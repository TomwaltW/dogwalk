/**
 * 服务端 SDK 的 get() 不带 limit 时默认最多回 100 条,超出的部分静默丢掉。
 * 结果集可能超过 100 条的查询一律走 getAll 分页取全。
 */

const PAGE = 100;
// 安全阀:单次查询最多翻 50 页(5000 条),防止数据异常时把云函数拖到超时
const MAX_PAGES = 50;

/**
 * @param {object} query  collection(...).where(...)[.orderBy(...)],不要自己带 skip / limit
 * @returns {Promise<{data: Array<object>}>}
 */
async function getAll(query) {
  const data = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await query.skip(page * PAGE).limit(PAGE).get();
    data.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return { data };
}

module.exports = { getAll, PAGE };
