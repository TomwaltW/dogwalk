// cloudfunctions/scanTag/core.js —— owner: T3
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { tagCode: String }
// data:  DogPublic —— 字段只能少不能多,见 spec 3.2「公开视图」
// 允许游客(ctx.openid === '')调用,这是 AUTH_REQUIRED 的唯一例外。
// ownerContact 仅当 lostMode === true 时非 null;每次扫码写一条 scanLogs。

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
