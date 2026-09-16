// cloudfunctions/checkin/core.js —— owner: T2
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { spotId: String, dogIds: [String], startAt: String /* ISO8601 */, note?: String }
// data:  { checkinId: String, expireAt: String /* ISO8601 */, notified: Number }

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL, CHECKIN_DURATION_MS } = require('../_shared/contracts');

const NOTE_MAX = 30;

// 订阅消息「出门提醒」。契约(_shared/contracts.js)里没有冻结模板 id 与额度 key ——
// spec 8 只说了三个模板要总管自己去申请。这里先本地定死 key、模板 id 走环境变量,
// TΩ 合流时与 T3 的 subscribe.js 对齐同一个 key,并在云函数配置里填 TPL_CHECKIN_NEARBY。
const TEMPLATE_KEY = 'checkinNearby';
const TEMPLATE_ID = process.env.TPL_CHECKIN_NEARBY || '';

/**
 * 入参校验 —— 口径同 _shared/schema.js:通过返回 null,失败返回出错字段名。
 *
 * 之所以在这里内联而不是调 schema.validateCheckin():那个函数在 T0 的骨架里是
 * NOT_IMPLEMENTED 桩,而 _shared/** 是 T0 的 owner 文件,T2 不可写(spec 3.5)。
 *
 * @param {object} event
 * @returns {string|null}
 */
function validate(event) {
  const e = event || {};
  if (typeof e.spotId !== 'string' || !e.spotId) return 'spotId';
  if (!Array.isArray(e.dogIds) || e.dogIds.length === 0) return 'dogIds';
  if (e.dogIds.some((id) => typeof id !== 'string' || !id)) return 'dogIds';
  if (typeof e.startAt !== 'string' || Number.isNaN(new Date(e.startAt).getTime())) return 'startAt';
  if (e.note !== undefined && e.note !== null) {
    if (typeof e.note !== 'string' || e.note.length > NOTE_MAX) return 'note';
  }
  return null;
}

function dedupe(ids) {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/**
 * 给关注本点位的人发「出门提醒」。
 *
 * spec 3.4 的两条口径:
 *   - 订阅额度为 0:**不报错**,正常返回,notified 不含该用户;
 *   - openapi 调用失败:记 logger.error,**不影响主流程返回 ok**,且不扣该用户额度。
 *
 * @returns {Promise<number>} 实际发出的条数
 */
async function notifyFollowers(ctx, spot, checkin) {
  const send = ctx.openapi && ctx.openapi.subscribeMessage && ctx.openapi.subscribeMessage.send;
  if (typeof send !== 'function') return 0;

  let followers;
  try {
    // followSpotIds 是数组字段,配字面值即「数组里含这一项」
    const r = await ctx.db.collection(COLL.USERS).where({ followSpotIds: spot._id }).get();
    followers = r.data || [];
  } catch (e) {
    ctx.logger.error('checkin: 查关注者失败', e);
    return 0;
  }

  let notified = 0;
  for (const u of followers) {
    if (u._id === checkin.openid || u.status === 'banned') continue;
    const quota = ((u.subQuota || {})[TEMPLATE_KEY] || 0);
    if (quota <= 0) continue; // 额度为 0:静默跳过,不报错也不计数

    try {
      await ctx.openapi.subscribeMessage.send({
        touser: u._id,
        templateId: TEMPLATE_ID,
        page: 'pages/spot/spot?spotId=' + spot._id,
        data: {
          thing1: { value: spot.name || '' },
          time2: { value: new Date(checkin.startAt).toISOString() },
          thing3: { value: checkin.note || '有人出门遛狗了' },
        },
      });
      await ctx.db
        .collection(COLL.USERS)
        .doc(u._id)
        .update({ data: { ['subQuota.' + TEMPLATE_KEY]: ctx._.inc(-1) } });
      notified += 1;
    } catch (e) {
      // 发不出去不该拖垮广播本身
      ctx.logger.error('checkin: 订阅消息发送失败 touser=' + u._id, e);
    }
  }
  return notified;
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

  const bad = validate(event);
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  const spotId = event.spotId;
  const dogIds = dedupe(event.dogIds);
  const note = event.note || '';
  const now = ctx.now();
  const startAt = new Date(event.startAt);
  const expireAt = new Date(startAt.getTime() + CHECKIN_DURATION_MS);

  const spotRes = await ctx.db.collection(COLL.SPOTS).where({ _id: spotId }).limit(1).get();
  const spot = (spotRes.data || [])[0];
  if (!spot) return fail(CODES.NOT_FOUND, COLL.SPOTS);

  const dogRes = await ctx.db.collection(COLL.DOGS).where({ _id: ctx._.in(dogIds) }).get();
  const dogs = dogRes.data || [];
  if (dogs.length !== dogIds.length) return fail(CODES.NOT_FOUND, COLL.DOGS);
  if (dogs.some((d) => d.ownerOpenid !== ctx.openid)) return fail(CODES.FORBIDDEN);

  // CONFLICT 要四条同时成立:同一 openid + 同一 spotId + status active + 未过期(spec 3.4)
  const dup = await ctx.db
    .collection(COLL.CHECKINS)
    .where({ openid: ctx.openid, spotId: spotId, status: 'active', expireAt: ctx._.gt(now) })
    .limit(1)
    .get();
  if ((dup.data || []).length > 0) return fail(CODES.CONFLICT, 'active checkin exists');

  const doc = {
    openid: ctx.openid,
    dogIds: dogIds,
    spotId: spotId,
    startAt: startAt,
    expireAt: expireAt,
    note: note,
    status: 'active',
    createdAt: now,
  };
  const added = await ctx.db.collection(COLL.CHECKINS).add({ data: doc });

  const notified = await notifyFollowers(ctx, spot, doc);

  return ok({ checkinId: added._id, expireAt: expireAt.toISOString(), notified: notified });
}

module.exports = core;
// 订阅额度的记账 key,测试与 TΩ 对齐时用,免得两边各写一份字面量
module.exports.TEMPLATE_KEY = TEMPLATE_KEY;
