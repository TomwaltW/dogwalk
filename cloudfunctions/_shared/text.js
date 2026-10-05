/**
 * 文本与东八区时间的小工具,多个云函数共用。
 */

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 字符数按码位算 —— 'a'.length 和 '🐶'.length 不一样,中文和 emoji
 * 都得按人眼看到的字数来数。
 *
 * @param {string} s
 * @returns {number}
 */
function charLength(s) {
  return Array.from(String(s)).length;
}

/** 取前 n 个码位,不从 emoji 中间切断 */
function headChars(s, n) {
  return Array.from(String(s)).slice(0, n).join('');
}

module.exports = { CST_OFFSET_MS, charLength, headChars };
