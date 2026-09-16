// miniprogram/pages/park/format.js —— owner: T8
// 时间格式化的纯函数。页面里禁止 new Date()(spec 3.3.4),所以这里全用字符串算术:
// 既不读系统时钟,也不受运行环境时区影响,jest 在 UTC 机器上跑出来也是对的。

/** 东八区,单位分钟。用户都在国内,后端的「今天」也按这个算(spec 3.2.3 todayDogs) */
const TARGET_OFFSET_MIN = 8 * 60;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * ISO 串尾巴上的时区标记 -> 分钟偏移;没带时区返回 null。
 * @param {string} [token] 'Z' / '+08:00' / '-0530'
 * @returns {number|null}
 */
function offsetMinutes(token) {
  if (!token) return null;
  if (token === 'Z') return 0;
  const m = token.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const value = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -value : value;
}

/**
 * ISO8601 -> 'HH:mm'(东八区)。
 * 后端可能给 '...Z' 也可能给 '...+08:00',两种都要显示成北京时间的时分。
 * 不带时区的按已经是本地时间处理。解析不了就返回 '',调用处直接当「没有」。
 *
 * @param {string} iso
 * @returns {string} 'HH:mm' 或 ''
 */
function hhmm(iso) {
  const m = String(iso == null ? '' : iso).match(ISO_RE);
  if (!m) return '';

  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return '';

  const offset = offsetMinutes(m[6]);
  if (offset === null) return pad2(hour) + ':' + pad2(minute);

  const shifted = hour * 60 + minute - offset + TARGET_OFFSET_MIN;
  const inDay = ((shifted % 1440) + 1440) % 1440; // 跨天回绕
  return pad2(Math.floor(inDay / 60)) + ':' + pad2(inDay % 60);
}

module.exports = { hhmm };
