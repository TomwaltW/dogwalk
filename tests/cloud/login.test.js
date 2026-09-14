/**
 * tests/cloud/login.test.js —— owner: T1
 *
 * 验收 B1(spec 2.2):
 *   ① 首次调用创建 users 文档
 *   ② 二次调用不重复创建,返回同一 _openid
 *   ③ 未带 openid 时返回 { ok:false, code:'AUTH_REQUIRED' }
 */

const core = require('../../cloudfunctions/login/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-14T19:30:00+08:00';

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

describe('login: 首次调用', () => {
  test('首次调用创建 users 文档,_id 即 _openid', async () => {
    const { ctx, dump } = makeCtx({});
    const r = await core({}, ctx);

    expect(r.ok).toBe(true);
    expect(dump(COLL.USERS)).toHaveLength(1);

    const row = dump(COLL.USERS)[0];
    expect(row._id).toBe('o1');
    expect(row._openid).toBe('o1');
    expect(r.data.user._openid).toBe('o1');
  });

  test('新建的 users 文档字段齐全,时间取自 ctx.now()', async () => {
    const { ctx, dump } = makeCtx({});
    await core({}, ctx);

    const row = dump(COLL.USERS)[0];
    expect(row).toMatchObject({
      nickname: '',
      avatarFileID: '',
      followSpotIds: [],
      subQuota: {},
      status: 'normal',
    });
    expect(row.createdAt.getTime()).toBe(new Date(NOW_ISO).getTime());
    expect(row.updatedAt.getTime()).toBe(new Date(NOW_ISO).getTime());
  });

  test('带 profile 时写入昵称与头像', async () => {
    const { ctx, dump } = makeCtx({});
    const r = await core({ profile: { nickname: '狗子他爸', avatarFileID: 'cloud://a.png' } }, ctx);

    expect(r.ok).toBe(true);
    expect(dump(COLL.USERS)[0].nickname).toBe('狗子他爸');
    expect(dump(COLL.USERS)[0].avatarFileID).toBe('cloud://a.png');
    expect(r.data.user.nickname).toBe('狗子他爸');
  });

  test('返回自己的狗,别人的狗不返回', async () => {
    const { ctx } = makeCtx({
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
    const { ctx } = makeCtx({});
    const r = await core({}, ctx);

    expect(r.ok).toBe(true);
    expect(r.data.dogs).toEqual([]);
  });
});

describe('login: 二次调用', () => {
  test('二次调用不重复创建,返回同一 _openid', async () => {
    const { ctx, dump } = makeCtx({});

    const first = await core({}, ctx);
    const second = await core({}, ctx);

    expect(dump(COLL.USERS)).toHaveLength(1);
    expect(second.ok).toBe(true);
    expect(second.data.user._openid).toBe(first.data.user._openid);
    expect(second.data.user._id).toBe(first.data.user._id);
  });

  test('已有用户再登录不覆盖 createdAt / followSpotIds / subQuota', async () => {
    const created = new Date('2026-08-01T10:00:00+08:00');
    const { ctx, dump } = makeCtx({
      users: [
        {
          _id: 'o1',
          _openid: 'o1',
          nickname: '老昵称',
          avatarFileID: '',
          followSpotIds: ['s1'],
          subQuota: { checkin: 3 },
          status: 'normal',
          createdAt: created,
          updatedAt: created,
        },
      ],
    });

    const r = await core({ profile: { nickname: '新昵称', avatarFileID: 'cloud://b.png' } }, ctx);
    const row = dump(COLL.USERS)[0];

    expect(dump(COLL.USERS)).toHaveLength(1);
    expect(row.createdAt.getTime()).toBe(created.getTime());
    expect(row.followSpotIds).toEqual(['s1']);
    expect(row.subQuota).toEqual({ checkin: 3 });
    expect(row.nickname).toBe('新昵称');
    expect(row.updatedAt.getTime()).toBe(new Date(NOW_ISO).getTime());
    expect(r.data.user.nickname).toBe('新昵称');
  });

  test('不带 profile 的二次调用不改昵称', async () => {
    const { ctx, dump } = makeCtx({
      users: [
        {
          _id: 'o1',
          _openid: 'o1',
          nickname: '老昵称',
          avatarFileID: 'cloud://old.png',
          followSpotIds: [],
          subQuota: {},
          status: 'normal',
          createdAt: new Date('2026-08-01T10:00:00+08:00'),
          updatedAt: new Date('2026-08-01T10:00:00+08:00'),
        },
      ],
    });

    await core({}, ctx);

    expect(dump(COLL.USERS)[0].nickname).toBe('老昵称');
    expect(dump(COLL.USERS)[0].avatarFileID).toBe('cloud://old.png');
  });
});

describe('login: 失败面', () => {
  test('未带 openid 时返回 { ok:false, code:AUTH_REQUIRED }', async () => {
    const { ctx, dump } = makeCtx({}, '');
    const r = await core({}, ctx);

    expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(dump(COLL.USERS)).toHaveLength(0);
  });

  test('profile 昵称超 20 字符返回 INVALID_PARAM nickname,且不建文档', async () => {
    const { ctx, dump } = makeCtx({});
    const r = await core({ profile: { nickname: 'x'.repeat(21), avatarFileID: '' } }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'nickname' });
    expect(dump(COLL.USERS)).toHaveLength(0);
  });

  test('profile 不是对象返回 INVALID_PARAM profile', async () => {
    const { ctx } = makeCtx({});
    const r = await core({ profile: 'me' }, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INVALID_PARAM', msg: 'profile' });
  });

  test('event 缺省也能走通,不抛异常', async () => {
    const { ctx } = makeCtx({});
    await expect(core(undefined, ctx)).resolves.toMatchObject({ ok: true });
  });

  test('db 挂掉时返回 INTERNAL 而不是抛给调用方', async () => {
    const { ctx } = makeCtx({});
    ctx.db = {
      collection() {
        throw new Error('db is down');
      },
    };

    const r = await core({}, ctx);

    expect(r).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
