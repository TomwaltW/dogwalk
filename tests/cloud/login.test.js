/**
 * tests/cloud/login.test.js —— owner: T6(第二轮改到契约 v2)
 *
 * 对应 spec 3.2.2 users、3.3.2 login、3.4。
 * 派工包 T6-d 要求覆盖:login 新建的 users 文档有 subTemplates,
 * 且字段集合恰好是 spec 3.2.2 的那几个 —— 第一轮「关注固定点位」留下的字段
 * 连同 spots 集合一起废弃了(spec 0 节),整键集断言能一并钉住它不再出现。
 * subTemplates 是本轮新增的模板 id 账本(spec 9 节假设 10)。
 */

const core = require('../../cloudfunctions/login/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const NOW_MS = new Date(DEFAULT_NOW).getTime();

/** 造一个 ctx;openid 默认为已登录用户 o1 */
function setup(seed, openid) {
  return makeTestCtx({ seed: seed || {}, openid: openid === undefined ? 'o1' : openid });
}

/** 库里已有的一条 users 文档(契约 v2 字段) */
function seededUser(over) {
  return Object.assign(
    {
      _id: 'o1',
      _openid: 'o1',
      nickname: '老昵称',
      avatarFileID: 'cloud://old.png',
      subQuota: { foundReport: 3 },
      subTemplates: { foundReport: 'tpl-old' },
      status: 'normal',
      createdAt: new Date('2026-08-01T10:00:00+08:00'),
      updatedAt: new Date('2026-08-01T10:00:00+08:00'),
    },
    over || {}
  );
}

describe('login: 首次调用', () => {
  test('首次调用创建 users 文档,_id 即 _openid', async () => {
    const { ctx, dump } = setup({});
    const r = await core({}, ctx);

    expect(r.ok).toBe(true);
    expect(dump(COLL.USERS)).toHaveLength(1);

    const row = dump(COLL.USERS)[0];
    expect(row._id).toBe('o1');
    expect(row._openid).toBe('o1');
    expect(r.data.user._openid).toBe('o1');
  });

  test('新建的 users 文档有 subTemplates 与 subQuota 两本账,都从空开始', async () => {
    const { ctx, dump } = setup({});
    const r = await core({}, ctx);

    const row = dump(COLL.USERS)[0];
    expect(row.subTemplates).toEqual({});
    expect(row.subQuota).toEqual({});
    expect(r.data.user.subTemplates).toEqual({});
  });

  test('新建的 users 文档字段恰好是 spec 3.2.2 的那些,第一轮的字段一个不留', async () => {
    const { ctx, dump } = setup({});
    await core({}, ctx);

    const row = dump(COLL.USERS)[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        '_id',
        '_openid',
        'avatarFileID',
        'createdAt',
        'nickname',
        'status',
        'subQuota',
        'subTemplates',
        'updatedAt',
      ].sort()
    );
    expect(row).toMatchObject({ nickname: '', avatarFileID: '', status: 'normal' });
    expect(row.createdAt.getTime()).toBe(NOW_MS);
    expect(row.updatedAt.getTime()).toBe(NOW_MS);
  });

  test('带 profile 时写入昵称与头像', async () => {
    const { ctx, dump } = setup({});
    const r = await core({ profile: { nickname: '狗子他爸', avatarFileID: 'cloud://a.png' } }, ctx);

    expect(r.ok).toBe(true);
    expect(dump(COLL.USERS)[0].nickname).toBe('狗子他爸');
    expect(dump(COLL.USERS)[0].avatarFileID).toBe('cloud://a.png');
    expect(r.data.user.nickname).toBe('狗子他爸');
  });

  test('返回自己的狗,别人的狗不返回', async () => {
    const { ctx } = setup({
      dogs: [
        { _id: 'd1', ownerOpenid: 'o1', name: '旺财', createdAt: new Date('2026-01-01') },
        { _id: 'd2', ownerOpenid: 'o2', name: '来福', createdAt: new Date('2026-01-02') },
        { _id: 'd3', ownerOpenid: 'o1', name: '大黄', createdAt: new Date('2026-01-03') },
      ],
    });
    const r = await core({}, ctx);

    expect(r.data.dogs.map((d) => d._id)).toEqual(['d1', 'd3']);
  });

  test('一条狗都没有时返回空数组,不报错', async () => {
    const { ctx } = setup({});
    const r = await core({}, ctx);

    expect(r.ok).toBe(true);
    expect(r.data.dogs).toEqual([]);
  });
});

describe('login: 二次调用', () => {
  test('二次调用不重复创建,返回同一 _openid', async () => {
    const { ctx, dump } = setup({});

    const first = await core({}, ctx);
    const second = await core({}, ctx);

    expect(dump(COLL.USERS)).toHaveLength(1);
    expect(second.ok).toBe(true);
    expect(second.data.user._openid).toBe(first.data.user._openid);
    expect(second.data.user._id).toBe(first.data.user._id);
  });

  test('已有用户再登录不覆盖 createdAt / subQuota / subTemplates', async () => {
    const { ctx, dump } = setup({ users: [seededUser()] });

    const r = await core({ profile: { nickname: '新昵称', avatarFileID: 'cloud://b.png' } }, ctx);
    const row = dump(COLL.USERS)[0];

    expect(dump(COLL.USERS)).toHaveLength(1);
    expect(row.createdAt.getTime()).toBe(new Date('2026-08-01T10:00:00+08:00').getTime());
    expect(row.subQuota).toEqual({ foundReport: 3 });
    expect(row.subTemplates).toEqual({ foundReport: 'tpl-old' });
    expect(row.nickname).toBe('新昵称');
    expect(row.updatedAt.getTime()).toBe(NOW_MS);
    expect(r.data.user.nickname).toBe('新昵称');
  });

  test('不带 profile 的二次调用不改昵称', async () => {
    const { ctx, dump } = setup({ users: [seededUser()] });

    await core({}, ctx);

    expect(dump(COLL.USERS)[0].nickname).toBe('老昵称');
    expect(dump(COLL.USERS)[0].avatarFileID).toBe('cloud://old.png');
  });

  test('老用户文档里的历史残留字段不去动它(TΩ2 统一清)', async () => {
    const { ctx, dump } = setup({ users: [seededUser({ legacyLeftover: ['s1'] })] });

    await core({}, ctx);

    expect(dump(COLL.USERS)[0].legacyLeftover).toEqual(['s1']);
  });
});

describe('login: 失败面', () => {
  test('未带 openid 时返回 { ok:false, code:AUTH_REQUIRED }', async () => {
    const { ctx, dump } = setup({}, '');
    const r = await core({}, ctx);

    expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(dump(COLL.USERS)).toHaveLength(0);
  });

  test('profile 昵称超 20 字符返回 INVALID_PARAM nickname,且不建文档', async () => {
    const { ctx, dump } = setup({});
    const r = await core({ profile: { nickname: 'x'.repeat(21), avatarFileID: '' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'nickname' });
    expect(dump(COLL.USERS)).toHaveLength(0);
  });

  test('profile 不是对象返回 INVALID_PARAM profile', async () => {
    const { ctx } = setup({});
    const r = await core({ profile: 'me' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'profile' });
  });

  test('event 缺省也能走通,不抛异常', async () => {
    const { ctx } = setup({});
    await expect(core(undefined, ctx)).resolves.toMatchObject({ ok: true });
  });

  test('db 挂掉时返回 INTERNAL 而不是抛给调用方', async () => {
    const { ctx, calls } = setup({});
    ctx.db = {
      collection() {
        throw new Error('db is down');
      },
    };

    const r = await core({}, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(calls.errors.length).toBeGreaterThan(0);
  });
});
