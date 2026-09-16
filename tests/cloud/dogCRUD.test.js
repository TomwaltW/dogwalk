/**
 * tests/cloud/dogCRUD.test.js —— owner: T6(第二轮改到契约 v2)
 *
 * 验收 B1(spec 2.2):
 *   ① create 接受 tags / vaccinated / licenseNo 并返回带 _id 的 Dog
 *   ② tags 含非法值返回 INVALID_PARAM
 *   ③ checkText 对 name 返回 false 时返回 CONTENT_RISKY 且 msg === 'name',库里没有新文档
 *   ④ update 他人的狗返回 FORBIDDEN
 *
 * 另覆盖 spec 3.3.2 的可写字段白名单、3.4 的失败面,以及校验顺序
 * 归属 → 字段合法 → 内容安全(任何一步不过都不写库)。
 */

const core = require('../../cloudfunctions/dogCRUD/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL, TAGS, LIMITS } = require('../../cloudfunctions/_shared/contracts');

const NOW_MS = new Date(DEFAULT_NOW).getTime();

/** dogs 文档的字段全集 —— spec 3.2.2(12 个可写字段 + 服务端自己的 6 个) */
const DOG_DOC_KEYS = [
  '_id',
  'ownerOpenid',
  'name',
  'avatarFileID',
  'breed',
  'gender',
  'birthMonth',
  'sizeClass',
  'neutered',
  'vaccinated',
  'licenseNo',
  'tags',
  'tagCode',
  'qrFileID',
  'lostMode',
  'lostNote',
  'createdAt',
  'updatedAt',
].sort();

/** 造一个 ctx;openid 默认为已登录用户 o1 */
function setup(opts) {
  const o = opts || {};
  return makeTestCtx({
    seed: o.seed || {},
    openid: o.openid === undefined ? 'o1' : o.openid,
    risky: o.risky,
    riskyImages: o.riskyImages,
  });
}

/** 一只各字段都合法的狗(契约 v2);传 patch 覆盖其中几项 */
function makeDog(patch) {
  return Object.assign(
    {
      name: '旺财',
      breed: '柯基',
      sizeClass: 'medium',
      birthMonth: '2024-03',
      gender: 'male',
      neutered: true,
      vaccinated: true,
      licenseNo: 'HZ-2024-0001',
      tags: ['ball', 'calm'],
      avatarFileID: '',
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
      lostNote: '',
      createdAt: new Date('2026-08-01T10:00:00+08:00'),
      updatedAt: new Date('2026-08-01T10:00:00+08:00'),
    },
    patch || {}
  );
}

describe('dogCRUD: create', () => {
  test('① create 接受 tags / vaccinated / licenseNo,返回带 _id 的 Dog', async () => {
    const { ctx, dump } = setup();
    const r = await core(
      {
        action: 'create',
        dog: makeDog({ tags: ['ball', 'fearsBig'], vaccinated: true, licenseNo: 'HZ-777' }),
      },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(typeof r.data._id).toBe('string');
    expect(r.data._id.length).toBeGreaterThan(0);
    expect(r.data).toMatchObject({
      name: '旺财',
      sizeClass: 'medium',
      ownerOpenid: 'o1',
      tags: ['ball', 'fearsBig'],
      vaccinated: true,
      licenseNo: 'HZ-777',
    });
    expect(dump(COLL.DOGS)).toHaveLength(1);
    expect(dump(COLL.DOGS)[0]._id).toBe(r.data._id);
  });

  test('create 补齐 v2 默认字段,时间取自 ctx.now()', async () => {
    const { ctx } = setup();
    const r = await core(
      { action: 'create', dog: { name: '旺财', sizeClass: 'small', gender: 'female' } },
      ctx
    );

    expect(r.data).toMatchObject({
      breed: '',
      birthMonth: '',
      avatarFileID: '',
      neutered: false,
      vaccinated: false,
      licenseNo: '',
      tags: [],
      lostMode: false,
      lostNote: '',
      tagCode: '',
      qrFileID: '',
    });
    expect(r.data.createdAt.getTime()).toBe(NOW_MS);
    expect(r.data.updatedAt.getTime()).toBe(NOW_MS);
  });

  test('落库文档的字段恰好是 spec 3.2.2 的 dogs,客户端塞来的野字段一律丢掉', async () => {
    const { ctx, dump } = setup();
    const r = await core(
      { action: 'create', dog: makeDog({ whatever: ['chase'], legacyFlag: false }) },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(Object.keys(dump(COLL.DOGS)[0]).sort()).toEqual(DOG_DOC_KEYS);
    expect(Object.keys(r.data).sort()).toEqual(DOG_DOC_KEYS);
  });

  test('create 忽略客户端塞来的 ownerOpenid / _id / tagCode,不给冒名与抢码', async () => {
    const { ctx } = setup();
    const r = await core(
      { action: 'create', dog: makeDog({ _id: 'forged', ownerOpenid: 'o2', tagCode: 'abc123' }) },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(r.data.ownerOpenid).toBe('o1');
    expect(r.data._id).not.toBe('forged');
    expect(r.data.tagCode).toBe('');
  });

  test('create 不带 dog 返回 INVALID_PARAM dog', async () => {
    const { ctx } = setup();
    const r = await core({ action: 'create' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dog' });
  });

  test('必填仍是 name / sizeClass / gender,各报自己的字段名', async () => {
    const { ctx } = setup();

    for (const k of ['name', 'sizeClass', 'gender']) {
      const dog = makeDog();
      delete dog[k];
      await expect(core({ action: 'create', dog }, ctx)).resolves.toMatchObject({
        code: 'INVALID_PARAM',
        msg: k,
      });
    }
  });
});

describe('dogCRUD: 字段校验(spec 3.3.2 的 12 个可写字段)', () => {
  test('② tags 含非法值返回 INVALID_PARAM,库里没有新文档', async () => {
    const { ctx, dump } = setup();
    const r = await core({ action: 'create', dog: makeDog({ tags: ['ball', 'bite'] }) }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'tags' });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('tags 不是数组也报 tags;合法值就是 TAGS 全集', async () => {
    const { ctx } = setup();

    await expect(
      core({ action: 'create', dog: makeDog({ tags: 'ball' }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'tags' });

    const r = await core({ action: 'create', dog: makeDog({ tags: TAGS.slice() }) }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data.tags).toEqual(TAGS);
  });

  test('tags 重复值落库前去重', async () => {
    const { ctx, dump } = setup();
    const r = await core(
      { action: 'create', dog: makeDog({ tags: ['ball', 'ball', 'shy', 'ball'] }) },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(r.data.tags).toEqual(['ball', 'shy']);
    expect(dump(COLL.DOGS)[0].tags).toEqual(['ball', 'shy']);
  });

  test('name 长度按码位数算:12 个 emoji 合法,13 个不合法', async () => {
    const { ctx } = setup();

    const ok12 = '🐶'.repeat(12);
    expect(ok12.length).toBe(24); // UTF-16 长度是 24,码位数才是 12
    expect(Array.from(ok12).length).toBe(LIMITS.NAME_MAX);

    await expect(
      core({ action: 'create', dog: makeDog({ name: ok12 }) }, ctx)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      core({ action: 'create', dog: makeDog({ name: '🐶'.repeat(13) }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'name' });
  });

  test('name 空 / 纯空白 / 非字符串都报 name', async () => {
    const { ctx } = setup();

    for (const name of ['', '   ', 123, null]) {
      await expect(
        core({ action: 'create', dog: makeDog({ name }) }, ctx)
      ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'name' });
    }
  });

  test('breed ≤ 20 / licenseNo ≤ 32 / lostNote ≤ 50,超一位就报自己的字段名', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog()] } });

    const cases = [
      ['breed', LIMITS.BREED_MAX],
      ['licenseNo', LIMITS.LICENSE_MAX],
      ['lostNote', LIMITS.LOST_NOTE_MAX],
    ];
    for (const [field, max] of cases) {
      await expect(
        core({ action: 'update', dogId: 'd1', dog: { [field]: '字'.repeat(max) } }, ctx)
      ).resolves.toMatchObject({ ok: true });
      await expect(
        core({ action: 'update', dogId: 'd1', dog: { [field]: '字'.repeat(max + 1) } }, ctx)
      ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: field });
    }
  });

  test('sizeClass / gender / birthMonth 非法各报自己的字段名', async () => {
    const { ctx, dump } = setup();

    await expect(
      core({ action: 'create', dog: makeDog({ sizeClass: 'huge' }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'sizeClass' });
    await expect(
      core({ action: 'create', dog: makeDog({ gender: 'unknown' }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'gender' });
    await expect(
      core({ action: 'create', dog: makeDog({ birthMonth: '2024/03' }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'birthMonth' });
    await expect(
      core({ action: 'create', dog: makeDog({ birthMonth: '2024-13' }) }, ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'birthMonth' });
    await expect(
      core({ action: 'create', dog: makeDog({ birthMonth: '' }) }, ctx)
    ).resolves.toMatchObject({ ok: true });

    expect(dump(COLL.DOGS)).toHaveLength(1); // 只有最后那条合法的进了库
  });

  test('neutered / vaccinated / lostMode 必须是 Boolean', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog()] } });

    for (const k of ['neutered', 'vaccinated', 'lostMode']) {
      await expect(
        core({ action: 'update', dogId: 'd1', dog: { [k]: 'yes' } }, ctx)
      ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: k });
      await expect(
        core({ action: 'update', dogId: 'd1', dog: { [k]: 1 } }, ctx)
      ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: k });
    }
  });
});

describe('dogCRUD: 内容安全(spec 3.3.1 / 3.4)', () => {
  test('③ checkText 对 name 返回 false 时 CONTENT_RISKY + msg name,库里没有新文档', async () => {
    const { ctx, dump } = setup({ risky: ['脏话'] });
    const r = await core({ action: 'create', dog: makeDog({ name: '脏话狗' }) }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: 'name' });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('breed / licenseNo / lostNote 各自报自己的字段名,且不写库', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] }, risky: ['脏话'] });

    for (const field of ['breed', 'licenseNo', 'lostNote']) {
      const r = await core({ action: 'update', dogId: 'd1', dog: { [field]: '脏话' } }, ctx);
      expect(r).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: field });
    }
    expect(dump(COLL.DOGS)[0].breed).toBe('柯基');
    expect(dump(COLL.DOGS)[0].updatedAt.getTime()).not.toBe(NOW_MS);
  });

  test('这次没给的字段不去查内容安全:库里有脏词也能改别的字段', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog({ breed: '脏话犬' })] }, risky: ['脏话'] });
    const r = await core({ action: 'update', dogId: 'd1', dog: { neutered: false } }, ctx);

    expect(r.ok).toBe(true);
  });

  test('avatarFileID 变化且非空时走 checkImage,不通过报 avatarFileID', async () => {
    const { ctx, dump } = setup({ riskyImages: ['cloud://bad.png'] });
    const r = await core(
      { action: 'create', dog: makeDog({ avatarFileID: 'cloud://bad.png' }) },
      ctx
    );

    expect(r).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: 'avatarFileID' });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('avatarFileID 与库里现有的相同就不重复送审', async () => {
    const { ctx } = setup({
      seed: { dogs: [seededDog({ avatarFileID: 'cloud://bad.png' })] },
      riskyImages: ['cloud://bad.png'],
    });

    const same = await core(
      { action: 'update', dogId: 'd1', dog: { avatarFileID: 'cloud://bad.png' } },
      ctx
    );
    expect(same.ok).toBe(true);

    const changed = await core(
      { action: 'update', dogId: 'd1', dog: { avatarFileID: 'cloud://bad2.png' } },
      ctx
    );
    expect(changed.ok).toBe(true); // bad2 不在 riskyImages 里
  });

  test('avatarFileID 清空(空串)不送审', async () => {
    const { ctx } = setup({
      seed: { dogs: [seededDog({ avatarFileID: 'cloud://a.png' })] },
      riskyImages: [''],
    });
    const r = await core({ action: 'update', dogId: 'd1', dog: { avatarFileID: '' } }, ctx);

    expect(r.ok).toBe(true);
  });

  test('校验顺序:字段非法先于内容安全,内容安全后于归属', async () => {
    const risky = ['脏话'];

    // 字段非法 + 内容有风险 → 先报 INVALID_PARAM
    const a = setup({ risky });
    await expect(
      core({ action: 'create', dog: makeDog({ name: '脏话狗', sizeClass: 'huge' }) }, a.ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'sizeClass' });

    // 别人的狗 + 内容有风险 → 先报 FORBIDDEN
    const b = setup({ seed: { dogs: [seededDog({ ownerOpenid: 'o2' })] }, risky });
    await expect(
      core({ action: 'update', dogId: 'd1', dog: { name: '脏话狗' } }, b.ctx)
    ).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('dogCRUD: update', () => {
  test('④ update 他人的狗返回 FORBIDDEN,库里不变', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog({ ownerOpenid: 'o2' })] } });
    const r = await core({ action: 'update', dogId: 'd1', dog: { name: '被改名' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.DOGS)[0].name).toBe('旺财');
  });

  test('他人的狗即使字段非法也先报 FORBIDDEN,不泄露校验结果', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog({ ownerOpenid: 'o2' })] } });
    const r = await core({ action: 'update', dogId: 'd1', dog: { sizeClass: 'huge' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('update 自己的狗改字段并刷新 updatedAt,createdAt 不动', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core(
      { action: 'update', dogId: 'd1', dog: { name: '大黄', tags: ['shy'] } },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ _id: 'd1', name: '大黄', tags: ['shy'], breed: '柯基' });
    expect(r.data.updatedAt.getTime()).toBe(NOW_MS);
    expect(dump(COLL.DOGS)[0].createdAt.getTime()).toBe(
      new Date('2026-08-01T10:00:00+08:00').getTime()
    );
  });

  test('走失模式:api.setLostMode 的形状(update {_id, lostMode, lostNote})', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core(
      { action: 'update', dog: { _id: 'd1', lostMode: true, lostNote: '在西湖边走丢,谢谢' } },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(dump(COLL.DOGS)[0]).toMatchObject({
      lostMode: true,
      lostNote: '在西湖边走丢,谢谢',
    });
  });

  test('update 不改 ownerOpenid / tagCode / qrFileID', async () => {
    const { ctx, dump } = setup({
      seed: { dogs: [seededDog({ tagCode: 'ab12cd', qrFileID: 'cloud://q.png' })] },
    });
    const r = await core(
      {
        action: 'update',
        dogId: 'd1',
        dog: { ownerOpenid: 'o2', tagCode: 'zzz999', qrFileID: '' },
      },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(dump(COLL.DOGS)[0]).toMatchObject({
      ownerOpenid: 'o1',
      tagCode: 'ab12cd',
      qrFileID: 'cloud://q.png',
    });
  });

  test('update 自己的狗字段非法返回 INVALID_PARAM,库里不变', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core({ action: 'update', dogId: 'd1', dog: { sizeClass: 'huge' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'sizeClass' });
    expect(dump(COLL.DOGS)[0].sizeClass).toBe('medium');
  });

  test('update 不存在的狗返回 NOT_FOUND dogs', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core({ action: 'update', dogId: 'nope', dog: { name: '大黄' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('update 不给 dogId 返回 INVALID_PARAM dogId', async () => {
    const { ctx } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core({ action: 'update', dog: { name: '大黄' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'dogId' });
  });
});

describe('dogCRUD: get / listMine / remove', () => {
  test('get 自己的狗返回整条,get 他人的狗返回 FORBIDDEN', async () => {
    const { ctx } = setup({
      seed: { dogs: [seededDog(), seededDog({ _id: 'd2', ownerOpenid: 'o2' })] },
    });

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
    const { ctx } = setup();
    const r = await core({ action: 'get', dogId: 'nope' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('listMine 只返回自己的狗,按 createdAt 升序', async () => {
    const { ctx } = setup({
      seed: {
        dogs: [
          seededDog({ _id: 'd1', createdAt: new Date('2026-03-01') }),
          seededDog({ _id: 'd2', ownerOpenid: 'o2', createdAt: new Date('2026-01-01') }),
          seededDog({ _id: 'd3', createdAt: new Date('2026-02-01') }),
        ],
      },
    });
    const r = await core({ action: 'listMine' }, ctx);

    expect(r.ok).toBe(true);
    expect(r.data.map((d) => d._id)).toEqual(['d3', 'd1']);
  });

  test('listMine 一条都没有时返回空数组而不是报错', async () => {
    const { ctx } = setup();
    const r = await core({ action: 'listMine' }, ctx);

    expect(r).toEqual({ ok: true, data: [] });
  });

  test('remove 自己的狗返回 { removed:true } 并真的删掉', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] } });
    const r = await core({ action: 'remove', dogId: 'd1' }, ctx);

    expect(r).toEqual({ ok: true, data: { removed: true } });
    expect(dump(COLL.DOGS)).toHaveLength(0);
  });

  test('remove 他人的狗返回 FORBIDDEN,狗还在', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog({ ownerOpenid: 'o2' })] } });
    const r = await core({ action: 'remove', dogId: 'd1' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.DOGS)).toHaveLength(1);
  });
});

describe('dogCRUD: 失败面', () => {
  test('未带 openid 时任何 action 都返回 AUTH_REQUIRED', async () => {
    const { ctx, dump } = setup({ seed: { dogs: [seededDog()] }, openid: '' });

    for (const action of ['create', 'update', 'get', 'listMine', 'remove']) {
      const r = await core({ action, dogId: 'd1', dog: makeDog() }, ctx);
      expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    }
    expect(dump(COLL.DOGS)).toHaveLength(1);
  });

  test('action 缺失或不认识返回 INVALID_PARAM action', async () => {
    const { ctx } = setup();

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
    const { ctx, calls } = setup();
    ctx.db = {
      collection() {
        throw new Error('db is down');
      },
    };

    const r = await core({ action: 'listMine' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(calls.errors.length).toBeGreaterThan(0);
  });
});
