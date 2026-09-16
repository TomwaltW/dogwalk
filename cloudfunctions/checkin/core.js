// cloudfunctions/checkin/core.js —— owner: T7
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { parkId: String, dogIds: [String], latitude: Number, longitude: Number }
// data:  { checkinId: String, expireAt: String /* ISO */ }
//
// 校验顺序是契约的一部分,别调:AUTH → 参数 → 公园存在且 active → 狗都是自己的
//   → 围栏 → 同公园 CONFLICT → 其他公园的在场签到置 cancelled → 写新文档。
// 坐标只用来算围栏,**算完即弃**:checkins 文档没有坐标字段,永远不要加(spec 1「明确不做」)。

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL, CHECKIN_DURATION_MS } = require('../_shared/contracts');
const geo = require('../_shared/geo');

/** 非空字符串 */
function isNonEmptyStr(v) {
  return typeof v === 'string' && v !== '';
}

function dedupe(ids) {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/**
 * 入参校验 —— 通过返回 null,失败返回出错字段名(spec 3.4:msg = 字段名)。
 * @param {object} event
 * @returns {string|null}
 */
function validate(event) {
  const e = event || {};
  if (!isNonEmptyStr(e.parkId)) return 'parkId';
  if (!Array.isArray(e.dogIds) || e.dogIds.length === 0) return 'dogIds';
  if (!e.dogIds.every(isNonEmptyStr)) return 'dogIds';
  // isLatLng 一次判两个值,这里各配一个必定合法的对手,好把错误定位到具体字段
  if (!geo.isLatLng(e.latitude, 0)) return 'latitude';
  if (!geo.isLatLng(0, e.longitude)) return 'longitude';
  return null;
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
async function core(event, ctx) {
  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const bad = validate(event);
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  const parkId = event.parkId;
  const dogIds = dedupe(event.dogIds);
  const now = ctx.now();

  // 公园:停用的公园等同于不存在,不让签进去
  const parkRes = await ctx.db.collection(COLL.PARKS).where({ _id: parkId, active: true }).limit(1).get();
  const park = (parkRes.data || [])[0];
  if (!park) return fail(CODES.NOT_FOUND, COLL.PARKS);

  // 狗:先看在不在,再看是不是自己的 —— 归属问题不该被「查不到」盖过去
  const dogRes = await ctx.db.collection(COLL.DOGS).where({ _id: ctx._.in(dogIds) }).get();
  const dogs = dogRes.data || [];
  if (dogs.length !== dogIds.length) return fail(CODES.NOT_FOUND, COLL.DOGS);
  if (dogs.some((d) => d.ownerOpenid !== ctx.openid)) return fail(CODES.FORBIDDEN);

  // 围栏:fake-db 不支持地理查询(spec 3.3.5),也不需要 —— 点到圆心一次 haversine 就够
  const distance = geo.distanceM(event.latitude, event.longitude, park.latitude, park.longitude);
  if (!(distance <= park.radiusM)) return fail(CODES.OUT_OF_RANGE, String(Math.round(distance)));

  // 「在场」= status active 且未过期;边界上 expireAt === now 算过期(_.gt 不是 _.gte)
  const activeMine = { openid: ctx.openid, status: 'active', expireAt: ctx._.gt(now) };

  const dup = await ctx.db
    .collection(COLL.CHECKINS)
    .where(Object.assign({ parkId: parkId }, activeMine))
    .limit(1)
    .get();
  if ((dup.data || []).length > 0) return fail(CODES.CONFLICT, 'active checkin exists');

  // 一人一时只在一个公园(spec 9.4):换公园自动把别处的在场签到签退
  await ctx.db
    .collection(COLL.CHECKINS)
    .where(Object.assign({ parkId: ctx._.neq(parkId) }, activeMine))
    .update({ data: { status: 'cancelled', cancelledAt: now } });

  const startAt = now; // 不信客户端传来的时间
  const expireAt = new Date(startAt.getTime() + CHECKIN_DURATION_MS);
  const added = await ctx.db.collection(COLL.CHECKINS).add({
    data: {
      openid: ctx.openid,
      parkId: parkId,
      dogIds: dogIds,
      startAt: startAt,
      expireAt: expireAt,
      status: 'active',
      createdAt: now,
    },
  });

  return ok({ checkinId: added._id, expireAt: expireAt.toISOString() });
}

module.exports = core;
