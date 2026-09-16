// cloudfunctions/parkBoard/core.js —— owner: T7
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2 —— 一个云函数两种返回形状:
// event: { parkId?: String }
// data(无 parkId): [ParkSummary]   只含 active:true 的公园,给首页地图 marker 用
// data(有 parkId): ParkBoard       { park, dogs, todayDogs, myCheckin }
//
// 这是唯一一个「给别人看」的接口,隐私口径卡死(spec 1「明确不做」、2.2 B6):
// 只回狗,不回主人 —— 没有 openid / ownerOpenid / nickname,狗一律裁成 DogCard 的 5 个字段;
// 坐标只有公园自己那份(公开数据),签到坐标本来就没落库。

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL } = require('../_shared/contracts');

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 东八区「今天 00:00」对应的 UTC 时刻(spec 9.5)。
 * 云函数运行时时区不保证是东八区,所以不用 getHours() 这类本地时间 API:
 * 先把时刻平移到东八区再取 ISO 的日期串,换算回来就是当天零点。
 *
 * @param {Date} now
 * @returns {Date}
 */
function cstDayStart(now) {
  const dayStr = new Date(now.getTime() + CST_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(new Date(dayStr + 'T00:00:00.000Z').getTime() - CST_OFFSET_MS);
}

/** spec 3.2.3 DogCard —— 恰好 5 个 key,一个都不能多 */
function toDogCard(dog) {
  return {
    dogId: dog._id,
    name: dog.name || '',
    avatarFileID: dog.avatarFileID || '',
    sizeClass: dog.sizeClass || '',
    tags: Array.isArray(dog.tags) ? dog.tags.slice() : [],
  };
}

/** spec 3.2.3 ParkSummary —— 公园自身坐标是公开数据,允许出现 */
function toParkSummary(park, activeDogCount) {
  return {
    parkId: park._id,
    name: park.name || '',
    latitude: park.latitude,
    longitude: park.longitude,
    radiusM: park.radiusM,
    activeDogCount: activeDogCount,
  };
}

/** 保序去重 */
function dedupe(ids) {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** 按签到顺序抽出去重后的 dogId */
function dogIdsOf(checkins) {
  return dedupe(checkins.reduce((acc, c) => acc.concat(c.dogIds || []), []));
}

/**
 * 此刻在场的签到:status active 且未过期。
 * 边界上 expireAt === now 算过期,所以是 _.gt 不是 _.gte(spec 2.2 B6)。
 *
 * 注:云开发服务端 get() 单次最多 100 条。v1 的公园数与同时在场人数远在这个量级之下;
 * 真到了要翻页的规模,是该上聚合查询的时候了(fake-db 不支持聚合,届时按 spec 7.3 报告)。
 */
function activeWhere(ctx, now, extra) {
  return Object.assign({ status: 'active', expireAt: ctx._.gt(now) }, extra || {});
}

/** _id → dog,一次把用到的狗全捞出来,不按条 N 次查库 */
async function loadDogIndex(ctx, ids) {
  const index = {};
  if (ids.length === 0) return index;
  const res = await ctx.db.collection(COLL.DOGS).where({ _id: ctx._.in(ids) }).get();
  (res.data || []).forEach((d) => {
    index[d._id] = d;
  });
  return index;
}

/** dogId 列表 → DogCard 列表;狗文档已经不在了就跳过 */
function toCards(ids, dogIndex) {
  return ids.filter((id) => dogIndex[id]).map((id) => toDogCard(dogIndex[id]));
}

/** 无 parkId:所有 active 公园 + 各自的在场狗数 */
async function listParks(ctx, now) {
  const parksRes = await ctx.db.collection(COLL.PARKS).where({ active: true }).get();
  const parks = parksRes.data || [];
  if (parks.length === 0) return ok([]);

  const checkinsRes = await ctx.db.collection(COLL.CHECKINS).where(activeWhere(ctx, now)).get();
  const byPark = {};
  (checkinsRes.data || []).forEach((c) => {
    if (!byPark[c.parkId]) byPark[c.parkId] = [];
    byPark[c.parkId].push(c);
  });

  // 一条签到都没有的公园给 0,不是不出现
  return ok(parks.map((p) => toParkSummary(p, dogIdsOf(byPark[p._id] || []).length)));
}

/** 有 parkId:公园看板 */
async function board(ctx, now, parkId) {
  const parkRes = await ctx.db.collection(COLL.PARKS).where({ _id: parkId }).limit(1).get();
  const park = (parkRes.data || [])[0];
  if (!park) return fail(CODES.NOT_FOUND, COLL.PARKS);

  const checkins = ctx.db.collection(COLL.CHECKINS);

  // 在场:排最近签到的在前,与 todayDogs 同一把尺子
  const activeRes = await checkins.where(activeWhere(ctx, now, { parkId: parkId })).orderBy('startAt', 'desc').get();
  const active = activeRes.data || [];

  // 今天来过:**不看 status**,已签退的也算(spec 9.5),按最近签到时间倒序
  const todayRes = await checkins
    .where({ parkId: parkId, startAt: ctx._.gte(cstDayStart(now)) })
    .orderBy('startAt', 'desc')
    .get();
  const today = todayRes.data || [];

  const activeIds = dogIdsOf(active);
  const todayIds = dogIdsOf(today);
  const dogIndex = await loadDogIndex(ctx, dedupe(activeIds.concat(todayIds)));

  // 同一个人同一公园正常只会有一条在场签到(checkin 的 CONFLICT 拦着),
  // 真出现多条就认最近那一条 —— 签退页只需要一个 checkinId。
  const mine = active.find((c) => c.openid === ctx.openid);

  return ok({
    // activeDogCount 数的是在场签到里去重后的 dogId,与无 parkId 那一路同口径:
    // 不查狗文档在不在,所以狗被删掉时它可能比 dogs.length 大
    park: toParkSummary(park, activeIds.length),
    dogs: toCards(activeIds, dogIndex),
    todayDogs: toCards(todayIds, dogIndex),
    myCheckin: mine
      ? { checkinId: mine._id, dogIds: (mine.dogIds || []).slice(), expireAt: new Date(mine.expireAt).toISOString() }
      : null,
  });
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
async function core(event, ctx) {
  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const parkId = (event || {}).parkId;
  const now = ctx.now();
  return typeof parkId === 'string' && parkId !== ''
    ? board(ctx, now, parkId)
    : listParks(ctx, now);
}

module.exports = core;
