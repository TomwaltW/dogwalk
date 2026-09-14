// cloudfunctions/dailyJob/core.js —— owner: T3
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
//
// spec 3.3.2
// 定时触发,无 event
// data: { archived: Number, encounters: Number, spotsUpdated: Number }
//
// 三个计数的口径(spec 只冻结了形状,这里写死口径备查):
//   archived      本次归档处理掉的「已过期 active 广播」条数。
//                 CHECKIN_STATUS 只有 active / cancelled 两个值(spec 3.2 冻结),
//                 所以「归档」不翻状态位 —— 过期与否一律按 expireAt 与当前时间算
//                 (看板也是这么过滤的,spec 2.2 B4),这里只统计,不改 checkins。
//   encounters    本次写入 / 刷新的 encounters 条数。
//   spotsUpdated  regularCount 真的发生变化的点位数(值没变的不算)。
//
// 定时触发没有调用者,ctx.openid 恒为 ''。这里不做 AUTH_REQUIRED 校验 ——
// spec 3.4 那条只约束「接口需要登录」的那一类,dailyJob 不是对外接口。
//
// fake-db 不支持聚合与事务(spec 3.3.5),所以碰面统计一律 where() + get() 自己算;
// 幂等靠「重算后覆写 times」而不是 _.inc 累加,重复跑不会翻倍。

const { COLL } = require('../_shared/contracts');
const { ok } = require('../_shared/errors');

const DAY_MS = 24 * 60 * 60 * 1000;
// 云函数运行时的时区不保证(云开发默认 UTC),统一按东八区切日,
// 否则早上 6 点遛狗会被算到前一天。
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;
// 归档回看窗口:每天跑一次,回看 2 天足够覆盖昨天整天 + 今天已过期的。
const LOOKBACK_MS = 2 * DAY_MS;
// 常客统计窗口:近 14 天在该点位出过场的不同 openid 数,即 spots.regularCount。
const REGULAR_WINDOW_MS = 14 * DAY_MS;
// 分桶键的分隔符:spotId / date 里都不会出现它
const BUCKET_SEP = '#';

/** 库里取出来的时间可能是 Date,也可能是 ISO 串,统一成 Date */
function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

/** 按东八区把时刻切成 'YYYY-MM-DD'(spec 3.2 encounters.date) */
function dateStr(d) {
  return new Date(toDate(d).getTime() + CN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 两段广播的时间窗是否重叠。边界(恰好等于 expireAt)不算重叠,与在场判定口径一致 */
function overlaps(a, b) {
  return (
    toDate(a.startAt).getTime() < toDate(b.expireAt).getTime() &&
    toDate(b.startAt).getTime() < toDate(a.expireAt).getTime()
  );
}

/** 两个 openid 字典序升序后用下划线连接(spec 3.2 encounters.pairKey) */
function pairKeyOf(x, y) {
  return x < y ? x + '_' + y : y + '_' + x;
}

/**
 * 把一批已过期的广播按 (spotId, date) 分桶,桶内两两求碰面。
 *
 * @param {Array<object>} checkins 已过期的 active 广播
 * @returns {Array<{spotId:string, date:string, pairKey:string, times:number, lastAt:Date}>}
 */
function buildEncounters(checkins) {
  const buckets = new Map();
  checkins.forEach((c) => {
    const key = c.spotId + BUCKET_SEP + dateStr(c.startAt);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  });

  const out = [];
  buckets.forEach((rows, key) => {
    const sep = key.lastIndexOf(BUCKET_SEP);
    const spotId = key.slice(0, sep);
    const date = key.slice(sep + 1);
    const pairs = new Map();
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.openid === b.openid) continue; // 自己跟自己不算碰面
        if (!overlaps(a, b)) continue;
        const pairKey = pairKeyOf(a.openid, b.openid);
        // 碰面时刻 = 两段广播重叠开始的那一刻
        const at = new Date(Math.max(toDate(a.startAt).getTime(), toDate(b.startAt).getTime()));
        const cur = pairs.get(pairKey);
        if (cur) {
          cur.times += 1;
          if (at.getTime() > cur.lastAt.getTime()) cur.lastAt = at;
        } else {
          pairs.set(pairKey, { times: 1, lastAt: at });
        }
      }
    }
    pairs.forEach((agg, pairKey) => {
      out.push({ spotId, date, pairKey, times: agg.times, lastAt: agg.lastAt });
    });
  });
  return out;
}

/**
 * @param {object} event                云函数入参(定时触发时为空)
 * @param {object} ctx
 * @param {object} ctx.db               云开发 db 实例(测试时为 fake-db)
 * @param {object} ctx._                db.command
 * @param {string} ctx.openid           调用者 openid,游客为 ''
 * @param {() => Date} ctx.now          取当前时间,禁止直接 new Date()
 * @param {object} ctx.openapi          cloud.openapi,测试时为 mock
 * @param {{info:Function,error:Function}} ctx.logger
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const { db, _ } = ctx;
  const logger = ctx.logger || console;
  const now = ctx.now();

  // 1. 已过期的 active 广播 —— 归档窗口内的那些
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const expired = (
    await db
      .collection(COLL.CHECKINS)
      .where({ status: 'active', expireAt: _.lte(now).and(_.gte(since)) })
      .get()
  ).data;
  const archived = expired.length;

  // 2. 碰面统计:重算后覆写,重复跑不翻倍
  const rows = buildEncounters(expired);
  let encounters = 0;
  for (const row of rows) {
    const hit = (
      await db
        .collection(COLL.ENCOUNTERS)
        .where({ spotId: row.spotId, date: row.date, pairKey: row.pairKey })
        .limit(1)
        .get()
    ).data[0];
    if (hit) {
      await db
        .collection(COLL.ENCOUNTERS)
        .doc(hit._id)
        .update({ data: { times: row.times, lastAt: row.lastAt } });
    } else {
      await db.collection(COLL.ENCOUNTERS).add({ data: row });
    }
    encounters += 1;
  }

  // 3. 点位常客数:近 14 天在该点位出过场的不同 openid 数
  const regularSince = new Date(now.getTime() - REGULAR_WINDOW_MS);
  const spots = (await db.collection(COLL.SPOTS).get()).data;
  let spotsUpdated = 0;
  for (const spot of spots) {
    const visits = (
      await db
        .collection(COLL.CHECKINS)
        .where({
          spotId: spot._id,
          status: 'active',
          startAt: _.gte(regularSince).and(_.lte(now)),
        })
        .get()
    ).data;
    const regularCount = new Set(visits.map((v) => v.openid)).size;
    if (regularCount !== spot.regularCount) {
      await db.collection(COLL.SPOTS).doc(spot._id).update({ data: { regularCount } });
      spotsUpdated += 1;
    }
  }

  logger.info('dailyJob done', { archived, encounters, spotsUpdated });
  return ok({ archived, encounters, spotsUpdated });
};
