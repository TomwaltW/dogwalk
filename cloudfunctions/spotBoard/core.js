// cloudfunctions/spotBoard/core.js —— owner: T2
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2 —— 一个云函数两种返回形状:
// event: { spotId?: String }
// data(无 spotId): [{ spotId, name, peakHint, regularCount, activeDogCount, activePeopleCount }]
// data(有 spotId): { spot: Spot, sessions: [BoardSession], wxGroupQrFileID }
//
// 聚合口径与 miniprogram/logic/presence.js 一致(见那边的注释:跨根 require 在云上
// resolve 不到,_shared/ 又是 T0 的 owner 文件不可写,只能两边各留一份)。改这里记得同步改那边。

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL } = require('../_shared/contracts');

/** socialOk === false 的狗不参与社交,不在看板露出(spec 3.2) */
function isVisibleDog(dog) {
  return !!dog && dog.socialOk !== false;
}

function toBoardDog(dog) {
  return {
    name: dog.name || '',
    avatarFileID: dog.avatarFileID || '',
    sizeClass: dog.sizeClass || '',
  };
}

function toIso(v) {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function indexById(docs) {
  const out = {};
  (docs || []).forEach((d) => {
    if (d && d._id !== undefined) out[d._id] = d;
  });
  return out;
}

/**
 * 按 openid 把广播并成在场记录:同一个人无论一条广播带多只狗、还是发了几条,
 * 看板上都只占一行(spec 2.2 B8)。起点取最早、终点取最晚、note 取最近一条非空的。
 *
 * @param {Array<object>} checkins   已经过滤成「在场」的广播,按 startAt 升序
 * @param {object} dogIndex          _id → dog
 * @param {object} userIndex         _id → user
 * @returns {Array<object>} BoardSession[]
 */
function aggregate(checkins, dogIndex, userIndex) {
  const groups = [];
  const byOpenid = {};

  checkins.forEach((c) => {
    const openid = c.openid || '';
    let g = byOpenid[openid];
    if (!g) {
      g = { openid: openid, dogIds: [], startAt: null, expireAt: null, note: '' };
      byOpenid[openid] = g;
      groups.push(g);
    }
    (c.dogIds || []).forEach((id) => {
      if (g.dogIds.indexOf(id) < 0) g.dogIds.push(id);
    });
    const startAt = new Date(c.startAt).getTime();
    const expireAt = new Date(c.expireAt).getTime();
    if (!Number.isNaN(startAt) && (g.startAt === null || startAt < g.startAt)) g.startAt = startAt;
    if (!Number.isNaN(expireAt) && (g.expireAt === null || expireAt > g.expireAt)) g.expireAt = expireAt;
    if (c.note) g.note = c.note; // 入参已按 startAt 升序,后写的就是最近的
  });

  return groups
    .map((g) => {
      const user = userIndex[g.openid] || {};
      return {
        openid: g.openid,
        nickname: user.nickname || '',
        avatarFileID: user.avatarFileID || '',
        dogs: g.dogIds.map((id) => dogIndex[id]).filter(isVisibleDog).map(toBoardDog),
        startAt: toIso(g.startAt),
        expireAt: toIso(g.expireAt),
        note: g.note,
      };
    })
    .filter((s) => s.dogs.length > 0); // 一只露得出来的狗都没有,这条就不该占位
}

/**
 * 拉在场广播:两个条件同时成立 —— expireAt > now 且 status === 'active'(spec 2.2 B4)。
 * 边界上 expireAt === now 算过期(_.gt 不是 _.gte),与 presence.isActive() 同口径。
 */
// 注:云开发服务端 get() 单次最多 100 条。v1 的点位数与同时在场人数远在这个量级之下,
// 真到了要翻页的规模,是该上聚合查询的时候了(fake-db 不支持聚合,届时按 spec 7.3 报告)。
async function activeCheckins(ctx, where) {
  const now = ctx.now();
  const q = Object.assign({ status: 'active', expireAt: ctx._.gt(now) }, where);
  const res = await ctx.db.collection(COLL.CHECKINS).where(q).orderBy('startAt', 'asc').get();
  return res.data || [];
}

/** 把广播里引用到的狗和人一次性捞出来,避免按条 N 次查库 */
async function loadRefs(ctx, checkins) {
  const dogIds = [];
  const openids = [];
  checkins.forEach((c) => {
    (c.dogIds || []).forEach((id) => {
      if (dogIds.indexOf(id) < 0) dogIds.push(id);
    });
    if (c.openid && openids.indexOf(c.openid) < 0) openids.push(c.openid);
  });

  const dogs = dogIds.length
    ? (await ctx.db.collection(COLL.DOGS).where({ _id: ctx._.in(dogIds) }).get()).data || []
    : [];
  const users = openids.length
    ? (await ctx.db.collection(COLL.USERS).where({ _id: ctx._.in(openids) }).get()).data || []
    : [];

  return { dogIndex: indexById(dogs), userIndex: indexById(users) };
}

/** 无 spotId:所有上架点位的摘要列表。一条广播都没有时给 0,不报错。 */
async function listSummaries(ctx) {
  const spots = (await ctx.db.collection(COLL.SPOTS).where({ active: true }).get()).data || [];
  const checkins = await activeCheckins(ctx, {});
  const { dogIndex, userIndex } = await loadRefs(ctx, checkins);

  return spots.map((spot) => {
    const sessions = aggregate(
      checkins.filter((c) => c.spotId === spot._id),
      dogIndex,
      userIndex
    );
    return {
      spotId: spot._id,
      name: spot.name || '',
      peakHint: spot.peakHint || '',
      regularCount: spot.regularCount || 0,
      activeDogCount: sessions.reduce((n, s) => n + s.dogs.length, 0),
      activePeopleCount: sessions.length,
    };
  });
}

/** 有 spotId:点位详情。点位不存在才报 NOT_FOUND,没人在场只是 sessions 为空数组。 */
async function spotDetail(ctx, spotId) {
  const spot = ((await ctx.db.collection(COLL.SPOTS).where({ _id: spotId }).limit(1).get()).data || [])[0];
  if (!spot) return fail(CODES.NOT_FOUND, COLL.SPOTS);

  const checkins = await activeCheckins(ctx, { spotId: spotId });
  const { dogIndex, userIndex } = await loadRefs(ctx, checkins);

  return ok({
    spot: spot,
    sessions: aggregate(checkins, dogIndex, userIndex),
    wxGroupQrFileID: spot.wxGroupQrFileID || '',
  });
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx
 * @param {object} ctx.db               云开发 db 实例(测试时为 fake-db)
 * @param {object} ctx._                db.command
 * @param {string} ctx.openid           调用者 openid,游客为 ''
 * @param {() => Date} ctx.now          取当前时间,禁止直接 new Date()
 * @param {object} ctx.openapi          cloud.openapi,测试时为 mock
 * @param {{info:Function,error:Function}} ctx.logger
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
async function core(event, ctx) {
  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const e = event || {};
  if (e.spotId !== undefined && e.spotId !== null && typeof e.spotId !== 'string') {
    return fail(CODES.INVALID_PARAM, 'spotId');
  }

  // 空串按「没给 spotId」处理:首页 listSpots() 和详情页 getSpotBoard() 共用这一个云函数
  return e.spotId ? spotDetail(ctx, e.spotId) : ok(await listSummaries(ctx));
}

module.exports = core;
