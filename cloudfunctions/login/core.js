// cloudfunctions/login/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { profile?: { nickname: String, avatarFileID: String } }
// data:  { user: User, dogs: [Dog] }
// 首次调用创建 users 文档(_id 即 _openid);二次调用不重复创建,也不动两本账
// (subQuota / subTemplates,见 spec 3.2.2)。
// ctx.openid === '' → fail(AUTH_REQUIRED)

const { COLL } = require('../_shared/contracts');
const { CODES, fail, ok } = require('../_shared/errors');

const NICKNAME_MAX = 20; // 微信昵称上限口径,与前端保持一致

/**
 * 校验 login 带上来的用户资料。通过返回 null,失败返回字段名。
 *
 * @param {object} [profile]  { nickname, avatarFileID };缺省视为通过
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateProfile(profile) {
  if (profile === undefined || profile === null) return null;
  if (typeof profile !== 'object' || Array.isArray(profile)) return 'profile';

  if (profile.nickname !== undefined) {
    if (typeof profile.nickname !== 'string') return 'nickname';
    const n = profile.nickname.trim().length;
    if (n < 1 || n > NICKNAME_MAX) return 'nickname';
  }
  if (profile.avatarFileID !== undefined && typeof profile.avatarFileID !== 'string') {
    return 'avatarFileID';
  }
  return null;
}

/** profile 里允许写进 users 的字段,给了才写 */
function profilePatch(profile) {
  const patch = {};
  if (!profile) return patch;
  if (typeof profile.nickname === 'string') patch.nickname = profile.nickname.trim();
  if (typeof profile.avatarFileID === 'string') patch.avatarFileID = profile.avatarFileID;
  return patch;
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};
  const openid = ctx.openid;

  if (!openid) return fail(CODES.AUTH_REQUIRED);

  const bad = validateProfile(e.profile);
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  try {
    const users = ctx.db.collection(COLL.USERS);
    const now = ctx.now();
    const patch = profilePatch(e.profile);

    // users 的 _id 即 _openid(spec 3.2.2)。doc(id).get() 在文档不存在时是
    // reject 而不是 resolve(null),所以判存在走 where 更省事。
    const found = await users.where({ _openid: openid }).get();
    let user = found.data[0];

    if (!user) {
      const doc = Object.assign(
        {
          _openid: openid,
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
        },
        patch
      );
      await users.doc(openid).set({ data: doc });
      user = Object.assign({ _id: openid }, doc);
    } else {
      // 绑定开放平台之前注册的老用户,这里自动补上 unionid ——
      // 绑定那天不需要做数据迁移,人回来登录一次就补齐了。
      if (ctx.unionid && user.unionid !== ctx.unionid) patch.unionid = ctx.unionid;

      // 二次调用只覆盖 profile 带来的字段(外加上面那次补录);createdAt 与
      // 两本账(subQuota / subTemplates)原样保留 —— 额度是用户一次次授权
      // 攒下来的,登录不该清零。
      if (Object.keys(patch).length) {
        patch.updatedAt = now;
        await users.doc(user._id).update({ data: patch });
        user = Object.assign(user, patch);
      }
    }

    const dogs = await ctx.db
      .collection(COLL.DOGS)
      .where({ ownerOpenid: openid })
      .orderBy('createdAt', 'asc')
      .get();

    return ok({ user, dogs: dogs.data });
  } catch (err) {
    // core 永远不把异常抛给调用方(spec 3.1)
    if (ctx.logger && ctx.logger.error) ctx.logger.error('login failed', err);
    return fail(CODES.INTERNAL, err.message);
  }
};
