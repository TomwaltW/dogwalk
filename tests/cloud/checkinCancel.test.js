/**
 * tests/cloud/checkinCancel.test.js —— owner: T2
 *
 * spec 3.3.2:event { checkinId },data { cancelled: true }
 * spec 3.4 :取消他人的广播 → FORBIDDEN;查不到 → NOT_FOUND '<集合名>'
 */

const core = require('../../cloudfunctions/checkinCancel/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-14T19:30:00+08:00';
const NOW = new Date(NOW_ISO);
const at = (ms) => new Date(NOW.getTime() + ms);

function seedData() {
  return {
    [COLL.CHECKINS]: [
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
      {
        _id: 'c2',
        openid: 'o2',
        spotId: 's1',
        dogIds: ['d3'],
        startAt: NOW,
        expireAt: at(CHECKIN_DURATION_MS),
        note: '',
        status: 'active',
        createdAt: NOW,
      },
    ],
  };
}

function makeCtx(over) {
  const o = over || {};
  const { db, _, dump } = createFakeDb(o.seed || seedData());
  const logger = { info: jest.fn(), error: jest.fn() };
  return {
    ctx: {
      db,
      _,
      openid: o.openid === undefined ? 'o1' : o.openid,
      now: fixedClock(NOW_ISO),
      openapi: {},
      logger,
    },
    dump,
    logger,
  };
}

const rowOf = (dump, id) => dump(COLL.CHECKINS).find((c) => c._id === id);

describe('checkinCancel —— 正常路径', () => {
  test('取消自己的广播返回 { cancelled: true },库里 status 变成 cancelled', async () => {
    const { ctx, dump } = makeCtx();
    const res = await core({ checkinId: 'c1' }, ctx);

    expect(res).toEqual({ ok: true, data: { cancelled: true } });
    expect(rowOf(dump, 'c1').status).toBe('cancelled');
    // 别人的那条一行没动
    expect(rowOf(dump, 'c2').status).toBe('active');
  });

  test('重复取消是幂等的,仍返回 { cancelled: true }', async () => {
    const { ctx, dump } = makeCtx();
    expect((await core({ checkinId: 'c1' }, ctx)).ok).toBe(true);
    const second = await core({ checkinId: 'c1' }, ctx);
    expect(second).toEqual({ ok: true, data: { cancelled: true } });
    expect(rowOf(dump, 'c1').status).toBe('cancelled');
  });

  test('已过期的广播也允许取消', async () => {
    const seed = seedData();
    seed[COLL.CHECKINS][0].expireAt = at(-1);
    const { ctx, dump } = makeCtx({ seed });
    expect((await core({ checkinId: 'c1' }, ctx)).ok).toBe(true);
    expect(rowOf(dump, 'c1').status).toBe('cancelled');
  });
});

describe('checkinCancel —— 失败面(spec 3.4)', () => {
  test('取消他人的广播返回 FORBIDDEN,且不改动数据', async () => {
    const { ctx, dump } = makeCtx();
    const res = await core({ checkinId: 'c2' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(rowOf(dump, 'c2').status).toBe('active');
  });

  test('未登录返回 AUTH_REQUIRED', async () => {
    const { ctx, dump } = makeCtx({ openid: '' });
    expect(await core({ checkinId: 'c1' }, ctx)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(rowOf(dump, 'c1').status).toBe('active');
  });

  test.each([[{}], [{ checkinId: '' }], [{ checkinId: 123 }]])(
    '缺失 / 非法 checkinId 返回 INVALID_PARAM checkinId(%p)',
    async (event) => {
      const { ctx } = makeCtx();
      expect(await core(event, ctx)).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'checkinId' });
    }
  );

  test('广播不存在返回 NOT_FOUND checkins', async () => {
    const { ctx } = makeCtx();
    expect(await core({ checkinId: 'nope' }, ctx)).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.CHECKINS });
  });

  test('取消后该点位看板上就不该再有这条 —— status 过滤条件成立', async () => {
    const { ctx, dump } = makeCtx();
    await core({ checkinId: 'c1' }, ctx);
    const stillActive = dump(COLL.CHECKINS).filter((c) => c.status === 'active');
    expect(stillActive.map((c) => c._id)).toEqual(['c2']);
  });
});
