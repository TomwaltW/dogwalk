/**
 * tests/fakes/ 三件套的自测 —— T0 owner。
 *
 * 这不是业务测试,是对「契约脚手架本身可用」的回归保护:T1-T5 全部依赖
 * fake-db / mini-runtime / clock,它们坏了下游五条 track 会一起误判。
 */

const { createFakeDb } = require('./fake-db');
const { loadPage } = require('./mini-runtime');
const { fixedClock } = require('./clock');

describe('fake-db: 读写与查询', () => {
  test('seed 的文档可按字段查出,返回深拷贝', async () => {
    const { db, dump } = createFakeDb({
      dogs: [
        { _id: 'd1', name: 'a', sizeClass: 'small' },
        { _id: 'd2', name: 'b', sizeClass: 'large' },
      ],
    });
    const r = await db.collection('dogs').where({ sizeClass: 'small' }).get();
    expect(r.data).toHaveLength(1);
    expect(r.data[0]._id).toBe('d1');

    r.data[0].name = 'MUTATED';
    expect(dump('dogs')[0].name).toBe('a');
  });

  test('add 自动生成 _id,count 与 get 一致', async () => {
    const { db } = createFakeDb({});
    const added = await db.collection('dogs').add({ data: { name: 'c' } });
    expect(typeof added._id).toBe('string');
    expect(added._id.length).toBeGreaterThan(0);
    expect((await db.collection('dogs').count()).total).toBe(1);
    expect((await db.collection('dogs').get()).data[0].name).toBe('c');
  });

  test('doc().get() 不存在时 reject,update 不存在时 updated:0', async () => {
    const { db } = createFakeDb({ dogs: [{ _id: 'd1', name: 'a' }] });
    await expect(db.collection('dogs').doc('nope').get()).rejects.toThrow(/does not exist/);
    const r = await db.collection('dogs').doc('nope').update({ data: { name: 'x' } });
    expect(r.stats.updated).toBe(0);
  });

  test('doc().set() 是 upsert,remove 真的删掉', async () => {
    const { db, dump } = createFakeDb({});
    await db.collection('users').doc('o1').set({ data: { nickname: 'n1' } });
    expect(dump('users')).toEqual([{ _id: 'o1', nickname: 'n1' }]);
    await db.collection('users').doc('o1').set({ data: { nickname: 'n2' } });
    expect(dump('users')).toEqual([{ _id: 'o1', nickname: 'n2' }]);
    expect((await db.collection('users').doc('o1').remove()).stats.removed).toBe(1);
    expect(dump('users')).toHaveLength(0);
  });

  test('orderBy / limit / skip', async () => {
    const { db } = createFakeDb({
      checkins: [{ _id: 'c1', n: 3 }, { _id: 'c2', n: 1 }, { _id: 'c3', n: 2 }],
    });
    const asc = await db.collection('checkins').orderBy('n', 'asc').get();
    expect(asc.data.map((d) => d.n)).toEqual([1, 2, 3]);
    const desc = await db.collection('checkins').orderBy('n', 'desc').limit(2).get();
    expect(desc.data.map((d) => d.n)).toEqual([3, 2]);
    const skipped = await db.collection('checkins').orderBy('n', 'asc').skip(1).get();
    expect(skipped.data.map((d) => d.n)).toEqual([2, 3]);
  });
});

describe('fake-db: command', () => {
  test('比较类 command 对 Date 按时刻比较', async () => {
    const t0 = new Date('2026-09-14T12:00:00Z');
    const { db, _ } = createFakeDb({
      checkins: [
        { _id: 'c1', expireAt: new Date('2026-09-14T11:00:00Z') },
        { _id: 'c2', expireAt: new Date('2026-09-14T13:00:00Z') },
      ],
    });
    const r = await db.collection('checkins').where({ expireAt: _.gt(t0) }).get();
    expect(r.data.map((d) => d._id)).toEqual(['c2']);
    expect(r.data[0].expireAt).toBeInstanceOf(Date);
  });

  test('eq/neq/in/nin', async () => {
    const { db, _ } = createFakeDb({
      dogs: [{ _id: 'd1', s: 'small' }, { _id: 'd2', s: 'large' }, { _id: 'd3', s: 'medium' }],
    });
    const hit = async (q) => (await db.collection('dogs').where(q).get()).data.map((d) => d._id);
    expect(await hit({ s: _.eq('small') })).toEqual(['d1']);
    expect(await hit({ s: _.neq('small') })).toEqual(['d2', 'd3']);
    expect(await hit({ s: _.in(['small', 'medium']) })).toEqual(['d1', 'd3']);
    expect(await hit({ s: _.nin(['small', 'medium']) })).toEqual(['d2']);
  });

  test('_.and / _.or,链式与顶层两种写法都work', async () => {
    const { db, _ } = createFakeDb({
      checkins: [
        { _id: 'c1', n: 5, status: 'active' },
        { _id: 'c2', n: 15, status: 'active' },
        { _id: 'c3', n: 5, status: 'cancelled' },
      ],
    });
    const chained = await db.collection('checkins').where({ n: _.gte(1).and(_.lt(10)) }).get();
    expect(chained.data.map((d) => d._id)).toEqual(['c1', 'c3']);

    const topLevel = await db
      .collection('checkins')
      .where(_.or([{ n: 15 }, { status: 'cancelled' }]))
      .get();
    expect(topLevel.data.map((d) => d._id)).toEqual(['c2', 'c3']);
  });

  test('_.inc 累加,点号路径可写入', async () => {
    const { db, dump } = createFakeDb({ encounters: [{ _id: 'e1', times: 2 }] });
    const _ = db.command;
    await db.collection('encounters').doc('e1').update({ data: { times: _.inc(3) } });
    expect(dump('encounters')[0].times).toBe(5);

    const fdb = createFakeDb({ users: [{ _id: 'o1', subQuota: { checkin: 3 } }] });
    await fdb.db.collection('users').doc('o1').update({ data: { 'subQuota.checkin': 0 } });
    expect(fdb.dump('users')[0].subQuota.checkin).toBe(0);
  });

  test('where 的嵌套对象写法等价于点号路径', async () => {
    const { db } = createFakeDb({ users: [{ _id: 'o1', subQuota: { checkin: 3 } }] });
    const a = await db.collection('users').where({ 'subQuota.checkin': 3 }).get();
    const b = await db.collection('users').where({ subQuota: { checkin: 3 } }).get();
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
  });

  test('数组字段配字面值命中任一元素', async () => {
    const { db } = createFakeDb({ users: [{ _id: 'o1', followSpotIds: ['s1', 's2'] }] });
    const r = await db.collection('users').where({ followSpotIds: 's2' }).get();
    expect(r.data).toHaveLength(1);
  });

  test('不支持的能力要明确报错,不静默给错结果', async () => {
    const { db } = createFakeDb({ dogs: [{ _id: 'd1', n: 1 }] });
    expect(db.collection('dogs').aggregate).toBeUndefined();
    await expect(
      db.collection('dogs').doc('d1').update({ data: { n: db.command.gt(1) } })
    ).rejects.toThrow(/只支持 _\.inc/);
    expect(() => db.collection('dogs').where(db.command.neq(1))._resolve()).toThrow(
      /只接受 _\.and \/ _\.or/
    );
  });

  test('空集合查询返回空数组而非报错', async () => {
    const { db } = createFakeDb({});
    const r = await db.collection('checkins').where({ status: 'active' }).get();
    expect(r.data).toEqual([]);
  });
});

describe('mini-runtime', () => {
  test('loadPage 返回 options 对象,且不残留全局', () => {
    const had = Object.prototype.hasOwnProperty.call(global, 'Page');
    const page = loadPage('miniprogram/pages/index/index.js');
    expect(typeof page).toBe('object');
    expect(page.data).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(global, 'Page')).toBe(had);
  });

  test('setData 真实更新 data,支持点号与下标路径', () => {
    const page = loadPage('miniprogram/pages/index/index.js');
    page.setData({ spots: [{ name: 'a' }] });
    page.setData({ 'spots[0].name': 'b', 'errMsg': 'x' });
    expect(page.data.spots[0].name).toBe('b');
    expect(page.data.errMsg).toBe('x');
    expect(page.__setDataCalls).toHaveLength(2);
  });

  test('两次 loadPage 的 data 互不串台', () => {
    const p1 = loadPage('miniprogram/pages/spot/spot.js');
    const p2 = loadPage('miniprogram/pages/spot/spot.js');
    p1.setData({ x: 1 });
    expect(p2.data.x).toBeUndefined();
  });

  test('wx 可被 stubs 覆盖,注入的 wx / app 从返回值上拿得到', () => {
    const seen = [];
    const app = { globalData: { user: { _id: 'o1' } } };
    const page = loadPage('miniprogram/pages/me/me.js', {
      wx: { showToast: (o) => seen.push(o.title) },
      app,
    });
    expect(page.__app).toBe(app);
    page.__wx.showToast({ title: 'hi' });
    expect(seen).toEqual(['hi']);
    // 未覆盖的 wx API 仍是可用的默认 stub,并记录调用
    page.__wx.navigateTo({ url: '/pages/index/index' });
    expect(page.__wx.__calls.map((c) => c.name)).toContain('navigateTo');
  });

  test('六个页面全部加载得起来', () => {
    const pages = [
      'miniprogram/pages/index/index.js',
      'miniprogram/pages/spot/spot.js',
      'miniprogram/pages/checkin/checkin.js',
      'miniprogram/pages/dog/edit/edit.js',
      'miniprogram/pages/dog/profile/profile.js',
      'miniprogram/pages/me/me.js',
    ];
    pages.forEach((p) => expect(typeof loadPage(p)).toBe('object'));
  });
});

describe('clock', () => {
  test('fixedClock 每次返回同一时刻的新实例', () => {
    const now = fixedClock('2026-09-14T19:30:00+08:00');
    const a = now();
    const b = now();
    expect(a.getTime()).toBe(b.getTime());
    expect(a).not.toBe(b);
    expect(a.toISOString()).toBe('2026-09-14T11:30:00.000Z');
  });

  test('解析不了的时间串要立刻报错', () => {
    expect(() => fixedClock('not-a-date')).toThrow(/无法解析/);
  });
});

describe('_shared 契约', () => {
  const { CODES, fail, ok } = require('../../cloudfunctions/_shared/errors');
  const contracts = require('../../cloudfunctions/_shared/contracts');

  test('返回形状符合 spec 3.1', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(ok(undefined)).toEqual({ ok: true, data: null });
    expect(fail(CODES.FORBIDDEN)).toEqual({ ok: false, code: 'FORBIDDEN', msg: 'FORBIDDEN' });
    expect(fail(CODES.INVALID_PARAM, 'sizeClass')).toEqual({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'sizeClass',
    });
  });

  test('常量与 spec 3.2 一致', () => {
    expect(contracts.CHECKIN_DURATION_MS).toBe(90 * 60 * 1000);
    expect(contracts.TAG_CODE_LENGTH).toBe(6);
    expect(contracts.SIZE_CLASS).toEqual(['small', 'medium', 'large']);
    expect(Object.values(contracts.COLL)).toEqual([
      'users',
      'dogs',
      'spots',
      'checkins',
      'encounters',
      'scanLogs',
    ]);
  });

  test('schema 的校验函数只有签名,调用即 NOT_IMPLEMENTED', () => {
    const schema = require('../../cloudfunctions/_shared/schema');
    ['validateDog', 'validateCheckin', 'validateProfile', 'validateTagCode'].forEach((fn) => {
      expect(typeof schema[fn]).toBe('function');
      expect(() => schema[fn]({})).toThrow('NOT_IMPLEMENTED');
    });
  });

  test('八个云函数的 core 都是 async 函数且 reject NOT_IMPLEMENTED', async () => {
    const names = [
      'login', 'dogCRUD', 'checkin', 'checkinCancel',
      'spotBoard', 'genTagCode', 'scanTag', 'dailyJob',
    ];
    for (const n of names) {
      const core = require('../../cloudfunctions/' + n + '/core');
      expect(typeof core).toBe('function');
      await expect(core({}, {})).rejects.toThrow('NOT_IMPLEMENTED');
    }
  });
});

describe('api 封装', () => {
  const api = require('../../miniprogram/api/index');

  function withWx(handler, fn) {
    const had = Object.prototype.hasOwnProperty.call(global, 'wx');
    const saved = global.wx;
    global.wx = { cloud: { callFunction: handler } };
    try {
      return fn();
    } finally {
      if (had) global.wx = saved;
      else delete global.wx;
    }
  }

  test('ok:true 时 resolve data 本身', async () => {
    const p = withWx(
      (o) => o.success({ result: { ok: true, data: { called: o.name, event: o.data } } }),
      () => api.listMyDogs()
    );
    await expect(p).resolves.toEqual({ called: 'dogCRUD', event: { action: 'listMine' } });
  });

  test('ok:false 时 reject ApiError,code 透传', async () => {
    const p = withWx(
      (o) => o.success({ result: { ok: false, code: 'FORBIDDEN', msg: 'not yours' } }),
      () => api.removeDog('d1')
    );
    await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'not yours' });
    await p.catch((e) => {
      expect(e).toBeInstanceOf(api.ApiError);
      expect(e).toBeInstanceOf(Error);
    });
  });

  test('callFunction fail 归成 INTERNAL', async () => {
    const p = withWx((o) => o.fail({ errMsg: 'boom' }), () => api.listSpots());
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL', message: 'boom' });
  });

  test('返回形状不对也归成 INTERNAL,不让页面拿到脏数据', async () => {
    const p = withWx((o) => o.success({ result: undefined }), () => api.listSpots());
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  test('10 个方法映射到正确的云函数与 event', async () => {
    const seen = [];
    const capture = (o) => {
      seen.push([o.name, o.data]);
      o.success({ result: { ok: true, data: null } });
    };
    await withWx(capture, () =>
      Promise.all([
        api.login({ nickname: 'n' }),
        api.listSpots(),
        api.getSpotBoard('s1'),
        api.createCheckin({ spotId: 's1', dogIds: ['d1'], startAt: 'iso' }),
        api.cancelCheckin('c1'),
        api.listMyDogs(),
        api.saveDog({ name: 'a' }),
        api.removeDog('d1'),
        api.getDogPublic('abc123'),
        api.genTag('d1'),
      ])
    );
    expect(seen).toEqual([
      ['login', { profile: { nickname: 'n' } }],
      ['spotBoard', {}],
      ['spotBoard', { spotId: 's1' }],
      ['checkin', { spotId: 's1', dogIds: ['d1'], startAt: 'iso' }],
      ['checkinCancel', { checkinId: 'c1' }],
      ['dogCRUD', { action: 'listMine' }],
      ['dogCRUD', { action: 'create', dog: { name: 'a' } }],
      ['dogCRUD', { action: 'remove', dogId: 'd1' }],
      ['scanTag', { tagCode: 'abc123' }],
      ['genTagCode', { dogId: 'd1' }],
    ]);
  });
});
