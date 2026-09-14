/**
 * tests/cloud/spotBoard.test.js —— owner: T2
 *
 * 对应 spec 2.2 B4:
 *   ① 看板只返回 expireAt > now 且 status==='active' 的广播
 *   ② 过期的不出现
 *   ③ 无广播时返回空数组而非报错
 *
 * 一个云函数两种返回形状(spec 3.3.2):
 *   无 spotId → [{ spotId, name, peakHint, regularCount, activeDogCount, activePeopleCount }]
 *   有 spotId → { spot, sessions, wxGroupQrFileID }
 */

const core = require('../../cloudfunctions/spotBoard/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-14T19:30:00+08:00';
const NOW = new Date(NOW_ISO);
const at = (ms) => new Date(NOW.getTime() + ms);

/** 一条默认在场的广播 */
function checkin(patch) {
  return Object.assign(
    {
      _id: 'c1',
      openid: 'o1',
      spotId: 's1',
      dogIds: ['d1'],
      startAt: NOW,
      expireAt: at(CHECKIN_DURATION_MS),
      note: '',
      status: 'active',
      createdAt: NOW,
    },
    patch
  );
}

function seedData(checkins) {
  return {
    [COLL.SPOTS]: [
      {
        _id: 's1',
        name: '中心花园南侧草坪',
        communityId: 'c1',
        wxGroupQrFileID: 'f-qr-s1',
        peakHint: '工作日 19:30-20:30',
        regularCount: 12,
        active: true,
      },
      { _id: 's2', name: '河堤步道', communityId: 'c1', wxGroupQrFileID: '', peakHint: '周末上午', regularCount: 3, active: true },
      { _id: 's9', name: '已下架点位', communityId: 'c1', wxGroupQrFileID: '', peakHint: '', regularCount: 0, active: false },
    ],
    [COLL.DOGS]: [
      { _id: 'd1', ownerOpenid: 'o1', name: '旺财', avatarFileID: 'f-d1', sizeClass: 'small', socialOk: true },
      { _id: 'd2', ownerOpenid: 'o1', name: '来福', avatarFileID: 'f-d2', sizeClass: 'large', socialOk: true },
      { _id: 'd3', ownerOpenid: 'o2', name: '二黑', avatarFileID: 'f-d3', sizeClass: 'medium', socialOk: true },
      { _id: 'd9', ownerOpenid: 'o1', name: '社恐', avatarFileID: '', sizeClass: 'small', socialOk: false },
    ],
    [COLL.USERS]: [
      { _id: 'o1', _openid: 'o1', nickname: '阿甲', avatarFileID: 'f-o1', followSpotIds: [], subQuota: {}, status: 'normal' },
      { _id: 'o2', _openid: 'o2', nickname: '阿乙', avatarFileID: 'f-o2', followSpotIds: [], subQuota: {}, status: 'normal' },
    ],
    [COLL.CHECKINS]: checkins || [],
  };
}

function makeCtx(over) {
  const o = over || {};
  const { db, _, dump } = createFakeDb(o.seed || seedData(o.checkins));
  const logger = { info: jest.fn(), error: jest.fn() };
  return {
    ctx: {
      db,
      _,
      openid: o.openid === undefined ? 'o1' : o.openid,
      now: fixedClock(o.nowIso || NOW_ISO),
      openapi: {},
      logger,
    },
    dump,
    logger,
  };
}

describe('spotBoard —— 无 spotId:点位摘要列表', () => {
  test('返回数组,每项形状符合 spec 3.3.2', async () => {
    const { ctx } = makeCtx({ checkins: [checkin({ _id: 'c1', dogIds: ['d1', 'd2'] })] });
    const res = await core({}, ctx);

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    const s1 = res.data.find((s) => s.spotId === 's1');
    expect(Object.keys(s1).sort()).toEqual(
      ['activeDogCount', 'activePeopleCount', 'name', 'peakHint', 'regularCount', 'spotId'].sort()
    );
    expect(s1).toEqual({
      spotId: 's1',
      name: '中心花园南侧草坪',
      peakHint: '工作日 19:30-20:30',
      regularCount: 12,
      activeDogCount: 2,
      activePeopleCount: 1,
    });
  });

  test('event 省略(undefined)也走列表路径', async () => {
    const { ctx } = makeCtx();
    const res = await core(undefined, ctx);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
  });

  test('B4③: 一条广播都没有时返回空计数的数组,而不是报错', async () => {
    const { ctx } = makeCtx({ checkins: [] });
    const res = await core({}, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.map((s) => s.spotId)).toEqual(['s1', 's2']);
    expect(res.data.every((s) => s.activeDogCount === 0 && s.activePeopleCount === 0)).toBe(true);
  });

  test('B4①②: 计数只算 active 且未过期的广播', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'] }),
        checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'], status: 'cancelled' }),
        checkin({ _id: 'c3', openid: 'o2', dogIds: ['d3'], expireAt: at(-1) }),
      ],
    });
    const res = await core({}, ctx);
    const s1 = res.data.find((s) => s.spotId === 's1');
    expect(s1).toMatchObject({ activePeopleCount: 1, activeDogCount: 1 });
  });

  test('同一个人在同一点位的多条广播只算一个人,狗取并集', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'] }),
        checkin({ _id: 'c2', openid: 'o1', dogIds: ['d1', 'd2'] }),
      ],
    });
    const res = await core({}, ctx);
    expect(res.data.find((s) => s.spotId === 's1')).toMatchObject({ activePeopleCount: 1, activeDogCount: 2 });
  });

  test('各点位的计数互不串台;active:false 的点位不出现在列表里', async () => {
    const { ctx } = makeCtx({
      checkins: [checkin({ _id: 'c1', spotId: 's1' }), checkin({ _id: 'c2', spotId: 's2', openid: 'o2', dogIds: ['d3'] })],
    });
    const res = await core({}, ctx);
    expect(res.data.map((s) => s.spotId)).toEqual(['s1', 's2']);
    expect(res.data.find((s) => s.spotId === 's2')).toMatchObject({ activePeopleCount: 1, activeDogCount: 1 });
  });
});

describe('spotBoard —— 有 spotId:点位详情', () => {
  test('返回对象 { spot, sessions, wxGroupQrFileID },不是数组', async () => {
    const { ctx } = makeCtx({ checkins: [checkin({ note: '在南门' })] });
    const res = await core({ spotId: 's1' }, ctx);

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(false);
    expect(Object.keys(res.data).sort()).toEqual(['sessions', 'spot', 'wxGroupQrFileID']);
    expect(res.data.spot._id).toBe('s1');
    expect(res.data.wxGroupQrFileID).toBe('f-qr-s1');
  });

  test('BoardSession 形状符合 spec 3.3.2', async () => {
    const { ctx } = makeCtx({ checkins: [checkin({ dogIds: ['d1'], note: '在南门' })] });
    const res = await core({ spotId: 's1' }, ctx);

    expect(res.data.sessions).toHaveLength(1);
    const s = res.data.sessions[0];
    expect(Object.keys(s).sort()).toEqual(
      ['avatarFileID', 'dogs', 'expireAt', 'nickname', 'note', 'openid', 'startAt'].sort()
    );
    expect(s).toMatchObject({
      openid: 'o1',
      nickname: '阿甲',
      avatarFileID: 'f-o1',
      note: '在南门',
      startAt: NOW.toISOString(),
      expireAt: at(CHECKIN_DURATION_MS).toISOString(),
    });
    expect(s.dogs).toEqual([{ name: '旺财', avatarFileID: 'f-d1', sizeClass: 'small' }]);
  });

  test('B4①: 只返回 expireAt > now 且 status==="active" 的广播', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'] }),
        checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'], status: 'cancelled' }),
      ],
    });
    const res = await core({ spotId: 's1' }, ctx);
    expect(res.data.sessions.map((s) => s.openid)).toEqual(['o1']);
  });

  test('B4②: 过期的不出现;边界上 expireAt === now 也算过期', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'], expireAt: at(-1) }),
        checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'], expireAt: NOW }),
      ],
    });
    const res = await core({ spotId: 's1' }, ctx);
    expect(res.data.sessions).toEqual([]);
  });

  test('B4③: 该点位无广播时 sessions 是空数组而非报错', async () => {
    const { ctx } = makeCtx({ checkins: [checkin({ spotId: 's2' })] });
    const res = await core({ spotId: 's1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.sessions).toEqual([]);
    expect(res.data.spot._id).toBe('s1');
  });

  test('同一用户多只狗合并为一条 session', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'], startAt: at(0), expireAt: at(CHECKIN_DURATION_MS) }),
        checkin({ _id: 'c2', openid: 'o1', dogIds: ['d2'], startAt: at(60000), expireAt: at(60000 + CHECKIN_DURATION_MS) }),
      ],
    });
    const res = await core({ spotId: 's1' }, ctx);

    expect(res.data.sessions).toHaveLength(1);
    expect(res.data.sessions[0].dogs.map((d) => d.name)).toEqual(['旺财', '来福']);
    expect(res.data.sessions[0].startAt).toBe(at(0).toISOString());
    expect(res.data.sessions[0].expireAt).toBe(at(60000 + CHECKIN_DURATION_MS).toISOString());
  });

  test('socialOk:false 的狗不在看板露出', async () => {
    const { ctx } = makeCtx({ checkins: [checkin({ dogIds: ['d1', 'd9'] })] });
    const res = await core({ spotId: 's1' }, ctx);
    expect(res.data.sessions[0].dogs.map((d) => d.name)).toEqual(['旺财']);
  });

  test('sessions 按 startAt 升序', async () => {
    const { ctx } = makeCtx({
      checkins: [
        checkin({ _id: 'c1', openid: 'o2', dogIds: ['d3'], startAt: at(60000) }),
        checkin({ _id: 'c2', openid: 'o1', dogIds: ['d1'], startAt: at(0) }),
      ],
    });
    const res = await core({ spotId: 's1' }, ctx);
    expect(res.data.sessions.map((s) => s.openid)).toEqual(['o1', 'o2']);
  });

  test('别的点位的广播不串进来', async () => {
    const { ctx } = makeCtx({
      checkins: [checkin({ _id: 'c1', spotId: 's1' }), checkin({ _id: 'c2', spotId: 's2', openid: 'o2', dogIds: ['d3'] })],
    });
    const res = await core({ spotId: 's1' }, ctx);
    expect(res.data.sessions.map((s) => s.openid)).toEqual(['o1']);
  });
});

describe('spotBoard —— 失败面(spec 3.4)', () => {
  test('未登录返回 AUTH_REQUIRED', async () => {
    const { ctx } = makeCtx({ openid: '' });
    expect(await core({}, ctx)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(await core({ spotId: 's1' }, ctx)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
  });

  test('点位不存在返回 NOT_FOUND spots', async () => {
    const { ctx } = makeCtx();
    expect(await core({ spotId: 'nope' }, ctx)).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.SPOTS });
  });

  test('spotId 类型不对返回 INVALID_PARAM spotId', async () => {
    const { ctx } = makeCtx();
    expect(await core({ spotId: 123 }, ctx)).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'spotId' });
  });

  test('spotId 为空串按「无 spotId」处理,走列表路径', async () => {
    const { ctx } = makeCtx();
    const res = await core({ spotId: '' }, ctx);
    expect(Array.isArray(res.data)).toBe(true);
  });
});
