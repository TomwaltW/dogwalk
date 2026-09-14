// cloudfunctions/genTagCode/core.js —— owner: T3
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { dogId: String }
// data:  { tagCode: String, qrFileID: String }
// tagCode 长度为 TAG_CODE_LENGTH 的 [a-z0-9],全局唯一;已生成过则复用,不新建。

const { COLL, TAG_CODE_LENGTH } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');

// 字符集固定 [a-z0-9];长度取契约常量,不写字面量。
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
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
 * 生成狗牌小程序码,拿到云存储 fileID。
 *
 * 接缝说明:ctx(spec 3.3.1)里只有 openapi,没有云存储句柄;而云调用
 * wxacode.getUnlimited 返回的是 { contentType, buffer },要落成 fileID 还需要
 * cloud.uploadFile。所以这里只在返回值里现成带 fileID 时采用,否则留空串
 * ——spec 3.2 允许 qrFileID 为 '',spec 3.4 也要求 openapi 失败不影响主流程。
 * 总管给 ctx 补上存储句柄后,改这一个函数体即可。
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
    const res = await wxacode.getUnlimited({
      scene: tagCode,
      page: 'pages/dog/profile/profile',
      checkPath: false,
    });
    if (res && typeof res.fileID === 'string' && res.fileID) return res.fileID;
    logger.error('genTagCode: 小程序码没带回 fileID,qrFileID 留空', { tagCode });
    return '';
  } catch (e) {
    // spec 3.4:openapi 失败记 logger.error,不影响主流程返回 ok
    logger.error('genTagCode: 生成小程序码失败', { tagCode, msg: e && e.message });
    return '';
  }
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx
 * @param {object} ctx.db               云开发 db 实例(测试时为 fake-db)
 * @param {object} ctx._                db.command
 * @param {string} ctx.openid           调用者 openid,游客为 ''
 * @param {() => Date} ctx.now          取当前时间,禁止直接 new Date()
 * @param {object} ctx.openapi          cloud.openapi,测试时为 mock
 * @param {{info:Function,error:Function}} ctx.logger
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

  // 已生成过就复用已有的,不新建(spec 6 节 T3)。
  const oldCode = typeof dog.tagCode === 'string' ? dog.tagCode : '';
  const tagCode = oldCode || (await pickUniqueCode(db));
  if (!tagCode) return fail(CODES.INTERNAL, 'tagCode generate failed');

  // 码同理:已有就不重新生成,只有缺的时候才去调 openapi。
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
