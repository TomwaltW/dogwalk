// cloudfunctions/genTagCode/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { dogId: String }
// data:  { tagCode: String, qrFileID: String }
// tagCode 长度为 TAG_CODE_LENGTH 的 [a-z0-9],全局唯一;新狗建档时已由 dogCRUD 发码,
// 这里只给老数据补码。已生成过则复用,不重摇也不重传。

const { COLL } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');
const { pickUniqueCode } = require('../_shared/tagcode');

// 小程序码扫出来落到哪一页(spec 3.3.2)。这一页是游客可见的寻回页。
const QR_PAGE = 'pages/dog/profile/profile';

/**
 * 给还没有码的老狗补一个码。新狗在 dogCRUD create 时就发了码,这里只兜老数据。
 *
 * 并发安全:只在 tagCode 仍为 '' 时写入(条件更新)。两个请求同时补码,
 * 只有一个写得进去;输的那个回读库里的码返回,不会把作废的码交给页面。
 *
 * @returns {Promise<string|null>} 库里最终的码;摇不出来返回 null
 */
async function claimCode(db, dogId) {
  const code = await pickUniqueCode(db);
  if (!code) return null;
  const dogs = db.collection(COLL.DOGS);
  const r = await dogs.where({ _id: dogId, tagCode: '' }).update({ data: { tagCode: code } });
  if (r && r.stats && r.stats.updated) return code;
  const now = (await dogs.doc(dogId).get()).data;
  return (now && now.tagCode) || null;
}

/**
 * 生成狗牌小程序码并落进云存储,拿到 fileID。
 *
 * wxacode.getUnlimited 返回的是 { buffer, contentType },要变成能在 <image> 里显示的
 * fileID 还得过一次 ctx.storage.uploadFile(spec 3.3.1)。
 *
 * spec 3.4:openapi / 云存储任一环节出错都只记 logger.error,qrFileID 留空串,
 * 主流程仍返回 ok —— dogs.qrFileID 允许为 ''(spec 3.2.2),下次进身份牌页会再试一次。
 *
 * @param {string} tagCode
 * @param {object} ctx
 * @returns {Promise<string>} 拿不到就是空串
 */
async function makeQrFileID(tagCode, ctx) {
  const logger = ctx.logger || console;
  const wxacode = ctx.openapi && ctx.openapi.wxacode;
  if (!wxacode || typeof wxacode.getUnlimited !== 'function') {
    logger.error('genTagCode: openapi.wxacode 不可用,qrFileID 留空', { tagCode });
    return '';
  }
  try {
    const res = await wxacode.getUnlimited({ scene: tagCode, page: QR_PAGE, checkPath: false });
    if (!res || !res.buffer) {
      logger.error('genTagCode: 小程序码没带回 buffer,qrFileID 留空', { tagCode });
      return '';
    }
    return await ctx.storage.uploadFile('tags/' + tagCode + '.png', res.buffer);
  } catch (e) {
    logger.error('genTagCode: 生成或上传小程序码失败', { tagCode, msg: e && e.message });
    return '';
  }
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const { db } = ctx;

  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const dogId = event && event.dogId;
  if (typeof dogId !== 'string' || dogId === '') return fail(CODES.INVALID_PARAM, 'dogId');

  let dog;
  try {
    dog = (await db.collection(COLL.DOGS).doc(dogId).get()).data;
  } catch {
    return fail(CODES.NOT_FOUND, COLL.DOGS);
  }
  if (!dog) return fail(CODES.NOT_FOUND, COLL.DOGS);
  if (dog.ownerOpenid !== ctx.openid) return fail(CODES.FORBIDDEN);

  // 已生成过就复用已有的,不新建 —— 身份牌是印出来贴狗身上的,换码等于旧牌作废。
  const oldCode = typeof dog.tagCode === 'string' ? dog.tagCode : '';
  const tagCode = oldCode || (await claimCode(db, dogId));
  if (!tagCode) return fail(CODES.INTERNAL, 'tagCode generate failed');

  // 码同理:已有就不重新生成,只有缺的时候才去调 openapi + 上传。
  // 云存储路径由 tagCode 决定,并发生成同一个码的图只会覆盖成同一个文件。
  const oldQr = typeof dog.qrFileID === 'string' ? dog.qrFileID : '';
  const qrFileID = oldQr || (await makeQrFileID(tagCode, ctx));

  if (qrFileID !== oldQr || tagCode !== oldCode) {
    const patch = { updatedAt: ctx.now() };
    if (qrFileID !== oldQr) patch.qrFileID = qrFileID;
    await db.collection(COLL.DOGS).doc(dogId).update({ data: patch });
  }

  return ok({ tagCode, qrFileID });
};
