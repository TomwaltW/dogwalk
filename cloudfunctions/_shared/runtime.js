/**
 * 云函数入口的公共部分 —— spec 3.3.1,T0' 提供。
 *
 * 每个云函数的 index.js 只剩五行:
 *   const cloud = require('wx-server-sdk');
 *   cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
 *   const core = require('./core');
 *   const { handler } = require('../_shared/runtime');
 *   exports.main = handler(cloud, core);
 *
 * 这里负责:组 ctx(db / _ / openid / now / openapi / logger / storage / security),
 * 以及把 core 抛出的任何异常兜成 fail(INTERNAL)。core 自己不该抛,这只是最后一道。
 */

const { fail, CODES } = require('./errors');
const { createSecurity } = require('./security');

/**
 * 云存储句柄 —— spec 3.3.1 ctx.storage。
 * @param {object} cloud wx-server-sdk
 */
function createStorage(cloud) {
  return {
    /** @returns {Promise<Buffer>} */
    async downloadFile(fileID) {
      const r = await cloud.downloadFile({ fileID });
      return r.fileContent;
    },
    /** @returns {Promise<string>} fileID */
    async uploadFile(cloudPath, buffer) {
      const r = await cloud.uploadFile({ cloudPath, fileContent: buffer });
      return r.fileID;
    },
  };
}

/**
 * @param {object} opts
 * @param {object} opts.cloud
 * @param {object} opts.db
 * @param {string} opts.openid
 * @param {object} [opts.logger]
 * @param {() => Date} [opts.now]
 */
function makeCtx(opts) {
  const { cloud, db } = opts;
  const openid = opts.openid || '';
  const logger = opts.logger || console;
  const storage = createStorage(cloud);
  return {
    db,
    _: db.command,
    openid,
    now: opts.now || (() => new Date()),
    openapi: cloud.openapi,
    logger,
    storage,
    security: createSecurity({ openapi: cloud.openapi, storage, openid, logger }),
  };
}

/**
 * @param {object} cloud   wx-server-sdk(已 init)
 * @param {Function} core  (event, ctx) => Promise<{ok,...}>
 * @returns {Function}     exports.main
 */
function handler(cloud, core) {
  return async (event) => {
    try {
      const { OPENID } = cloud.getWXContext();
      const db = cloud.database();
      const ctx = makeCtx({ cloud, db, openid: OPENID || '', logger: console });
      return await core(event || {}, ctx);
    } catch (e) {
      console.error(e);
      return fail(CODES.INTERNAL, (e && e.message) || CODES.INTERNAL);
    }
  };
}

module.exports = { createStorage, makeCtx, handler };
