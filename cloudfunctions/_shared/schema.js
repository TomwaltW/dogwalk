/**
 * 服务端参数校验 —— 契约签名,T0 只落签名,函数体一律 NOT_IMPLEMENTED。
 *
 * 统一返回约定(配合 spec 3.4「必填字段缺失 / 枚举值非法 / 字符串超长 →
 * fail(INVALID_PARAM, '<字段名>')」):
 *
 *   返回 null                 —— 校验通过
 *   返回 '<字段名>' (String)  —— 校验失败,该字符串即 fail() 的 msg
 *
 * 调用方写法:
 *   const bad = validateDog(event.dog);
 *   if (bad) return fail(CODES.INVALID_PARAM, bad);
 *
 * 字段口径见 spec 3.2;枚举取值见 contracts.js 的
 * SIZE_CLASS / PLAY_STYLE / TEMPERAMENT。
 */

const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

/**
 * 校验狗档案入参(create 为全量,update 为部分字段)。
 * 覆盖:name 1-12 字符、sizeClass ∈ SIZE_CLASS、gender ∈ male|female、
 * birthMonth 为 '' 或 'YYYY-MM'、playStyle ⊆ PLAY_STYLE、
 * temperament ⊆ TEMPERAMENT、neutered/okWithSmallDogs/socialOk 为 Boolean。
 *
 * @param {object} dog                  待校验的 dog(可为 Partial<Dog>)
 * @param {{partial?: boolean}} [opts]  partial=true 时缺失字段不算错(update 场景)
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateDog(dog, opts) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 校验「我出门了」广播入参。
 * 覆盖:spotId 非空、dogIds 为非空数组、startAt 可被 Date 解析、note 0-30 字符。
 *
 * @param {object} event  { spotId, dogIds, startAt, note? }
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateCheckin(event) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 校验 login 带上来的用户资料。
 * 覆盖:nickname 1-20 字符、avatarFileID 为 String(可为 '')。
 *
 * @param {object} [profile]  { nickname, avatarFileID };缺省视为通过
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateProfile(profile) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 校验狗牌短码格式:长度 TAG_CODE_LENGTH 的 [a-z0-9]。
 *
 * @param {string} tagCode
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateTagCode(tagCode) {
  throw new Error(NOT_IMPLEMENTED);
}

module.exports = { validateDog, validateCheckin, validateProfile, validateTagCode };
