/**
 * 一把组好云函数测试用的 ctx —— spec 3.3.5,T0' 提供,各轨只使用不修改。
 *
 *   const { ctx, db, dump, calls } = makeTestCtx({ seed, openid: 'o1', risky: ['脏话'] });
 *   const r = await core(event, ctx);
 *
 * 各部件:
 *   ctx.db / ctx._          tests/fakes/fake-db.js
 *   ctx.now                 缺省 fixedClock('2026-09-16T10:00:00+08:00')
 *   ctx.security.checkText  文本含 risky 里任一词 → false,否则 true
 *   ctx.security.checkImage fileID 在 riskyImages 里 → false,否则 true
 *   ctx.storage.uploadFile  返回 'cloud://fake/' + cloudPath,并 push 到 calls.uploads
 *   ctx.storage.downloadFile 返回 Buffer('fake:' + fileID),并 push 到 calls.downloads
 *   ctx.openapi             缺省:subscribeMessage.send 记到 calls.subscribe 后 resolve({errCode:0});
 *                           wxacode.getUnlimited 记到 calls.wxacode 后 resolve({buffer, contentType})。
 *                           传 openapi 可整体覆盖(比如让 send 抛错验「发失败不影响主流程」)。
 *   ctx.logger              缺省把 error 记到 calls.errors,不往控制台喷;传 logger 可覆盖
 *
 * 所有 calls.* 都是普通数组,断言直接读;每次 makeTestCtx 都是新的。
 */

const { createFakeDb } = require('./fake-db');
const { fixedClock } = require('./clock');

const DEFAULT_NOW = '2026-09-16T10:00:00+08:00';

/**
 * @param {object} [opts]
 * @param {Object<string, Array<object>>} [opts.seed]
 * @param {string} [opts.openid]         缺省 ''(游客)
 * @param {() => Date} [opts.now]
 * @param {string[]} [opts.risky]        命中即内容不安全的词
 * @param {string[]} [opts.riskyImages]  命中即图片不安全的 fileID
 * @param {object} [opts.openapi]
 * @param {object} [opts.logger]
 * @returns {{ctx: object, db: object, _: object, dump: Function, calls: object}}
 */
function makeTestCtx(opts) {
  const o = opts || {};
  const { db, _, dump } = createFakeDb(o.seed || {});
  const risky = o.risky || [];
  const riskyImages = o.riskyImages || [];

  const calls = {
    subscribe: [],
    wxacode: [],
    uploads: [],
    downloads: [],
    errors: [],
    infos: [],
  };

  const openapi = o.openapi || {
    subscribeMessage: {
      async send(payload) {
        calls.subscribe.push(payload);
        return { errCode: 0, errMsg: 'openapi.subscribeMessage.send:ok' };
      },
    },
    wxacode: {
      async getUnlimited(payload) {
        calls.wxacode.push(payload);
        return { buffer: Buffer.from('fake-png:' + (payload && payload.scene)), contentType: 'image/png' };
      },
    },
  };

  const storage = {
    async uploadFile(cloudPath, buffer) {
      calls.uploads.push({ cloudPath, buffer });
      return 'cloud://fake/' + cloudPath;
    },
    async downloadFile(fileID) {
      calls.downloads.push(fileID);
      return Buffer.from('fake:' + fileID);
    },
  };

  const security = {
    async checkText(text) {
      if (typeof text !== 'string' || text.trim() === '') return true;
      return !risky.some((w) => text.indexOf(w) >= 0);
    },
    async checkImage(fileID) {
      if (typeof fileID !== 'string' || fileID === '') return true;
      return riskyImages.indexOf(fileID) < 0;
    },
  };

  const logger = o.logger || {
    info: (...a) => calls.infos.push(a),
    error: (...a) => calls.errors.push(a),
  };

  const ctx = {
    db,
    _,
    openid: o.openid || '',
    now: o.now || fixedClock(DEFAULT_NOW),
    openapi,
    logger,
    storage,
    security,
  };

  return { ctx, db, _, dump, calls };
}

module.exports = { makeTestCtx, DEFAULT_NOW };
