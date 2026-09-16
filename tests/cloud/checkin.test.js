/**
 * tests/cloud/checkin.test.js —— owner: T7
 *
 * 验收 B5(spec 2.2):
 *   ① 半径内成功,expireAt - startAt === 2*60*60*1000,落库文档不含 latitude / longitude
 *   ② 半径外返回 OUT_OF_RANGE,msg === String(Math.round(距离))
 *   ③ 同公园已有未过期 active → CONFLICT
 *   ④ 换公园签到,上一条被置为 cancelled
 *   ⑤ 别人的狗 → FORBIDDEN
 *   ⑥ 坐标非法 → INVALID_PARAM
 *
 * 另覆盖 spec 3.3.2 规定的校验顺序:AUTH → 参数 → 公园 → 狗归属 → 围栏 → CONFLICT。
 */

const core = require('../../cloudfunctions/checkin/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { COLL, CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');
const geo = require('../../cloudfunctions/_shared/geo');

const NOW_ISO = '2026-09-16T10:00:00+08:00';
const NOW_MS = new Date(NOW_ISO).getTime();

const PARK_A = { _id: 'park_a', name: 'A 公园', latitude: 30.2415, longitude: 120.156, radiusM: 300, active: true };
const PARK_B = { _id: 'park_b', name: 'B 公园', latitude: 30.244, longitude: 120.214, radiusM: 250, active: true };
const PARK_OFF = { _id: 'park_off', name: '停用公园', latitude: 30.268, longitude: 120.065, radiusM: 400, active: false };

/** 公园中心 +0.001° 纬度 ≈ 111 米,在 300 米半径内 */
const INSIDE_A = { latitude: PARK_A.latitude + 0.001, longitude: PARK_A.longitude };
/** +0.01° ≈ 1112 米,在半径外 */
const OUTSIDE_A = { latitude: PARK_A.latitude + 0.01, longitude: PARK_A.longitude };

function makeDog(id, owner, patch) {
  return Object.assign(
    {
      _id: id,
      ownerOpenid: owner,
      name: id,
      avatarFileID: '',
      sizeClass: 'medium',
      tags: [],
    },
    patch || {}
  );
}

const DOGS = [
  makeDog('dog1', 'o1'),
  makeDog('dog2', 'o1'),
  makeDog('dog9', 'o2'), // 别人的狗
];

/** startAt / expireAt 用相对 now 的小时偏移写,省得数时间戳 */
function checkinDoc(id, patch) {
  return Object.assign(
    {
      _id: id,
      openid: 'o1',
      parkId: PARK_A._id,
      dogIds: ['dog1'],
      startAt: new Date(NOW_MS - 30 * 60 * 1000),
      expireAt: new Date(NOW_MS + 90 * 60 * 1000),
      status: 'active',
      createdAt: new Date(NOW_MS - 30 * 60 * 1000),
    },
    patch || {}
  );
}

function ctxWith(opts) {
  const o = opts || {};
  return makeTestCtx({
    openid: o.openid === undefined ? 'o1' : o.openid,
    seed: {
      [COLL.PARKS]: o.parks || [PARK_A, PARK_B, PARK_OFF],
      [COLL.DOGS]: o.dogs || DOGS,
      [COLL.CHECKINS]: o.checkins || [],
    },
  });
}

/** 一个合法的签到 event */
function evt(patch) {
  return Object.assign({ parkId: PARK_A._id, dogIds: ['dog1'] }, INSIDE_A, patch || {});
}

describe('checkin —— 公园签到', () => {
  describe('AUTH 与参数校验', () => {
    test('未登录返回 AUTH_REQUIRED', async () => {
      const { ctx, dump } = ctxWith({ openid: '' });
      const r = await core(evt(), ctx);
      expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
      expect(dump(COLL.CHECKINS)).toHaveLength(0);
    });

    test('parkId 缺失 / 空串 → INVALID_PARAM parkId', async () => {
      for (const bad of [undefined, '', null, 123]) {
        const { ctx } = ctxWith({});
        const r = await core(evt({ parkId: bad }), ctx);
        expect(r).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'parkId' });
      }
    });

    test('dogIds 不是非空字符串数组 → INVALID_PARAM dogIds', async () => {
      for (const bad of [undefined, [], 'dog1', ['dog1', ''], ['dog1', 7]]) {
        const { ctx } = ctxWith({});
        const r = await core(evt({ dogIds: bad }), ctx);
        expect(r).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'dogIds' });
      }
    });

    test('坐标非法 → INVALID_PARAM latitude / longitude', async () => {
      const badLat = [undefined, null, '30.24', NaN, Infinity, 91, -91];
      for (const bad of badLat) {
        const { ctx } = ctxWith({});
        const r = await core(evt({ latitude: bad }), ctx);
        expect(r).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'latitude' });
      }
      const badLng = [undefined, null, '120.15', NaN, Infinity, 181, -181];
      for (const bad of badLng) {
        const { ctx } = ctxWith({});
        const r = await core(evt({ longitude: bad }), ctx);
        expect(r).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'longitude' });
      }
    });

    test('event 为 undefined 也不炸,走 INVALID_PARAM', async () => {
      const { ctx } = ctxWith({});
      const r = await core(undefined, ctx);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_PARAM');
    });
  });

  describe('公园与狗的存在性 / 归属', () => {
    test('公园不存在 → NOT_FOUND parks', async () => {
      const { ctx } = ctxWith({});
      const r = await core(evt({ parkId: 'park_none' }), ctx);
      expect(r).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.PARKS });
    });

    test('公园 active:false → NOT_FOUND parks', async () => {
      const { ctx } = ctxWith({});
      const r = await core(
        evt({ parkId: PARK_OFF._id, latitude: PARK_OFF.latitude, longitude: PARK_OFF.longitude }),
        ctx
      );
      expect(r).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.PARKS });
    });

    test('狗不存在 → NOT_FOUND dogs', async () => {
      const { ctx } = ctxWith({});
      const r = await core(evt({ dogIds: ['dog1', 'dog_none'] }), ctx);
      expect(r).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
    });

    test('带了别人的狗 → FORBIDDEN', async () => {
      const { ctx, dump } = ctxWith({});
      const r = await core(evt({ dogIds: ['dog1', 'dog9'] }), ctx);
      expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(dump(COLL.CHECKINS)).toHaveLength(0);
    });

    test('归属先于围栏:别人的狗 + 超距离 → FORBIDDEN 而不是 OUT_OF_RANGE', async () => {
      const { ctx } = ctxWith({});
      const r = await core(evt(Object.assign({ dogIds: ['dog9'] }, OUTSIDE_A)), ctx);
      expect(r.code).toBe('FORBIDDEN');
    });
  });

  describe('围栏', () => {
    test('半径外返回 OUT_OF_RANGE,msg 是四舍五入到整数的米数', async () => {
      const { ctx, dump } = ctxWith({});
      const r = await core(evt(OUTSIDE_A), ctx);
      const d = geo.distanceM(OUTSIDE_A.latitude, OUTSIDE_A.longitude, PARK_A.latitude, PARK_A.longitude);
      expect(d).toBeGreaterThan(PARK_A.radiusM);
      expect(r).toEqual({ ok: false, code: 'OUT_OF_RANGE', msg: String(Math.round(d)) });
      expect(dump(COLL.CHECKINS)).toHaveLength(0);
    });

    test('恰好在圆心上也算在内', async () => {
      const { ctx } = ctxWith({});
      const r = await core(evt({ latitude: PARK_A.latitude, longitude: PARK_A.longitude }), ctx);
      expect(r.ok).toBe(true);
    });

    test('围栏先于 CONFLICT:同公园已有在场签到 + 超距离 → OUT_OF_RANGE', async () => {
      const { ctx } = ctxWith({ checkins: [checkinDoc('ck_old')] });
      const r = await core(evt(OUTSIDE_A), ctx);
      expect(r.code).toBe('OUT_OF_RANGE');
    });
  });

  describe('成功写库', () => {
    test('半径内成功,expireAt - startAt === 2 小时,返回 checkinId 与 ISO expireAt', async () => {
      const { ctx, dump } = ctxWith({});
      const r = await core(evt({ dogIds: ['dog1', 'dog2'] }), ctx);
      expect(r.ok).toBe(true);
      expect(Object.keys(r.data).sort()).toEqual(['checkinId', 'expireAt']);
      expect(typeof r.data.checkinId).toBe('string');
      expect(r.data.checkinId.length).toBeGreaterThan(0);

      const rows = dump(COLL.CHECKINS);
      expect(rows).toHaveLength(1);
      const doc = rows[0];
      expect(doc.startAt.getTime()).toBe(NOW_MS);
      expect(doc.expireAt.getTime() - doc.startAt.getTime()).toBe(CHECKIN_DURATION_MS);
      expect(CHECKIN_DURATION_MS).toBe(2 * 60 * 60 * 1000);
      expect(r.data.expireAt).toBe(doc.expireAt.toISOString());
      expect(doc.openid).toBe('o1');
      expect(doc.parkId).toBe(PARK_A._id);
      expect(doc.dogIds).toEqual(['dog1', 'dog2']);
      expect(doc.status).toBe('active');
    });

    test('落库文档不含 latitude / longitude —— 坐标用完即弃', async () => {
      const { ctx, dump } = ctxWith({});
      await core(evt(), ctx);
      const doc = dump(COLL.CHECKINS)[0];
      expect(doc).not.toHaveProperty('latitude');
      expect(doc).not.toHaveProperty('longitude');
      expect(JSON.stringify(doc).indexOf('latitude')).toBe(-1);
      expect(JSON.stringify(doc).indexOf('longitude')).toBe(-1);
    });

    test('dogIds 去重后落库', async () => {
      const { ctx, dump } = ctxWith({});
      const r = await core(evt({ dogIds: ['dog1', 'dog2', 'dog1'] }), ctx);
      expect(r.ok).toBe(true);
      expect(dump(COLL.CHECKINS)[0].dogIds).toEqual(['dog1', 'dog2']);
    });

    test('startAt 取 ctx.now(),不信客户端传来的时间', async () => {
      const { ctx, dump } = ctxWith({});
      await core(evt({ startAt: '1999-01-01T00:00:00Z' }), ctx);
      expect(dump(COLL.CHECKINS)[0].startAt.getTime()).toBe(NOW_MS);
    });
  });

  describe('CONFLICT 与换公园', () => {
    test('同公园已有未过期 active → CONFLICT,不写新文档', async () => {
      const { ctx, dump } = ctxWith({ checkins: [checkinDoc('ck_old')] });
      const r = await core(evt(), ctx);
      expect(r).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(dump(COLL.CHECKINS)).toHaveLength(1);
      expect(dump(COLL.CHECKINS)[0].status).toBe('active');
    });

    test('同公园的旧签到已过期 → 不算冲突,可以再签', async () => {
      const expired = checkinDoc('ck_expired', {
        startAt: new Date(NOW_MS - 3 * 60 * 60 * 1000),
        expireAt: new Date(NOW_MS - 60 * 60 * 1000),
      });
      const { ctx, dump } = ctxWith({ checkins: [expired] });
      const r = await core(evt(), ctx);
      expect(r.ok).toBe(true);
      expect(dump(COLL.CHECKINS)).toHaveLength(2);
    });

    test('expireAt === now 算过期(_.gt 而不是 _.gte)', async () => {
      const boundary = checkinDoc('ck_boundary', {
        startAt: new Date(NOW_MS - CHECKIN_DURATION_MS),
        expireAt: new Date(NOW_MS),
      });
      const { ctx } = ctxWith({ checkins: [boundary] });
      const r = await core(evt(), ctx);
      expect(r.ok).toBe(true);
    });

    test('同公园的旧签到已 cancelled → 不算冲突', async () => {
      const cancelled = checkinDoc('ck_cancelled', { status: 'cancelled', cancelledAt: new Date(NOW_MS - 60000) });
      const { ctx } = ctxWith({ checkins: [cancelled] });
      const r = await core(evt(), ctx);
      expect(r.ok).toBe(true);
    });

    test('别人在同公园的在场签到不影响我', async () => {
      const others = checkinDoc('ck_other', { openid: 'o2', dogIds: ['dog9'] });
      const { ctx } = ctxWith({ checkins: [others] });
      const r = await core(evt(), ctx);
      expect(r.ok).toBe(true);
    });

    test('换公园签到:上一条 active 被置为 cancelled 并带 cancelledAt', async () => {
      const { ctx, dump } = ctxWith({ checkins: [checkinDoc('ck_at_a')] });
      const r = await core(
        evt({ parkId: PARK_B._id, latitude: PARK_B.latitude + 0.001, longitude: PARK_B.longitude }),
        ctx
      );
      expect(r.ok).toBe(true);

      const rows = dump(COLL.CHECKINS);
      expect(rows).toHaveLength(2);
      const old = rows.find((c) => c._id === 'ck_at_a');
      expect(old.status).toBe('cancelled');
      expect(old.cancelledAt.getTime()).toBe(NOW_MS);
      const fresh = rows.find((c) => c._id !== 'ck_at_a');
      expect(fresh.parkId).toBe(PARK_B._id);
      expect(fresh.status).toBe('active');
    });

    test('换公园时不动别人的、也不动已过期的签到', async () => {
      const mineExpired = checkinDoc('ck_mine_expired', {
        startAt: new Date(NOW_MS - 3 * 60 * 60 * 1000),
        expireAt: new Date(NOW_MS - 60 * 60 * 1000),
      });
      const othersActive = checkinDoc('ck_other_active', { openid: 'o2', dogIds: ['dog9'] });
      const { ctx, dump } = ctxWith({ checkins: [mineExpired, othersActive] });
      const r = await core(
        evt({ parkId: PARK_B._id, latitude: PARK_B.latitude + 0.001, longitude: PARK_B.longitude }),
        ctx
      );
      expect(r.ok).toBe(true);

      const rows = dump(COLL.CHECKINS);
      expect(rows.find((c) => c._id === 'ck_mine_expired').status).toBe('active');
      expect(rows.find((c) => c._id === 'ck_mine_expired')).not.toHaveProperty('cancelledAt');
      expect(rows.find((c) => c._id === 'ck_other_active').status).toBe('active');
    });
  });
});
