/**
 * 枚举与文案的前端镜像 —— spec 3.2.1 / 3.3.4,T0' 提供,各轨只读。
 *
 * 为什么不直接 require cloudfunctions/_shared/contracts.js:小程序只打包 miniprogram/
 * 根内的文件,跨根 require 在真机上 resolve 不到。取值必须与 contracts.js 一致,
 * tests/shared/enums.test.js 逐项钉死,改一边会红。
 */

const SIZE_CLASS = ['small', 'medium', 'large'];
const GENDER = ['male', 'female'];
const TAGS = ['ball', 'fearsBig', 'foodGuard', 'shy', 'chaser', 'calm'];

const TAG_LABEL = {
  ball: '爱玩球',
  fearsBig: '怕大狗',
  foodGuard: '护食',
  shy: '怕生',
  chaser: '爱追跑',
  calm: '安静',
};
const SIZE_LABEL = { small: '小型犬', medium: '中型犬', large: '大型犬' };
const GENDER_LABEL = { male: '公', female: '母' };
const MEMBER_STATUS_LABEL = {
  pending: '待确认',
  approved: '已加入',
  rejected: '已婉拒',
  left: '已退出',
};

const CHECKIN_STATUS = ['active', 'cancelled'];
const WALK_STATUS = ['open', 'cancelled'];
const MEMBER_STATUS = ['pending', 'approved', 'rejected', 'left'];

const CHECKIN_DURATION_MS = 2 * 60 * 60 * 1000;
const TAG_CODE_LENGTH = 6;

const TEMPLATE_KEYS = { FOUND_REPORT: 'foundReport' };

const LIMITS = {
  NAME_MAX: 12,
  BREED_MAX: 20,
  LICENSE_MAX: 32,
  LOST_NOTE_MAX: 50,
  WALK_NOTE_MAX: 50,
  MESSAGE_MAX: 200,
  FOUND_MSG_MAX: 200,
  WALK_MAX_DOGS_DEFAULT: 3,
  WALK_MAX_DOGS_CAP: 10,
};

/** 枚举值 -> 中文;不认识就原样返回,不抛 */
function labelOf(dict, value) {
  return (dict && dict[value]) || value || '';
}

/** 一组 tag -> '爱玩球 / 怕生';空数组返回 '' */
function labelsOfTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  return tags.map((t) => labelOf(TAG_LABEL, t)).join(' / ');
}

/** 给 wxml 的 picker / chips 用:[{value, label}] */
function optionsOf(values, dict) {
  return values.map((v) => ({ value: v, label: labelOf(dict, v) }));
}

/**
 * 字符数按码位算 —— 'a'.length 和 '🐶'.length 不一样,中文名和 emoji 名
 * 都得按人眼看到的字数来数,否则「12 字符」这条线会错位。
 * @param {string} s
 * @returns {number}
 */
function charLength(s) {
  return Array.from(String(s == null ? '' : s)).length;
}

module.exports = {
  SIZE_CLASS,
  GENDER,
  TAGS,
  TAG_LABEL,
  SIZE_LABEL,
  GENDER_LABEL,
  MEMBER_STATUS_LABEL,
  CHECKIN_STATUS,
  WALK_STATUS,
  MEMBER_STATUS,
  CHECKIN_DURATION_MS,
  TAG_CODE_LENGTH,
  TEMPLATE_KEYS,
  LIMITS,
  labelOf,
  labelsOfTags,
  optionsOf,
  charLength,
};
