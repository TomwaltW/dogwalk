/**
 * users 文档的形状与「没有就建」—— login 与 subscribeGrant 共用(spec 3.2.2)。
 * users 的 _id 即 _openid。
 */

const { COLL } = require('./contracts');

/**
 * 新用户文档(不含 _id)。
 *
 * @param {object} ctx  spec 3.3.1
 * @returns {object}
 */
function newUserDoc(ctx) {
  const now = ctx.now();
  return {
    _openid: ctx.openid,
    // 跨端身份,口径见 _shared/runtime.js 的 handler 注释:
    // 只记录不夺权,没绑开放平台时是空串,不影响本端任何逻辑。
    unionid: ctx.unionid || '',
    nickname: '',
    avatarFileID: '',
    subQuota: {},
    subTemplates: {},
    status: 'normal',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 取调用者的 users 文档,不存在就按 newUserDoc 建一份。
 * 只要用户能调云函数,账本就该在 —— 不能指望用户先去「我的」页点登录。
 *
 * @param {object} ctx
 * @param {object} [patch]  新建时叠加在默认值上的字段
 * @returns {Promise<{user: object, created: boolean}>}
 */
async function ensureUser(ctx, patch) {
  const users = ctx.db.collection(COLL.USERS);
  // doc(id).get() 在文档不存在时 reject,判存在走 where 更省事
  const found = await users.where({ _openid: ctx.openid }).limit(1).get();
  if (found.data[0]) return { user: found.data[0], created: false };

  const doc = Object.assign(newUserDoc(ctx), patch || {});
  // set 是 upsert:两个请求并发建同一个用户也只会落一份
  await users.doc(ctx.openid).set({ data: doc });
  return { user: Object.assign({ _id: ctx.openid }, doc), created: true };
}

module.exports = { newUserDoc, ensureUser };
