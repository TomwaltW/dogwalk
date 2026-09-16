/**
 * ApiError -> 给用户看的一句话 —— owner: T10,约遛三页共用。
 *
 * 错误码见 spec 3.1;页面捕获 ApiError 后一律走这里得到 errMsg,
 * 不抛、不白屏(spec 3.4 末两行)。
 */

/** 默认文案。某一页需要更贴切的说法,调用时用 overrides 盖掉那一条 */
const TEXT = {
  AUTH_REQUIRED: '还没登录,去「我的」登录一下再回来',
  INVALID_PARAM: '填的信息不太对,检查一下再试',
  NOT_FOUND: '这条约遛不在了,回列表看看别的',
  FORBIDDEN: '你没有权限做这一步',
  CONFLICT: '状态刚变过,刷新一下再试',
  CONTENT_RISKY: '这段文字没通过内容检查,换个说法再发',
  WALK_FULL: '狗数已满,改上限得重新发起',
  INTERNAL: '网络或者服务出了点问题,稍后再试',
};

/**
 * @param {Error & {code?:string}} e            api 层 reject 的 ApiError
 * @param {Object<string,string>} [overrides]   按错误码覆盖默认文案
 * @returns {string} 一定非空,兜底用 e.message
 */
function errText(e, overrides) {
  const code = (e && e.code) || '';
  if (overrides && overrides[code]) return overrides[code];
  if (TEXT[code]) return TEXT[code];
  return (e && e.message) || '出了点问题,稍后再试';
}

module.exports = { errText, TEXT };
