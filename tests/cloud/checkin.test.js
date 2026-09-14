/**
 * tests/cloud/checkin.test.js —— owner: T2
 *
 * 对应 spec 2.2 B3:
 *   ① 广播写入后 expireAt - startAt === 90*60*1000
 *   ② 同一用户在同一点位已有 active 广播时再发返回 code:'CONFLICT'
 */

const core = require('../../cloudfunctions/checkin/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');

const NOW_ISO = '2026-09-14T19:30:00+08:00';
const NOW = new Date(NOW_ISO);
const at = (ms) => new Date(NOW.getTime() + ms);
const TPL = core.TEMPLATE_KEY;

function seedData() {
  return {
    [COLL.SPOTS]: [
      {
        _id: 's1',
        name: '中心花园南侧草坪',
        communityId: 'c1',
        wxGroupQrFileID: 'f-qr',
        peakHint: '工作日 19:30-20:30',
        regularCount: 12,
        active: true,
      },
      { _id: 's2', name: '河堤步道', communityId: 'c1', wxGroupQrFileID: '', peakHint: '', regularCount: 3, active: true },
    ],
    [COLL.DOGS]: [
      { _id: 'd1', ownerOpenid: 'o1', name: '旺财', sizeClass: 'small', socialOk: true },
      { _id: 'd2', ownerOpenid: 'o1', name: '来福', sizeClass: 'large', socialOk: true },
      { _id: 'd3', ownerOpenid: 'o2', name: '二黑', sizeClass: 'medium', socialOk: true },
    ],
    [COLL.USERS]: [
      { _id: 'o1', _openid: 'o1', nickname: '阿甲', followSpotIds: ['s1'], subQuota: { [TPL]: 5 }, status: 'normal' },
      { _id: 'o2', _openid: 'o2', nickname: '阿乙', followSpotIds: ['s1'], subQuota: { [TPL]: 2 }, status: 'normal' },
      { _id: 'o3', _openid: 'o3', nickname: '阿丙', followSpotIds: ['s1'], subQuota: { [TPL]: 0 }, status: 'normal' },
      { _id: 'o4', _openid: 'o4', nickname: '阿丁', followSpotIds: ['s2'], subQuota: { [TPL]: 9 }, status: 'normal' },
      { _id: 'o5', _openid: 'o5', nickname: '阿戊', followSpotIds: ['s1'], subQuota: { [TPL]: 9 }, status: 'banned' },
    ],
    [COLL.CHECKINS]: [],
  };
}

function makeCtx(over) {
  const o = over || {};
  const { db, _, dump } = createFakeDb(o.seed || seedData());
  const send = o.send || jest.fn().mockResolvedValue({ errCode: 0 });
  const logger = { info: jest.fn(), error: jest.fn() };
  return {
    ctx: {
      db,
      _,
      openid: o.openid === undefined ? 'o1' : o.openid,
      now: fixedClock(o.nowIso || NOW_ISO),
      openapi: { subscribeMessage: { send } },
      logger,
    },
    dump,
    send,
    logger,
  };
}

const EVENT = { spotId: 's1', dogIds: ['d1'], startAt: NOW.toISOString(), note: '' };
const ev = (patch) => Object.assign({}, EVENT, patch);

describe('checkin —— 写入与有效期(B3①)', () => {
  test('B3①: 广播写入后 expireAt - startAt === 90*60*1000', async () => {
    const { ctx, dump } = makeCtx();
    const res = await core(ev(), ctx);

    expect(res.ok).toBe(true);
    const rows = dump(COLL.CHECKINS);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(new Date(row.expireAt).getTime() - new Date(row.startAt).getTime()).toBe(90 * 60 * 1000);
    expect(new Date(row.expireAt).getTime() - new Date(row.startAt).getTime()).toBe(CHECKIN_DURATION_MS);
    // 返回给前端的 expireAt 是同一时刻的 ISO8601
    expect(res.data.expireAt).toBe(at(CHECKIN_DURATION_MS).toISOString());
    expect(res.data.checkinId).toBe(row._id);
  });

  test('落库文档形状符合 spec 3.2 checkins', async () => {
    const { ctx, dump } = makeCtx();
    await core(ev({ dogIds: ['d1', 'd2'], note: '在南门' }), ctx);
    const row = dump(COLL.CHECKINS)[0];
    expect(row).toMatchObject({
      openid: 'o1',
      spotId: 's1',
      dogIds: ['d1', 'd2'],
      note: '在南门',
      status: 'active',
    });
    expect(row.startAt).toBeInstanceOf(Date);
    expect(row.expireAt).toBeInstanceOf(Date);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBe(NOW.getTime());
  });

  test('expireAt 以 event.startAt 为基准,不是以 now 为基准', async () => {
    const { ctx, dump } = makeCtx();
    const startAt = at(30 * 60 * 1000);
    await core(ev({ startAt: startAt.toISOString() }), ctx);
    const row = dump(COLL.CHECKINS)[0];
    expect(row.expireAt.getTime()).toBe(startAt.getTime() + CHECKIN_DURATION_MS);
  });

  test('dogIds 去重后落库', async () => {
    const { ctx, dump } = makeCtx();
    await core(ev({ dogIds: ['d1', 'd1', 'd2'] }), ctx);
    expect(dump(COLL.CHECKINS)[0].dogIds).toEqual(['d1', 'd2']);
  });

  test('note 省略时落库为空串', async () => {
    const { ctx, dump } = makeCtx();
    const e = ev();
    delete e.note;
    await core(e, ctx);
    expect(dump(COLL.CHECKINS)[0].note).toBe('');
  });
});

describe('checkin —— 重复广播冲突(B3②)', () => {
  test('B3②: 同一用户在同一点位已有 active 广播时再发返回 code:CONFLICT', async () => {
    const { ctx, dump } = makeCtx();
    const first = await core(ev(), ctx);
    expect(first.ok).toBe(true);

    const second = await core(ev(), ctx);
    expect(second).toEqual({ ok: false, code: 'CONFLICT', msg: 'active checkin exists' });
    expect(dump(COLL.CHECKINS)).toHaveLength(1);
  });

  test('换一个点位不算冲突', async () => {
    const { ctx, dump } = makeCtx();
    await core(ev(), ctx);
    const res = await core(ev({ spotId: 's2' }), ctx);
    expect(res.ok).toBe(true);
    expect(dump(COLL.CHECKINS)).toHaveLength(2);
  });

  test('换一个人不算冲突', async () => {
    // 同一个 ctx 换 openid,才是同一份库里的两个人
    const { ctx, dump } = makeCtx();
    await core(ev(), ctx);
    ctx.openid = 'o2';
    const res = await core(ev({ dogIds: ['d3'] }), ctx);
    expect(res.ok).toBe(true);
    expect(dump(COLL.CHECKINS).map((c) => c.openid)).toEqual(['o1', 'o2']);
  });

  test('已取消的旧广播不算冲突', async () => {
    const seed = seedData();
    seed[COLL.CHECKINS] = [
      { _id: 'old', openid: 'o1', spotId: 's1', dogIds: ['d1'], startAt: at(-1000), expireAt: at(CHECKIN_DURATION_MS), note: '', status: 'cancelled' },
    ];
    const { ctx } = makeCtx({ seed });
    const res = await core(ev(), ctx);
    expect(res.ok).toBe(true);
  });

  test('已过期的旧广播不算冲突;边界上 expireAt === now 也算过期', async () => {
    const seed = seedData();
    seed[COLL.CHECKINS] = [
      { _id: 'old', openid: 'o1', spotId: 's1', dogIds: ['d1'], startAt: at(-CHECKIN_DURATION_MS), expireAt: NOW, note: '', status: 'active' },
    ];
    const { ctx } = makeCtx({ seed });
    const res = await core(ev(), ctx);
    expect(res.ok).toBe(true);
  });
});

describe('checkin —— 失败面(spec 3.4)', () => {
  test('未登录返回 AUTH_REQUIRED', async () => {
    const { ctx, dump } = makeCtx({ openid: '' });
    expect(await core(ev(), ctx)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(dump(COLL.CHECKINS)).toHaveLength(0);
  });

  test.each([
    ['spotId', { spotId: '' }],
    ['dogIds', { dogIds: [] }],
    ['dogIds', { dogIds: 'd1' }],
    ['startAt', { startAt: 'yesterday' }],
    ['startAt', { startAt: undefined }],
    ['note', { note: 'x'.repeat(31) }],
  ])('非法入参返回 INVALID_PARAM,msg 是字段名 %s', async (field, patch) => {
    const { ctx, dump } = makeCtx();
    expect(await core(ev(patch), ctx)).toEqual({ ok: false, code: 'INVALID_PARAM', msg: field });
    expect(dump(COLL.CHECKINS)).toHaveLength(0);
  });

  test('note 恰好 30 字符可以通过', async () => {
    const { ctx } = makeCtx();
    expect((await core(ev({ note: 'x'.repeat(30) }), ctx)).ok).toBe(true);
  });

  test('点位不存在返回 NOT_FOUND spots', async () => {
    const { ctx } = makeCtx();
    expect(await core(ev({ spotId: 'nope' }), ctx)).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.SPOTS });
  });

  test('狗不存在返回 NOT_FOUND dogs', async () => {
    const { ctx } = makeCtx();
    expect(await core(ev({ dogIds: ['ghost'] }), ctx)).toEqual({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('带上别人的狗返回 FORBIDDEN', async () => {
    const { ctx, dump } = makeCtx();
    expect(await core(ev({ dogIds: ['d1', 'd3'] }), ctx)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.CHECKINS)).toHaveLength(0);
  });
});

describe('checkin —— 订阅消息与 notified 计数(spec 3.4)', () => {
  test('只通知关注本点位的人,不通知自己,notified 为实际发出条数', async () => {
    const { ctx, send } = makeCtx();
    const res = await core(ev(), ctx);

    expect(res.ok).toBe(true);
    // s1 的关注者:o1(自己,跳过) o2(有额度) o3(额度 0) o5(封禁);o4 关注的是 s2
    expect(res.data.notified).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].touser).toBe('o2');
  });

  test('额度为 0 的用户不报错、只是不计入 notified,也不被扣成负数', async () => {
    const { ctx, dump, send } = makeCtx();
    const res = await core(ev(), ctx);

    expect(res.ok).toBe(true);
    const users = dump(COLL.USERS);
    const o3 = users.find((u) => u._id === 'o3');
    expect(o3.subQuota[TPL]).toBe(0);
    expect(send.mock.calls.every((c) => c[0].touser !== 'o3')).toBe(true);
  });

  test('发送成功后扣减该用户的订阅额度', async () => {
    const { ctx, dump } = makeCtx();
    await core(ev(), ctx);
    const o2 = dump(COLL.USERS).find((u) => u._id === 'o2');
    expect(o2.subQuota[TPL]).toBe(1);
  });

  test('openapi 调用失败只记 logger.error,主流程照常返回 ok', async () => {
    const send = jest.fn().mockRejectedValue(new Error('openapi down'));
    const { ctx, dump, logger } = makeCtx({ send });
    const res = await core(ev(), ctx);

    expect(res.ok).toBe(true);
    expect(res.data.notified).toBe(0);
    expect(logger.error).toHaveBeenCalled();
    // 广播本身照样落库,额度不因失败被扣
    expect(dump(COLL.CHECKINS)).toHaveLength(1);
    expect(dump(COLL.USERS).find((u) => u._id === 'o2').subQuota[TPL]).toBe(2);
  });

  test('没有 openapi 可用时也不崩,返回 notified:0', async () => {
    const { ctx } = makeCtx();
    ctx.openapi = null;
    const res = await core(ev(), ctx);
    expect(res.ok).toBe(true);
    expect(res.data.notified).toBe(0);
  });

  test('没有关注者时 notified 为 0', async () => {
    const seed = seedData();
    seed[COLL.USERS] = seed[COLL.USERS].map((u) => Object.assign({}, u, { followSpotIds: [] }));
    const { ctx, send } = makeCtx({ seed });
    const res = await core(ev(), ctx);
    expect(res.data.notified).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
