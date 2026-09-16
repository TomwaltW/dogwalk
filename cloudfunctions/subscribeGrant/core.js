// cloudfunctions/subscribeGrant/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { templateKey: String /* ∈ TEMPLATE_KEYS 的值 */, templateId: String }
// data:  { remaining: Number }
//
// 微信的一次性订阅是「用户同意一次 = 攒一条」,所以前端每次 wx.requestSubscribeMessage
// 拿到 accept 就调一次这里:额度 +1,同时把模板 id 记在用户文档上(spec 9 节假设 10,
// 这样所有要填的 id 只在 miniprogram/config.js 一处)。

const { COLL, TEMPLATE_KEYS } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');

const VALID_KEYS = Object.values(TEMPLATE_KEYS);

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};

  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const templateKey = e.templateKey;
  if (typeof templateKey !== 'string' || VALID_KEYS.indexOf(templateKey) < 0) {
    return fail(CODES.INVALID_PARAM, 'templateKey');
  }

  const templateId = typeof e.templateId === 'string' ? e.templateId.trim() : '';
  if (templateId === '') return fail(CODES.INVALID_PARAM, 'templateId');

  const users = ctx.db.collection(COLL.USERS);

  // 没登录过就没有账本。这里不顺手建文档:users 的形状归 login 管(spec 3.5)。
  const found = await users.where({ _openid: ctx.openid }).limit(1).get();
  const user = found.data[0];
  if (!user) return fail(CODES.NOT_FOUND, COLL.USERS);

  await users.doc(user._id).update({
    data: {
      ['subQuota.' + templateKey]: ctx._.inc(1),
      ['subTemplates.' + templateKey]: templateId,
      updatedAt: ctx.now(),
    },
  });

  // 重新读一次再算余额:并发授权时以库里的为准,不拿本地加出来的数糊弄调用方。
  const after = (await users.doc(user._id).get()).data;
  const remaining = (after.subQuota && after.subQuota[templateKey]) || 0;

  return ok({ remaining });
};
