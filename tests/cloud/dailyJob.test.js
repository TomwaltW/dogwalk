/**
 * dailyJob —— owner: T3。对应 spec 3.3.2(定时触发,无 event,
 * data: { archived, encounters, spotsUpdated })、3.2 encounters / spots。
 *
 * fake-db 不支持聚合与事务(spec 3.3.5),所以碰面统计一律 where() + get() 自己算。
 */

const core = require('../../cloudfunctions/dailyJob/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');

const NOW = '2026-09-14T22:00:00+08:00';

/** startAt 给北京时间,expireAt 一律 = startAt + 90 分钟(spec 3.2) */
function checkin(id, openid, spotId, startAtCn, status) {
  const startAt = new Date(startAtCn);
  return {
    _id: id,
    openid,
    dogIds: ['dog-' + openid],
    spotId,
    startAt,
    expireAt: new Date(startAt.getTime() + CHECKIN_DURATION_MS),
    note: '',
    status: status || 'active',
    createdAt: startAt,
  };
}

function makeCtx(fake) {
  return {
    db: fake.db,
    _: fake._,
    openid: '', // 定时触发没有调用者
    now: fixedClock(NOW),
    openapi: {},
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

/** 昨天同一时刻的北京时间串 */
function yesterday(cn) {
  const d = new Date(cn);
  return new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

function baseSeed() {
  return {
    checkins: [
      checkin('c1', 'o1', 's1', '2026-09-14T19:30:00+08:00'), // 已过期
      checkin('c2', 'o2', 's1', '2026-09-14T20:00:00+08:00'), // 已过期,与 c1 重叠
      checkin('c3', 'o3', 's1', '2026-09-14T06:00:00+08:00'), // 已过期,与谁都不重叠
      checkin('c4', 'o4', 's1', '2026-09-14T19:30:00+08:00', 'cancelled'), // 取消的
      checkin('c5', 'o5', 's2', '2026-09-14T21:30:00+08:00'), // 还没过期
    ],
    spots: [
      { _id: 's1', name: '中心花园南侧草坪', communityId: 'cm1', wxGroupQrFileID: '', peakHint: '', regularCount: 0, active: true },
      { _id: 's2', name: '北门小广场', communityId: 'cm1', wxGroupQrFileID: '', peakHint: '', regularCount: 1, active: true },
    ],
    encounters: [],
  };
}

describe('dailyJob: 返回形状与计数', () => {
  test('返回 { archived, encounters, spotsUpdated } 三个计数', async () => {
    const fake = createFakeDb(baseSeed());
    const res = await core({}, makeCtx(fake));

    expect(res.ok).toBe(true);
    expect(Object.keys(res.data).sort()).toEqual(['archived', 'encounters', 'spotsUpdated']);
    Object.values(res.data).forEach((n) => expect(typeof n).toBe('number'));
  });

  test('archived 只数已过期的 active 广播:取消的和未过期的都不算', async () => {
    const fake = createFakeDb(baseSeed());
    const res = await core({}, makeCtx(fake));
    expect(res.data.archived).toBe(3); // c1 c2 c3;c4 取消、c5 未过期
  });

  test('空库照常返回三个 0,不报错', async () => {
    const fake = createFakeDb({});
    const res = await core({}, makeCtx(fake));
    expect(res).toEqual({ ok: true, data: { archived: 0, encounters: 0, spotsUpdated: 0 } });
  });
});

describe('dailyJob: 碰面统计(encounters)', () => {
  test('同点位同日时间窗重叠 → 写一条 encounters,pairKey 两个 openid 字典序升序用下划线连接', async () => {
    const fake = createFakeDb(baseSeed());
    const res = await core({}, makeCtx(fake));

    expect(res.data.encounters).toBe(1);
    const rows = fake.dump(COLL.ENCOUNTERS);
    expect(rows).toHaveLength(1);
    expect(rows[0].spotId).toBe('s1');
    expect(rows[0].date).toBe('2026-09-14');
    expect(rows[0].pairKey).toBe('o1_o2');
    expect(rows[0].times).toBe(1);
    expect(rows[0].lastAt).toEqual(new Date('2026-09-14T20:00:00+08:00')); // 重叠开始的时刻
  });

  test('pairKey 按字典序升序,不按出场先后', async () => {
    const fake = createFakeDb({
      checkins: [
        checkin('c1', 'o-zeta', 's1', '2026-09-14T19:30:00+08:00'),
        checkin('c2', 'o-alpha', 's1', '2026-09-14T19:45:00+08:00'),
      ],
      spots: [],
    });
    await core({}, makeCtx(fake));
    expect(fake.dump(COLL.ENCOUNTERS)[0].pairKey).toBe('o-alpha_o-zeta');
  });

  test('时间窗不重叠不算碰面;取消的广播也不算', async () => {
    const fake = createFakeDb({
      checkins: [
        checkin('c1', 'o1', 's1', '2026-09-14T06:00:00+08:00'),
        checkin('c2', 'o2', 's1', '2026-09-14T09:00:00+08:00'), // 与 c1 差 3 小时
        checkin('c3', 'o3', 's1', '2026-09-14T06:10:00+08:00', 'cancelled'), // 本来会与 c1 重叠
      ],
      spots: [],
    });
    const res = await core({}, makeCtx(fake));
    expect(res.data.encounters).toBe(0);
    expect(fake.dump(COLL.ENCOUNTERS)).toHaveLength(0);
  });

  test('同一对人当天在同一点位碰两次 → times 记 2,lastAt 取最后一次', async () => {
    const fake = createFakeDb({
      checkins: [
        checkin('c1', 'o1', 's1', '2026-09-14T06:00:00+08:00'),
        checkin('c2', 'o2', 's1', '2026-09-14T06:30:00+08:00'),
        checkin('c3', 'o1', 's1', '2026-09-14T19:00:00+08:00'),
        checkin('c4', 'o2', 's1', '2026-09-14T19:30:00+08:00'),
      ],
      spots: [],
    });
    const res = await core({}, makeCtx(fake));

    expect(res.data.encounters).toBe(1); // 一条记录,不是两条
    const row = fake.dump(COLL.ENCOUNTERS)[0];
    expect(row.times).toBe(2);
    expect(row.lastAt).toEqual(new Date('2026-09-14T19:30:00+08:00'));
  });

  test('不同点位 / 不同日期各自成条', async () => {
    const fake = createFakeDb({
      checkins: [
        checkin('c1', 'o1', 's1', '2026-09-14T06:00:00+08:00'),
        checkin('c2', 'o2', 's1', '2026-09-14T06:30:00+08:00'),
        checkin('c3', 'o1', 's2', '2026-09-14T09:00:00+08:00'),
        checkin('c4', 'o2', 's2', '2026-09-14T09:30:00+08:00'),
        checkin('c5', 'o1', 's1', yesterday('2026-09-14T19:00:00+08:00')),
        checkin('c6', 'o2', 's1', yesterday('2026-09-14T19:30:00+08:00')),
      ],
      spots: [],
    });
    const res = await core({}, makeCtx(fake));

    expect(res.data.encounters).toBe(3);
    const rows = fake.dump(COLL.ENCOUNTERS);
    expect(rows.map((r) => r.spotId + '/' + r.date).sort()).toEqual([
      's1/2026-09-13',
      's1/2026-09-14',
      's2/2026-09-14',
    ]);
  });

  test('同一个人自己跟自己不算碰面', async () => {
    const fake = createFakeDb({
      checkins: [
        checkin('c1', 'o1', 's1', '2026-09-14T06:00:00+08:00'),
        checkin('c2', 'o1', 's1', '2026-09-14T06:30:00+08:00'),
      ],
      spots: [],
    });
    expect((await core({}, makeCtx(fake))).data.encounters).toBe(0);
  });

  test('重复跑不翻倍:times 重算而不是累加(fake-db 无事务,幂等靠重算)', async () => {
    const fake = createFakeDb(baseSeed());
    const first = await core({}, makeCtx(fake));
    const second = await core({}, makeCtx(fake));

    expect(second.data.archived).toBe(first.data.archived);
    expect(second.data.encounters).toBe(first.data.encounters);
    const rows = fake.dump(COLL.ENCOUNTERS);
    expect(rows).toHaveLength(1);
    expect(rows[0].times).toBe(1); // 不是 2
  });
});

describe('dailyJob: 点位常客数(spotsUpdated)', () => {
  test('regularCount 按窗口内出过场的不同 openid 重算,只数真的变了的点位', async () => {
    const fake = createFakeDb(baseSeed());
    const res = await core({}, makeCtx(fake));

    const spots = fake.dump(COLL.SPOTS);
    const s1 = spots.find((s) => s._id === 's1');
    const s2 = spots.find((s) => s._id === 's2');
    expect(s1.regularCount).toBe(3); // o1 o2 o3;o4 取消了不算
    expect(s2.regularCount).toBe(1); // 本来就是 1,值没变
    expect(res.data.spotsUpdated).toBe(1); // 只有 s1 真的变了
  });

  test('第二次跑时所有点位都已是最新值 → spotsUpdated 为 0', async () => {
    const fake = createFakeDb(baseSeed());
    await core({}, makeCtx(fake));
    const second = await core({}, makeCtx(fake));
    expect(second.data.spotsUpdated).toBe(0);
  });

  test('没有任何广播的点位常客数归零', async () => {
    const fake = createFakeDb({
      checkins: [],
      spots: [{ _id: 's9', name: '空点位', communityId: 'cm1', wxGroupQrFileID: '', peakHint: '', regularCount: 7, active: true }],
    });
    const res = await core({}, makeCtx(fake));

    expect(res.data.spotsUpdated).toBe(1);
    expect(fake.dump(COLL.SPOTS)[0].regularCount).toBe(0);
  });
});
