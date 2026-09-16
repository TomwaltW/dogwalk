// cloudfunctions/scanTag/core.js —— owner: T3
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// event: { tagCode: String }
// data:  DogPublic —— 字段只能少不能多,见 spec 3.2「公开视图」
// 允许游客(ctx.openid === '')调用,这是 AUTH_REQUIRED 的唯一例外。
// ownerContact 仅当 lostMode === true 时非 null;每次扫码写一条 scanLogs。

const { COLL, TAG_CODE_LENGTH } = require('../_shared/contracts');
const { ok, fail, CODES } = require('../_shared/errors');

// 短码格式:长度取契约常量,不写字面量。字符集 [a-z0-9]。
const TAG_CODE_RE = new RegExp('^[a-z0-9]{' + TAG_CODE_LENGTH + '}$');

/**
 * 走失态下主人的联系方式 —— 来源字段待定,见 SPEC 3.2 的 DogPublic。
 *
 * spec 3.2 的 users / dogs 两张字段表里没有任何可以当联系方式的字段,
 * spec 1 又写明「不做实名认证、不做手机号获取」,所以本轮无法取到真实来源。
 * 补契约是总管的事,T3 只把接缝留好:门控逻辑照写照测,函数体先返回 null。
 * 将来来源字段补齐后,只改这一个函数体,调用处与测试都不用动。
 *
 * @param {object} dog   dogs 文档
 * @param {object} owner users 文档(走失态才会读,读不到时为 null)
 * @returns {string|null}
 */
function resolveOwnerContact(dog, owner) {
  return null;
}

/**
 * dogs 文档 → DogPublic。字段逐个挑,只能少不能多(spec 3.2):
 * _id / ownerOpenid / tagCode / socialOk / qrFileID / createdAt / updatedAt 一律不出去。
 *
 * @param {object} dog
 * @param {object|null} owner
 * @returns {object} DogPublic
 */
function toDogPublic(dog, owner) {
  return {
    name: typeof dog.name === 'string' ? dog.name : '',
    breed: typeof dog.breed === 'string' ? dog.breed : '',
    sizeClass: dog.sizeClass,
    birthMonth: typeof dog.birthMonth === 'string' ? dog.birthMonth : '',
    gender: dog.gender,
    neutered: !!dog.neutered,
    avatarFileID: typeof dog.avatarFileID === 'string' ? dog.avatarFileID : '',
    playStyle: Array.isArray(dog.playStyle) ? dog.playStyle.slice() : [],
    temperament: Array.isArray(dog.temperament) ? dog.temperament.slice() : [],
    okWithSmallDogs: !!dog.okWithSmallDogs,
    lostMode: !!dog.lostMode,
    ownerContact: dog.lostMode ? resolveOwnerContact(dog, owner) : null,
  };
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

  // 这里没有 AUTH_REQUIRED:scanTag 是游客例外(spec 3.4)。
  const tagCode = event && event.tagCode;
  if (typeof tagCode !== 'string' || !TAG_CODE_RE.test(tagCode)) {
    return fail(CODES.INVALID_PARAM, 'tagCode');
  }

  const found = await db.collection(COLL.DOGS).where({ tagCode }).limit(1).get();
  const dog = found.data[0];
  if (!dog) return fail(CODES.NOT_FOUND, COLL.DOGS);

  // 主人资料只在走失态下才需要,非走失态不白读一次 users。
  let owner = null;
  if (dog.lostMode) {
    try {
      owner = (await db.collection(COLL.USERS).doc(dog.ownerOpenid).get()).data;
    } catch {
      owner = null; // 主人文档不在了也不该让扫码失败
    }
  }

  // spec 3.2 scanLogs:游客态 scannerOpenid 写空串,不是 null / undefined。
  await db.collection(COLL.SCAN_LOGS).add({
    data: {
      tagCode,
      scannerOpenid: ctx.openid || '',
      isLostMode: !!dog.lostMode,
      scannedAt: ctx.now(),
    },
  });

  return ok(toDogPublic(dog, owner));
};

// 接缝对外可见,便于总管补完来源字段后一处改完,也便于测试直接引用当下口径。
module.exports.resolveOwnerContact = resolveOwnerContact;
