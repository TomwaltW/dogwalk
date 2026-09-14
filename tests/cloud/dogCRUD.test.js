/**
 * tests/cloud/dogCRUD.test.js —— owner: T1
 *
 * 验收 B2(spec 2.2):
 *   ① create 返回带 _id 的 dog
 *   ② update 他人的狗返回 code:'FORBIDDEN'
 *   ③ sizeClass 传非法值返回 code:'INVALID_PARAM'
 *
 * 另覆盖 get / listMine / remove 三个 action 与 spec 3.4 的失败面。
 */

const core = require('../../cloudfunctions/dogCRUD/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-14T19:30:00+08:00';
const NOW_MS = new Date(NOW_ISO).getTime();

/** 造一个 ctx;openid 默认为已登录用户 o1 */
function makeCtx(seed, openid) {
  const { db, _, dump } = createFakeDb(seed || {});
  return {
    ctx: {
      db,
      _,
      openid: openid === undefined ? 'o1' : openid,
      now: fixedClock(NOW_ISO),
      openapi: {},
      logger: { info: jest.fn(), error: jest.fn() },
    },
    dump,
  };
}

/** 一只各字段都合法的狗;传 patch 覆盖其中几项 */
function makeDog(patch) {
  return Object.assign(
    {
      name: '旺财',
      breed: '柯基',
      sizeClass: 'medium',
      birthMonth: '2024-03',
      gender: 'male',
      neutered: true,
      avatarFileID: '',
      playStyle: ['chase'],
      temperament: ['friendly'],
      okWithSmallDogs: true,
      socialOk: true,
    },
    patch || {}
  );
}

/** 库里已有的一条完整狗文档 */
function seededDog(patch) {
  return Object.assign(
    makeDog(),
    {
      _id: 'd1',
      ownerOpenid: 'o1',
      tagCode: '',
      qrFileID: '',
      lostMode: false,
      createdAt: new Date('2026-08-01T10:00:00+08:00'),
      updatedAt: new Date('2026-08-01T10:00:00+08:00'),
    },
    patch || {}
  );
}

describe('dogCRUD: create', () => {
  test('create 返回带 _id 的 dog', async () => {
    const { ctx, dump } = makeCtx({});
    const r = await core({ action: 'create', dog: makeDog() }, ctx);

    expect(r.ok).toBe(true);
    expect(typeof r.data._id).toBe('string');
    expect(r.data._id.length).toBeGreaterThan(0);
    expect(r.data).toMatchObject({ name: '旺财', sizeClass: 'medium', ownerOpenid: 'o1' });
    expect(dump(COLL.DOGS)).toHaveLength(1);
    expect(dump(COLL.DOGS)[0]._id).toBe(r.data._id);
  });

  test('create 补齐默认字段,时间取自 ctx.now()', async () => {
    const { ctx } = makeCtx({});
    const r = await core({ action: 'create', dog: { name: '旺财', sizeClass: 'small', gender: 'female' } }, ctx);

    expect(r.data).toMatchObject({
      breed: '',
      birthMonth: '',
      avatarFileID: '',
      playStyle: [],
      temperament: [],
      neutered: false,
      okWithSmallDogs: true,
      socialOk: true,
      lostMode: false,
      tagCode: '',
      qrFileID: '',
    });
    expect(r.data.createdAt.getTime()).toBe(NOW_MS);
    expect(r.data.updatedAt.getTime()).toBe(NOW_MS);
  });

  test('create 忽略客户端塞来的 ownerOpenid / _id / tagCode,不给冒名与抢码', async () => {
    const { ctx } = makeCtx({});
    const r = await core(
      { action: 'create', dog: makeDog({ _id: 'forged', ownerOpenid: 'o2', tagCode: 'abc123' }) },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(r.data.ownerOpenid).toBe('o1');
    expect(r.data._id).not.toBe('forged');
    expect(r.data.tagCode).toBe('');
  });

  test('sizeClass 传非法值返回 code:INVALID_PARAM', async () => {
    const { ctx, dump } = makeCtx({});
    const r = await core({ action: 'create', dog: makeDog({ sizeClass: 'huge' }) }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'sizeClass' });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('缺 name / gender 非法 / 名字超 12 字各报自己的字段名', async () => {
    const { ctx } = makeCtx({});

    await expect(core({ action: 'create', dog: makeDog({ name: undefined }) }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'name',
    });
    await expect(core({ action: 'create', dog: makeDog({ name: '一二三四五六七八九十十一十二' }) }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'name',
    });
    await expect(core({ action: 'create', dog: makeDog({ gender: 'unknown' }) }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'gender',
    });
    await expect(core({ action: 'create', dog: makeDog({ playStyle: ['bite'] }) }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'playStyle',
    });
  });

  test('create 不带 dog 返回 INVALID_PARAM dog', async () => {
    const { ctx } = makeCtx({});
    const r = await core({ action: 'create' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dog' });
  });
});

describe('dogCRUD: update', () => {
  test('update 他人的狗返回 code:FORBIDDEN', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog({ ownerOpenid: 'o2' })] });
    const r = await core({ action: 'update', dogId: 'd1', dog: { name: '被改名' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.DOGS)[0].name).toBe('旺财');
  });

  test('他人的狗即使字段非法也先报 FORBIDDEN,不泄露校验结果', async () => {
    const { ctx } = makeCtx({ dogs: [seededDog({ ownerOpenid: 'o2' })] });
    const r = await core({ action: 'update', dogId: 'd1', dog: { sizeClass: 'huge' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('update 自己的狗改字段并刷新 updatedAt,createdAt 不动', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'update', dogId: 'd1', dog: { name: '大黄', socialOk: false } }, ctx);

    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ _id: 'd1', name: '大黄', socialOk: false, breed: '柯基' });
    expect(r.data.updatedAt.getTime()).toBe(NOW_MS);
    expect(dump(COLL.DOGS)[0].createdAt.getTime()).toBe(new Date('2026-08-01T10:00:00+08:00').getTime());
  });

  test('update 走 api.saveDog 的形状:dogId 可以从 dog._id 里取', async () => {
    const { ctx } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'update', dog: { _id: 'd1', name: '大黄' } }, ctx);

    expect(r.ok).toBe(true);
    expect(r.data.name).toBe('大黄');
  });

  test('update 不改 ownerOpenid / tagCode / qrFileID', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog({ tagCode: 'abc123', qrFileID: 'cloud://q.png' })] });
    const r = await core(
      { action: 'update', dogId: 'd1', dog: { ownerOpenid: 'o2', tagCode: 'zzz999', qrFileID: '' } },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(dump(COLL.DOGS)[0]).toMatchObject({
      ownerOpenid: 'o1',
      tagCode: 'abc123',
      qrFileID: 'cloud://q.png',
    });
  });

  test('update 自己的狗字段非法返回 INVALID_PARAM,库里不变', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'update', dogId: 'd1', dog: { sizeClass: 'huge' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'sizeClass' });
    expect(dump(COLL.DOGS)[0].sizeClass).toBe('medium');
  });

  test('update 不存在的狗返回 NOT_FOUND dogs', async () => {
    const { ctx } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'update', dogId: 'nope', dog: { name: '大黄' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('update 不给 dogId 返回 INVALID_PARAM dogId', async () => {
    const { ctx } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'update', dog: { name: '大黄' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dogId' });
  });
});

describe('dogCRUD: get / listMine / remove', () => {
  test('get 自己的狗返回整条,get 他人的狗返回 FORBIDDEN', async () => {
    const { ctx } = makeCtx({ dogs: [seededDog(), seededDog({ _id: 'd2', ownerOpenid: 'o2' })] });

    await expect(core({ action: 'get', dogId: 'd1' }, ctx)).resolves.toMatchObject({
      ok: true,
      data: { _id: 'd1', name: '旺财' },
    });
    await expect(core({ action: 'get', dogId: 'd2' }, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  test('get 不存在的狗返回 NOT_FOUND', async () => {
    const { ctx } = makeCtx({});
    const r = await core({ action: 'get', dogId: 'nope' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('listMine 只返回自己的狗,按 createdAt 升序', async () => {
    const { ctx } = makeCtx({
      dogs: [
        seededDog({ _id: 'd1', createdAt: new Date('2026-03-01') }),
        seededDog({ _id: 'd2', ownerOpenid: 'o2', createdAt: new Date('2026-01-01') }),
        seededDog({ _id: 'd3', createdAt: new Date('2026-02-01') }),
      ],
    });
    const r = await core({ action: 'listMine' }, ctx);

    expect(r.ok).toBe(true);
    expect(r.data.map((d) => d._id)).toEqual(['d3', 'd1']);
  });

  test('listMine 一条都没有时返回空数组而不是报错', async () => {
    const { ctx } = makeCtx({});
    const r = await core({ action: 'listMine' }, ctx);

    expect(r).toEqual({ ok: true, data: [] });
  });

  test('remove 自己的狗返回 { removed:true } 并真的删掉', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog()] });
    const r = await core({ action: 'remove', dogId: 'd1' }, ctx);

    expect(r).toEqual({ ok: true, data: { removed: true } });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('remove 他人的狗返回 FORBIDDEN,狗还在', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog({ ownerOpenid: 'o2' })] });
    const r = await core({ action: 'remove', dogId: 'd1' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.DOGS)).toHaveLength(1);
  });
});

describe('dogCRUD: 失败面', () => {
  test('未带 openid 时任何 action 都返回 AUTH_REQUIRED', async () => {
    const { ctx, dump } = makeCtx({ dogs: [seededDog()] }, '');

    for (const action of ['create', 'update', 'get', 'listMine', 'remove']) {
      const r = await core({ action, dogId: 'd1', dog: makeDog() }, ctx);
      expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    }
    expect(dump(COLL.DOGS)).toHaveLength(1);
  });

  test('action 缺失或不认识返回 INVALID_PARAM action', async () => {
    const { ctx } = makeCtx({});

    await expect(core({}, ctx)).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'action' });
    await expect(core({ action: 'drop' }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'action',
    });
    await expect(core(undefined, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'action',
    });
  });

  test('db 挂掉时返回 INTERNAL 而不是抛给调用方', async () => {
    const { ctx } = makeCtx({});
    ctx.db = {
      collection() {
        throw new Error('db is down');
      },
    };

    const r = await core({ action: 'listMine' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
