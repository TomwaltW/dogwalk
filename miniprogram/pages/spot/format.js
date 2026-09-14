/**
 * 点位详情页的展示格式化 —— 纯函数,不读时钟,不碰 wx。
 *
 * 抽出来有两个原因:WXML 里没法做字符串运算;页面模块按 spec 3.3.4 不该出现 Date。
 */

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * ISO8601 串 -> 本地时间的 'HH:MM'。空值 / 非法串一律返回 '',
 * 免得 NaN 顺着 setData 漏进 WXML。
 *
 * @param {string|Date} v
 * @returns {string}
 */
function formatHm(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

module.exports = { formatHm };
