// cloudfunctions/genTagCode/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { dogId: String }
// data:  { tagCode: String, qrFileID: String }
// tagCode 长度为 TAG_CODE_LENGTH 的 [a-z0-9],全局唯一;已生成过则复用,不重摇也不重传。

const { COLL, TAG_CODE_LENGTH } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');

// 字符集固定 [a-z0-9];长度取契约常量,不写字面量。
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// 撞码重摇的上限。36^6 ≈ 22 亿,一个小区的狗量下撞满 12 次等于库坏了。
const MAX_TRIES = 12;
// 小程序码扫出来落到哪一页(spec 3.3.2)。这一页是游客可见的寻回页。
const QR_PAGE = 'pages/dog/profile/profile';

/** 随机一个短码。云函数里可以用 Math.random(),spec 3.3.4 那条禁令只约束页面。 */
function randomCode() {
  let code = '';
  for (let i = 0; i < TAG_CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * 摇一个库里没人用过的短码。
 * fake-db 与真实 db 都没有事务(spec 3.3.5),这里靠「短码空间足够稀疏 + 唯一索引」
 * 收敛;真实环境请在 dogs.tagCode 上建唯一索引兜住并发。
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
  const tagCode = oldCode || (await pickUniqueCode(db));
  if (!tagCode) return fail(CODES.INTERNAL, 'tagCode generate failed');

  // 码同理:已有就不重新生成,只有缺的时候才去调 openapi + 上传。
  const oldQr = typeof dog.qrFileID === 'string' ? dog.qrFileID : '';
  const qrFileID = oldQr || (await makeQrFileID(tagCode, ctx));

  const patch = {};
  if (tagCode !== oldCode) patch.tagCode = tagCode;
  if (qrFileID !== oldQr) patch.qrFileID = qrFileID;
  if (Object.keys(patch).length) {
    patch.updatedAt = ctx.now();
    await db.collection(COLL.DOGS).doc(dogId).update({ data: patch });
  }

  return ok({ tagCode, qrFileID });
};
