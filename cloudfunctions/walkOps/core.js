// cloudfunctions/walkOps/core.js —— owner: T11
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 该脚本只重写 core.js / index.js,所以 _shared 的 require 只能出现在本文件里。
//
// spec 3.3.2「约遛域(T11)」—— 一个云函数按 action 分发,八个 action:
// event: { action: 'create'|'list'|'get'|'join'|'decide'|'leave'|'cancel'|'message', ... }
// data:  WalkSummary | [WalkSummary] | WalkDetail |
//        {memberId,status} | {left:true} | {cancelled:true} | {messageId}
// 全部需要登录;对外的狗一律过 toDogCard(spec 3.2.3),绝不返回狗文档原样。

const { COLL, LIMITS, WALK_STATUS, MEMBER_STATUS } = require('../_shared/contracts');
const { CODES, fail, ok } = require('../_shared/errors');

// 状态字面量从 3.2.1 的枚举里取,免得和契约漂移
const [WALK_OPEN, WALK_CANCELLED] = WALK_STATUS;
const [PENDING, APPROVED, REJECTED, LEFT] = MEMBER_STATUS;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINE_WINDOW_MS = 7 * DAY_MS; // mine:true 往回看 7 天
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/; // 'YYYY-MM-DD'
const UNKNOWN_DOG_NAME = '某只狗'; // 留言署名的狗已被删(spec 3.2.3 WalkMessage)

// ------------------------------------------------------------------ 小工具

function unique(list) {
  return list.filter((v, i) => list.indexOf(v) === i);
}

function toMs(v) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/** 对外的时间字段一律 ISO 串(spec 3.2.2) */
function toISO(v) {
  const ms = toMs(v);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

/** 客户端传来的时刻;不是时间就给 null */
function parseTime(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 东八区自然日 'YYYY-MM-DD' → [起, 止) 毫秒区间;偏移写死,不信运行时时区 */
function dayRangeMs(date) {
  const start = Date.parse(date + 'T00:00:00+08:00');
  return { start, end: start + DAY_MS };
}

// ------------------------------------------------------------ 形状转换

/**
 * DogCard —— 恰好五个 key(spec 3.2.3)。
 * 任何面向其他用户的狗展示都必须过这里,狗文档里的 ownerOpenid / breed / tagCode 等一律不外泄。
 */
function toDogCard(dog) {
  return {
    dogId: dog._id,
    name: dog.name,
    avatarFileID: dog.avatarFileID || '',
    sizeClass: dog.sizeClass,
    tags: Array.isArray(dog.tags) ? dog.tags : [],
  };
}

/** 按给定的 id 顺序转 DogCard;狗文档不在了(被主人删了)就跳过 */
function cardsFrom(dogMap, dogIds) {
  return (dogIds || [])
    .map((id) => dogMap.get(id))
    .filter(Boolean)
    .map(toDogCard);
}

/** WalkSummary 的唯一构造处(spec 3.2.3),key 集合只在这里定义 */
function makeWalkSummary(walk, extra) {
  return {
    walkId: walk._id,
    parkId: walk.parkId,
    parkName: extra.parkName,
    startAt: toISO(walk.startAt),
    note: walk.note || '',
    maxDogs: walk.maxDogs,
    dogCount: extra.dogCount,
    hostDogs: extra.hostDogs,
    status: walk.status,
    isHost: extra.isHost,
    myStatus: extra.myStatus,
  };
}

// ---------------------------------------------------------------- 取数

/** 按 _id 批量取,返回 Map;顺序由调用方按自己的 id 列表还原 */
async function fetchByIds(ctx, coll, ids) {
  const uniq = unique(ids.filter((v) => typeof v === 'string' && v));
  if (!uniq.length) return new Map();
  const r = await ctx.db
    .collection(coll)
    .where({ _id: ctx._.in(uniq) })
    .get();
  return new Map(r.data.map((d) => [d._id, d]));
}

/**
 * 取 walk。
 * @returns {Promise<{err:object}|{walk:object}>} err 是可直接返回的 fail(...)
 */
async function loadWalk(event, ctx) {
  if (typeof event.walkId !== 'string' || !event.walkId) {
    return { err: fail(CODES.INVALID_PARAM, 'walkId') };
  }
  const r = await ctx.db
    .collection(COLL.WALKS)
    .where({ _id: event.walkId })
    .get();
  if (!r.data[0]) return { err: fail(CODES.NOT_FOUND, COLL.WALKS) };
  return { walk: r.data[0] };
}

/**
 * 校验 event.dogIds:非空、去重、全是自己的。
 * @returns {Promise<{err:object}|{dogIds:string[], dogs:object[]}>}
 */
async function loadOwnDogs(event, ctx) {
  const raw = event.dogIds;
  if (!Array.isArray(raw) || !raw.length) return { err: fail(CODES.INVALID_PARAM, 'dogIds') };
  if (raw.some((id) => typeof id !== 'string' || !id)) {
    return { err: fail(CODES.INVALID_PARAM, 'dogIds') };
  }

  const dogIds = unique(raw);
  const dogMap = await fetchByIds(ctx, COLL.DOGS, dogIds);
  if (dogMap.size !== dogIds.length) return { err: fail(CODES.NOT_FOUND, COLL.DOGS) };

  const dogs = dogIds.map((id) => dogMap.get(id));
  if (dogs.some((d) => d.ownerOpenid !== ctx.openid)) return { err: fail(CODES.FORBIDDEN) };
  return { dogIds, dogs };
}

/** 这一场里 approved 成员带来的狗数 */
function countApproved(rows, walkId) {
  return rows
    .filter((m) => m.walkId === walkId)
    .reduce((n, m) => n + (m.dogIds || []).length, 0);
}

/**
 * 一批 walk 文档 → [WalkSummary]。
 * parkName / hostDogs / dogCount 与库一致,isHost / myStatus 按调用者算。
 * 狗数按文档里记的 dogIds 算(狗被删了也不该凭空腾出名额),hostDogs 只列还在的。
 */
async function toWalkSummaries(walks, ctx) {
  if (!walks.length) return [];

  const walkIds = walks.map((w) => w._id);
  const hostDogIds = [];
  walks.forEach((w) => hostDogIds.push(...(w.dogIds || [])));

  const [parkMap, dogMap, approved, mine] = await Promise.all([
    fetchByIds(ctx, COLL.PARKS, walks.map((w) => w.parkId)),
    fetchByIds(ctx, COLL.DOGS, hostDogIds),
    ctx.db
      .collection(COLL.WALK_MEMBERS)
      .where({ walkId: ctx._.in(walkIds), status: APPROVED })
      .get(),
    ctx.db
      .collection(COLL.WALK_MEMBERS)
      .where({ walkId: ctx._.in(walkIds), openid: ctx.openid })
      .get(),
  ]);

  return walks.map((w) => {
    const park = parkMap.get(w.parkId);
    const isHost = w.hostOpenid === ctx.openid;
    const myRow = mine.data.find((m) => m.walkId === w._id);
    return makeWalkSummary(w, {
      parkName: park ? park.name : '', // 公园没了也不能让整条约遛消失
      hostDogs: cardsFrom(dogMap, w.dogIds),
      dogCount: (w.dogIds || []).length + countApproved(approved.data, w._id),
      isHost,
      // myStatus 优先级:host > 我在 members 里那条的 status > none(spec 3.2.3)
      myStatus: isHost ? 'host' : myRow ? myRow.status : 'none',
    });
  });
}

// ================================================================ create

async function actionCreate(event, ctx) {
  if (typeof event.parkId !== 'string' || !event.parkId) {
    return fail(CODES.INVALID_PARAM, 'parkId');
  }
  const parks = await ctx.db
    .collection(COLL.PARKS)
    .where({ _id: event.parkId })
    .get();
  const park = parks.data[0];
  if (!park || !park.active) return fail(CODES.NOT_FOUND, COLL.PARKS);

  const startAt = parseTime(event.startAt);
  if (!startAt || startAt.getTime() <= ctx.now().getTime()) {
    return fail(CODES.INVALID_PARAM, 'startAt');
  }

  const loaded = await loadOwnDogs(event, ctx);
  if (loaded.err) return loaded.err;

  const note = event.note === undefined || event.note === null ? '' : event.note;
  if (typeof note !== 'string' || note.length > LIMITS.WALK_NOTE_MAX) {
    return fail(CODES.INVALID_PARAM, 'note');
  }

  const maxDogs =
    event.maxDogs === undefined || event.maxDogs === null
      ? LIMITS.WALK_MAX_DOGS_DEFAULT
      : event.maxDogs;
  // 发起人的狗也算在内(假设 6),所以上限不能小于自己带的狗数
  if (
    !Number.isInteger(maxDogs) ||
    maxDogs < 1 ||
    maxDogs > LIMITS.WALK_MAX_DOGS_CAP ||
    maxDogs < loaded.dogIds.length
  ) {
    return fail(CODES.INVALID_PARAM, 'maxDogs');
  }

  if (!(await ctx.security.checkText(note))) return fail(CODES.CONTENT_RISKY, 'note');

  const now = ctx.now();
  const doc = {
    hostOpenid: ctx.openid,
    parkId: event.parkId,
    startAt,
    dogIds: loaded.dogIds,
    note,
    maxDogs,
    status: WALK_OPEN,
    createdAt: now,
    updatedAt: now,
  };
  const added = await ctx.db.collection(COLL.WALKS).add({ data: doc });

  return ok(
    makeWalkSummary(Object.assign({ _id: added._id }, doc), {
      parkName: park.name,
      hostDogs: loaded.dogs.map(toDogCard),
      dogCount: loaded.dogIds.length,
      isHost: true,
      myStatus: 'host',
    })
  );
}

// ================================================================== list

/** 广场:open 且还没开始的,按 startAt 升序 */
async function listOpen(event, ctx, nowMs) {
  let startAt = ctx._.gt(new Date(nowMs));
  if (event.date !== undefined && event.date !== null) {
    const range = dayRangeMs(String(event.date));
    startAt = startAt.and(ctx._.gte(new Date(range.start))).and(ctx._.lt(new Date(range.end)));
  }

  const where = { status: WALK_OPEN, startAt };
  if (event.parkId) where.parkId = event.parkId;

  const r = await ctx.db.collection(COLL.WALKS).where(where).orderBy('startAt', 'asc').get();
  return r.data;
}

/** 我的:我 host 的 + 我 pending/approved 的,含 cancelled,7 天窗口内,按 startAt 降序 */
async function listMine(ctx, nowMs) {
  const since = new Date(nowMs - MINE_WINDOW_MS);

  const hosted = await ctx.db
    .collection(COLL.WALKS)
    .where({ hostOpenid: ctx.openid, startAt: ctx._.gt(since) })
    .get();

  const rows = await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .where({ openid: ctx.openid, status: ctx._.in([PENDING, APPROVED]) })
    .get();

  // 我 host 的那些已经在上一批里了,别重复
  const joinedIds = unique(rows.data.map((m) => m.walkId)).filter(
    (id) => !hosted.data.some((w) => w._id === id)
  );
  const joined = joinedIds.length
    ? (
        await ctx.db
          .collection(COLL.WALKS)
          .where({ _id: ctx._.in(joinedIds), startAt: ctx._.gt(since) })
          .get()
      ).data
    : [];

  return hosted.data.concat(joined).sort((a, b) => toMs(b.startAt) - toMs(a.startAt));
}

async function actionList(event, ctx) {
  const nowMs = ctx.now().getTime();

  let walks;
  if (event.mine === true) {
    walks = await listMine(ctx, nowMs);
  } else {
    if (event.date !== undefined && event.date !== null && !DATE_RE.test(String(event.date))) {
      return fail(CODES.INVALID_PARAM, 'date');
    }
    walks = await listOpen(event, ctx, nowMs);
  }

  return ok(await toWalkSummaries(walks, ctx));
}

// =================================================================== get

async function actionGet(event, ctx) {
  const loadedWalk = await loadWalk(event, ctx);
  if (loadedWalk.err) return loadedWalk.err;
  const walk = loadedWalk.walk;

  const isHost = walk.hostOpenid === ctx.openid;
  const rows = (
    await ctx.db
      .collection(COLL.WALK_MEMBERS)
      .where({ walkId: walk._id })
      .orderBy('createdAt', 'asc')
      .get()
  ).data;
  const myRow = rows.find((m) => m.openid === ctx.openid);

  // host 看全部状态;其他人只看 approved + 自己那条(任何状态)
  const visible = isHost
    ? rows
    : rows.filter((m) => m.status === APPROVED || m.openid === ctx.openid);

  const memberDogIds = [];
  visible.forEach((m) => memberDogIds.push(...(m.dogIds || [])));
  const memberDogMap = await fetchByIds(ctx, COLL.DOGS, memberDogIds);

  const members = visible.map((m) => ({
    memberId: m._id,
    status: m.status,
    dogs: cardsFrom(memberDogMap, m.dogIds),
    isMe: m.openid === ctx.openid,
  }));

  // 留言区只对发起人和已批准成员开放(假设 8)
  let messages = [];
  if (isHost || (myRow && myRow.status === APPROVED)) {
    const raw = (
      await ctx.db
        .collection(COLL.MESSAGES)
        .where({ walkId: walk._id })
        .orderBy('createdAt', 'asc')
        .get()
    ).data;
    const msgDogMap = await fetchByIds(ctx, COLL.DOGS, raw.map((m) => m.dogId));
    messages = raw.map((m) => {
      const dog = msgDogMap.get(m.dogId);
      return {
        messageId: m._id,
        dogName: dog ? dog.name : UNKNOWN_DOG_NAME, // 以狗名署名,不显示主人昵称(假设 8)
        text: m.text,
        createdAt: toISO(m.createdAt),
        isMe: m.openid === ctx.openid,
      };
    });
  }

  const myDogs = (
    await ctx.db
      .collection(COLL.DOGS)
      .where({ ownerOpenid: ctx.openid })
      .orderBy('createdAt', 'asc')
      .get()
  ).data.map(toDogCard);

  const summaries = await toWalkSummaries([walk], ctx);
  return ok({ walk: summaries[0], members, messages, myDogs });
}

// ================================================================== join

async function actionJoin(event, ctx) {
  const loadedWalk = await loadWalk(event, ctx);
  if (loadedWalk.err) return loadedWalk.err;
  const walk = loadedWalk.walk;

  if (walk.status !== WALK_OPEN || toMs(walk.startAt) <= ctx.now().getTime()) {
    return fail(CODES.CONFLICT, 'walk closed');
  }
  if (walk.hostOpenid === ctx.openid) return fail(CODES.FORBIDDEN); // host 的狗在 walk.dogIds 里

  const loaded = await loadOwnDogs(event, ctx);
  if (loaded.err) return loaded.err;

  const now = ctx.now();
  const rows = await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .where({ walkId: walk._id, openid: ctx.openid })
    .get();
  const row = rows.data[0];

  if (row) {
    // 被拒绝的不能再申请,退出的可以(假设 7)
    if (row.status !== LEFT) return fail(CODES.CONFLICT, row.status);
    await ctx.db
      .collection(COLL.WALK_MEMBERS)
      .doc(row._id)
      .update({ data: { status: PENDING, dogIds: loaded.dogIds, updatedAt: now } });
    return ok({ memberId: row._id, status: PENDING });
  }

  // 满了也让人排队,由 host 在 decide 时定夺(假设 6),所以这里不查容量
  const added = await ctx.db.collection(COLL.WALK_MEMBERS).add({
    data: {
      walkId: walk._id,
      openid: ctx.openid,
      dogIds: loaded.dogIds,
      status: PENDING,
      createdAt: now,
      updatedAt: now,
    },
  });
  return ok({ memberId: added._id, status: PENDING });
}

// ================================================================ decide

async function actionDecide(event, ctx) {
  if (typeof event.memberId !== 'string' || !event.memberId) {
    return fail(CODES.INVALID_PARAM, 'memberId');
  }
  if (typeof event.approve !== 'boolean') return fail(CODES.INVALID_PARAM, 'approve');

  const found = await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .where({ _id: event.memberId })
    .get();
  const member = found.data[0];
  if (!member) return fail(CODES.NOT_FOUND, COLL.WALK_MEMBERS);

  const walks = await ctx.db
    .collection(COLL.WALKS)
    .where({ _id: member.walkId })
    .get();
  const walk = walks.data[0];
  if (!walk) return fail(CODES.NOT_FOUND, COLL.WALKS);
  if (walk.hostOpenid !== ctx.openid) return fail(CODES.FORBIDDEN);
  if (member.status !== PENDING) return fail(CODES.CONFLICT, member.status);
  if (walk.status === WALK_CANCELLED) return fail(CODES.CONFLICT, 'walk cancelled');

  if (event.approve) {
    const approved = await ctx.db
      .collection(COLL.WALK_MEMBERS)
      .where({ walkId: walk._id, status: APPROVED })
      .get();
    const taken = (walk.dogIds || []).length + countApproved(approved.data, walk._id);
    // 满员只是不批,这条申请留在 pending,host 可以改批别人
    if (taken + (member.dogIds || []).length > walk.maxDogs) return fail(CODES.WALK_FULL);
  }

  const status = event.approve ? APPROVED : REJECTED;
  await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .doc(member._id)
    .update({ data: { status, updatedAt: ctx.now() } });

  return ok({ memberId: member._id, status });
}

// ================================================================= leave

async function actionLeave(event, ctx) {
  const loadedWalk = await loadWalk(event, ctx);
  if (loadedWalk.err) return loadedWalk.err;
  const walk = loadedWalk.walk;

  if (walk.hostOpenid === ctx.openid) return fail(CODES.FORBIDDEN); // host 只能 cancel

  const rows = await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .where({ walkId: walk._id, openid: ctx.openid })
    .get();
  const row = rows.data[0];
  if (!row) return fail(CODES.CONFLICT, 'none');
  if (row.status === REJECTED || row.status === LEFT) return fail(CODES.CONFLICT, row.status);

  await ctx.db
    .collection(COLL.WALK_MEMBERS)
    .doc(row._id)
    .update({ data: { status: LEFT, updatedAt: ctx.now() } });

  return ok({ left: true });
}

// ================================================================ cancel

async function actionCancel(event, ctx) {
  const loadedWalk = await loadWalk(event, ctx);
  if (loadedWalk.err) return loadedWalk.err;
  const walk = loadedWalk.walk;

  if (walk.hostOpenid !== ctx.openid) return fail(CODES.FORBIDDEN);
  if (walk.status === WALK_CANCELLED) return ok({ cancelled: true }); // 幂等

  await ctx.db
    .collection(COLL.WALKS)
    .doc(walk._id)
    .update({ data: { status: WALK_CANCELLED, updatedAt: ctx.now() } });

  return ok({ cancelled: true });
}

// =============================================================== message

async function actionMessage(event, ctx) {
  const loadedWalk = await loadWalk(event, ctx);
  if (loadedWalk.err) return loadedWalk.err;
  const walk = loadedWalk.walk;

  if (walk.status === WALK_CANCELLED) return fail(CODES.CONFLICT, 'walk cancelled');

  const isHost = walk.hostOpenid === ctx.openid;
  let member = null;
  if (!isHost) {
    const rows = await ctx.db
      .collection(COLL.WALK_MEMBERS)
      .where({ walkId: walk._id, openid: ctx.openid })
      .get();
    member = rows.data[0];
    if (!member || member.status !== APPROVED) return fail(CODES.FORBIDDEN);
  }

  const text = typeof event.text === 'string' ? event.text.trim() : '';
  if (!text || text.length > LIMITS.MESSAGE_MAX) return fail(CODES.INVALID_PARAM, 'text');
  if (!(await ctx.security.checkText(text))) return fail(CODES.CONTENT_RISKY, 'text');

  // 署名的狗 = 发言者带进这次约遛的第一只(spec 3.2.2 messages.dogId)
  const dogIds = isHost ? walk.dogIds : member.dogIds;
  const added = await ctx.db.collection(COLL.MESSAGES).add({
    data: {
      walkId: walk._id,
      openid: ctx.openid,
      dogId: (dogIds || [])[0] || '',
      text,
      createdAt: ctx.now(),
    },
  });

  return ok({ messageId: added._id });
}

// ================================================================== 分发

const ACTIONS = {
  create: actionCreate,
  list: actionList,
  get: actionGet,
  join: actionJoin,
  decide: actionDecide,
  leave: actionLeave,
  cancel: actionCancel,
  message: actionMessage,
};

/**
 * @param {object} event                云函数入参
 * @param {object} ctx                  见 spec 3.3.1(db / _ / openid / now / openapi / logger / storage / security)
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};

  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED); // 八个 action 都要登录

  const run = Object.prototype.hasOwnProperty.call(ACTIONS, e.action) ? ACTIONS[e.action] : null;
  if (!run) return fail(CODES.INVALID_PARAM, 'action');

  try {
    return await run(e, ctx);
  } catch (err) {
    // core 永远不把异常抛给调用方(spec 3.1)
    if (ctx.logger && ctx.logger.error) ctx.logger.error('walkOps ' + e.action + ' failed', err);
    return fail(CODES.INTERNAL, err.message);
  }
};
