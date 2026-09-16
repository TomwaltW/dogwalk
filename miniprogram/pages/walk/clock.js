/**
 * 约遛三页唯一的时钟来源 —— owner: T10。
 *
 * spec 3.3.4 禁止页面里出现 new Date();但「最早可选日期」「默认发起时间」总得知道现在几点。
 * 把这一个不纯点单独拎到这里,页面只 require('./clock') 拿一个 ISO 串,
 * 测试里 jest.mock('../../miniprogram/pages/walk/clock') 就能把时间钉死。
 *
 * 这是 T10 白名单内的文件(miniprogram/pages/walk/**),不是共享组件。
 */

/** @returns {string} 当前时间的 ISO8601 串(UTC),与 walkOps event.startAt 同形状 */
function nowIso() {
  return new Date().toISOString();
}

module.exports = { nowIso };
