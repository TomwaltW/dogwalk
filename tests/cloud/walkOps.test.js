/**
 * tests/cloud/walkOps.test.js —— owner: T11
 *
 * 验收 B7(spec 2.2)+ 第 6 节 T11 那一行:
 *   ① create → list 能看到
 *   ② join 后 host 的 get 看到 pending 成员;非成员的 get 里 messages 为 []
 *   ③ decide(approve) 超员 → WALK_FULL
 *   ④ 非 host decide → FORBIDDEN
 *   ⑤ cancel 后 list 不再出现
 *   ⑥ message 文本 checkText 为 false → CONTENT_RISKY
 *   ⑦ list 不返回已过期 / cancelled;mine:true 返回我 pending 的与 cancelled 的
 *   ⑧ leave 后再 join 变回 pending
 *   ⑨ 非成员 message → FORBIDDEN
 *   ⑩ 三种对外形状的 key 集合与 spec 3.2.3 逐字一致
 *   ⑪ get 返回值序列化后不含 openid / hostOpenid / nickname
 */

const core = require('../../cloudfunctions/walkOps/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { COLL, LIMITS } = require('../../cloudfunctions/_shared/contracts');

// makeTestCtx 缺省时钟:东八区 2026-09-16 10:00。下面所有时间都围着它排。
const NOW_MS = new Date('2026-09-16T10:00:00+08:00').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TONIGHT = '2026-09-16T19:00:00+08:00'; // 东八区 09-16
const LATE_TONIGHT = '2026-09-16T23:30:00+08:00'; // 东八区 09-16(UTC 还是 09-16)
const AFTER_MIDNIGHT = '2026-09-17T00:30:00+08:00'; // 东八区 09-17(UTC 是 09-16,按 UTC 切会算错)
const TOMORROW = '2026-09-17T09:00:00+08:00'; // 东八区 09-17
const YESTERDAY = '2026-09-15T19:00:00+08:00'; // 已过期
const LONG_AGO = '2026-09-05T19:00:00+08:00'; // 7 天窗口之外

// ---------------------------------------------------------------- 形状(spec 3.2.3,逐字)
const WALK_SUMMARY_KEYS = ['dogCount', 'hostDogs', 'isHost', 'maxDogs', 'myStatus',
  'note', 'parkId', 'parkName', 'startAt', 'status', 'walkId'];
const DOG_CARD_KEYS = ['avatarFileID', 'dogId', 'name', 'sizeClass', 'tags'];
const WALK_MEMBER_KEYS = ['dogs', 'isMe', 'memberId', 'status'];
const WALK_MESSAGE_KEYS = ['createdAt', 'dogName', 'isMe', 'messageId', 'text'];
const WALK_DETAIL_KEYS = ['members', 'messages', 'myDogs', 'walk'];

// ---------------------------------------------------------------- 种子

function dogDoc(patch) {
  return Object.assign(
    {
      name: '狗', avatarFileID: '', breed: '中华田园犬', gender: 'male', birthMonth: '2024-03',
      sizeClass: 'medium', neutered: true, vaccinated: true, licenseNo: '', tags: [],
      tagCode: '', qrFileID: '', lostMode: false, lostNote: '',
      createdAt: new Date('2026-08-01T10:00:00+08:00'),
      updatedAt: new Date('2026-08-01T10:00:00+08:00'),
    },
    patch || {}
  );
}

/** o1 有 d1/d2,o2 有 d3/d4,o3 有 d5;p1/p2 在营,p0 已关停 */
function baseSeed(extra) {
  return Object.assign(
    {
      parks: [
        { _id: 'p1', name: '城西公园', latitude: 30.27, longitude: 120.15, radiusM: 300, active: true },
        { _id: 'p2', name: '运河公园', latitude: 30.32, longitude: 120.13, radiusM: 200, active: true },
        { _id: 'p0', name: '已关停公园', latitude: 30.1, longitude: 120.1, radiusM: 100, active: false },
      ],
      dogs: [
        dogDoc({ _id: 'd1', ownerOpenid: 'o1', name: '旺财', sizeClass: 'medium', tags: ['ball'],
          avatarFileID: 'cloud://d1.png', createdAt: new Date('2026-08-01T10:00:00+08:00') }),
        dogDoc({ _id: 'd2', ownerOpenid: 'o1', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'],
          createdAt: new Date('2026-08-02T10:00:00+08:00') }),
        dogDoc({ _id: 'd3', ownerOpenid: 'o2', name: '大黄', sizeClass: 'large', tags: [],
          createdAt: new Date('2026-08-03T10:00:00+08:00') }),
        dogDoc({ _id: 'd4', ownerOpenid: 'o2', name: '小白', sizeClass: 'small', tags: ['shy'],
          createdAt: new Date('2026-08-04T10:00:00+08:00') }),
        dogDoc({ _id: 'd5', ownerOpenid: 'o3', name: '黑仔', sizeClass: 'large', tags: ['chaser'],
          createdAt: new Date('2026-08-05T10:00:00+08:00') }),
      ],
    },
    extra || {}
  );
}

function walkDoc(patch) {
  return Object.assign(
    {
      _id: 'w1', hostOpenid: 'o1', parkId: 'p1', startAt: new Date(TONIGHT),
      dogIds: ['d1'], note: '一起遛', maxDogs: 3, status: 'open',
      createdAt: new Date(NOW_MS - DAY), updatedAt: new Date(NOW_MS - DAY),
    },
    patch || {}
  );
}

function memberDoc(patch) {
  return Object.assign(
    {
      _id: 'm1', walkId: 'w1', openid: 'o2', dogIds: ['d3'], status: 'pending',
      createdAt: new Date(NOW_MS - HOUR), updatedAt: new Date(NOW_MS - HOUR),
    },
    patch || {}
  );
}

/** 同一个库换一个调用者(makeTestCtx 一次只给一个 openid) */
function as(ctx, openid) {
  return Object.assign({}, ctx, { openid });
}

/** 缺省以 o1 身份建一场今晚的约遛 */
async function createWalk(ctx, patch) {
  const r = await core(
    Object.assign({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1'] }, patch || {}),
    ctx
  );
  expect(r.ok).toBe(true);
  return r.data;
}

// ================================================================ 分发 / 鉴权

describe('walkOps 分发与鉴权', () => {
  test('未登录调任何 action 都返回 AUTH_REQUIRED', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: '' });
    for (const action of ['create', 'list', 'get', 'join', 'decide', 'leave', 'cancel', 'message']) {
      const r = await core({ action }, ctx);
      expect(r).toEqual({ ok: false, code: 'AUTH_REQUIRED', msg: 'AUTH_REQUIRED' });
    }
  });

  test('action 不在表里 / 没给 action 都返回 INVALID_PARAM action', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    expect(await core({ action: 'explode' }, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'action' });
    expect(await core({}, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'action' });
    expect(await core(undefined, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'action' });
  });

  test('core 永远不抛异常给调用方,DB 炸了兜底成 INTERNAL 并记 error 日志', async () => {
    const { ctx, calls } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    ctx.db.collection = () => {
      throw new Error('db down');
    };
    const r = await core({ action: 'list' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'INTERNAL', msg: 'db down' });
    expect(calls.errors).toHaveLength(1);
  });
});

// ================================================================ create

describe('walkOps create', () => {
  test('建成功:返回 WalkSummary,key 集合与 spec 3.2.3 逐字一致(⑩)', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    const r = await core(
      { action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1', 'd2'], note: '来玩球', maxDogs: 4 },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data).sort()).toEqual(WALK_SUMMARY_KEYS);
    expect(r.data).toMatchObject({
      parkId: 'p1', parkName: '城西公园', note: '来玩球', maxDogs: 4,
      dogCount: 2, status: 'open', isHost: true, myStatus: 'host',
    });
    expect(r.data.startAt).toBe(new Date(TONIGHT).toISOString());
    expect(Object.keys(r.data.hostDogs[0]).sort()).toEqual(DOG_CARD_KEYS);
    expect(r.data.hostDogs.map((d) => d.name)).toEqual(['旺财', '豆豆']);
  });

  test('落库文档按 spec 3.2.2:status open、hostOpenid 为调用者、startAt 是 Date、maxDogs 缺省 3、note 缺省 ""', async () => {
    const { ctx, dump } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    await createWalk(ctx);
    const rows = dump(COLL.WALKS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hostOpenid: 'o1', parkId: 'p1', dogIds: ['d1'], note: '', maxDogs: LIMITS.WALK_MAX_DOGS_DEFAULT, status: 'open',
    });
    expect(rows[0].startAt).toBeInstanceOf(Date);
    expect(rows[0].createdAt.getTime()).toBe(NOW_MS);
    expect(rows[0].updatedAt.getTime()).toBe(NOW_MS);
  });

  test('dogIds 重复的先去重再算 dogCount', async () => {
    const { ctx, dump } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    const walk = await createWalk(ctx, { dogIds: ['d1', 'd1', 'd2'] });
    expect(walk.dogCount).toBe(2);
    expect(dump(COLL.WALKS)[0].dogIds).toEqual(['d1', 'd2']);
  });

  test('公园不存在或已关停 → NOT_FOUND parks', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    expect(await core({ action: 'create', parkId: 'nope', startAt: TONIGHT, dogIds: ['d1'] }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.PARKS });
    expect(await core({ action: 'create', parkId: 'p0', startAt: TONIGHT, dogIds: ['d1'] }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.PARKS });
    expect(await core({ action: 'create', startAt: TONIGHT, dogIds: ['d1'] }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'parkId' });
  });

  test('startAt 不可解析或不在未来 → INVALID_PARAM startAt', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    for (const startAt of [undefined, '不是时间', YESTERDAY, '2026-09-16T10:00:00+08:00']) {
      const r = await core({ action: 'create', parkId: 'p1', startAt, dogIds: ['d1'] }, ctx);
      expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'startAt' });
    }
  });

  test('dogIds 为空 → INVALID_PARAM;狗不存在 → NOT_FOUND dogs;别人的狗 → FORBIDDEN', async () => {
    const { ctx, dump } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: [] }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dogIds' });
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: 'd1' }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dogIds' });
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1', 'ghost'] }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d3'] }, ctx))
      .toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.WALKS)).toHaveLength(0);
  });

  test('note 超长 / maxDogs 越界或小于 dogIds 个数 → INVALID_PARAM', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    const long = 'x'.repeat(LIMITS.WALK_NOTE_MAX + 1);
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1'], note: long }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'note' });
    for (const maxDogs of [0, 2.5, LIMITS.WALK_MAX_DOGS_CAP + 1, '3']) {
      expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1'], maxDogs }, ctx))
        .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'maxDogs' });
    }
    expect(await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1', 'd2'], maxDogs: 1 }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'maxDogs' });
    const okNote = await core(
      { action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1'], note: 'x'.repeat(LIMITS.WALK_NOTE_MAX) }, ctx);
    expect(okNote.ok).toBe(true);
  });

  test('note 过不了 checkText → CONTENT_RISKY note,且不写库', async () => {
    const { ctx, dump } = makeTestCtx({ seed: baseSeed(), openid: 'o1', risky: ['脏话'] });
    const r = await core({ action: 'create', parkId: 'p1', startAt: TONIGHT, dogIds: ['d1'], note: '带点脏话' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: 'note' });
    expect(dump(COLL.WALKS)).toHaveLength(0);
  });
});

// ================================================================ list

describe('walkOps list', () => {
  test('① create → list 能看到,且 list[0] 的 key 集合与 spec 3.2.3 逐字一致(⑩)', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    const created = await createWalk(ctx, { note: '来玩球' });
    const r = await core({ action: 'list' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data.map((w) => w.walkId)).toEqual([created.walkId]);
    expect(Object.keys(r.data[0]).sort()).toEqual(WALK_SUMMARY_KEYS);
    expect(Object.keys(r.data[0].hostDogs[0]).sort()).toEqual(DOG_CARD_KEYS);
    expect(r.data[0]).toMatchObject({ parkName: '城西公园', note: '来玩球', isHost: true, myStatus: 'host' });
  });

  test('⑦ list 不返回已过期的,也不返回 cancelled 的,按 startAt 升序', async () => {
    const seed = baseSeed({
      walks: [
        walkDoc({ _id: 'wLate', startAt: new Date(TOMORROW) }),
        walkDoc({ _id: 'wSoon', startAt: new Date(TONIGHT) }),
        walkDoc({ _id: 'wPast', startAt: new Date(YESTERDAY) }),
        walkDoc({ _id: 'wDead', startAt: new Date(TOMORROW), status: 'cancelled' }),
      ],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'list' }, ctx);
    expect(r.data.map((w) => w.walkId)).toEqual(['wSoon', 'wLate']);
  });

  test('带 parkId 只返回该公园的', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ _id: 'wA', parkId: 'p1' }), walkDoc({ _id: 'wB', parkId: 'p2' })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'list', parkId: 'p2' }, ctx);
    expect(r.data.map((w) => w.walkId)).toEqual(['wB']);
    expect(r.data[0].parkName).toBe('运河公园');
  });

  test('date 按东八区自然日切,跨 UTC 日界的那条不会算错', async () => {
    const seed = baseSeed({
      walks: [
        walkDoc({ _id: 'wTonight', startAt: new Date(TONIGHT) }),
        walkDoc({ _id: 'wLateTonight', startAt: new Date(LATE_TONIGHT) }),
        walkDoc({ _id: 'wAfterMidnight', startAt: new Date(AFTER_MIDNIGHT) }),
        walkDoc({ _id: 'wTomorrow', startAt: new Date(TOMORROW) }),
      ],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const d16 = await core({ action: 'list', date: '2026-09-16' }, ctx);
    expect(d16.data.map((w) => w.walkId)).toEqual(['wTonight', 'wLateTonight']);
    const d17 = await core({ action: 'list', date: '2026-09-17' }, ctx);
    expect(d17.data.map((w) => w.walkId)).toEqual(['wAfterMidnight', 'wTomorrow']);
  });

  test('date 格式不对 → INVALID_PARAM date', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    for (const date of ['2026/09/16', '20260916', '2026-9-16', '2026-13-01', 'today']) {
      expect(await core({ action: 'list', date }, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'date' });
    }
  });

  test('dogCount = host 的狗 + approved 成员的狗;pending 的不算', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ dogIds: ['d1', 'd2'], maxDogs: 6 })],
      walk_members: [
        memberDoc({ _id: 'mApproved', openid: 'o2', dogIds: ['d3', 'd4'], status: 'approved' }),
        memberDoc({ _id: 'mPending', openid: 'o3', dogIds: ['d5'], status: 'pending' }),
      ],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'list' }, ctx);
    expect(r.data[0].dogCount).toBe(4);
    expect(r.data[0].hostDogs.map((d) => d.dogId)).toEqual(['d1', 'd2']);
  });

  test('公园没了 parkName 给空串,狗被删了就不出现在 hostDogs 里', async () => {
    const seed = baseSeed({ walks: [walkDoc({ parkId: 'gone', dogIds: ['d1', 'ghost'] })] });
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'list' }, ctx);
    expect(r.data[0].parkName).toBe('');
    expect(r.data[0].hostDogs.map((d) => d.dogId)).toEqual(['d1']);
    expect(r.data[0].dogCount).toBe(2);
  });

  test('myStatus 按调用者算:host > members 里那条 > none', async () => {
    const seed = baseSeed({
      walks: [walkDoc()],
      walk_members: [memberDoc({ openid: 'o2', status: 'pending' })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    expect((await core({ action: 'list' }, ctx)).data[0]).toMatchObject({ isHost: true, myStatus: 'host' });
    expect((await core({ action: 'list' }, as(ctx, 'o2'))).data[0]).toMatchObject({ isHost: false, myStatus: 'pending' });
    expect((await core({ action: 'list' }, as(ctx, 'o3'))).data[0]).toMatchObject({ isHost: false, myStatus: 'none' });
  });

  test('⑦ mine:true 返回我 host 的(含 cancelled)与我 pending 的,按 startAt 降序', async () => {
    const seed = baseSeed({
      walks: [
        walkDoc({ _id: 'wHost', hostOpenid: 'o2', startAt: new Date(TONIGHT) }),
        walkDoc({ _id: 'wHostCancelled', hostOpenid: 'o2', startAt: new Date(TOMORROW), status: 'cancelled' }),
        walkDoc({ _id: 'wPending', hostOpenid: 'o1', startAt: new Date(YESTERDAY) }),
        walkDoc({ _id: 'wOther', hostOpenid: 'o1', startAt: new Date(TOMORROW) }),
      ],
      walk_members: [memberDoc({ _id: 'mP', walkId: 'wPending', openid: 'o2', status: 'pending' })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'list', mine: true }, ctx);
    expect(r.data.map((w) => w.walkId)).toEqual(['wHostCancelled', 'wHost', 'wPending']);
    expect(r.data.map((w) => w.myStatus)).toEqual(['host', 'host', 'pending']);
  });

  test('mine:true 不含 rejected / left 的,也不含 7 天窗口之外的', async () => {
    const seed = baseSeed({
      walks: [
        walkDoc({ _id: 'wRejected', hostOpenid: 'o1' }),
        walkDoc({ _id: 'wLeft', hostOpenid: 'o1' }),
        walkDoc({ _id: 'wOld', hostOpenid: 'o2', startAt: new Date(LONG_AGO) }),
        walkDoc({ _id: 'wApproved', hostOpenid: 'o1' }),
      ],
      walk_members: [
        memberDoc({ _id: 'mR', walkId: 'wRejected', openid: 'o2', status: 'rejected' }),
        memberDoc({ _id: 'mL', walkId: 'wLeft', openid: 'o2', status: 'left' }),
        memberDoc({ _id: 'mA', walkId: 'wApproved', openid: 'o2', status: 'approved' }),
      ],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'list', mine: true }, ctx);
    expect(r.data.map((w) => w.walkId)).toEqual(['wApproved']);
  });

  test('mine:true 我既是 host 又有成员记录时不重复出现', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ _id: 'w1', hostOpenid: 'o1' })],
      walk_members: [memberDoc({ _id: 'mSelf', walkId: 'w1', openid: 'o1', status: 'approved' })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'list', mine: true }, ctx);
    expect(r.data.map((w) => w.walkId)).toEqual(['w1']);
    expect(r.data[0].myStatus).toBe('host');
  });

  test('一条都没有时返回空数组,不报错', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    expect(await core({ action: 'list' }, ctx)).toEqual({ ok: true, data: [] });
    expect(await core({ action: 'list', mine: true }, ctx)).toEqual({ ok: true, data: [] });
  });
});

// ================================================================ get

describe('walkOps get', () => {
  /** w1:host o1 带 d1;o2 approved 带 d3;o3 pending 带 d5;o4 rejected */
  function detailSeed() {
    return baseSeed({
      walks: [walkDoc({ maxDogs: 5 })],
      walk_members: [
        memberDoc({ _id: 'mApproved', openid: 'o2', dogIds: ['d3'], status: 'approved',
          createdAt: new Date(NOW_MS - 3 * HOUR) }),
        memberDoc({ _id: 'mPending', openid: 'o3', dogIds: ['d5'], status: 'pending',
          createdAt: new Date(NOW_MS - 2 * HOUR) }),
        memberDoc({ _id: 'mRejected', openid: 'o4', dogIds: [], status: 'rejected',
          createdAt: new Date(NOW_MS - HOUR) }),
      ],
      messages: [
        { _id: 'msgLate', walkId: 'w1', openid: 'o2', dogId: 'd3', text: '晚一条', createdAt: new Date(NOW_MS - HOUR) },
        { _id: 'msgEarly', walkId: 'w1', openid: 'o1', dogId: 'd1', text: '早一条', createdAt: new Date(NOW_MS - 2 * HOUR) },
      ],
    });
  }

  test('② host 的 get 看到全部成员,含 pending 的;返回 key 集合与 spec 3.2.3 逐字一致(⑩)', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data).sort()).toEqual(WALK_DETAIL_KEYS);
    expect(Object.keys(r.data.walk).sort()).toEqual(WALK_SUMMARY_KEYS);
    expect(Object.keys(r.data.members[0]).sort()).toEqual(WALK_MEMBER_KEYS);
    expect(Object.keys(r.data.messages[0]).sort()).toEqual(WALK_MESSAGE_KEYS);
    expect(Object.keys(r.data.myDogs[0]).sort()).toEqual(DOG_CARD_KEYS);
    expect(r.data.members.map((m) => m.memberId)).toEqual(['mApproved', 'mPending', 'mRejected']);
    expect(r.data.members.map((m) => m.status)).toEqual(['approved', 'pending', 'rejected']);
    expect(r.data.walk.myStatus).toBe('host');
  });

  test('② 非成员的 get:messages 为 [],成员表只看得到 approved 的', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o9' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.messages).toEqual([]);
    expect(r.data.members.map((m) => m.memberId)).toEqual(['mApproved']);
    expect(r.data.walk.myStatus).toBe('none');
    expect(r.data.myDogs).toEqual([]);
  });

  test('pending 的人看得到自己那条和 approved 的,但 messages 还是 []', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o3' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.members.map((m) => m.memberId)).toEqual(['mApproved', 'mPending']);
    expect(r.data.members.map((m) => m.isMe)).toEqual([false, true]);
    expect(r.data.messages).toEqual([]);
    expect(r.data.walk.myStatus).toBe('pending');
  });

  test('approved 成员看得到 messages,按 createdAt 升序,dogName 是狗名、isMe 按 openid', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o2' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.messages.map((m) => m.text)).toEqual(['早一条', '晚一条']);
    expect(r.data.messages.map((m) => m.dogName)).toEqual(['旺财', '大黄']);
    expect(r.data.messages.map((m) => m.isMe)).toEqual([false, true]);
    expect(r.data.messages[0].createdAt).toBe(new Date(NOW_MS - 2 * HOUR).toISOString());
  });

  test('留言者的狗被删了,dogName 给「某只狗」', async () => {
    const seed = detailSeed();
    seed.messages = [{ _id: 'msgGhost', walkId: 'w1', openid: 'o1', dogId: 'ghost', text: '狗没了', createdAt: new Date(NOW_MS - HOUR) }];
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.messages[0].dogName).toBe('某只狗');
  });

  test('myDogs 是调用者自己的狗,按 createdAt 升序,且是 DogCard', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.myDogs.map((d) => d.dogId)).toEqual(['d1', 'd2']);
    expect(r.data.myDogs[0]).toEqual({
      dogId: 'd1', name: '旺财', avatarFileID: 'cloud://d1.png', sizeClass: 'medium', tags: ['ball'],
    });
  });

  test('成员的 dogs 是 DogCard,不是狗文档原样', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    const member = r.data.members.find((m) => m.memberId === 'mApproved');
    expect(Object.keys(member.dogs[0]).sort()).toEqual(DOG_CARD_KEYS);
    expect(member.dogs[0].name).toBe('大黄');
    expect(member.isMe).toBe(false);
  });

  test('⑪ 整个 get 返回值序列化后不含 openid / hostOpenid / nickname 等主人字段', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    const json = JSON.stringify(r.data);
    for (const leaked of ['openid', 'hostOpenid', 'nickname', 'ownerOpenid', 'breed', 'tagCode', 'licenseNo', 'lostNote']) {
      expect(json).not.toContain(leaked);
    }
    expect(json).not.toContain('o1');
    expect(json).not.toContain('o2');
  });

  test('walk 不存在 → NOT_FOUND walks;walkId 没给 → INVALID_PARAM walkId', async () => {
    const { ctx } = makeTestCtx({ seed: detailSeed(), openid: 'o1' });
    expect(await core({ action: 'get', walkId: 'ghost' }, ctx)).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALKS });
    expect(await core({ action: 'get' }, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'walkId' });
  });

  test('已 cancelled 的约遛仍然能 get 到,status 是 cancelled', async () => {
    const seed = detailSeed();
    seed.walks = [walkDoc({ status: 'cancelled' })];
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(r.data.walk.status).toBe('cancelled');
  });
});

// ================================================================ join

describe('walkOps join', () => {
  test('申请成功:落一条 pending,返回 {memberId,status}', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'join', walkId: 'w1', dogIds: ['d3'] }, ctx);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data).sort()).toEqual(['memberId', 'status']);
    expect(r.data.status).toBe('pending');
    const rows = dump(COLL.WALK_MEMBERS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ walkId: 'w1', openid: 'o2', dogIds: ['d3'], status: 'pending' });
    expect(rows[0].createdAt.getTime()).toBe(NOW_MS);
  });

  test('② join 之后 host 的 get 看得到这条 pending 成员', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const joined = await core({ action: 'join', walkId: 'w1', dogIds: ['d3'] }, ctx);
    const detail = await core({ action: 'get', walkId: 'w1' }, as(ctx, 'o1'));
    expect(detail.data.members).toHaveLength(1);
    expect(detail.data.members[0]).toMatchObject({ memberId: joined.data.memberId, status: 'pending', isMe: false });
    expect(detail.data.members[0].dogs[0].name).toBe('大黄');
  });

  test('重复申请 / 已批准 / 已拒绝都 → CONFLICT,msg 是当前状态', async () => {
    for (const status of ['pending', 'approved', 'rejected']) {
      const seed = baseSeed({ walks: [walkDoc()], walk_members: [memberDoc({ openid: 'o2', status })] });
      const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
      const r = await core({ action: 'join', walkId: 'w1', dogIds: ['d3'] }, ctx);
      expect(r).toMatchObject({ ok: false, code: 'CONFLICT', msg: status });
      expect(dump(COLL.WALK_MEMBERS)).toHaveLength(1);
    }
  });

  test('⑧ leave 之后再 join,复用原记录改回 pending', async () => {
    const seed = baseSeed({ walks: [walkDoc()], walk_members: [memberDoc({ openid: 'o2', status: 'approved' })] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
    expect(await core({ action: 'leave', walkId: 'w1' }, ctx)).toEqual({ ok: true, data: { left: true } });
    const again = await core({ action: 'join', walkId: 'w1', dogIds: ['d4'] }, ctx);
    expect(again.data).toEqual({ memberId: 'm1', status: 'pending' });
    const rows = dump(COLL.WALK_MEMBERS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: 'm1', status: 'pending', dogIds: ['d4'] });
    expect(rows[0].updatedAt.getTime()).toBe(NOW_MS);
  });

  test('host 自己 join → FORBIDDEN', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    expect(await core({ action: 'join', walkId: 'w1', dogIds: ['d1'] }, ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.WALK_MEMBERS)).toHaveLength(0);
  });

  test('已取消 / 已过期的约遛 → CONFLICT walk closed', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ _id: 'wDead', status: 'cancelled' }), walkDoc({ _id: 'wPast', startAt: new Date(YESTERDAY) })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    for (const walkId of ['wDead', 'wPast']) {
      expect(await core({ action: 'join', walkId, dogIds: ['d3'] }, ctx))
        .toMatchObject({ ok: false, code: 'CONFLICT', msg: 'walk closed' });
    }
  });

  test('walk 不存在 → NOT_FOUND;dogIds 非法 / 别人的狗 → INVALID_PARAM / FORBIDDEN', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    expect(await core({ action: 'join', walkId: 'ghost', dogIds: ['d3'] }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALKS });
    expect(await core({ action: 'join', walkId: 'w1', dogIds: [] }, ctx))
      .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dogIds' });
    expect(await core({ action: 'join', walkId: 'w1', dogIds: ['d1'] }, ctx))
      .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('申请时不查容量:已经满员也能排队(假设 6 由 host 决定)', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ dogIds: ['d1', 'd2'], maxDogs: 2 })],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    const r = await core({ action: 'join', walkId: 'w1', dogIds: ['d3'] }, ctx);
    expect(r).toMatchObject({ ok: true, data: { status: 'pending' } });
  });
});

// ================================================================ decide

describe('walkOps decide', () => {
  function decideSeed(patch) {
    return baseSeed({
      walks: [walkDoc(patch && patch.walk)],
      walk_members: [memberDoc(Object.assign({ openid: 'o2', dogIds: ['d3'], status: 'pending' }, patch && patch.member))],
    });
  }

  test('host approve → approved,dogCount 跟着涨', async () => {
    const { ctx, dump } = makeTestCtx({ seed: decideSeed(), openid: 'o1' });
    const r = await core({ action: 'decide', memberId: 'm1', approve: true }, ctx);
    expect(r).toEqual({ ok: true, data: { memberId: 'm1', status: 'approved' } });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('approved');
    expect(dump(COLL.WALK_MEMBERS)[0].updatedAt.getTime()).toBe(NOW_MS);
    const list = await core({ action: 'list' }, ctx);
    expect(list.data[0].dogCount).toBe(2);
  });

  test('host reject → rejected', async () => {
    const { ctx, dump } = makeTestCtx({ seed: decideSeed(), openid: 'o1' });
    const r = await core({ action: 'decide', memberId: 'm1', approve: false }, ctx);
    expect(r).toEqual({ ok: true, data: { memberId: 'm1', status: 'rejected' } });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('rejected');
  });

  test('③ approve 后狗数超 maxDogs → WALK_FULL,且不改状态', async () => {
    const seed = decideSeed({ walk: { dogIds: ['d1', 'd2'], maxDogs: 3 }, member: { dogIds: ['d3', 'd4'] } });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    const r = await core({ action: 'decide', memberId: 'm1', approve: true }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'WALK_FULL' });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('pending');
  });

  test('③ 容量把已 approved 的成员算进去', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ dogIds: ['d1'], maxDogs: 3 })],
      walk_members: [
        memberDoc({ _id: 'mOld', openid: 'o2', dogIds: ['d3'], status: 'approved' }),
        memberDoc({ _id: 'mNew', openid: 'o3', dogIds: ['d5'], status: 'pending' }),
      ],
    });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    expect(await core({ action: 'decide', memberId: 'mNew', approve: true }, ctx))
      .toMatchObject({ ok: true, data: { status: 'approved' } });
    expect(dump(COLL.WALK_MEMBERS).find((m) => m._id === 'mNew').status).toBe('approved');

    const seed2 = baseSeed({
      walks: [walkDoc({ dogIds: ['d1'], maxDogs: 2 })],
      walk_members: [
        memberDoc({ _id: 'mOld', openid: 'o2', dogIds: ['d3'], status: 'approved' }),
        memberDoc({ _id: 'mNew', openid: 'o3', dogIds: ['d5'], status: 'pending' }),
      ],
    });
    const two = makeTestCtx({ seed: seed2, openid: 'o1' });
    expect(await core({ action: 'decide', memberId: 'mNew', approve: true }, two.ctx))
      .toMatchObject({ ok: false, code: 'WALK_FULL' });
  });

  test('④ 非 host decide → FORBIDDEN(本人也不行)', async () => {
    const { ctx, dump } = makeTestCtx({ seed: decideSeed(), openid: 'o2' });
    expect(await core({ action: 'decide', memberId: 'm1', approve: true }, ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await core({ action: 'decide', memberId: 'm1', approve: true }, as(ctx, 'o9'))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('pending');
  });

  test('成员不存在 → NOT_FOUND walk_members;不是 pending → CONFLICT', async () => {
    const { ctx } = makeTestCtx({ seed: decideSeed({ member: { status: 'approved' } }), openid: 'o1' });
    expect(await core({ action: 'decide', memberId: 'ghost', approve: true }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALK_MEMBERS });
    expect(await core({ action: 'decide', memberId: 'm1', approve: true }, ctx))
      .toMatchObject({ ok: false, code: 'CONFLICT', msg: 'approved' });
  });

  test('walk 已 cancelled → CONFLICT;approve 不是布尔 → INVALID_PARAM', async () => {
    const { ctx } = makeTestCtx({ seed: decideSeed({ walk: { status: 'cancelled' } }), openid: 'o1' });
    expect(await core({ action: 'decide', memberId: 'm1', approve: true }, ctx)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await core({ action: 'decide', memberId: 'm1' }, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'approve' });
    expect(await core({ action: 'decide', approve: true }, ctx)).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'memberId' });
  });
});

// ================================================================ leave

describe('walkOps leave', () => {
  test('approved 成员退出 → left,dogCount 跟着减', async () => {
    const seed = baseSeed({
      walks: [walkDoc({ maxDogs: 5 })],
      walk_members: [memberDoc({ openid: 'o2', dogIds: ['d3'], status: 'approved' })],
    });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
    expect((await core({ action: 'list' }, as(ctx, 'o1'))).data[0].dogCount).toBe(2);
    expect(await core({ action: 'leave', walkId: 'w1' }, ctx)).toEqual({ ok: true, data: { left: true } });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('left');
    expect((await core({ action: 'list' }, as(ctx, 'o1'))).data[0].dogCount).toBe(1);
  });

  test('pending 的也能退出', async () => {
    const seed = baseSeed({ walks: [walkDoc()], walk_members: [memberDoc({ openid: 'o2', status: 'pending' })] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
    expect(await core({ action: 'leave', walkId: 'w1' }, ctx)).toEqual({ ok: true, data: { left: true } });
    expect(dump(COLL.WALK_MEMBERS)[0].status).toBe('left');
  });

  test('host 不能 leave,只能 cancel → FORBIDDEN', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx } = makeTestCtx({ seed, openid: 'o1' });
    expect(await core({ action: 'leave', walkId: 'w1' }, ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('没有我的记录 / 已 rejected / 已 left → CONFLICT', async () => {
    const seed = baseSeed({
      walks: [walkDoc()],
      walk_members: [
        memberDoc({ _id: 'mR', openid: 'o3', status: 'rejected' }),
        memberDoc({ _id: 'mL', openid: 'o4', status: 'left' }),
      ],
    });
    const { ctx } = makeTestCtx({ seed, openid: 'o2' });
    expect(await core({ action: 'leave', walkId: 'w1' }, ctx)).toMatchObject({ ok: false, code: 'CONFLICT', msg: 'none' });
    expect(await core({ action: 'leave', walkId: 'w1' }, as(ctx, 'o3'))).toMatchObject({ ok: false, code: 'CONFLICT', msg: 'rejected' });
    expect(await core({ action: 'leave', walkId: 'w1' }, as(ctx, 'o4'))).toMatchObject({ ok: false, code: 'CONFLICT', msg: 'left' });
  });

  test('walk 不存在 → NOT_FOUND walks', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o2' });
    expect(await core({ action: 'leave', walkId: 'ghost' }, ctx)).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALKS });
  });
});

// ================================================================ cancel

describe('walkOps cancel', () => {
  test('⑤ host cancel 之后 list 不再出现,但 mine:true 还看得到', async () => {
    const { ctx } = makeTestCtx({ seed: baseSeed(), openid: 'o1' });
    const walk = await createWalk(ctx);
    expect((await core({ action: 'list' }, ctx)).data).toHaveLength(1);

    expect(await core({ action: 'cancel', walkId: walk.walkId }, ctx)).toEqual({ ok: true, data: { cancelled: true } });
    expect((await core({ action: 'list' }, ctx)).data).toEqual([]);

    const mine = await core({ action: 'list', mine: true }, ctx);
    expect(mine.data.map((w) => w.status)).toEqual(['cancelled']);
  });

  test('cancel 幂等:再 cancel 一次照样 ok,updatedAt 不再动', async () => {
    const seed = baseSeed({ walks: [walkDoc({ status: 'cancelled' })] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    expect(await core({ action: 'cancel', walkId: 'w1' }, ctx)).toEqual({ ok: true, data: { cancelled: true } });
    expect(dump(COLL.WALKS)[0].updatedAt.getTime()).toBe(NOW_MS - DAY);
  });

  test('非 host cancel → FORBIDDEN;walk 不存在 → NOT_FOUND', async () => {
    const seed = baseSeed({ walks: [walkDoc()], walk_members: [memberDoc({ openid: 'o2', status: 'approved' })] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o2' });
    expect(await core({ action: 'cancel', walkId: 'w1' }, ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.WALKS)[0].status).toBe('open');
    expect(await core({ action: 'cancel', walkId: 'ghost' }, as(ctx, 'o1')))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALKS });
  });

  test('cancel 会写 status 与 updatedAt', async () => {
    const seed = baseSeed({ walks: [walkDoc()] });
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    await core({ action: 'cancel', walkId: 'w1' }, ctx);
    expect(dump(COLL.WALKS)[0].status).toBe('cancelled');
    expect(dump(COLL.WALKS)[0].updatedAt.getTime()).toBe(NOW_MS);
  });
});

// ================================================================ message

describe('walkOps message', () => {
  function msgSeed() {
    return baseSeed({
      walks: [walkDoc({ dogIds: ['d2', 'd1'], maxDogs: 5 })],
      walk_members: [
        memberDoc({ _id: 'mApproved', openid: 'o2', dogIds: ['d4', 'd3'], status: 'approved' }),
        memberDoc({ _id: 'mPending', openid: 'o3', dogIds: ['d5'], status: 'pending' }),
      ],
    });
  }

  test('host 留言成功:落库 dogId 取 walk.dogIds[0]', async () => {
    const { ctx, dump } = makeTestCtx({ seed: msgSeed(), openid: 'o1' });
    const r = await core({ action: 'message', walkId: 'w1', text: '七点见' }, ctx);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data)).toEqual(['messageId']);
    const rows = dump(COLL.MESSAGES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ walkId: 'w1', openid: 'o1', dogId: 'd2', text: '七点见' });
    expect(rows[0].createdAt.getTime()).toBe(NOW_MS);
  });

  test('approved 成员留言:dogId 取自己 member 记录的 dogIds[0],随后 get 能读到', async () => {
    const { ctx, dump } = makeTestCtx({ seed: msgSeed(), openid: 'o2' });
    const r = await core({ action: 'message', walkId: 'w1', text: '带球来' }, ctx);
    expect(r.ok).toBe(true);
    expect(dump(COLL.MESSAGES)[0]).toMatchObject({ openid: 'o2', dogId: 'd4' });
    const detail = await core({ action: 'get', walkId: 'w1' }, ctx);
    expect(detail.data.messages).toHaveLength(1);
    expect(detail.data.messages[0]).toMatchObject({ dogName: '小白', text: '带球来', isMe: true });
  });

  test('⑨ 非成员 / pending 成员留言 → FORBIDDEN,且不落库', async () => {
    const { ctx, dump } = makeTestCtx({ seed: msgSeed(), openid: 'o9' });
    expect(await core({ action: 'message', walkId: 'w1', text: '我能说话吗' }, ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await core({ action: 'message', walkId: 'w1', text: '我能说话吗' }, as(ctx, 'o3'))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.MESSAGES)).toHaveLength(0);
  });

  test('⑥ text 过不了 checkText → CONTENT_RISKY text,且不落库', async () => {
    const { ctx, dump } = makeTestCtx({ seed: msgSeed(), openid: 'o1', risky: ['脏话'] });
    const r = await core({ action: 'message', walkId: 'w1', text: '你这狗一堆脏话' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: 'text' });
    expect(dump(COLL.MESSAGES)).toHaveLength(0);
  });

  test('text 空 / 纯空白 / 超长 → INVALID_PARAM text;两端空白会被去掉再落库', async () => {
    const { ctx, dump } = makeTestCtx({ seed: msgSeed(), openid: 'o1' });
    for (const text of [undefined, '', '   ', 'x'.repeat(LIMITS.MESSAGE_MAX + 1), 123]) {
      expect(await core({ action: 'message', walkId: 'w1', text }, ctx))
        .toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'text' });
    }
    expect((await core({ action: 'message', walkId: 'w1', text: '  七点见  ' }, ctx)).ok).toBe(true);
    expect(dump(COLL.MESSAGES)[0].text).toBe('七点见');
  });

  test('已取消的约遛留言 → CONFLICT;walk 不存在 → NOT_FOUND', async () => {
    const seed = msgSeed();
    seed.walks = [walkDoc({ status: 'cancelled' })];
    const { ctx, dump } = makeTestCtx({ seed, openid: 'o1' });
    expect(await core({ action: 'message', walkId: 'w1', text: '还去吗' }, ctx)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await core({ action: 'message', walkId: 'ghost', text: '还去吗' }, ctx))
      .toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.WALKS });
    expect(dump(COLL.MESSAGES)).toHaveLength(0);
  });
});
