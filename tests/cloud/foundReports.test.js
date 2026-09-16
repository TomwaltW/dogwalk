/**
 * tests/cloud/foundReports.test.js —— owner: T6(第二轮新增)
 *
 * 主人看自己狗的寻回留言。spec 3.3.2 foundReports、3.2.3 FoundReport、3.4。
 * 派工包 T6-d 要求覆盖:非主人查留言 FORBIDDEN。
 */

const core = require('../../cloudfunctions/foundReports/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

const OWNER = 'o-owner';

/** FoundReport 的字段全集 —— spec 3.2.3 */
const REPORT_KEYS = ['createdAt', 'latitude', 'longitude', 'message', 'reportId'];

function makeDog(over) {
  return Object.assign(
    { _id: 'd1', ownerOpenid: OWNER, name: '豆豆', tagCode: 'ab12cd', lostMode: true },
    over
  );
}

function makeReport(over) {
  return Object.assign(
    {
      _id: 'r1',
      dogId: 'd1',
      tagCode: 'ab12cd',
      message: '在文三路看到它',
      latitude: null,
      longitude: null,
      reporterOpenid: '',
      notified: false,
      createdAt: new Date('2026-09-15T09:00:00+08:00'),
    },
    over
  );
}

function setup(opts) {
  const o = opts || {};
  return makeTestCtx({
    seed: o.seed || { dogs: [makeDog()], found_reports: [makeReport()] },
    openid: o.openid === undefined ? OWNER : o.openid,
  });
}

describe('foundReports: 主人查留言', () => {
  test('返回 FoundReport 列表,key 恰好是 spec 3.2.3 的 5 个', async () => {
    const { ctx } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(Object.keys(res.data[0]).sort()).toEqual(REPORT_KEYS);
    expect(res.data[0]).toEqual({
      reportId: 'r1',
      message: '在文三路看到它',
      latitude: null,
      longitude: null,
      createdAt: new Date('2026-09-15T09:00:00+08:00').toISOString(),
    });
  });

  test('createdAt 转成 ISO 字符串,不是 Date', async () => {
    const { ctx } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(typeof res.data[0].createdAt).toBe('string');
    expect(res.data[0].createdAt).toBe('2026-09-15T01:00:00.000Z');
  });

  test('带坐标的留言原样带出;缺坐标的补 null 而不是 undefined', async () => {
    const { ctx } = setup({
      seed: {
        dogs: [makeDog()],
        found_reports: [
          makeReport({ _id: 'r1', latitude: 30.2741, longitude: 120.1551 }),
          makeReport({
            _id: 'r2',
            latitude: undefined,
            longitude: undefined,
            createdAt: new Date('2026-09-14T09:00:00+08:00'),
          }),
        ],
      },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    const byId = Object.fromEntries(res.data.map((r) => [r.reportId, r]));
    expect(byId.r1).toMatchObject({ latitude: 30.2741, longitude: 120.1551 });
    expect(byId.r2.latitude).toBeNull();
    expect(byId.r2.longitude).toBeNull();
  });

  test('按 createdAt 倒序,只看自己这只狗的', async () => {
    const { ctx } = setup({
      seed: {
        dogs: [makeDog(), makeDog({ _id: 'd2' })],
        found_reports: [
          makeReport({ _id: 'old', createdAt: new Date('2026-09-10T09:00:00+08:00') }),
          makeReport({ _id: 'new', createdAt: new Date('2026-09-16T09:00:00+08:00') }),
          makeReport({ _id: 'mid', createdAt: new Date('2026-09-12T09:00:00+08:00') }),
          makeReport({ _id: 'other-dog', dogId: 'd2' }),
        ],
      },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.data.map((r) => r.reportId)).toEqual(['new', 'mid', 'old']);
  });

  test('最多 50 条,取最新的 50 条', async () => {
    const reports = [];
    for (let i = 0; i < 60; i += 1) {
      reports.push(
        makeReport({
          _id: 'r' + i,
          createdAt: new Date(new Date('2026-09-01T00:00:00+08:00').getTime() + i * 60000),
        })
      );
    }
    const { ctx } = setup({ seed: { dogs: [makeDog()], found_reports: reports } });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.data).toHaveLength(50);
    expect(res.data[0].reportId).toBe('r59');
    expect(res.data[49].reportId).toBe('r10');
  });

  test('一条留言都没有时返回空数组', async () => {
    const { ctx } = setup({ seed: { dogs: [makeDog()], found_reports: [] } });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res).toEqual({ ok: true, data: [] });
  });

  test('不漏出 reporterOpenid / notified / tagCode 这些内部字段', async () => {
    const { ctx } = setup({
      seed: {
        dogs: [makeDog()],
        found_reports: [makeReport({ reporterOpenid: 'o-passerby', notified: true })],
      },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    ['reporterOpenid', 'notified', 'tagCode', 'dogId', '_id'].forEach((k) =>
      expect(res.data[0]).not.toHaveProperty(k)
    );
  });
});

describe('foundReports: 失败面(spec 3.4)', () => {
  test('非主人查留言 → FORBIDDEN', async () => {
    const { ctx } = setup({ openid: 'o-someone-else' });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(res).not.toHaveProperty('data');
  });

  test('游客调用 → AUTH_REQUIRED', async () => {
    const { ctx } = setup({ openid: '' });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res).toEqual({ ok: false, code: 'AUTH_REQUIRED', msg: 'AUTH_REQUIRED' });
  });

  test('dogId 缺失 / 不是字符串 → INVALID_PARAM dogId', async () => {
    const { ctx } = setup();

    await expect(core({}, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
    await expect(core({ dogId: 123 }, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
    await expect(core(undefined, ctx)).resolves.toMatchObject({
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
  });

  test('狗不存在 → NOT_FOUND dogs', async () => {
    const { ctx } = setup();
    const res = await core({ dogId: 'nope' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });
});
