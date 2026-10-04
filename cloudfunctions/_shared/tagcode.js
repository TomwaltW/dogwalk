/**
 * 身份牌短码 —— 长度取契约常量 TAG_CODE_LENGTH,字符集 [a-z0-9]。
 * dogCRUD create 建狗时就发码,genTagCode 只给老数据补码;scanTag / reportFound 用同一个正则校验。
 *
 * 为什么建狗时就发码:dogs.tagCode 上有唯一索引(database/indexes.md),
 * 若新狗一律写 '',全库同时只能有一只没码的狗,第二只的 add 会撞索引。
 */

const { COLL, TAG_CODE_LENGTH } = require('./contracts');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TAG_CODE_RE = new RegExp('^[a-z0-9]{' + TAG_CODE_LENGTH + '}$');
// 撞码重摇的上限。36^6 ≈ 22 亿,一个小区的狗量下撞满 12 次等于库坏了。
const MAX_TRIES = 12;

/** 随机一个短码。云函数里可以用 Math.random(),spec 3.3.4 那条禁令只约束页面。 */
function randomCode() {
  let code = '';
  for (let i = 0; i < TAG_CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * 摇一个库里没人用过的短码。没有事务,并发撞码由唯一索引兜底。
 *
 * @param {object} db
 * @returns {Promise<string|null>} 摇不出来返回 null
 */
async function pickUniqueCode(db) {
  for (let i = 0; i < MAX_TRIES; i += 1) {
    const code = randomCode();
    const { total } = await db.collection(COLL.DOGS).where({ tagCode: code }).count();
    if (!total) return code;
  }
  return null;
}

module.exports = { TAG_CODE_RE, randomCode, pickUniqueCode };
