/**
 * tests/cloud/parkBoard.test.js —— owner: T7
 *
 * 验收 B6(spec 2.2):
 *   ① 无 parkId 返回 ParkSummary[],activeDogCount 不数过期 / cancelled 的,同一只狗两条签到只数一次
 *   ② 有 parkId 时 dogs / todayDogs 都是恰好 5 个 key 的 DogCard
 *   ③ todayDogs 含今天已签退的、不含昨天的
 *   ④ myCheckin 有 / 无两种
 *   ⑤ JSON.stringify(data) 不含 openid / ownerOpenid / nickname,坐标只在 park 层
 *
 * 时间基准 = makeTestCtx 缺省 now,东八区 2026-09-16 10:00。
 * 「今天」按东八区自然日算(spec 9.5),所以今天 00:00 = 2026-09-15T16:00:00Z。
 */

const core = require('../../cloudfunctions/parkBoard/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { fixedClock } = require('../fakes/clock');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-16T10:00:00+08:00';

const PARK_A = { _id: 'park_a', name: 'A 公园', latitude: 30.2415, longitude: 120.156, radiusM: 300, active: true };
const PARK_B = { _id: 'park_b', name: 'B 公园', latitude: 30.244, longitude: 120.214, radiusM: 250, active: true };
const PARK_C = { _id: 'park_c', name: 'C 公园(没人)', latitude: 30.268, longitude: 120.065, radiusM: 400, active: true };
const PARK_OFF = { _id: 'park_off', name: '停用公园', latitude: 30.3, longitude: 120.3, radiusM: 200, active: false };

const PARK_SUMMARY_KEYS = ['activeDogCount', 'latitude', 'longitude', 'name', 'parkId', 'radiusM'];
const DOG_CARD_KEYS = ['avatarFileID', 'dogId', 'name', 'sizeClass', 'tags'];

/** 狗文档上塞满「不该外泄」的字段,给 ⑤ 那条隐私断言当靶子 */
function makeDog(id, owner, name, patch) {
  return Object.assign(
    {
      _id: id,
      ownerOpenid: owner,
      name: name,
      avatarFileID: 'cloud://fake/' + id + '.png',
      sizeClass: 'medium',
      tags: ['ball'],
      breed: '柯基',
      tagCode: 'abc123',
      lostMode: false,
      lostNote: '',
    },
    patch || {}
  );
}

const DOGS = [
  makeDog('dog1', 'o1', '大毛'),
  // 故意缺 avatarFileID / tags,钉 DogCard 的缺省值
  { _id: 'dog2', ownerOpenid: 'o1', name: '二狗', sizeClass: 'small' },
  makeDog('dog3', 'o2', '三花'),
  makeDog('dog4', 'o2', '四喜'),
  makeDog('dog5', 'o3', '五福'),
  makeDog('dog6', 'o3', '六六'),
  makeDog('dog7', 'o9', '七仔'),
  makeDog('dog8', 'o8', '八宝'),
];

const USERS = [
  { _id: 'o1', _openid: 'o1', nickname: '张三', avatarFileID: 'cloud://fake/o1.png', status: 'normal' },
  { _id: 'o2', _openid: 'o2', nickname: '李四', avatarFileID: '', status: 'normal' },
];

function at(iso) {
  return new Date(iso);
}

function ck(id, openid, parkId, dogIds, startIso, endIso, status) {
  return {
    _id: id,
    openid: openid,
    parkId: parkId,
    dogIds: dogIds,
    startAt: at(startIso),
    expireAt: at(endIso),
    status: status || 'active',
    createdAt: at(startIso),
  };
}

const CHECKINS = [
  // —— park_a ——
  ck('ck_a1', 'o1', 'park_a', ['dog1', 'dog2'], '2026-09-16T09:30:00+08:00', '2026-09-16T11:30:00+08:00'),
  // 同一个人同一公园的第二条在场签到,dog1 重复 —— 用来钉「同一只狗只数一次」
  ck('ck_a2', 'o1', 'park_a', ['dog1'], '2026-09-16T09:50:00+08:00', '2026-09-16T11:50:00+08:00'),
  // 今天来过但已过期
  ck('ck_a3', 'o2', 'park_a', ['dog3'], '2026-09-16T07:00:00+08:00', '2026-09-16T09:00:00+08:00'),
  // expireAt 恰好等于 now —— 边界算过期
  ck('ck_a4', 'o2', 'park_a', ['dog4'], '2026-09-16T08:00:00+08:00', '2026-09-16T10:00:00+08:00'),
  // 今天已签退
  ck('ck_a5', 'o3', 'park_a', ['dog5'], '2026-09-16T09:00:00+08:00', '2026-09-16T11:00:00+08:00', 'cancelled'),
  // 昨天(东八区)
  ck('ck_a6', 'o3', 'park_a', ['dog6'], '2026-09-15T19:00:00+08:00', '2026-09-15T21:00:00+08:00', 'cancelled'),
  // —— park_b ——
  ck('ck_b1', 'o9', 'park_b', ['dog7'], '2026-09-16T09:00:00+08:00', '2026-09-16T11:00:00+08:00'),
  // —— park_off:停用公园里也有人在场,但它压根不该出现在列表里 ——
  ck('ck_off', 'o8', 'park_off', ['dog8'], '2026-09-16T09:00:00+08:00', '2026-09-16T11:00:00+08:00'),
];

function ctxWith(opts) {
  const o = opts || {};
  return makeTestCtx({
    openid: o.openid === undefined ? 'o1' : o.openid,
    seed: {
      [COLL.PARKS]: o.parks || [PARK_A, PARK_B, PARK_C, PARK_OFF],
      [COLL.DOGS]: o.dogs || DOGS,
      [COLL.CHECKINS]: o.checkins || CHECKINS,
      [COLL.USERS]: o.users || USERS,
    },
  });
}

function byId(list, key, id) {
  return list.find((x) => x[key] === id);
}

describe('parkBoard —— 无 parkId:公园列表', () => {
  test('未登录返回 AUTH_REQUIRED', async () => {
    const { ctx } = ctxWith({ openid: '' });
    const r = await core({}, ctx);
    expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
  });

  test('返回 ParkSummary[],只含 active:true 的公园,key 恰好 6 个', async () => {
    const { ctx } = ctxWith({});
    const r = await core({}, ctx);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.map((p) => p.parkId).sort()).toEqual(['park_a', 'park_b', 'park_c']);
    r.data.forEach((p) => {
      expect(Object.keys(p).sort()).toEqual(PARK_SUMMARY_KEYS);
      expect(typeof p.activeDogCount).toBe('number');
    });
    const a = byId(r.data, 'parkId', 'park_a');
    expect(a.name).toBe(PARK_A.name);
    expect(a.latitude).toBe(PARK_A.latitude);
    expect(a.longitude).toBe(PARK_A.longitude);
    expect(a.radiusM).toBe(PARK_A.radiusM);
  });

  test('activeDogCount 只数在场的:同一只狗两条签到只算一次,过期 / cancelled 的不数', async () => {
    const { ctx } = ctxWith({});
    const r = await core({}, ctx);
    // park_a 在场的是 ck_a1(dog1,dog2) + ck_a2(dog1) → 去重后 2 只
    // ck_a3 已过期、ck_a4 expireAt===now 算过期、ck_a5 已签退、ck_a6 是昨天的,都不数
    expect(byId(r.data, 'parkId', 'park_a').activeDogCount).toBe(2);
    expect(byId(r.data, 'parkId', 'park_b').activeDogCount).toBe(1);
  });

  test('一条签到都没有的公园给 0,不报错', async () => {
    const { ctx } = ctxWith({});
    const r = await core({}, ctx);
    expect(byId(r.data, 'parkId', 'park_c').activeDogCount).toBe(0);
  });

  test('checkins 集合整个为空时也返回全部公园,计数都是 0', async () => {
    const { ctx } = ctxWith({ checkins: [] });
    const r = await core({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(3);
    r.data.forEach((p) => expect(p.activeDogCount).toBe(0));
  });

  test('parkId 传空串 / undefined 一律走列表分支', async () => {
    const { ctx } = ctxWith({});
    for (const e of [{}, undefined, null, { parkId: '' }, { parkId: null }]) {
      const r = await core(e, ctx);
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
    }
  });

  test('列表返回里不含 openid / ownerOpenid / nickname', async () => {
    const { ctx } = ctxWith({});
    const r = await core({}, ctx);
    const s = JSON.stringify(r.data);
    expect(s.indexOf('openid')).toBe(-1);
    expect(s.indexOf('nickname')).toBe(-1);
    expect(s.indexOf('张三')).toBe(-1);
  });
});

describe('parkBoard —— 有 parkId:公园看板', () => {
  test('公园不存在 → NOT_FOUND parks', async () => {
    const { ctx } = ctxWith({});
    const r = await core({ parkId: 'park_none' }, ctx);
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.PARKS });
  });

  test('ParkBoard 的 key 恰好是 park / dogs / todayDogs / myCheckin', async () => {
    const { ctx } = ctxWith({});
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data).sort()).toEqual(['dogs', 'myCheckin', 'park', 'todayDogs']);
    expect(Object.keys(r.data.park).sort()).toEqual(PARK_SUMMARY_KEYS);
    expect(r.data.park.parkId).toBe('park_a');
    expect(r.data.park.activeDogCount).toBe(2);
  });

  test('dogs 是此刻在场的狗,去重,每条都是恰好 5 个 key 的 DogCard', async () => {
    const { ctx } = ctxWith({});
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(r.data.dogs.map((d) => d.dogId)).toEqual(['dog1', 'dog2']);
    r.data.dogs.forEach((d) => expect(Object.keys(d).sort()).toEqual(DOG_CARD_KEYS));
    expect(byId(r.data.dogs, 'dogId', 'dog1')).toEqual({
      dogId: 'dog1',
      name: '大毛',
      avatarFileID: 'cloud://fake/dog1.png',
      sizeClass: 'medium',
      tags: ['ball'],
    });
    // 狗文档缺 avatarFileID / tags 时给缺省值,不是 undefined
    expect(byId(r.data.dogs, 'dogId', 'dog2')).toEqual({
      dogId: 'dog2',
      name: '二狗',
      avatarFileID: '',
      sizeClass: 'small',
      tags: [],
    });
  });

  test('todayDogs 含今天已签退的、不含昨天的,按最近签到时间倒序,每条都是 DogCard', async () => {
    const { ctx } = ctxWith({});
    const r = await core({ parkId: 'park_a' }, ctx);
    // 今天(东八区)的签到按 startAt 降序:ck_a2 09:50 / ck_a1 09:30 / ck_a5 09:00 / ck_a4 08:00 / ck_a3 07:00
    expect(r.data.todayDogs.map((d) => d.dogId)).toEqual(['dog1', 'dog2', 'dog5', 'dog4', 'dog3']);
    // dog5 是今天已签退的(ck_a5 cancelled),在;dog6 是昨天的,不在
    expect(r.data.todayDogs.map((d) => d.dogId)).toContain('dog5');
    expect(r.data.todayDogs.map((d) => d.dogId)).not.toContain('dog6');
    r.data.todayDogs.forEach((d) => expect(Object.keys(d).sort()).toEqual(DOG_CARD_KEYS));
  });

  test('昨天 23:59(东八区)的签到不算今天,今天 00:00 的算', async () => {
    const checkins = [
      ck('ck_y', 'o2', 'park_a', ['dog3'], '2026-09-15T23:59:00+08:00', '2026-09-16T01:59:00+08:00', 'cancelled'),
      ck('ck_t', 'o3', 'park_a', ['dog5'], '2026-09-16T00:00:00+08:00', '2026-09-16T02:00:00+08:00', 'cancelled'),
    ];
    const { ctx } = ctxWith({ checkins });
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(r.data.todayDogs.map((d) => d.dogId)).toEqual(['dog5']);
  });

  test('myCheckin:调用者在该公园有在场签到时返回 3 个 key,expireAt 是 ISO 串', async () => {
    const { ctx } = ctxWith({ openid: 'o1' });
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(Object.keys(r.data.myCheckin).sort()).toEqual(['checkinId', 'dogIds', 'expireAt']);
    // 取最近一条在场签到
    expect(r.data.myCheckin.checkinId).toBe('ck_a2');
    expect(r.data.myCheckin.dogIds).toEqual(['dog1']);
    expect(r.data.myCheckin.expireAt).toBe(at('2026-09-16T11:50:00+08:00').toISOString());
  });

  test('myCheckin:没签到 / 只有过期或已签退的签到 → null', async () => {
    const none = ctxWith({ openid: 'o5' });
    expect((await core({ parkId: 'park_a' }, none.ctx)).data.myCheckin).toBeNull();

    // o2 在 park_a 只有过期的,o3 只有 cancelled 的
    const expiredOnly = ctxWith({ openid: 'o2' });
    expect((await core({ parkId: 'park_a' }, expiredOnly.ctx)).data.myCheckin).toBeNull();
    const cancelledOnly = ctxWith({ openid: 'o3' });
    expect((await core({ parkId: 'park_a' }, cancelledOnly.ctx)).data.myCheckin).toBeNull();
  });

  test('myCheckin 只认同一个公园:人在 park_b 时 park_a 的看板给 null', async () => {
    const { ctx } = ctxWith({ openid: 'o9' });
    expect((await core({ parkId: 'park_a' }, ctx)).data.myCheckin).toBeNull();
    expect((await core({ parkId: 'park_b' }, ctx)).data.myCheckin.checkinId).toBe('ck_b1');
  });

  test('没人签到过的公园:dogs / todayDogs 为 [],myCheckin 为 null,不报错', async () => {
    const { ctx } = ctxWith({});
    const r = await core({ parkId: 'park_c' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data.dogs).toEqual([]);
    expect(r.data.todayDogs).toEqual([]);
    expect(r.data.myCheckin).toBeNull();
    expect(r.data.park.activeDogCount).toBe(0);
  });

  test('狗文档已被删:dogs / todayDogs 跳过它,activeDogCount 仍按 dogId 去重计数', async () => {
    const checkins = [
      ck('ck_g', 'o1', 'park_a', ['dog1', 'dog_ghost'], '2026-09-16T09:30:00+08:00', '2026-09-16T11:30:00+08:00'),
    ];
    const { ctx } = ctxWith({ checkins });
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(r.data.dogs.map((d) => d.dogId)).toEqual(['dog1']);
    expect(r.data.todayDogs.map((d) => d.dogId)).toEqual(['dog1']);
    // 口径与无 parkId 那一路一致:数的是签到里的 dogId,不查狗文档在不在
    expect(r.data.park.activeDogCount).toBe(2);
  });

  test('B6 隐私:整个返回值不含 openid / ownerOpenid / nickname,坐标只出现在 park 这一层', async () => {
    const { ctx } = ctxWith({ openid: 'o1' });
    const r = await core({ parkId: 'park_a' }, ctx);
    const all = JSON.stringify(r.data);
    expect(all.indexOf('openid')).toBe(-1);
    expect(all.indexOf('ownerOpenid')).toBe(-1);
    expect(all.indexOf('nickname')).toBe(-1);
    expect(all.indexOf('张三')).toBe(-1);
    expect(all.indexOf('o1"')).toBe(-1);

    // 坐标只允许在 park 这一层
    expect(r.data.park.latitude).toBe(PARK_A.latitude);
    expect(r.data.park.longitude).toBe(PARK_A.longitude);
    const withoutPark = JSON.stringify({
      dogs: r.data.dogs,
      todayDogs: r.data.todayDogs,
      myCheckin: r.data.myCheckin,
    });
    expect(withoutPark.indexOf('latitude')).toBe(-1);
    expect(withoutPark.indexOf('longitude')).toBe(-1);
    // 狗文档里的非 DogCard 字段也不该漏出来
    expect(all.indexOf('breed')).toBe(-1);
    expect(all.indexOf('tagCode')).toBe(-1);
    expect(all.indexOf('lostNote')).toBe(-1);
  });

  test('东八区的「今天」按东八区算,不跟着 UTC 日期走', async () => {
    // now = 东八区 9-16 00:30(UTC 还停在 9-15 16:30)。按 UTC 日切会把 9-15 的签到算进今天。
    expect(new Date(NOW_ISO).toISOString()).toBe('2026-09-16T02:00:00.000Z');
    const checkins = [
      ck('ck_last_night', 'o2', 'park_a', ['dog3'], '2026-09-15T23:00:00+08:00', '2026-09-16T01:00:00+08:00'),
      ck('ck_after_midnight', 'o3', 'park_a', ['dog5'], '2026-09-16T00:10:00+08:00', '2026-09-16T02:10:00+08:00'),
    ];
    const { ctx } = makeTestCtx({
      openid: 'o1',
      now: fixedClock('2026-09-16T00:30:00+08:00'),
      seed: { [COLL.PARKS]: [PARK_A], [COLL.DOGS]: DOGS, [COLL.CHECKINS]: checkins },
    });
    const r = await core({ parkId: 'park_a' }, ctx);
    expect(r.data.todayDogs.map((d) => d.dogId)).toEqual(['dog5']);
    // 两条都还没过期,所以都在场 —— 「在场」与「今天」是两把不同的尺子
    expect(r.data.dogs.map((d) => d.dogId).sort()).toEqual(['dog3', 'dog5']);
  });
});
