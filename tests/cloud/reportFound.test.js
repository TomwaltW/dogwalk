/**
 * tests/cloud/reportFound.test.js —— owner: T6(第二轮新增)
 *
 * 验收 B3(spec 2.2):
 *   ① 游客可留言、落库
 *   ② 主人有额度且有模板 id 时 calls.subscribe 长度 1、额度减 1、notified:true
 *   ③ 额度为 0 时不调 send、notified:false、返回 ok
 *   ④ send 抛错时不扣额度、notified:false、返回 ok
 *   ⑤ checkText 为 false 时 CONTENT_RISKY 且不落库
 *
 * 落库形状见 spec 3.2.2 found_reports;通知口径见 3.3.2 与 3.4。
 */

const core = require('../../cloudfunctions/reportFound/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL, TEMPLATE_KEYS, LIMITS } = require('../../cloudfunctions/_shared/contracts');

const NOW = new Date(DEFAULT_NOW);
const KEY = TEMPLATE_KEYS.FOUND_REPORT;
const OWNER = 'o-owner';

function makeDog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: OWNER,
      name: '豆豆',
      breed: '柯基',
      sizeClass: 'small',
      birthMonth: '2023-04',
      gender: 'male',
      neutered: true,
      vaccinated: true,
      licenseNo: '',
      tags: [],
      avatarFileID: '',
      tagCode: 'ab12cd',
      qrFileID: '',
      lostMode: true,
      lostNote: '走丢了',
      createdAt: NOW,
      updatedAt: NOW,
    },
    over
  );
}

function makeOwner(over) {
  return Object.assign(
    {
      _id: OWNER,
      _openid: OWNER,
      nickname: '豆豆爸',
      avatarFileID: '',
      subQuota: { [KEY]: 1 },
      subTemplates: { [KEY]: 'tpl-found-001' },
      status: 'normal',
      createdAt: NOW,
      updatedAt: NOW,
    },
    over
  );
}

/** 默认:一只走失的狗 + 一个有额度有模板 id 的主人;调用者是游客 */
function setup(opts) {
  const o = opts || {};
  return makeTestCtx({
    seed: o.seed || { dogs: [makeDog()], users: [makeOwner()] },
    openid: o.openid === undefined ? '' : o.openid,
    risky: o.risky,
    openapi: o.openapi,
  });
}

const EVENT = { tagCode: 'ab12cd', message: '在文三路看到它,拴在便利店门口' };

describe('reportFound: 留言落库', () => {
  test('① 游客可留言,落库形状按 spec 3.2.2', async () => {
    const { ctx, dump } = setup();
    const res = await core(EVENT, ctx);

    expect(res.ok).toBe(true);
    expect(typeof res.data.reportId).toBe('string');
    expect(res.data.reportId.length).toBeGreaterThan(0);

    const rows = dump(COLL.FOUND_REPORTS);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        '_id',
        'createdAt',
        'dogId',
        'latitude',
        'longitude',
        'message',
        'notified',
        'reporterOpenid',
        'tagCode',
      ].sort()
    );
    expect(rows[0]).toMatchObject({
      _id: res.data.reportId,
      dogId: 'd1',
      tagCode: 'ab12cd',
      message: EVENT.message,
      latitude: null,
      longitude: null,
      reporterOpenid: '', // 游客写空串,不是 null / undefined
    });
    expect(rows[0].createdAt).toEqual(NOW);
  });

  test('登录用户留言时记下 reporterOpenid', async () => {
    const { ctx, dump } = setup({ openid: 'o-passerby' });
    await core(EVENT, ctx);

    expect(dump(COLL.FOUND_REPORTS)[0].reporterOpenid).toBe('o-passerby');
  });

  test('路人自愿附带坐标时原样落库', async () => {
    const { ctx, dump } = setup();
    await core(Object.assign({ latitude: 30.2741, longitude: 120.1551 }, EVENT), ctx);

    expect(dump(COLL.FOUND_REPORTS)[0]).toMatchObject({
      latitude: 30.2741,
      longitude: 120.1551,
    });
  });

  test('留言里不落任何主人字段', async () => {
    const { ctx, dump } = setup();
    await core(EVENT, ctx);

    const json = JSON.stringify(dump(COLL.FOUND_REPORTS)[0]);
    expect(json).not.toContain(OWNER);
    expect(json).not.toContain('豆豆爸');
  });
});

describe('reportFound: 订阅消息通知(spec 3.3.2 / 3.4)', () => {
  test('② 有额度且有模板 id:send 被调一次、额度减 1、notified 为 true', async () => {
    const { ctx, calls, dump } = setup({
      seed: { dogs: [makeDog()], users: [makeOwner({ subQuota: { [KEY]: 2 } })] },
    });
    const res = await core(EVENT, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.notified).toBe(true);
    expect(calls.subscribe).toHaveLength(1);
    expect(dump(COLL.USERS)[0].subQuota[KEY]).toBe(1);
    expect(dump(COLL.FOUND_REPORTS)[0].notified).toBe(true);
  });

  test('send 的 payload 按 spec 3.3.2:touser / template_id / page / data 三个字段', async () => {
    const { ctx, calls } = setup();
    await core(EVENT, ctx);

    expect(calls.subscribe[0]).toEqual({
      touser: OWNER,
      template_id: 'tpl-found-001',
      page: 'pages/dog/tag/tag?dogId=d1',
      data: {
        thing1: { value: '豆豆' },
        thing2: { value: '在文三路看到它,拴在便利店门口'.slice(0, 20) },
        time3: { value: '2026-09-16 10:00' }, // 东八区,ctx.now() 缺省值
      },
    });
  });

  test('留言只带前 20 字进模板,按码位数截', async () => {
    const long = '字'.repeat(30);
    const { ctx, calls } = setup();
    await core({ tagCode: 'ab12cd', message: long }, ctx);

    expect(Array.from(calls.subscribe[0].data.thing2.value)).toHaveLength(20);
  });

  test('③ 额度为 0:不调 send、notified:false、仍返回 ok 且落库', async () => {
    const { ctx, calls, dump } = setup({
      seed: { dogs: [makeDog()], users: [makeOwner({ subQuota: { [KEY]: 0 } })] },
    });
    const res = await core(EVENT, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.notified).toBe(false);
    expect(calls.subscribe).toHaveLength(0);
    expect(calls.errors).toHaveLength(0); // 额度为 0 不是错误
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(1);
    expect(dump(COLL.FOUND_REPORTS)[0].notified).toBe(false);
  });

  test('没记过模板 id:不调 send、notified:false、不报错', async () => {
    const { ctx, calls } = setup({
      seed: {
        dogs: [makeDog()],
        users: [makeOwner({ subQuota: { [KEY]: 5 }, subTemplates: {} })],
      },
    });
    const res = await core(EVENT, ctx);

    expect(res).toMatchObject({ ok: true, data: { notified: false } });
    expect(calls.subscribe).toHaveLength(0);
    expect(calls.errors).toHaveLength(0);
  });

  test('主人的 users 文档不存在:当没额度处理,不报错', async () => {
    const { ctx, calls } = setup({ seed: { dogs: [makeDog()], users: [] } });
    const res = await core(EVENT, ctx);

    expect(res).toMatchObject({ ok: true, data: { notified: false } });
    expect(calls.subscribe).toHaveLength(0);
  });

  test('④ send 抛错:记 logger.error、不扣额度、notified:false、主流程仍 ok', async () => {
    const sent = [];
    const { ctx, calls, dump } = setup({
      openapi: {
        subscribeMessage: {
          async send(payload) {
            sent.push(payload);
            throw new Error('subscribe send failed');
          },
        },
      },
    });
    const res = await core(EVENT, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.notified).toBe(false);
    expect(sent).toHaveLength(1);
    expect(calls.errors.length).toBeGreaterThan(0);
    expect(dump(COLL.USERS)[0].subQuota[KEY]).toBe(1); // 没扣
    expect(dump(COLL.FOUND_REPORTS)[0].notified).toBe(false);
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(1); // 留言照样留下
  });

  test('非走失态的狗也能留言并通知 —— 扫到牌就能联系主人', async () => {
    const { ctx, calls } = setup({
      seed: { dogs: [makeDog({ lostMode: false, lostNote: '' })], users: [makeOwner()] },
    });
    const res = await core(EVENT, ctx);

    expect(res.data.notified).toBe(true);
    expect(calls.subscribe).toHaveLength(1);
  });
});

describe('reportFound: 内容安全与失败面(spec 3.4)', () => {
  test('⑤ checkText 为 false:CONTENT_RISKY + msg message,且不落库不通知', async () => {
    const { ctx, calls, dump } = setup({ risky: ['脏话'] });
    const res = await core({ tagCode: 'ab12cd', message: '脏话脏话' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'CONTENT_RISKY', msg: 'message' });
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(0);
    expect(calls.subscribe).toHaveLength(0);
  });

  test('tagCode 格式非法 → INVALID_PARAM tagCode', async () => {
    const { ctx, dump } = setup();

    for (const tagCode of [undefined, '', 'ab12c', 'AB12CD', 'ab_2cd', 123]) {
      await expect(core({ tagCode, message: '看到了' }, ctx)).resolves.toMatchObject({
        code: 'INVALID_PARAM',
        msg: 'tagCode',
      });
    }
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(0);
  });

  test('message 为空 / 超 200 字 / 非字符串 → INVALID_PARAM message', async () => {
    const { ctx } = setup();

    for (const message of ['', '   ', '字'.repeat(LIMITS.FOUND_MSG_MAX + 1), 42, undefined]) {
      await expect(core({ tagCode: 'ab12cd', message }, ctx)).resolves.toMatchObject({
        code: 'INVALID_PARAM',
        msg: 'message',
      });
    }
    await expect(
      core({ tagCode: 'ab12cd', message: '字'.repeat(LIMITS.FOUND_MSG_MAX) }, ctx)
    ).resolves.toMatchObject({ ok: true });
  });

  test('坐标只给一半 → INVALID_PARAM,报缺的那个', async () => {
    const { ctx, dump } = setup();

    await expect(
      core(Object.assign({ latitude: 30.27 }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'longitude' });
    await expect(
      core(Object.assign({ longitude: 120.15 }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'latitude' });
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(0);
  });

  test('坐标越界 / 不是有限数 → INVALID_PARAM,报出错的那个', async () => {
    const { ctx } = setup();

    await expect(
      core(Object.assign({ latitude: 91, longitude: 120.15 }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'latitude' });
    await expect(
      core(Object.assign({ latitude: 30.27, longitude: 181 }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'longitude' });
    await expect(
      core(Object.assign({ latitude: 30.27, longitude: '120' }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'longitude' });
    await expect(
      core(Object.assign({ latitude: NaN, longitude: 120.15 }, EVENT), ctx)
    ).resolves.toMatchObject({ code: 'INVALID_PARAM', msg: 'latitude' });
  });

  test('tagCode 查不到狗 → NOT_FOUND dogs,不落库', async () => {
    const { ctx, dump } = setup();
    const res = await core({ tagCode: 'zzzz99', message: '看到了' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
    expect(dump(COLL.FOUND_REPORTS)).toHaveLength(0);
  });

  test('event 缺省不抛异常', async () => {
    const { ctx } = setup();
    await expect(core(undefined, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'tagCode',
    });
  });
});
