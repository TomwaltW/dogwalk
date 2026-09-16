/**
 * 内容安全 —— spec 3.3.1 的 ctx.security,T0' 提供。
 *
 *   checkText(text)    security.msgSecCheck(v2)。空串 / 纯空白直接 true。
 *   checkImage(fileID) 先 storage.downloadFile 拿 buffer,再 security.imgSecCheck。'' 直接 true。
 *
 * 口径(总管定的取舍,spec 3.3.1):
 *   - 接口明确判 risky / review(v2)或 errCode 87014(v1)→ false,调用方返回 CONTENT_RISKY 且不写库
 *   - 接口本身调用失败(网络、额度、未开通)→ logger.error 后 true(放行)。
 *     内容安全挂了不能让整个 app 不能建档。
 *
 * 测试里不要用这个文件,用 tests/fakes/cloud-ctx.js 的 makeTestCtx({ risky, riskyImages })。
 */

/** 违规内容的 errCode,v1 imgSecCheck / msgSecCheck 都用它 */
const RISKY_ERR_CODE = 87014;

const EXT_CONTENT_TYPE = {
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** 按 fileID 的扩展名猜 contentType,猜不出按 jpeg */
function contentTypeOf(fileID) {
  const m = /\.([a-z0-9]+)(\?.*)?$/i.exec(String(fileID || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_CONTENT_TYPE[ext] || 'image/jpeg';
}

function isRiskyError(e) {
  return !!e && (e.errCode === RISKY_ERR_CODE || e.errcode === RISKY_ERR_CODE);
}

/**
 * @param {object} deps
 * @param {object} deps.openapi   cloud.openapi
 * @param {object} deps.storage   { downloadFile(fileID) => Promise<Buffer> }
 * @param {string} deps.openid    调用者 openid,msgSecCheck v2 要带
 * @param {{error:Function}} [deps.logger]
 * @returns {{checkText:Function, checkImage:Function}}
 */
function createSecurity(deps) {
  const { openapi, storage, openid } = deps || {};
  const logger = (deps && deps.logger) || console;
  const sec = openapi && openapi.security;

  async function checkText(text) {
    if (typeof text !== 'string' || text.trim() === '') return true;
    if (!sec || typeof sec.msgSecCheck !== 'function') {
      logger.error('security: msgSecCheck 不可用,放行');
      return true;
    }
    try {
      const res = await sec.msgSecCheck({
        openid: openid || undefined,
        scene: 2, // 2 = 评论,用户生成内容一律按这个场景
        version: 2,
        content: text,
      });
      const suggest = res && res.result && res.result.suggest;
      if (suggest === 'risky' || suggest === 'review') return false;
      if (res && (res.errCode === RISKY_ERR_CODE || res.errcode === RISKY_ERR_CODE)) return false;
      return true;
    } catch (e) {
      if (isRiskyError(e)) return false;
      logger.error('security: msgSecCheck 调用失败,放行', (e && e.message) || e);
      return true;
    }
  }

  async function checkImage(fileID) {
    if (typeof fileID !== 'string' || fileID === '') return true;
    if (!sec || typeof sec.imgSecCheck !== 'function' || !storage) {
      logger.error('security: imgSecCheck 不可用,放行');
      return true;
    }
    try {
      const buffer = await storage.downloadFile(fileID);
      const res = await sec.imgSecCheck({
        media: { contentType: contentTypeOf(fileID), value: buffer },
      });
      if (res && (res.errCode === RISKY_ERR_CODE || res.errcode === RISKY_ERR_CODE)) return false;
      return true;
    } catch (e) {
      if (isRiskyError(e)) return false;
      logger.error('security: imgSecCheck 调用失败,放行', (e && e.message) || e);
      return true;
    }
  }

  return { checkText, checkImage };
}

module.exports = { createSecurity, contentTypeOf, RISKY_ERR_CODE };
