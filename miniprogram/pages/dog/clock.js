/**
 * pages/dog/** 唯一的时钟来源 —— owner: T9。
 *
 * spec 3.3.4 要求页面模块里不出现裸的当前时间调用(测试没法钉死,断言会飘)。
 * 但上传照片的 cloudPath 得唯一,唯一性只能来自时间 —— 所以把这一个不纯点单独
 * 拎到页面目录下的小模块里:edit.js 只 require('../clock'),测试里
 * jest.mock('.../pages/dog/clock') 就能把它钉死,顺带断言 cloudPath 的形状。
 *
 * 同第一轮 pages/checkin/clock.js 的做法。它是 T9 白名单内的文件,不是共享组件。
 */

/** @returns {number} 当前时间戳(毫秒) */
function nowMs() {
  return Date.now();
}

module.exports = { nowMs };
