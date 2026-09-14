/**
 * 狗档案的枚举与展示文案 —— owner: T5,供 pages/dog/** 与 pages/me/** 共用。
 *
 * 这里刻意不 require cloudfunctions/_shared/contracts.js:小程序只打包 miniprogram/
 * 根内的文件,跨根 require 在真机上 resolve 不到(同 api/index.js 里那条注释)。
 * 取值与 _shared/contracts.js 的 SIZE_CLASS / PLAY_STYLE / TEMPERAMENT 一致,
 * 变更需同步两边 —— 但 contracts.js 是冻结契约,本轮不会变。
 *
 * spec 没有 miniprogram/components/ 共享目录,所以这层共用只在 T5 自己的
 * 白名单(pages/dog/**、pages/me/**)内部,不跨 track。
 */

const SIZE_CLASS = ['small', 'medium', 'large'];
const PLAY_STYLE = ['chase', 'wrestle', 'solo'];
const TEMPERAMENT = ['friendly', 'shy', 'jumpy', 'antisocial'];
const GENDER = ['male', 'female'];

/** 名字长度上限 —— spec 3.2 `name: String, // 1-12 字符` */
const NAME_MAX = 12;
/** birthMonth 形如 'YYYY-MM',可为 ''(spec 3.2) */
const BIRTH_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const LABEL = {
  sizeClass: { small: '小型犬', medium: '中型犬', large: '大型犬' },
  gender: { male: '公', female: '母' },
  playStyle: { chase: '追跑', wrestle: '扭打', solo: '自己玩' },
  temperament: { friendly: '亲人', shy: '胆小', jumpy: '易激动', antisocial: '不合群' },
};

/** 枚举值 -> 中文;不认识就原样返回,不抛 */
function labelOf(field, value) {
  const dict = LABEL[field];
  return (dict && dict[value]) || value || '';
}

/** 把一组枚举值翻成 '追跑 / 扭打';空数组返回 '' */
function labelsOf(field, values) {
  if (!Array.isArray(values) || !values.length) return '';
  return values.map((v) => labelOf(field, v)).join(' / ');
}

/** 给 wxml 的 picker / checkbox 用:[{value, label}] */
function optionsOf(field, values) {
  return values.map((v) => ({ value: v, label: labelOf(field, v) }));
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

/** 数组 a 是否全在白名单 allowed 里 */
function isSubset(a, allowed) {
  return Array.isArray(a) && a.every((v) => allowed.indexOf(v) >= 0);
}

module.exports = {
  SIZE_CLASS,
  PLAY_STYLE,
  TEMPERAMENT,
  GENDER,
  NAME_MAX,
  BIRTH_MONTH_RE,
  LABEL,
  labelOf,
  labelsOf,
  optionsOf,
  charLength,
  isSubset,
};
