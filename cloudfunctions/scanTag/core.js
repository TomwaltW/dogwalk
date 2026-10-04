// cloudfunctions/scanTag/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { tagCode: String }
// data:  DogPublic —— 恰好 9 个 key,见 spec 3.2.3
// 允许游客(ctx.openid === '')调用,这是 AUTH_REQUIRED 的例外之一(spec 3.4)。
//
// 这里不读 users,也不返回任何主人信息:spec 9 节假设 12 —— 走失页不显示主人联系方式,
// 路人只能留言(reportFound),主人靠订阅消息与身份牌页的留言列表看到。
// 每次扫码写一条 scanLogs。

const { COLL } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');
// 短码格式(长度取契约常量)与 reportFound / genTagCode 共用一份
const { TAG_CODE_RE } = require('../_shared/tagcode');

/**
 * dogs 文档 → DogPublic(spec 3.2.3)。字段逐个挑,恰好 9 个,只能少不能多:
 * _id / ownerOpenid / tagCode / qrFileID / licenseNo / neutered / vaccinated /
 * createdAt / updatedAt 一律不出去。
 *
 * lostNote 只在走失态下给 —— 非走失态恒为空串,库里存着上次走失的留言也不给路人看。
 *
 * @param {object} dog
 * @returns {object} DogPublic
 */
function toDogPublic(dog) {
  const lostMode = !!dog.lostMode;
  return {
    name: typeof dog.name === 'string' ? dog.name : '',
    breed: typeof dog.breed === 'string' ? dog.breed : '',
    sizeClass: typeof dog.sizeClass === 'string' ? dog.sizeClass : '',
    gender: typeof dog.gender === 'string' ? dog.gender : '',
    birthMonth: typeof dog.birthMonth === 'string' ? dog.birthMonth : '',
    avatarFileID: typeof dog.avatarFileID === 'string' ? dog.avatarFileID : '',
    tags: Array.isArray(dog.tags) ? dog.tags.slice() : [],
    lostMode,
    lostNote: lostMode && typeof dog.lostNote === 'string' ? dog.lostNote : '',
  };
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const { db } = ctx;

  // 这里没有 AUTH_REQUIRED:scanTag 是游客例外(spec 3.4)。
  const tagCode = event && event.tagCode;
  if (typeof tagCode !== 'string' || !TAG_CODE_RE.test(tagCode)) {
    return fail(CODES.INVALID_PARAM, 'tagCode');
  }

  const found = await db.collection(COLL.DOGS).where({ tagCode }).limit(1).get();
  const dog = found.data[0];
  if (!dog) return fail(CODES.NOT_FOUND, COLL.DOGS);

  // spec 3.2.2 scanLogs:游客态 scannerOpenid 写空串,不是 null / undefined。
  await db.collection(COLL.SCAN_LOGS).add({
    data: {
      tagCode,
      scannerOpenid: ctx.openid || '',
      isLostMode: !!dog.lostMode,
      scannedAt: ctx.now(),
    },
  });

  return ok(toDogPublic(dog));
};
