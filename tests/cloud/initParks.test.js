/**
 * tests/cloud/initParks.test.js —— owner: T7
 *
 * 验收 B4(spec 2.2):
 *   ① 空库调用插入 3 条,返回 {inserted:3,total:3}
 *   ② 再调一次返回 {inserted:0,total:3}
 *   ③ 3 条都有 latitude / longitude / radiusM / active:true
 *
 * 另覆盖 spec 3.4 的 AUTH_REQUIRED,与「seed.js 是纯数据」这条部署约束(spec 3.3.1)。
 */

const fs = require('fs');
const path = require('path');

const core = require('../../cloudfunctions/initParks/core');
const { PARKS } = require('../../cloudfunctions/initParks/seed');
const { makeTestCtx } = require('../fakes/cloud-ctx');
const { COLL } = require('../../cloudfunctions/_shared/contracts');

describe('initParks —— 公园种子数据,幂等', () => {
  test('未登录返回 AUTH_REQUIRED,且一条都不插', async () => {
    const { ctx, dump } = makeTestCtx({ openid: '' });
    const r = await core({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('AUTH_REQUIRED');
    expect(dump(COLL.PARKS)).toHaveLength(0);
  });

  test('空库调用插入 3 条,返回 {inserted:3,total:3}', async () => {
    const { ctx, dump } = makeTestCtx({ openid: 'o1' });
    const r = await core({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ inserted: 3, total: 3 });
    expect(dump(COLL.PARKS)).toHaveLength(3);
  });

  test('3 条公园都有 latitude / longitude / radiusM / active:true', async () => {
    const { ctx, dump } = makeTestCtx({ openid: 'o1' });
    await core({}, ctx);
    const parks = dump(COLL.PARKS);
    expect(parks).toHaveLength(3);
    parks.forEach((p) => {
      expect(typeof p.latitude).toBe('number');
      expect(Number.isFinite(p.latitude)).toBe(true);
      expect(typeof p.longitude).toBe('number');
      expect(Number.isFinite(p.longitude)).toBe(true);
      expect(typeof p.radiusM).toBe('number');
      expect(p.radiusM).toBeGreaterThan(0);
      expect(p.active).toBe(true);
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    });
    // spec 3.2.2 parks 的字段就这 6 个,别顺手加 createdAt 之类的
    parks.forEach((p) => {
      expect(Object.keys(p).sort()).toEqual(
        ['_id', 'active', 'latitude', 'longitude', 'name', 'radiusM'].sort()
      );
    });
  });

  test('再调一次返回 {inserted:0,total:3},库里仍是 3 条', async () => {
    const { ctx, dump } = makeTestCtx({ openid: 'o1' });
    await core({}, ctx);
    const again = await core({}, ctx);
    expect(again.ok).toBe(true);
    expect(again.data).toEqual({ inserted: 0, total: 3 });
    expect(dump(COLL.PARKS)).toHaveLength(3);
  });

  test('_id 固定:两次种下的 _id 集合一致,不会生成随机 id', async () => {
    const first = makeTestCtx({ openid: 'o1' });
    await core({}, first.ctx);
    const second = makeTestCtx({ openid: 'o2' });
    await core({}, second.ctx);

    const ids = (d) => d(COLL.PARKS).map((p) => p._id).sort();
    expect(ids(first.dump)).toEqual(ids(second.dump));
    expect(ids(first.dump)).toEqual(PARKS.map((p) => p._id).sort());
    ids(first.dump).forEach((id) => expect(id.startsWith('fake_')).toBe(false));
  });

  test('parks 非空时什么都不插,哪怕只有 1 条', async () => {
    const seeded = { _id: 'park_x', name: '已有公园', latitude: 30.2, longitude: 120.1, radiusM: 100, active: true };
    const { ctx, dump } = makeTestCtx({ openid: 'o1', seed: { [COLL.PARKS]: [seeded] } });
    const r = await core({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ inserted: 0, total: 1 });
    expect(dump(COLL.PARKS)).toHaveLength(1);
  });

  test('event 为 undefined / null 也不炸', async () => {
    const a = makeTestCtx({ openid: 'o1' });
    expect((await core(undefined, a.ctx)).ok).toBe(true);
    const b = makeTestCtx({ openid: 'o1' });
    expect((await core(null, b.ctx)).ok).toBe(true);
  });

  test('seed.js 是纯数据,不 require 任何东西(部署脚本只重写 core.js / index.js)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/initParks/seed.js'), 'utf8');
    expect(src.indexOf('require(')).toBe(-1);
    expect(Array.isArray(PARKS)).toBe(true);
    expect(PARKS).toHaveLength(3);
  });
});
