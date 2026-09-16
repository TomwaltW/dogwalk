/**
 * tests/cloud/checkinCancel.test.js —— owner: T7
 *
 * 验收 T7-a(spec 6「T7」那一行):
 *   重复取消幂等返回 {cancelled:true};他人的签到 FORBIDDEN;不存在 NOT_FOUND。
 */

const core = require('../../cloudfunctions/checkinCancel/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-16T10:00:00+08:00';
const NOW_MS = new Date(NOW_ISO).getTime();

function checkinDoc(id, patch) {
  return Object.assign(
    {
      _id: id,
      openid: 'o1',
      parkId: 'park_a',
      dogIds: ['dog1'],
      startAt: new Date(NOW_MS - 30 * 60 * 1000),
      expireAt: new Date(NOW_MS + 90 * 60 * 1000),
      status: 'active',
      createdAt: new Date(NOW_MS - 30 * 60 * 1000),
    },
    patch || {}
  );
}

function ctxWith(checkins, openid) {
  return makeTestCtx({
    openid: openid === undefined ? 'o1' : openid,
    seed: { [COLL.CHECKINS]: checkins || [] },
  });
}

describe('checkinCancel —— 签退,幂等', () => {
  test('未登录返回 AUTH_REQUIRED', async () => {
    const { ctx } = ctxWith([checkinDoc('ck1')], '');
    const r = await core({ checkinId: 'ck1' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
  });

  test('checkinId 缺失 / 空串 → INVALID_PARAM checkinId', async () => {
    for (const bad of [undefined, '', null, 7]) {
      const { ctx } = ctxWith([checkinDoc('ck1')]);
      const r = await core({ checkinId: bad }, ctx);
      expect(r).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'checkinId' });
    }
    const { ctx } = ctxWith([checkinDoc('ck1')]);
    expect((await core(undefined, ctx))).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'checkinId' });
  });

  test('签到不存在 → NOT_FOUND checkins', async () => {
    const { ctx } = ctxWith([checkinDoc('ck1')]);
    const r = await core({ checkinId: 'ck_none' }, ctx);
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.CHECKINS });
  });

  test('他人的签到 → FORBIDDEN,且不改状态', async () => {
    const { ctx, dump } = ctxWith([checkinDoc('ck1', { openid: 'o2' })]);
    const r = await core({ checkinId: 'ck1' }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.CHECKINS)[0].status).toBe('active');
  });

  test('取消自己的签到:status 置 cancelled,cancelledAt 取 ctx.now()', async () => {
    const { ctx, dump } = ctxWith([checkinDoc('ck1')]);
    const r = await core({ checkinId: 'ck1' }, ctx);
    expect(r).toEqual({ ok: true, data: { cancelled: true } });
    const doc = dump(COLL.CHECKINS)[0];
    expect(doc.status).toBe('cancelled');
    expect(doc.cancelledAt.getTime()).toBe(NOW_MS);
  });

  test('重复取消幂等:仍返回 {cancelled:true},cancelledAt 不被刷新', async () => {
    const cancelledAt = new Date(NOW_MS - 60 * 60 * 1000);
    const { ctx, dump } = ctxWith([checkinDoc('ck1', { status: 'cancelled', cancelledAt })]);
    const r = await core({ checkinId: 'ck1' }, ctx);
    expect(r).toEqual({ ok: true, data: { cancelled: true } });
    const doc = dump(COLL.CHECKINS)[0];
    expect(doc.status).toBe('cancelled');
    expect(doc.cancelledAt.getTime()).toBe(cancelledAt.getTime());
  });

  test('连着调两次也只是同一个结果', async () => {
    const { ctx, dump } = ctxWith([checkinDoc('ck1')]);
    const first = await core({ checkinId: 'ck1' }, ctx);
    const second = await core({ checkinId: 'ck1' }, ctx);
    expect(first).toEqual(second);
    expect(second).toEqual({ ok: true, data: { cancelled: true } });
    expect(dump(COLL.CHECKINS)).toHaveLength(1);
  });

  test('已过期但仍是 active 的签到也能签退', async () => {
    const expired = checkinDoc('ck1', {
      startAt: new Date(NOW_MS - 3 * 60 * 60 * 1000),
      expireAt: new Date(NOW_MS - 60 * 60 * 1000),
    });
    const { ctx, dump } = ctxWith([expired]);
    const r = await core({ checkinId: 'ck1' }, ctx);
    expect(r).toEqual({ ok: true, data: { cancelled: true } });
    expect(dump(COLL.CHECKINS)[0].status).toBe('cancelled');
  });
});
