// 云函数入口 —— 固定模板(spec 3.3.1),每个云函数一样,不要改。
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const core = require('./core');
const { handler } = require('../_shared/runtime');

exports.main = handler(cloud, core);
