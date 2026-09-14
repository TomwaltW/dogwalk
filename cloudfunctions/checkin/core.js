// cloudfunctions/checkin/core.js —— owner: T2
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { spotId: String, dogIds: [String], startAt: String /* ISO8601 */, note?: String }
// data:  { checkinId: String, expireAt: String /* ISO8601 */, notified: Number }
// expireAt = startAt + CHECKIN_DURATION_MS(90 分钟)。
// 同一 openid 在同一 spotId 已有 active 且未过期的 checkin → fail(CONFLICT, 'active checkin exists')
// 订阅消息额度为 0 不报错,notified 不含该用户;openapi 失败记 logger.error 不影响返回 ok。

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
module.exports = async function core(event, ctx) {
  throw new Error('NOT_IMPLEMENTED');
};
