/**
 * 狗档案的本地校验与展示转述 —— owner: T9,供 pages/dog/** 与 pages/me/** 共用。
 *
 * 枚举、文案、长度上限一律从 miniprogram/logic/enums.js 取(spec 3.3.4:不要再抄一份),
 * 这里只放 enums.js 里没有的两样东西:表单的本地校验,和契约里 ISO 串的展示格式。
 *
 * 为什么不复用 logic 里那个同域的校验模块:它归 T6,本轮正在被改(spec 3.5 归属表),
 * 页面跟它耦合,合流时测试会红。页面这一侧的校验本来也只是「省一次往返」,
 * 云函数那边还会按 spec 3.4 再校一次,这里不是唯一防线。
 *
 * spec 没有 miniprogram/components/ 共享目录,所以这层共用只在 T9 自己的白名单
 * (pages/dog/**、pages/me/**)内部,不跨 track。
 */

const enums = require('../../logic/enums');

/** birthMonth 形如 'YYYY-MM',可为 ''(spec 3.2.2) */
const BIRTH_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 字段名(云函数在 INVALID_PARAM / CONTENT_RISKY 的 msg 里给的就是这些)-> 中文 */
const FIELD_LABEL = {
  name: '名字',
  breed: '品种',
  licenseNo: '犬证号',
  lostNote: '留言',
  message: '留言',
  text: '留言',
  avatarFileID: '照片',
  birthMonth: '出生年月',
  tags: '性格标签',
};

function fieldLabel(field) {
  return FIELD_LABEL[field] || String(field || '内容');
}

/** CONTENT_RISKY 的人话 */
function riskyMsg(field) {
  return '「' + fieldLabel(field) + '」含不合适的内容,改一下再保存';
}

/**
 * ApiError(spec 3.3.3:带 code 的 Error)翻成人话。
 * @param {Error} err
 * @param {string} fallback 认不出来时的兜底文案
 * @param {object} [extra]  本页要覆盖的码 -> 文案
 * @returns {string}
 */
function readableError(err, fallback, extra) {
  if (!err) return fallback;
  const byCode = Object.assign(
    {
      AUTH_REQUIRED: '请先登录',
      FORBIDDEN: '这不是你的狗',
      NOT_FOUND: '没找到这只狗,可能已经被删了',
      CONTENT_RISKY: riskyMsg(err.message),
      INVALID_PARAM: '「' + fieldLabel(err.message) + '」填得不对,改一下再试',
    },
    extra || {}
  );
  return byCode[err.code] || err.message || fallback;
}

/** 数组 a 是否全在白名单 allowed 里 */
function isSubset(a, allowed) {
  return Array.isArray(a) && a.every((v) => allowed.indexOf(v) >= 0);
}

/**
 * 表单的本地校验 —— 规则来自 spec 3.2.2 与 3.2.1 的 LIMITS。
 * @param {object} form
 * @returns {string} 出错原因;'' 表示通过
 */
function validateDog(form) {
  const f = form || {};
  const L = enums.LIMITS;

  const name = String(f.name || '').trim();
  const nameLen = enums.charLength(name);
  if (nameLen === 0) return '狗的名字不能为空';
  if (nameLen > L.NAME_MAX) {
    return '名字最多 ' + L.NAME_MAX + ' 个字,现在是 ' + nameLen + ' 个';
  }

  if (enums.charLength(String(f.breed || '').trim()) > L.BREED_MAX) {
    return '品种最多 ' + L.BREED_MAX + ' 个字';
  }
  if (enums.charLength(String(f.licenseNo || '').trim()) > L.LICENSE_MAX) {
    return '犬证号最多 ' + L.LICENSE_MAX + ' 个字';
  }

  if (enums.SIZE_CLASS.indexOf(f.sizeClass) < 0) return '体型只能选小型 / 中型 / 大型犬';
  if (enums.GENDER.indexOf(f.gender) < 0) return '性别只能选公或母';

  const birthMonth = String(f.birthMonth || '').trim();
  if (birthMonth !== '' && !BIRTH_MONTH_RE.test(birthMonth)) {
    return '出生年月要写成 YYYY-MM,例如 2023-05;不填也行';
  }

  if (!isSubset(f.tags, enums.TAGS)) return '性格标签里有不认识的取值';

  return '';
}

/**
 * 选中态摊成 { ball: true } —— wxml 表达式里调不了 indexOf,只能取属性,
 * 所以选中与否得在 js 侧先算好。
 */
function checkedMap(values) {
  const out = {};
  (Array.isArray(values) ? values : []).forEach((v) => {
    out[v] = true;
  });
  return out;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * 契约里的 ISO8601 串 -> 东八区的 'YYYY-MM-DD HH:mm'。
 *
 * 纯函数:输入什么时间给什么结果,不读当前时间(所以不算 spec 3.3.4 禁的那类
 * 「裸的当前时间调用」,当前时间在 ./clock.js 里)。时区固定 +08:00 而不是用
 * 本机时区 —— 云端存的是 Date、返回的是 ISO,展示口径全项目按东八区(spec 3.2.3)。
 *
 * @param {string} iso
 * @returns {string} 认不出来就原样返回,不抛
 */
function formatIsoMinute(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso);
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return (
    d.getUTCFullYear() +
    '-' +
    pad2(d.getUTCMonth() + 1) +
    '-' +
    pad2(d.getUTCDate()) +
    ' ' +
    pad2(d.getUTCHours()) +
    ':' +
    pad2(d.getUTCMinutes())
  );
}

/** 体型 / 性别 / 标签的中文,薄封装一层省得每页都写 enums.labelOf(...) */
function sizeText(v) {
  return enums.labelOf(enums.SIZE_LABEL, v);
}
function genderText(v) {
  return enums.labelOf(enums.GENDER_LABEL, v);
}
function tagsText(tags) {
  return enums.labelsOfTags(tags);
}

module.exports = {
  enums,
  BIRTH_MONTH_RE,
  FIELD_LABEL,
  fieldLabel,
  riskyMsg,
  readableError,
  isSubset,
  validateDog,
  checkedMap,
  formatIsoMinute,
  sizeText,
  genderText,
  tagsText,
};
