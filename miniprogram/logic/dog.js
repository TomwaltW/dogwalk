/**
 * miniprogram/logic/dog.js —— owner: T1
 *
 * 狗档案的前端纯逻辑:本地校验 + 年龄展示。无副作用、不碰 wx.*、不调 api,
 * 页面(T5 的 pages/dog/**)提交前先过这里,拦得下的就不发请求。
 *
 * 与云端的关系:
 *   - 这不是 cloudfunctions/_shared/schema.js。那是云端契约签名,本轮未实现;
 *     云端校验各自写在云函数的 core.js 里。两边规则一致,口径见下方注释。
 *   - 前端拦截只是省一次往返,**不是**安全边界,云端照样全量校验一遍。
 *
 * 枚举为什么在这里再抄一份:小程序只打包 miniprogram/ 根内的文件,
 * require('../../cloudfunctions/...') 在真机上 resolve 不到
 * (同 api/index.js 里 INTERNAL 那段注释)。取值必须与 _shared/contracts.js
 * 一致,tests/logic/dog.test.js 有一条用例逐项钉死,改一边会红。
 */

const SIZE_CLASS = ['small', 'medium', 'large'];
const PLAY_STYLE = ['chase', 'wrestle', 'solo'];
const TEMPERAMENT = ['friendly', 'shy', 'jumpy', 'antisocial'];
const GENDER = ['male', 'female'];

const NAME_MAX = 12; // spec 3.2:name 1-12 字符
const BIRTH_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM'

/**
 * 新建表单的初始值:枚举字段先给好默认,名字留空待填。
 * 直接丢给 validateDog() 会得到 'name' —— 空表单本来就不该能提交。
 *
 * @returns {object} 一只字段齐全的空狗
 */
function emptyDog() {
  return {
    name: '',
    breed: '',
    sizeClass: 'medium',
    birthMonth: '',
    gender: 'male',
    neutered: false,
    avatarFileID: '',
    playStyle: [],
    temperament: [],
    okWithSmallDogs: true,
    socialOk: true,
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 数组且每项都在 allowed 里 */
function isSubsetOf(v, allowed) {
  return Array.isArray(v) && v.every((x) => allowed.indexOf(x) >= 0);
}

/**
 * 校验狗档案。规则与 cloudfunctions/dogCRUD/core.js 保持一致:
 *   name        去空格后 1-12 字符
 *   sizeClass   ∈ SIZE_CLASS
 *   gender      ∈ GENDER
 *   birthMonth  '' 或 'YYYY-MM'
 *   breed / avatarFileID        String
 *   playStyle / temperament     各自枚举的子集
 *   neutered / okWithSmallDogs / socialOk / lostMode   Boolean
 *
 * 全量模式(partial 非 true)下必填的只有 name / sizeClass / gender ——
 * 其余字段缺省时由云端补默认值,不算用户填错。
 *
 * @param {object} dog                  待校验的狗
 * @param {{partial?: boolean}} [opts]  partial=true 时字段缺失不算错(编辑场景)
 * @returns {string|null} 出错字段名;通过返回 null
 */
function validateDog(dog, opts) {
  if (!isPlainObject(dog)) return 'dog';
  const partial = !!(opts && opts.partial);
  const has = (k) => dog[k] !== undefined;

  if (has('name')) {
    if (typeof dog.name !== 'string') return 'name';
    const n = dog.name.trim().length;
    if (n < 1 || n > NAME_MAX) return 'name';
  } else if (!partial) {
    return 'name';
  }

  if (has('sizeClass')) {
    if (SIZE_CLASS.indexOf(dog.sizeClass) < 0) return 'sizeClass';
  } else if (!partial) {
    return 'sizeClass';
  }

  if (has('gender')) {
    if (GENDER.indexOf(dog.gender) < 0) return 'gender';
  } else if (!partial) {
    return 'gender';
  }

  if (has('birthMonth') && !(dog.birthMonth === '' || BIRTH_MONTH_RE.test(dog.birthMonth))) {
    return 'birthMonth';
  }
  if (has('breed') && typeof dog.breed !== 'string') return 'breed';
  if (has('avatarFileID') && typeof dog.avatarFileID !== 'string') return 'avatarFileID';
  if (has('playStyle') && !isSubsetOf(dog.playStyle, PLAY_STYLE)) return 'playStyle';
  if (has('temperament') && !isSubsetOf(dog.temperament, TEMPERAMENT)) return 'temperament';

  const bools = ['neutered', 'okWithSmallDogs', 'socialOk', 'lostMode'];
  for (const k of bools) {
    if (has(k) && typeof dog[k] !== 'boolean') return k;
  }

  return null;
}

/**
 * 狗的月龄。生日为 ''、格式非法、在未来,或 now 不是合法 Date,一律返回 null
 * (= 年龄未知,页面显示空)。
 *
 * now 由调用方传进来:spec 3.3.4 禁止页面里出现 new Date()。
 *
 * @param {string} birthMonth  'YYYY-MM',可为 ''
 * @param {Date}   now         当前时间
 * @returns {number|null} 月龄;算不出时 null
 */
function ageMonths(birthMonth, now) {
  if (typeof birthMonth !== 'string' || !BIRTH_MONTH_RE.test(birthMonth)) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;

  const y = Number(birthMonth.slice(0, 4));
  const m = Number(birthMonth.slice(5, 7));
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  return months < 0 ? null : months;
}

/**
 * 月龄的中文说法:'不满1个月' / '5个月' / '1岁' / '2岁6个月'。
 *
 * @param {string} birthMonth  'YYYY-MM',可为 ''
 * @param {Date}   now         当前时间
 * @returns {string} 年龄未知时为 ''
 */
function formatAge(birthMonth, now) {
  const m = ageMonths(birthMonth, now);
  if (m === null) return '';
  if (m === 0) return '不满1个月';
  if (m < 12) return m + '个月';
  const years = Math.floor(m / 12);
  const rest = m % 12;
  return rest === 0 ? years + '岁' : years + '岁' + rest + '个月';
}

module.exports = {
  SIZE_CLASS,
  PLAY_STYLE,
  TEMPERAMENT,
  GENDER,
  NAME_MAX,
  emptyDog,
  validateDog,
  ageMonths,
  formatAge,
};
