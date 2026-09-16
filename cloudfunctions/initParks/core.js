// cloudfunctions/initParks/core.js —— owner: T7
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: {}
// data:  { inserted: Number, total: Number }
//
// 幂等:parks 非空时一条都不插。首页发现 listParks 返回空会自动调一次(spec 9.14),
// 所以这个函数可能被并发调到,「非空就不写」比「按 _id 去重」更省事也更稳。

const { CODES, fail, ok } = require('../_shared/errors');
const { COLL } = require('../_shared/contracts');
const { PARKS } = require('./seed');

/**
 * @param {object} event                云函数入参(不读)
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
async function core(event, ctx) {
  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const parks = ctx.db.collection(COLL.PARKS);
  const before = await parks.count();
  if (before.total > 0) return ok({ inserted: 0, total: before.total });

  for (const p of PARKS) {
    // 逐条 add 而不是一次 batch:云开发服务端 SDK 没有批量插入,三条而已
    await parks.add({ data: Object.assign({}, p) });
  }

  const after = await parks.count();
  return ok({ inserted: PARKS.length, total: after.total });
}

module.exports = core;
