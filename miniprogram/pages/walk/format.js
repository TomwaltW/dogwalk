/**
 * 约遛三页共用的时间格式化 —— owner: T10,纯函数。
 *
 * 全部按 **东八区** 算,不看运行时时区:先把 ISO 解析成时间戳,加 8 小时,
 * 再用 UTC getter 取字段。不然同一条 startAt 在开发者工具(本机时区)和
 * jest(可能是 UTC)里会显示成两个时间,测试会随环境飘。
 *
 * 口径与 spec 3.2.3 一致:对外的时间字段都是 ISO8601 字符串,日期筛选是东八区的
 * 'YYYY-MM-DD'。这里没有裸的当前时间调用(那一个不纯点在 ./clock),只按传进来的时间戳构造 Date。
 */

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** ISO -> 东八区的各字段;解析不出来返回 null(调用处退化成空串,不抛) */
function cstParts(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + CST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}

/** ISO -> 'MM-DD HH:mm'(东八区);列表行与留言时间都用它 */
function mdHm(iso) {
  const p = cstParts(iso);
  if (!p) return '';
  return pad2(p.mo) + '-' + pad2(p.d) + ' ' + pad2(p.h) + ':' + pad2(p.mi);
}

/** ISO -> 'YYYY-MM-DD'(东八区);date picker 的值与 listWalks 的 date 筛选都用它 */
function ymd(iso) {
  const p = cstParts(iso);
  if (!p) return '';
  return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d);
}

/** ISO -> 'HH:mm'(东八区);time picker 的值 */
function hm(iso) {
  const p = cstParts(iso);
  if (!p) return '';
  return pad2(p.h) + ':' + pad2(p.mi);
}

/**
 * date picker + time picker 的值合成 startAt。
 * 两个 picker 给的都是东八区的墙上时间,所以拼成带 +08:00 的串再转 ISO,
 * 这样不管手机设在哪个时区,发出去的都是同一个瞬间。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} timeStr 'HH:mm'
 * @returns {string} ISO8601,拼不出来返回 ''
 */
function toIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  const t = Date.parse(dateStr + 'T' + timeStr + ':00+08:00');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString();
}

/**
 * 发起页的默认时间:现在往后推一个整点(10:20 -> 11:00)。
 * 跨天由时间戳自己处理,不用额外判断月末。
 * @param {string} nowIso 来自 ./clock
 * @returns {{date:string, time:string}} 拼不出来时两项都是 ''
 */
function defaultStart(nowIso) {
  const t = Date.parse(nowIso);
  if (!Number.isFinite(t)) return { date: '', time: '' };
  const p = cstParts(nowIso);
  // 先推到下一个整点:补满这一小时剩下的分秒,再加一小时
  const next = t + (60 - p.mi) * 60 * 1000;
  const iso = new Date(next - (next % (60 * 60 * 1000))).toISOString();
  return { date: ymd(iso), time: hm(iso) };
}

/**
 * a 是不是早于等于 b。两个都是 ISO;解析不出来算「不合法」返回 true,
 * 让调用处把它当成「时间不对」拦下来。
 */
function notAfter(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return a <= b;
}

module.exports = { mdHm, ymd, hm, toIso, defaultStart, notAfter, cstParts };
