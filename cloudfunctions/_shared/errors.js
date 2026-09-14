/**
 * 统一返回形状与错误码 —— spec 3.1,冻结契约。
 *
 * 所有云函数 core 的返回值只有两种形状:
 *   { ok: true,  data: <any> }
 *   { ok: false, code: <ErrorCode>, msg: <string> }
 *
 * 云函数永远不抛异常给调用方,一律返回 fail(...);
 * index.js 外层 try/catch 兜底成 fail(INTERNAL, e.message)。
 */

const CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED', // 无 openid
  INVALID_PARAM: 'INVALID_PARAM', // 参数校验失败
  NOT_FOUND: 'NOT_FOUND', // 资源不存在
  FORBIDDEN: 'FORBIDDEN', // 非本人资源
  CONFLICT: 'CONFLICT', // 状态冲突(如重复广播)
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED', // 订阅消息额度不足
  INTERNAL: 'INTERNAL', // 兜底
};

/**
 * @param {string} code  CODES 之一
 * @param {string} [msg] 失败细节;参数校验失败时按 spec 3.4 填字段名
 * @returns {{ok:false, code:string, msg:string}}
 */
function fail(code, msg) {
  return { ok: false, code, msg: msg || code };
}

/**
 * @param {*} data 成功载荷;undefined 归一成 null
 * @returns {{ok:true, data:*}}
 */
function ok(data) {
  return { ok: true, data: data === undefined ? null : data };
}

module.exports = { CODES, fail, ok };
