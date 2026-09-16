/**
 * scanTag —— owner: T3。对应 spec 2.2 B5、3.2「公开视图 DogPublic」、3.4 游客例外。
 *
 * 覆盖四件事(B5):
 *   ① 扫非走失狗返回公开档案、ownerContact 为 null
 *   ② 走失态走到 resolveOwnerContact 这条门控分支(取值待契约补来源字段)
 *   ③ 每次扫码写入一条 scanLogs
 *   ④ 游客态可调用且 scannerOpenid 为 ''
 */

const core = require('../../cloudfunctions/scanTag/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, TAG_CODE_LENGTH } = require('../../cloudfunctions/_shared/contracts');

const NOW = '2026-09-14T20:00:00+08:00';

/** DogPublic 的字段全集 —— spec 3.2,字段只能少不能多 */
const PUBLIC_KEYS = [
  'avatarFileID',
  'birthMonth',
  'breed',
  'gender',
  'lostMode',
  'name',
  'neutered',
  'okWithSmallDogs',
  'ownerContact',
  'playStyle',
  'sizeClass',
  'temperament',
];

function makeDog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: 'o-owner',
      name: '豆豆',
      breed: '柯基',
      sizeClass: 'small',
      birthMonth: '2023-04',
      gender: 'male',
      neutered: true,
      avatarFileID: 'cloud://avatar.png',
      playStyle: ['chase'],
      temperament: ['friendly'],
      okWithSmallDogs: true,
      socialOk: true,
      tagCode: 'ab12cd',
      qrFileID: 'cloud://qr.png',
      lostMode: false,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
    over
  );
}

function makeOwner(over) {
  return Object.assign(
    {
      _id: 'o-owner',
      _openid: 'o-owner',
      nickname: '豆豆爸',
      avatarFileID: '',
      followSpotIds: [],
      subQuota: {},
      status: 'normal',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
    over
  );
}

function makeCtx(fake, openid) {
  return {
    db: fake.db,
    _: fake._,
    openid: openid === undefined ? 'o-scanner' : openid,
    now: fixedClock(NOW),
    openapi: {},
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

describe('scanTag: 公开档案', () => {
  test('① 扫非走失狗返回公开档案,ownerContact 为 null', async () => {
    const fake = createFakeDb({ dogs: [makeDog()], users: [makeOwner()] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake));

    expect(res.ok).toBe(true);
    expect(res.data.name).toBe('豆豆');
    expect(res.data.breed).toBe('柯基');
    expect(res.data.sizeClass).toBe('small');
    expect(res.data.birthMonth).toBe('2023-04');
    expect(res.data.gender).toBe('male');
    expect(res.data.neutered).toBe(true);
    expect(res.data.avatarFileID).toBe('cloud://avatar.png');
    expect(res.data.playStyle).toEqual(['chase']);
    expect(res.data.temperament).toEqual(['friendly']);
    expect(res.data.okWithSmallDogs).toBe(true);
    expect(res.data.lostMode).toBe(false);
    // 2.2 B5「不含 ownerContact」+ 3.2「否则必须为 null」→ key 在、值为 null
    expect('ownerContact' in res.data).toBe(true);
    expect(res.data.ownerContact).toBeNull();
  });

  test('DogPublic 字段只能少不能多:不漏出 _id / ownerOpenid / tagCode / socialOk / qrFileID / createdAt', async () => {
    const fake = createFakeDb({ dogs: [makeDog()], users: [makeOwner()] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake));

    expect(Object.keys(res.data).sort()).toEqual(PUBLIC_KEYS);
    ['_id', 'ownerOpenid', 'tagCode', 'socialOk', 'qrFileID', 'createdAt', 'updatedAt'].forEach(
      (k) => expect(res.data).not.toHaveProperty(k)
    );
  });

  test('② 走失态 ownerContact 走 resolveOwnerContact 门控分支(取值待契约补来源字段)', async () => {
    const dog = makeDog({ lostMode: true });
    const owner = makeOwner();
    const fake = createFakeDb({ dogs: [dog], users: [owner] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake));

    expect(res.ok).toBe(true);
    expect(res.data.lostMode).toBe(true);
    expect('ownerContact' in res.data).toBe(true);
    // 不写死取值:断言它等于接缝函数当下的口径。总管补完来源字段后,
    // 只要 core 仍然走这条分支,这条断言依旧成立。
    expect(typeof core.resolveOwnerContact).toBe('function');
    expect(res.data.ownerContact).toEqual(core.resolveOwnerContact(dog, owner));
  });

  test('非走失态不取联系方式:resolveOwnerContact 的口径变了也依然是 null', async () => {
    const fake = createFakeDb({ dogs: [makeDog({ lostMode: false })], users: [makeOwner()] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake));
    expect(res.data.ownerContact).toBeNull();
  });

  // 门控之外的「取什么值」不在 T3 范围:users / dogs 两张字段表里没有联系方式来源,
  // 等总管补契约(见 cloudfunctions/scanTag/core.js 的 resolveOwnerContact)。
  test.todo('lostMode 时 ownerContact 的取值 —— 等契约补来源字段');
});

describe('scanTag: 扫码日志', () => {
  test('③ 每次扫码写入一条 scanLogs,字段按 3.2', async () => {
    const fake = createFakeDb({ dogs: [makeDog({ lostMode: true })], users: [makeOwner()] });
    await core({ tagCode: 'ab12cd' }, makeCtx(fake));

    const logs = fake.dump(COLL.SCAN_LOGS);
    expect(logs).toHaveLength(1);
    expect(logs[0].tagCode).toBe('ab12cd');
    expect(logs[0].scannerOpenid).toBe('o-scanner');
    expect(logs[0].isLostMode).toBe(true);
    expect(logs[0].scannedAt).toEqual(new Date(NOW));
  });

  test('扫两次写两条,不是覆盖同一条', async () => {
    const fake = createFakeDb({ dogs: [makeDog()], users: [makeOwner()] });
    await core({ tagCode: 'ab12cd' }, makeCtx(fake));
    await core({ tagCode: 'ab12cd' }, makeCtx(fake, 'o-other'));

    const logs = fake.dump(COLL.SCAN_LOGS);
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.scannerOpenid)).toEqual(['o-scanner', 'o-other']);
  });
});

describe('scanTag: 游客与失败面', () => {
  test('④ 游客态(openid 为 空串)可调用,scanLogs 的 scannerOpenid 写空串', async () => {
    const fake = createFakeDb({ dogs: [makeDog()], users: [makeOwner()] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake, ''));

    expect(res.ok).toBe(true); // AUTH_REQUIRED 的唯一例外,spec 3.4
    expect(res.data.name).toBe('豆豆');

    const logs = fake.dump(COLL.SCAN_LOGS);
    expect(logs).toHaveLength(1);
    expect(logs[0].scannerOpenid).toBe('');
    expect(logs[0].scannerOpenid).not.toBeNull();
    expect(logs[0].scannerOpenid).not.toBeUndefined();
  });

  test('tagCode 缺失 / 长度不对 / 含非法字符 → INVALID_PARAM tagCode', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const bad = [undefined, '', 'ab12c', 'ab12cde', 'AB12CD', 'ab_2cd', 123];

    for (const tagCode of bad) {
      const res = await core({ tagCode }, makeCtx(fake));
      expect(res).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'tagCode' });
    }
    expect('ab12cd'.length).toBe(TAG_CODE_LENGTH);
    expect(fake.dump(COLL.SCAN_LOGS)).toHaveLength(0); // 参数没过校验不写日志
  });

  test('查不到狗 → NOT_FOUND dogs,且不写 scanLogs', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const res = await core({ tagCode: 'zzzz99' }, makeCtx(fake));

    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(res.msg).toBe(COLL.DOGS);
    expect(fake.dump(COLL.SCAN_LOGS)).toHaveLength(0);
  });

  test('走失狗的主人文档不存在时不炸,照常返回公开档案', async () => {
    const fake = createFakeDb({ dogs: [makeDog({ lostMode: true })], users: [] });
    const res = await core({ tagCode: 'ab12cd' }, makeCtx(fake, ''));

    expect(res.ok).toBe(true);
    expect(res.data.lostMode).toBe(true);
    expect(Object.keys(res.data).sort()).toEqual(PUBLIC_KEYS);
  });
});
