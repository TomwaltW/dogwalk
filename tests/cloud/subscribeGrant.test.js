/**
 * tests/cloud/subscribeGrant.test.js —— owner: T6(第二轮新增)
 *
 * 用户在前端 wx.requestSubscribeMessage 里同意一次,就记一条额度 + 记下模板 id
 * (spec 9 节假设 10:所有要填的模板 id 只在 miniprogram/config.js 一处)。
 *
 * 派工包 T6-a 要求覆盖:
 *   同一 key 连调两次 remaining 为 2;非法 key 返回 INVALID_PARAM。
 */

const core = require('../../cloudfunctions/subscribeGrant/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL, TEMPLATE_KEYS } = require('../../cloudfunctions/_shared/contracts');

const NOW = new Date(DEFAULT_NOW);
const KEY = TEMPLATE_KEYS.FOUND_REPORT;
const ME = 'o1';

function makeUser(over) {
  return Object.assign(
    {
      _id: ME,
      _openid: ME,
      nickname: '我',
      avatarFileID: '',
      subQuota: {},
      subTemplates: {},
      status: 'normal',
      createdAt: NOW,
      updatedAt: NOW,
    },
    over
  );
}

function setup(opts) {
  const o = opts || {};
  return makeTestCtx({
    seed: o.seed || { users: [makeUser()] },
    openid: o.openid === undefined ? ME : o.openid,
  });
}

describe('subscribeGrant: 记额度', () => {
  test('同一 key 连调两次,remaining 为 2', async () => {
    const { ctx, dump } = setup();

    const first = await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);
    const second = await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);

    expect(first).toEqual({ ok: true, data: { remaining: 1 } });
    expect(second).toEqual({ ok: true, data: { remaining: 2 } });
    expect(dump(COLL.USERS)[0].subQuota[KEY]).toBe(2);
  });

  test('记下模板 id;重复授权覆盖成最新的那个', async () => {
    const { ctx, dump } = setup();

    await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);
    await core({ templateKey: KEY, templateId: 'tpl-002' }, ctx);

    expect(dump(COLL.USERS)[0].subTemplates[KEY]).toBe('tpl-002');
  });

  test('在已有额度上累加,不覆盖', async () => {
    const { ctx, dump } = setup({
      seed: { users: [makeUser({ subQuota: { [KEY]: 3 } })] },
    });
    const res = await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);

    expect(res.data.remaining).toBe(4);
    expect(dump(COLL.USERS)[0].subQuota[KEY]).toBe(4);
  });

  test('只动这个 key,用户的其他字段不受影响', async () => {
    const { ctx, dump } = setup({
      seed: { users: [makeUser({ nickname: '豆豆爸', subQuota: { other: 7 } })] },
    });
    await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);

    const row = dump(COLL.USERS)[0];
    expect(row.nickname).toBe('豆豆爸');
    expect(row.subQuota).toEqual({ other: 7, [KEY]: 1 });
    expect(row.createdAt).toEqual(NOW);
  });
});

describe('subscribeGrant: 失败面(spec 3.4)', () => {
  test('非法 templateKey → INVALID_PARAM templateKey,库里不动', async () => {
    const { ctx, dump } = setup();

    for (const templateKey of ['notAKey', '', undefined, 123, 'FOUND_REPORT']) {
      await expect(core({ templateKey, templateId: 'tpl-001' }, ctx)).resolves.toMatchObject({
        ok: false,
        code: 'INVALID_PARAM',
        msg: 'templateKey',
      });
    }
    expect(dump(COLL.USERS)[0].subQuota).toEqual({});
  });

  test('合法 key 就是 TEMPLATE_KEYS 的值(不是它的属性名)', async () => {
    const { ctx } = setup();

    for (const key of Object.values(TEMPLATE_KEYS)) {
      await expect(core({ templateKey: key, templateId: 'tpl-001' }, ctx)).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  test('templateId 为空 / 非字符串 → INVALID_PARAM templateId', async () => {
    const { ctx, dump } = setup();

    for (const templateId of ['', '   ', undefined, 123, null]) {
      await expect(core({ templateKey: KEY, templateId }, ctx)).resolves.toMatchObject({
        ok: false,
        code: 'INVALID_PARAM',
        msg: 'templateId',
      });
    }
    expect(dump(COLL.USERS)[0].subQuota).toEqual({});
  });

  test('游客调用 → AUTH_REQUIRED', async () => {
    const { ctx } = setup({ openid: '' });
    const res = await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);

    expect(res).toEqual({ ok: false, code: 'AUTH_REQUIRED', msg: 'AUTH_REQUIRED' });
  });

  test('没点过登录(users 文档不存在)也记得上额度:按 login 的形状建档', async () => {
    const { ctx, dump } = setup({ seed: { users: [] } });
    const res = await core({ templateKey: KEY, templateId: 'tpl-001' }, ctx);

    expect(res).toEqual({ ok: true, data: { remaining: 1 } });
    const users = dump(COLL.USERS);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      _id: ctx.openid,
      _openid: ctx.openid,
      status: 'normal',
      subQuota: { [KEY]: 1 },
      subTemplates: { [KEY]: 'tpl-001' },
    });

    // 之后再点登录,额度原样保留
    const login = require('../../cloudfunctions/login/core');
    const lr = await login({}, ctx);
    expect(lr.ok).toBe(true);
    expect(lr.data.user.subQuota[KEY]).toBe(1);
    expect(dump(COLL.USERS)).toHaveLength(1);
  });

  test('event 缺省不抛异常', async () => {
    const { ctx } = setup();
    await expect(core(undefined, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'templateKey',
    });
  });
});
