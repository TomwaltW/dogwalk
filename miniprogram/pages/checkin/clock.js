/**
 * 发广播页唯一的时钟来源。
 *
 * spec 3.3.4 要求页面模块里不出现裸的当前时间调用,需要当前时间时读 options.data.now。
 * 但 data.now 总得有人填,而运行时没有注入时钟 —— 所以把这一个不纯点单独拎到页面
 * 目录下的小模块里:checkin.js 只 require('./clock') 并把结果写进 data.now,
 * 测试里 jest.mock 掉这个文件就能把时间钉死。
 *
 * 它是 T4 白名单内的文件(miniprogram/pages/checkin/**),不是共享组件。
 */

/** @returns {string} 当前时间的 ISO8601 串,即 checkin 云函数 event.startAt 的形状 */
function nowIso() {
  return new Date().toISOString();
}

module.exports = { nowIso };
