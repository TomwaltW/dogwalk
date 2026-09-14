/**
 * 可控时钟 —— spec 3.3.5,T0 提供。
 *
 * 云函数 ctx.now 必须是一个 () => Date;业务代码禁止直接 new Date()。
 * 测试里把 ctx.now 换成 fixedClock('2026-09-14T19:30:00+08:00') 即可。
 */

/**
 * @param {string} isoString  ISO8601 时间串
 * @returns {() => Date}      每次调用返回同一时刻的新 Date 实例
 */
function fixedClock(isoString) {
  const t = new Date(isoString);
  if (Number.isNaN(t.getTime())) {
    throw new Error('clock: 无法解析的时间串: ' + isoString);
  }
  return () => new Date(t.getTime());
}

module.exports = { fixedClock };
