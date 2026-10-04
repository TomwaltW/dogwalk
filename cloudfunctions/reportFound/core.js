// cloudfunctions/reportFound/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { tagCode: String, message: String, latitude?: Number, longitude?: Number }
// data:  { reportId: String, notified: Boolean }
// 允许游客(ctx.openid === '')调用,这是 AUTH_REQUIRED 的例外之一(spec 3.4)——
// 捡到狗的路人多半没登录过,让他先注册等于这条链路白做。

const { COLL, LIMITS, TEMPLATE_KEYS } = require('../_shared/contracts');
const { isLatLng } = require('../_shared/geo');
const { ok, fail, CODES } = require('../_shared/errors');
const { CST_OFFSET_MS, charLength, headChars } = require('../_shared/text');
const { TAG_CODE_RE } = require('../_shared/tagcode');

/**
 * 「寻回留言」订阅消息模板的字段名。
 *
 * 模板由总管在小程序后台申请(spec 8),字段名以后台实际配置为准;对不上时
 * **只改这里**,下面的 send 调用不用动。
 */
const TEMPLATE_FIELDS = { name: 'thing1', message: 'thing2', time: 'time3' };

const TEMPLATE_KEY = TEMPLATE_KEYS.FOUND_REPORT;
/** 订阅消息 thing 类字段有长度限制,留言只带个开头,详情让主人点进小程序看 */
const MSG_PREVIEW_MAX = 20;

/**
 * 东八区的 'YYYY-MM-DD HH:mm'。
 *
 * 云函数运行时时区不保证是 UTC+8(spec 派工要求一律 ctx.now() + 自己算偏移),
 * 所以这里手动加 8 小时后读 UTC 字段,不信 getHours()。
 *
 * @param {Date} d
 * @returns {string}
 */
function formatCst(d) {
  const t = new Date(d.getTime() + CST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return (
    t.getUTCFullYear() +
    '-' +
    p(t.getUTCMonth() + 1) +
    '-' +
    p(t.getUTCDate()) +
    ' ' +
    p(t.getUTCHours()) +
    ':' +
    p(t.getUTCMinutes())
  );
}

/**
 * 坐标校验:要么都不给,要么都给且合法。
 *
 * @param {*} lat
 * @param {*} lng
 * @returns {{err?: string, latitude: (number|null), longitude: (number|null)}}
 */
function normalizeLatLng(lat, lng) {
  const hasLat = lat !== undefined && lat !== null;
  const hasLng = lng !== undefined && lng !== null;
  if (!hasLat && !hasLng) return { latitude: null, longitude: null };
  if (hasLat !== hasLng) return { err: hasLat ? 'longitude' : 'latitude' };
  if (!isLatLng(lat, lng)) {
    // 逐个报,前端好定位是哪一半坏了(0 是合法经度,拿它当哨兵)
    return { err: isLatLng(lat, 0) ? 'longitude' : 'latitude' };
  }
  return { latitude: lat, longitude: lng };
}

/**
 * 给主人发「寻回留言」订阅消息。
 *
 * spec 3.4:额度为 0 或没记过模板 id 都**不是错误**,静默跳过;
 * 额度先原子地占 1 条再发;send 抛错就退回额度、记 logger.error,主流程仍 ok。
 *
 * @param {object} dog     dogs 文档
 * @param {string} message 路人的留言原文
 * @param {object} ctx
 * @returns {Promise<boolean>} 真发出去了才是 true
 */
async function notifyOwner(dog, message, ctx) {
  const users = ctx.db.collection(COLL.USERS);

  let owner = null;
  try {
    owner = (await users.doc(dog.ownerOpenid).get()).data;
  } catch {
    owner = null; // 主人文档不在了就当没额度,不影响留言落库
  }
  if (!owner) return false;

  const templateId = owner.subTemplates && owner.subTemplates[TEMPLATE_KEY];
  if (typeof templateId !== 'string' || templateId === '') return false;

  // 先占额度再发:条件更新「额度 > 0 才扣 1」是原子的,两个路人同时留言
  // 也只有一个能占到最后一条,额度不会被扣成负数。没占到就是没额度,静默跳过。
  const quotaPath = 'subQuota.' + TEMPLATE_KEY;
  const taken = await users
    .where({ _id: dog.ownerOpenid, [quotaPath]: ctx._.gt(0) })
    .update({ data: { [quotaPath]: ctx._.inc(-1) } });
  if (!(taken && taken.stats && taken.stats.updated)) return false;

  try {
    await ctx.openapi.subscribeMessage.send({
      touser: dog.ownerOpenid,
      template_id: templateId,
      page: 'pages/dog/tag/tag?dogId=' + dog._id,
      data: {
        [TEMPLATE_FIELDS.name]: { value: typeof dog.name === 'string' ? dog.name : '' },
        [TEMPLATE_FIELDS.message]: { value: headChars(message, MSG_PREVIEW_MAX) },
        [TEMPLATE_FIELDS.time]: { value: formatCst(ctx.now()) },
      },
    });
  } catch (e) {
    // spec 3.4:openapi 失败不影响主流程,也不扣额度(没发出去凭什么扣)—— 把占的那条还回去
    await users.doc(dog.ownerOpenid).update({ data: { [quotaPath]: ctx._.inc(1) } });
    if (ctx.logger && ctx.logger.error) {
      ctx.logger.error('reportFound: 订阅消息发送失败', {
        dogId: dog._id,
        msg: e && e.message,
      });
    }
    return false;
  }

  return true;
}

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};

  // 这里没有 AUTH_REQUIRED:reportFound 是游客例外(spec 3.4)。
  const tagCode = e.tagCode;
  if (typeof tagCode !== 'string' || !TAG_CODE_RE.test(tagCode)) {
    return fail(CODES.INVALID_PARAM, 'tagCode');
  }

  const message = typeof e.message === 'string' ? e.message.trim() : '';
  if (message === '' || charLength(message) > LIMITS.FOUND_MSG_MAX) {
    return fail(CODES.INVALID_PARAM, 'message');
  }

  const coord = normalizeLatLng(e.latitude, e.longitude);
  if (coord.err) return fail(CODES.INVALID_PARAM, coord.err);

  if (!(await ctx.security.checkText(message))) {
    return fail(CODES.CONTENT_RISKY, 'message');
  }

  const found = await ctx.db.collection(COLL.DOGS).where({ tagCode }).limit(1).get();
  const dog = found.data[0];
  if (!dog) return fail(CODES.NOT_FOUND, COLL.DOGS);

  // 先把留言落库再去发通知:openapi 慢或挂了都不能把路人写的字弄丢。
  const reports = ctx.db.collection(COLL.FOUND_REPORTS);
  const added = await reports.add({
    data: {
      dogId: dog._id,
      tagCode,
      message,
      latitude: coord.latitude,
      longitude: coord.longitude,
      reporterOpenid: ctx.openid || '', // 游客写空串,不是 null / undefined
      notified: false,
      createdAt: ctx.now(),
    },
  });

  const notified = await notifyOwner(dog, message, ctx);
  if (notified) await reports.doc(added._id).update({ data: { notified: true } });

  return ok({ reportId: added._id, notified });
};
