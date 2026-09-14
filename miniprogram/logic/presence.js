/**
 * miniprogram/logic/presence.js —— owner: T2
 *
 * 在场聚合纯逻辑:不碰 wx、不碰 db、不 new Date()。
 * 时间一律由调用方传进来(spec 3.3.4:页面里禁止不可控副作用)。
 *
 * 为什么云函数不复用这个文件:小程序只打包 miniprogram/ 根内的文件,云函数包的根
 * 是 cloudfunctions/<fn>/,两边跨根 require 在真机 / 云上都 resolve 不到,而 _shared/
 * 是 T0 的 owner 文件不可写(spec 3.5)。spotBoard/core.js 因此自带一份服务端聚合,
 * 两边的判定口径必须一致 —— 改这里记得同步改那边。
 */

/** Date / 毫秒数 / ISO8601 字符串 → 毫秒数;认不出来的一律 NaN */
function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return new Date(v).getTime();
  return NaN;
}

function toIso(ms) {
  return typeof ms === 'number' && !Number.isNaN(ms) ? new Date(ms).toISOString() : '';
}

/**
 * 广播此刻是否还在场。
 *
 * 边界口径(spec 2.2 B8):now 恰好等于 expireAt 时**返回 false** —— 用 now < expireAt,
 * 不是 <=。90 分钟一到人就算走了,看板上不该再挂着。
 *
 * @param {object} checkin      checkin 文档(spec 3.2)
 * @param {Date|number|string} now
 * @returns {boolean}           脏数据一律 false,不抛异常
 */
function isActive(checkin, now) {
  if (!checkin || checkin.status !== 'active') return false;
  const expireAt = toMs(checkin.expireAt);
  const t = toMs(now);
  if (Number.isNaN(expireAt) || Number.isNaN(t)) return false;
  return t < expireAt;
}

/** [{_id}] 或 {id: doc} → {id: doc} */
function indexById(docs, key) {
  if (!docs) return {};
  if (Array.isArray(docs)) {
    const out = {};
    docs.forEach((d) => {
      if (d && d[key] !== undefined) out[d[key]] = d;
    });
    return out;
  }
  return docs;
}

/** socialOk === false 的狗不参与社交,不在看板露出(spec 3.2) */
function isVisibleDog(dog) {
  return !!dog && dog.socialOk !== false;
}

/** dog 文档 → BoardSession.dogs 的元素,字段只能少不能多 */
function toBoardDog(dog) {
  return {
    name: dog.name || '',
    avatarFileID: dog.avatarFileID || '',
    sizeClass: dog.sizeClass || '',
  };
}

/**
 * 把一堆广播聚合成看板上的「在场记录」。
 *
 * 合并口径(spec 2.2 B8):**按 openid 归并** —— 同一个人无论是一条广播带多只狗,
 * 还是先后发了几条,在看板上都只占一行。起点取最早的 startAt、终点取最晚的 expireAt、
 * note 取最近一条非空的。狗按首次出现的顺序去重取并集。
 *
 * 过滤口径:只保留 isActive() 为真的广播;socialOk:false 的狗剔掉;
 * 剔完一只狗都不剩的记录整条丢掉(人是为了狗才在看板上的)。
 *
 * @param {Array<object>} checkins        checkin 文档数组,可含已取消 / 已过期的
 * @param {object} opts
 * @param {Date|number|string} opts.now   判定在场的时刻,**必填**
 * @param {Array<object>|object} [opts.dogs]   dog 文档数组(或 _id→dog 映射);
 *                                             不传 = 一只狗都认不出来 = 得到空看板
 * @param {Array<object>|object} [opts.users]  user 文档数组(或 _id→user 映射)
 * @returns {Array<object>} BoardSession[](spec 3.3.2)
 */
function aggregateBoard(checkins, opts) {
  const o = opts || {};
  if (Number.isNaN(toMs(o.now))) {
    throw new Error('presence.aggregateBoard: opts.now 必填,且必须是 Date / 毫秒数 / ISO8601');
  }
  const dogIndex = indexById(o.dogs, '_id');
  const userIndex = indexById(o.users, '_id');

  const groups = [];
  const byOpenid = {};

  (checkins || []).forEach((c) => {
    if (!isActive(c, o.now)) return;
    const openid = c.openid || '';
    let g = byOpenid[openid];
    if (!g) {
      g = { openid: openid, dogIds: [], startAt: NaN, expireAt: NaN, note: '', noteAt: -Infinity };
      byOpenid[openid] = g;
      groups.push(g);
    }
    (c.dogIds || []).forEach((id) => {
      if (g.dogIds.indexOf(id) < 0) g.dogIds.push(id);
    });
    const startAt = toMs(c.startAt);
    const expireAt = toMs(c.expireAt);
    if (!Number.isNaN(startAt) && (Number.isNaN(g.startAt) || startAt < g.startAt)) g.startAt = startAt;
    if (!Number.isNaN(expireAt) && (Number.isNaN(g.expireAt) || expireAt > g.expireAt)) g.expireAt = expireAt;
    if (c.note && !Number.isNaN(startAt) && startAt >= g.noteAt) {
      g.note = c.note;
      g.noteAt = startAt;
    }
  });

  return groups
    .map((g) => {
      const user = userIndex[g.openid] || {};
      return {
        openid: g.openid,
        nickname: user.nickname || '',
        avatarFileID: user.avatarFileID || '',
        dogs: g.dogIds.map((id) => dogIndex[id]).filter(isVisibleDog).map(toBoardDog),
        startAt: toIso(g.startAt),
        expireAt: toIso(g.expireAt),
        note: g.note,
      };
    })
    .filter((s) => s.dogs.length > 0);
}

/**
 * 看板摘要计数:人按记录数、狗按记录里的狗数之和(aggregateBoard 已按人去重)。
 *
 * @param {Array<object>} sessions  aggregateBoard() 的返回值
 * @returns {{activePeopleCount:number, activeDogCount:number}}
 */
function presenceCounts(sessions) {
  const list = sessions || [];
  return {
    activePeopleCount: list.length,
    activeDogCount: list.reduce((n, s) => n + ((s && s.dogs) || []).length, 0),
  };
}

module.exports = { isActive, aggregateBoard, presenceCounts };
