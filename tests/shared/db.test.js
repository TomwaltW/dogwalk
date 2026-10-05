/**
 * _shared/db.js getAll —— 服务端 get() 不带 limit 最多回 100 条,getAll 要分页取全。
 * 另钉住 fake-db 与真实库对齐的两处行为:默认 100 条上限、唯一索引。
 */

const { getAll } = require('../../cloudfunctions/_shared/db');
const { createFakeDb } = require('../fakes/fake-db');
const walkOps = require('../../cloudfunctions/walkOps/core');
const { makeTestCtx } = require('../fakes/cloud-ctx');

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({ _id: 'r' + i, n: i }));
}

describe('fake-db 对齐真实库', () => {
  test('get() 不带 limit 最多回 100 条', async () => {
    const { db } = createFakeDb({ t: rows(250) });
    expect((await db.collection('t').get()).data).toHaveLength(100);
    expect((await db.collection('t').limit(150).get()).data).toHaveLength(150);
  });

  test('唯一索引:add / update 撞值就 reject,缺字段按 null 算', async () => {
    const { db } = createFakeDb({}, { unique: { dogs: ['tagCode'] } });
    await db.collection('dogs').add({ data: { tagCode: '' } });
    await expect(db.collection('dogs').add({ data: { tagCode: '' } })).rejects.toThrow(/duplicate/);

    await db.collection('dogs').add({ data: { name: 'x' } });
    await expect(db.collection('dogs').add({ data: { name: 'y' } })).rejects.toThrow(/duplicate/);

    const { _id } = await db.collection('dogs').add({ data: { tagCode: 'abc123' } });
    await expect(db.collection('dogs').doc(_id).update({ data: { tagCode: '' } })).rejects.toThrow(
      /duplicate/
    );
    expect((await db.collection('dogs').doc(_id).get()).data.tagCode).toBe('abc123'); // 没写进去
  });
});

describe('getAll', () => {
  test('分页取全,顺序按 orderBy', async () => {
    const { db } = createFakeDb({ t: rows(250) });
    const r = await getAll(db.collection('t').where({}).orderBy('n', 'desc'));
    expect(r.data).toHaveLength(250);
    expect(r.data[0].n).toBe(249);
    expect(r.data[249].n).toBe(0);
  });

  test('正好 100 条与空集合都不出错', async () => {
    expect((await getAll(createFakeDb({ t: rows(100) }).db.collection('t').where({}))).data).toHaveLength(100);
    expect((await getAll(createFakeDb({}).db.collection('t').where({}))).data).toHaveLength(0);
  });
});

describe('walkOps list:成员行超过 100 条时 dogCount 不少算', () => {
  test('60 场约遛各 2 位已批准成员(120 行)', async () => {
    const start = new Date('2026-09-16T19:00:00+08:00');
    const walks = [];
    const members = [];
    for (let i = 0; i < 60; i += 1) {
      walks.push({ _id: 'w' + i, hostOpenid: 'h', parkId: 'p1', startAt: start, dogIds: ['dh'],
        note: '', maxDogs: 5, status: 'open', createdAt: start, updatedAt: start });
      for (let j = 0; j < 2; j += 1) {
        members.push({ _id: 'm' + i + '_' + j, walkId: 'w' + i, openid: 'u' + j, dogIds: ['x' + j],
          status: 'approved', createdAt: start, updatedAt: start });
      }
    }
    const { ctx } = makeTestCtx({
      openid: 'viewer',
      seed: { walks, walk_members: members, parks: [{ _id: 'p1', name: 'P', active: true }],
        dogs: [{ _id: 'dh', ownerOpenid: 'h', name: '狗', sizeClass: 'small', tags: [] }] },
    });

    const r = await walkOps({ action: 'list' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(60);
    r.data.forEach((w) => expect(w.dogCount).toBe(3)); // 1 只 host 狗 + 2 位成员各 1 只
  });
});
