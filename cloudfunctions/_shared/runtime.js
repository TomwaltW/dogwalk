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
 * @param {string} [opts.unionid]
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
    // 跨端身份,见下面 handler 里的说明。业务代码认人一律用 ctx.openid,
    // 这个字段只给 login 存档用 —— 别拿它当主键判断。
    unionid: opts.unionid || '',
    now: opts.now || (() => new Date()),
    openapi: cloud.openapi,
    logger,
    storage,
    security: createSecurity({ openapi: cloud.openapi, storage, openid, logger }),
  };
}

/**
 * 跨端身份口径(2026-09-17 加,为以后的 App 版留的接缝):
 *
 * OPENID 只在微信里有,独立 App 拿不到。要让两端认出同一个人,靠的是
 * 微信开放平台的 UNIONID —— 小程序和 App 绑在同一个开放平台账号下,
 * 同一个微信用户的 UNIONID 相同(绑定后 getWXContext() 就会带上它)。
 *
 * **但主键仍然是 OPENID,不是 UNIONID。** 因为开放平台认证要钱要时间,
 * 绑定发生在哪一天是不确定的;主键要是随「这次有没有 UNIONID」而变,
 * 绑定前注册的人和绑定后回来的同一个人会被认成两个账号,狗和约遛全丢。
 * 所以 UNIONID 只记录、不夺权:login 把它存进用户文档(见 login/core.js),
 * 绑定之前是空串,绑定之后老用户下次登录自动补上。
 *
 * App 接入时的用法:App 侧用微信登录拿到 unionid,查 users 里 unionid 相同的
 * 那一条,取它的 _id(即 openid)当身份往下走 —— 现有 12 个云函数一行都不用改。
 *
 * @param {object} cloud   wx-server-sdk(已 init)
 * @param {Function} core  (event, ctx) => Promise<{ok,...}>
 * @returns {Function}     exports.main
 */
function handler(cloud, core) {
  return async (event) => {
    try {
      const { OPENID, UNIONID } = cloud.getWXContext();
      const db = cloud.database();
      const ctx = makeCtx({
        cloud,
        db,
        openid: OPENID || '',
        unionid: UNIONID || '',
        logger: console,
      });
      return await core(event || {}, ctx);
    } catch (e) {
      console.error(e);
      return fail(CODES.INTERNAL, (e && e.message) || CODES.INTERNAL);
    }
  };
}

module.exports = { createStorage, makeCtx, handler };
