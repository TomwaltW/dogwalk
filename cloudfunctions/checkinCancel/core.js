// cloudfunctions/checkinCancel/core.js —— owner: T7
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { checkinId: String }
// data:  { cancelled: true }

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL } = require('../_shared/contracts');

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
async function core(event, ctx) {
  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const e = event || {};
  if (typeof e.checkinId !== 'string' || e.checkinId === '') {
    return fail(CODES.INVALID_PARAM, 'checkinId');
  }

  // doc().get() 查不到会 reject,这里用 where 拿,免得把「不存在」走进 catch
  const res = await ctx.db.collection(COLL.CHECKINS).where({ _id: e.checkinId }).limit(1).get();
  const checkin = (res.data || [])[0];
  if (!checkin) return fail(CODES.NOT_FOUND, COLL.CHECKINS);
  if (checkin.openid !== ctx.openid) return fail(CODES.FORBIDDEN);

  // 幂等:已经是 cancelled 也照样回 {cancelled:true},且不刷新 cancelledAt ——
  // 重复点「签退」不该报错,也不该把签退时间改成第二次点的时刻。
  if (checkin.status !== 'cancelled') {
    await ctx.db
      .collection(COLL.CHECKINS)
      .doc(checkin._id)
      .update({ data: { status: 'cancelled', cancelledAt: ctx.now() } });
  }

  return ok({ cancelled: true });
}

module.exports = core;
