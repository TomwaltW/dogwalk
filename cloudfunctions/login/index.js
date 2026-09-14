const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const core = require('./core');
const { fail, CODES } = require('./_shared/errors');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  try {
    return await core(event, {
      db, _: db.command, openid: OPENID || '',
      now: () => new Date(), openapi: cloud.openapi, logger: console,
    });
  } catch (e) {
    console.error(e);
    return fail(CODES.INTERNAL, e.message);
  }
};
