/**
 * tests/fakes/ 四件套 + 契约文件的自测 —— T0' owner。
 *
 * 这不是业务测试,是对「契约脚手架本身可用」的回归保护:T6-T11 全部依赖
 * fake-db / mini-runtime / clock / cloud-ctx,它们坏了下游六条 track 会一起误判。
 *
 * 只验「骨架在、签名对、常量与 spec 一致」,不验各 core / 页面实现到什么程度 ——
 * 把「此刻还是空桩」写成永久断言,各轨一实现就必然红(第一轮踩过)。
 */

const { createFakeDb } = require('./fake-db');
const { loadPage } = require('./mini-runtime');
const { fixedClock } = require('./clock');
const { makeTestCtx } = require('./cloud-ctx');

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

  test('批量 update / remove(where 命中多条)', async () => {
    const { db, dump } = createFakeDb({
      checkins: [
        { _id: 'c1', openid: 'o1', status: 'active' },
        { _id: 'c2', openid: 'o1', status: 'active' },
        { _id: 'c3', openid: 'o2', status: 'active' },
      ],
    });
    const r = await db
      .collection('checkins')
      .where({ openid: 'o1', status: 'active' })
      .update({ data: { status: 'cancelled' } });
    expect(r.stats.updated).toBe(2);
    expect(dump('checkins').map((c) => c.status)).toEqual(['cancelled', 'cancelled', 'active']);
  });
});

describe('fake-db: command', () => {
  test('比较类 command 对 Date 按时刻比较', async () => {
    const t0 = new Date('2026-09-16T12:00:00Z');
    const { db, _ } = createFakeDb({
      checkins: [
        { _id: 'c1', expireAt: new Date('2026-09-16T11:00:00Z') },
        { _id: 'c2', expireAt: new Date('2026-09-16T13:00:00Z') },
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
    const { db, dump } = createFakeDb({ walks: [{ _id: 'w1', times: 2 }] });
    const _ = db.command;
    await db.collection('walks').doc('w1').update({ data: { times: _.inc(3) } });
    expect(dump('walks')[0].times).toBe(5);

    const fdb = createFakeDb({ users: [{ _id: 'o1', subQuota: { foundReport: 3 } }] });
    await fdb.db.collection('users').doc('o1').update({ data: { 'subQuota.foundReport': 0 } });
    expect(fdb.dump('users')[0].subQuota.foundReport).toBe(0);
  });

  test('where 的嵌套对象写法等价于点号路径', async () => {
    const { db } = createFakeDb({ users: [{ _id: 'o1', subQuota: { foundReport: 3 } }] });
    const a = await db.collection('users').where({ 'subQuota.foundReport': 3 }).get();
    const b = await db.collection('users').where({ subQuota: { foundReport: 3 } }).get();
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
  });

  test('数组字段配字面值命中任一元素', async () => {
    const { db } = createFakeDb({ walks: [{ _id: 'w1', dogIds: ['d1', 'd2'] }] });
    const r = await db.collection('walks').where({ dogIds: 'd2' }).get();
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

describe('cloud-ctx', () => {
  test('组出来的 ctx 齐八件,now 可控,openid 缺省为游客', () => {
    const { ctx } = makeTestCtx({});
    ['db', '_', 'openid', 'now', 'openapi', 'logger', 'storage', 'security'].forEach((k) =>
      expect(ctx).toHaveProperty(k)
    );
    expect(ctx.openid).toBe('');
    expect(ctx.now().toISOString()).toBe('2026-09-16T02:00:00.000Z');
    expect(makeTestCtx({ openid: 'o1' }).ctx.openid).toBe('o1');
  });

  test('security 按 risky / riskyImages 判,空串直接放行', async () => {
    const { ctx } = makeTestCtx({ risky: ['脏话'], riskyImages: ['cloud://bad.png'] });
    expect(await ctx.security.checkText('今天天气好')).toBe(true);
    expect(await ctx.security.checkText('有脏话的')).toBe(false);
    expect(await ctx.security.checkText('   ')).toBe(true);
    expect(await ctx.security.checkImage('cloud://ok.png')).toBe(true);
    expect(await ctx.security.checkImage('cloud://bad.png')).toBe(false);
    expect(await ctx.security.checkImage('')).toBe(true);
  });

  test('storage / openapi 的调用都留了记录', async () => {
    const { ctx, calls } = makeTestCtx({});
    const id = await ctx.storage.uploadFile('tags/abc123.png', Buffer.from('x'));
    expect(id).toBe('cloud://fake/tags/abc123.png');
    expect(calls.uploads).toHaveLength(1);
    expect((await ctx.storage.downloadFile('cloud://f')).toString()).toBe('fake:cloud://f');
    await ctx.openapi.subscribeMessage.send({ touser: 'o1' });
    expect(calls.subscribe[0].touser).toBe('o1');
    const qr = await ctx.openapi.wxacode.getUnlimited({ scene: 'abc123' });
    expect(Buffer.isBuffer(qr.buffer)).toBe(true);
    ctx.logger.error('boom');
    expect(calls.errors).toHaveLength(1);
  });
});

describe('mini-runtime', () => {
  test('loadPage 返回 options 对象,且不残留全局', () => {
    const had = Object.prototype.hasOwnProperty.call(global, 'Page');
    const page = loadPage('miniprogram/pages/index/index.js');
    expect(typeof page).toBe('object');
    expect(page.data).toBeInstanceOf(Object);
    expect(page.data).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(global, 'Page')).toBe(had);
  });

  test('setData 真实更新 data,支持点号与下标路径', () => {
    const page = loadPage('miniprogram/pages/index/index.js');
    page.setData({ markers: [{ name: 'a' }] });
    page.setData({ 'markers[0].name': 'b', errMsg: 'x' });
    expect(page.data.markers[0].name).toBe('b');
    expect(page.data.errMsg).toBe('x');
    expect(page.__setDataCalls).toHaveLength(2);
  });

  test('两次 loadPage 的 data 互不串台', () => {
    const p1 = loadPage('miniprogram/pages/park/park.js');
    const p2 = loadPage('miniprogram/pages/park/park.js');
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
    page.__wx.navigateTo({ url: '/pages/park/park' });
    expect(page.__wx.__calls.map((c) => c.name)).toContain('navigateTo');
  });

  test('本轮新增的 wx stub 都在,默认 success 给的形状对', async () => {
    const page = loadPage('miniprogram/pages/index/index.js');
    const w = page.__wx;
    ['getLocation', 'saveImageToPhotosAlbum', 'getSetting', 'authorize', 'openSetting',
      'getPrivacySetting', 'createMapContext', 'chooseMedia'].forEach((k) =>
      expect(typeof w[k]).toBe('function')
    );
    expect(typeof w.cloud.uploadFile).toBe('function');
    expect(typeof w.cloud.downloadFile).toBe('function');
    const up = await w.cloud.uploadFile({ cloudPath: 'x' });
    expect(up.fileID).toBe('cloud://fake/uploaded');
    const ctx = w.createMapContext('map');
    ctx.includePoints({ points: [] });
    expect(w.__calls.map((c) => c.name)).toContain('map.includePoints');
  });

  test('app.json 里的十个页面全部加载得起来', () => {
    const appJson = require('../../miniprogram/app.json');
    expect(appJson.pages).toHaveLength(10);
    appJson.pages.forEach((p) => {
      const page = loadPage('miniprogram/' + p + '.js');
      expect(typeof page).toBe('object');
    });
  });
});

describe('clock', () => {
  test('fixedClock 每次返回同一时刻的新实例', () => {
    const now = fixedClock('2026-09-16T19:30:00+08:00');
    const a = now();
    const b = now();
    expect(a.getTime()).toBe(b.getTime());
    expect(a).not.toBe(b);
    expect(a.toISOString()).toBe('2026-09-16T11:30:00.000Z');
  });

  test('解析不了的时间串要立刻报错', () => {
    expect(() => fixedClock('not-a-date')).toThrow(/无法解析/);
  });
});

describe('_shared 契约', () => {
  const { CODES, fail, ok } = require('../../cloudfunctions/_shared/errors');
  const contracts = require('../../cloudfunctions/_shared/contracts');

  test('返回形状符合 spec 3.1,错误码齐', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(ok(undefined)).toEqual({ ok: true, data: null });
    expect(fail(CODES.FORBIDDEN)).toEqual({ ok: false, code: 'FORBIDDEN', msg: 'FORBIDDEN' });
    expect(fail(CODES.OUT_OF_RANGE, '350')).toEqual({ ok: false, code: 'OUT_OF_RANGE', msg: '350' });
    expect(Object.keys(CODES).sort()).toEqual(
      ['AUTH_REQUIRED', 'CONFLICT', 'CONTENT_RISKY', 'FORBIDDEN', 'INTERNAL', 'INVALID_PARAM',
        'NOT_FOUND', 'OUT_OF_RANGE', 'QUOTA_EXHAUSTED', 'WALK_FULL']
    );
  });

  test('常量与 spec 3.2.1 一致', () => {
    expect(contracts.CHECKIN_DURATION_MS).toBe(2 * 60 * 60 * 1000);
    expect(contracts.TAG_CODE_LENGTH).toBe(6);
    expect(contracts.SIZE_CLASS).toEqual(['small', 'medium', 'large']);
    expect(contracts.GENDER).toEqual(['male', 'female']);
    expect(contracts.TAGS).toEqual(['ball', 'fearsBig', 'foodGuard', 'shy', 'chaser', 'calm']);
    expect(Object.keys(contracts.TAG_LABEL)).toEqual(contracts.TAGS);
    expect(contracts.WALK_STATUS).toEqual(['open', 'cancelled']);
    expect(contracts.MEMBER_STATUS).toEqual(['pending', 'approved', 'rejected', 'left']);
    expect(contracts.TEMPLATE_KEYS).toEqual({ FOUND_REPORT: 'foundReport' });
    expect(contracts.LIMITS.WALK_MAX_DOGS_DEFAULT).toBe(3);
    expect(Object.values(contracts.COLL)).toEqual([
      'users', 'dogs', 'parks', 'checkins', 'walks', 'walk_members', 'messages', 'found_reports', 'scanLogs',
    ]);
  });

  test('十二个云函数的 core 都是可调用的 async 函数,index.js 都是固定模板', () => {
    const fs = require('fs');
    const path = require('path');
    const names = [
      'login', 'dogCRUD', 'genTagCode', 'scanTag', 'reportFound', 'foundReports', 'subscribeGrant',
      'initParks', 'checkin', 'checkinCancel', 'parkBoard', 'walkOps',
    ];
    const template = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/login/index.js'), 'utf8');
    for (const n of names) {
      const core = require('../../cloudfunctions/' + n + '/core');
      expect(typeof core).toBe('function');
      const ret = core({}, {});
      expect(ret).toBeInstanceOf(Promise);
      // 空桩会 resolve fail(INTERNAL),实现完的会 resolve 业务结果或 reject,都不该让这条红
      ret.catch(() => {});
      const idx = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/' + n + '/index.js'), 'utf8');
      expect(idx).toBe(template);
    }
  });
});

describe('api 封装', () => {
  const api = require('../../miniprogram/api/index');

  function withWx(cloudStub, fn) {
    const had = Object.prototype.hasOwnProperty.call(global, 'wx');
    const saved = global.wx;
    global.wx = { cloud: cloudStub };
    try {
      return fn();
    } finally {
      if (had) global.wx = saved;
      else delete global.wx;
    }
  }

  test('ok:true 时 resolve data 本身', async () => {
    const p = withWx(
      { callFunction: (o) => o.success({ result: { ok: true, data: { called: o.name, event: o.data } } }) },
      () => api.listMyDogs()
    );
    await expect(p).resolves.toEqual({ called: 'dogCRUD', event: { action: 'listMine' } });
  });

  test('ok:false 时 reject ApiError,code 透传', async () => {
    const p = withWx(
      { callFunction: (o) => o.success({ result: { ok: false, code: 'FORBIDDEN', msg: 'not yours' } }) },
      () => api.removeDog('d1')
    );
    await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'not yours' });
    await p.catch((e) => {
      expect(e).toBeInstanceOf(api.ApiError);
      expect(e).toBeInstanceOf(Error);
    });
  });

  test('callFunction fail / 形状不对都归成 INTERNAL', async () => {
    const p1 = withWx({ callFunction: (o) => o.fail({ errMsg: 'boom' }) }, () => api.listParks());
    await expect(p1).rejects.toMatchObject({ code: 'INTERNAL', message: 'boom' });
    const p2 = withWx({ callFunction: (o) => o.success({ result: undefined }) }, () => api.listParks());
    await expect(p2).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  test('23 个云函数方法映射到正确的云函数与 event', async () => {
    const seen = [];
    const capture = (o) => {
      seen.push([o.name, o.data]);
      o.success({ result: { ok: true, data: null } });
    };
    await withWx({ callFunction: capture }, () =>
      Promise.all([
        api.login({ nickname: 'n' }),
        api.listMyDogs(),
        api.saveDog({ name: 'a' }),
        api.saveDog({ _id: 'd1', name: 'b' }),
        api.removeDog('d1'),
        api.genTag('d1'),
        api.getDogPublic('abc123'),
        api.setLostMode('d1', true, '在小区门口走丢的'),
        api.setLostMode('d1', false),
        api.reportFound({ tagCode: 'abc123', message: '看到了', latitude: 30.1, longitude: 120.1 }),
        api.listFoundReports('d1'),
        api.grantSubscribe('foundReport', 'TPL1'),
        api.initParks(),
        api.listParks(),
        api.getParkBoard('p1'),
        api.checkin({ parkId: 'p1', dogIds: ['d1'], latitude: 30.1, longitude: 120.1 }),
        api.cancelCheckin('c1'),
        api.createWalk({ parkId: 'p1', startAt: 'iso', dogIds: ['d1'], note: 'n', maxDogs: 4 }),
        api.listWalks({ parkId: 'p1', date: '2026-09-16' }),
        api.listWalks(),
        api.getWalk('w1'),
        api.joinWalk('w1', ['d1']),
        api.decideJoin('m1', true),
        api.leaveWalk('w1'),
        api.cancelWalk('w1'),
        api.postMessage('w1', 'hi'),
      ])
    );
    expect(seen).toEqual([
      ['login', { profile: { nickname: 'n' } }],
      ['dogCRUD', { action: 'listMine' }],
      ['dogCRUD', { action: 'create', dog: { name: 'a' } }],
      ['dogCRUD', { action: 'update', dog: { _id: 'd1', name: 'b' } }],
      ['dogCRUD', { action: 'remove', dogId: 'd1' }],
      ['genTagCode', { dogId: 'd1' }],
      ['scanTag', { tagCode: 'abc123' }],
      ['dogCRUD', { action: 'update', dog: { _id: 'd1', lostMode: true, lostNote: '在小区门口走丢的' } }],
      ['dogCRUD', { action: 'update', dog: { _id: 'd1', lostMode: false } }],
      ['reportFound', { tagCode: 'abc123', message: '看到了', latitude: 30.1, longitude: 120.1 }],
      ['foundReports', { dogId: 'd1' }],
      ['subscribeGrant', { templateKey: 'foundReport', templateId: 'TPL1' }],
      ['initParks', {}],
      ['parkBoard', {}],
      ['parkBoard', { parkId: 'p1' }],
      ['checkin', { parkId: 'p1', dogIds: ['d1'], latitude: 30.1, longitude: 120.1 }],
      ['checkinCancel', { checkinId: 'c1' }],
      ['walkOps', { action: 'create', parkId: 'p1', startAt: 'iso', dogIds: ['d1'], note: 'n', maxDogs: 4 }],
      ['walkOps', { action: 'list', parkId: 'p1', date: '2026-09-16' }],
      ['walkOps', { action: 'list' }],
      ['walkOps', { action: 'get', walkId: 'w1' }],
      ['walkOps', { action: 'join', walkId: 'w1', dogIds: ['d1'] }],
      ['walkOps', { action: 'decide', memberId: 'm1', approve: true }],
      ['walkOps', { action: 'leave', walkId: 'w1' }],
      ['walkOps', { action: 'cancel', walkId: 'w1' }],
      ['walkOps', { action: 'message', walkId: 'w1', text: 'hi' }],
    ]);
  });

  test('uploadFile / downloadFile 走 wx.cloud 的存储接口', async () => {
    const up = withWx(
      { uploadFile: (o) => o.success({ fileID: 'cloud://x/' + o.cloudPath }) },
      () => api.uploadFile('dogs/a.jpg', '/tmp/a.jpg')
    );
    await expect(up).resolves.toBe('cloud://x/dogs/a.jpg');
    const down = withWx(
      { downloadFile: (o) => o.success({ tempFilePath: '/tmp/' + o.fileID }) },
      () => api.downloadFile('f1')
    );
    await expect(down).resolves.toBe('/tmp/f1');
    const bad = withWx({ uploadFile: (o) => o.fail({ errMsg: 'nope' }) }, () => api.uploadFile('p', 'f'));
    await expect(bad).rejects.toMatchObject({ code: 'INTERNAL', message: 'nope' });
  });
});
