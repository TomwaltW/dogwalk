// cloudfunctions/dogCRUD/core.js —— owner: T1
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { action: 'create'|'update'|'get'|'listMine'|'remove', dog?: Partial<Dog>, dogId?: String }
// data:  Dog | [Dog] | { removed: true }
// 他人的狗 → fail(FORBIDDEN);枚举非法 → fail(INVALID_PARAM, '<字段名>')

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
