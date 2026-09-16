// cloudfunctions/foundReports/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { dogId: String }
// data:  [FoundReport]   —— createdAt 倒序,最多 50 条,形状见 spec 3.2.3
// 只有狗主人能看自己狗的寻回留言。

const { COLL } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');

const MAX_REPORTS = 50;

/**
 * found_reports 文档 → FoundReport(spec 3.2.3)。
 * reporterOpenid / notified / tagCode / dogId 是内部字段,不出去。
 *
 * @param {object} row
 * @returns {object} FoundReport
 */
function toFoundReport(row) {
  return {
    reportId: row._id,
    message: typeof row.message === 'string' ? row.message : '',
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};

  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const dogId = e.dogId;
  if (typeof dogId !== 'string' || dogId === '') return fail(CODES.INVALID_PARAM, 'dogId');

  const found = await ctx.db.collection(COLL.DOGS).where({ _id: dogId }).limit(1).get();
  const dog = found.data[0];
  if (!dog) return fail(CODES.NOT_FOUND, COLL.DOGS);
  if (dog.ownerOpenid !== ctx.openid) return fail(CODES.FORBIDDEN);

  const rows = await ctx.db
    .collection(COLL.FOUND_REPORTS)
    .where({ dogId })
    .orderBy('createdAt', 'desc')
    .limit(MAX_REPORTS)
    .get();

  return ok(rows.data.map(toFoundReport));
};
