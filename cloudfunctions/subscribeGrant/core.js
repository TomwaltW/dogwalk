// cloudfunctions/subscribeGrant/core.js —— owner: ��此刻是 T0' 留的空桩,真实现见 docs/dispatch/T6.md。
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// event / data 形状见 docs/dev-spec-2026-09-16.md 3.3.2「��一段。

const { fail, CODES } = require('../_shared/errors');

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  return fail(CODES.INTERNAL, 'NOT_IMPLEMENTED: subscribeGrant');
};
