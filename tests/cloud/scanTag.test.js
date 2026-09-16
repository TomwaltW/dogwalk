/**
 * tests/cloud/scanTag.test.js —— owner: T6(第二轮改到契约 v2)
 *
 * 验收 B2(spec 2.2):
 *   ① 返回值的 key 恰好是 DogPublic 的 9 个(spec 3.2.3)
 *   ② 非走失态 lostNote === ''
 *   ③ 走失态带 lostNote
 *   ④ 写入一条 scanLogs,游客态 scannerOpenid === ''
 *
 * 本轮 DogPublic 只有 9 个 key,里面没有任何主人相关字段 —— spec 9 节假设 12
 * 写明走失页不显示主人联系方式,路人只能留言,所以 scanTag 连 users 都不读。
 */

const core = require('../../cloudfunctions/scanTag/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL, TAG_CODE_LENGTH } = require('../../cloudfunctions/_shared/contracts');

const NOW = new Date(DEFAULT_NOW);

/** DogPublic 的字段全集 —— spec 3.2.3,恰好 9 个 */
const PUBLIC_KEYS = [
  'avatarFileID',
  'birthMonth',
  'breed',
  'gender',
  'lostMode',
  'lostNote',
  'name',
  'sizeClass',
  'tags',
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
      vaccinated: true,
      licenseNo: 'HZ-2023-0007',
      tags: ['ball', 'shy'],
      avatarFileID: 'cloud://avatar.png',
      tagCode: 'ab12cd',
      qrFileID: 'cloud://qr.png',
      lostMode: false,
      lostNote: '',
      createdAt: NOW,
      updatedAt: NOW,
    },
    over
  );
}

function setup(seed, openid) {
  return makeTestCtx({ seed, openid: openid === undefined ? 'o-scanner' : openid });
}

describe('scanTag: DogPublic', () => {
  test('① 返回值的 key 恰好是 DogPublic 的 9 个,一个不多一个不少', async () => {
    const { ctx } = setup({ dogs: [makeDog()] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.ok).toBe(true);
    expect(Object.keys(res.data).sort()).toEqual(PUBLIC_KEYS);
    expect(PUBLIC_KEYS).toHaveLength(9);
  });

  test('主人字段与内部字段一个都不漏出去', async () => {
    const { ctx } = setup({ dogs: [makeDog({ lostMode: true, lostNote: '走丢了' })] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    [
      '_id',
      'ownerOpenid',
      'tagCode',
      'qrFileID',
      'licenseNo',
      'neutered',
      'vaccinated',
      'createdAt',
      'updatedAt',
    ].forEach((k) => expect(res.data).not.toHaveProperty(k));
  });

  test('档案字段照原样带出去', async () => {
    const { ctx } = setup({ dogs: [makeDog()] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.data).toEqual({
      name: '豆豆',
      breed: '柯基',
      sizeClass: 'small',
      gender: 'male',
      birthMonth: '2023-04',
      avatarFileID: 'cloud://avatar.png',
      tags: ['ball', 'shy'],
      lostMode: false,
      lostNote: '',
    });
  });

  test('② 非走失态 lostNote 恒为空串 —— 库里有留言也不给路人看', async () => {
    const { ctx } = setup({ dogs: [makeDog({ lostMode: false, lostNote: '上次走丢时写的' })] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.data.lostMode).toBe(false);
    expect(res.data.lostNote).toBe('');
  });

  test('③ 走失态带 lostNote', async () => {
    const { ctx } = setup({
      dogs: [makeDog({ lostMode: true, lostNote: '在西湖边走丢,麻烦留个言' })],
    });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.data.lostMode).toBe(true);
    expect(res.data.lostNote).toBe('在西湖边走丢,麻烦留个言');
  });

  test('脏数据兜底:缺字段的老文档也返回齐 9 个 key,不返回 undefined', async () => {
    const { ctx } = setup({ dogs: [{ _id: 'd9', tagCode: 'ab12cd', ownerOpenid: 'o-owner' }] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(Object.keys(res.data).sort()).toEqual(PUBLIC_KEYS);
    expect(res.data.name).toBe('');
    expect(res.data.tags).toEqual([]);
    expect(res.data.lostMode).toBe(false);
    expect(res.data.lostNote).toBe('');
  });

  test('主人的 users 文档根本不参与:库里没有 users 也照常返回', async () => {
    const { ctx } = setup({ dogs: [makeDog({ lostMode: true, lostNote: '走丢了' })], users: [] });
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.lostNote).toBe('走丢了');
  });
});

describe('scanTag: 扫码日志', () => {
  test('每次扫码写入一条 scanLogs,字段按 spec 3.2.2', async () => {
    const { ctx, dump } = setup({ dogs: [makeDog({ lostMode: true })] });
    await core({ tagCode: 'ab12cd' }, ctx);

    const logs = dump(COLL.SCAN_LOGS);
    expect(logs).toHaveLength(1);
    expect(logs[0].tagCode).toBe('ab12cd');
    expect(logs[0].scannerOpenid).toBe('o-scanner');
    expect(logs[0].isLostMode).toBe(true);
    expect(logs[0].scannedAt).toEqual(NOW);
  });

  test('扫两次写两条,不是覆盖同一条', async () => {
    const seed = { dogs: [makeDog()] };
    const first = makeTestCtx({ seed, openid: 'o-scanner' });
    await core({ tagCode: 'ab12cd' }, first.ctx);
    await core({ tagCode: 'ab12cd' }, first.ctx);

    expect(first.dump(COLL.SCAN_LOGS)).toHaveLength(2);
  });
});

describe('scanTag: 游客与失败面', () => {
  test('④ 游客态(openid 为空串)可调用,scanLogs 的 scannerOpenid 写空串', async () => {
    const { ctx, dump } = setup({ dogs: [makeDog()] }, '');
    const res = await core({ tagCode: 'ab12cd' }, ctx);

    expect(res.ok).toBe(true); // AUTH_REQUIRED 的例外之一,spec 3.4
    expect(res.data.name).toBe('豆豆');

    const logs = dump(COLL.SCAN_LOGS);
    expect(logs).toHaveLength(1);
    expect(logs[0].scannerOpenid).toBe('');
    expect(logs[0].scannerOpenid).not.toBeNull();
    expect(logs[0].scannerOpenid).not.toBeUndefined();
  });

  test('tagCode 缺失 / 长度不对 / 含非法字符 → INVALID_PARAM tagCode,不写日志', async () => {
    const { ctx, dump } = setup({ dogs: [makeDog()] });
    const bad = [undefined, '', 'ab12c', 'ab12cde', 'AB12CD', 'ab_2cd', 123];

    for (const tagCode of bad) {
      const res = await core({ tagCode }, ctx);
      expect(res).toEqual({ ok: false, code: 'INVALID_PARAM', msg: 'tagCode' });
    }
    expect('ab12cd'.length).toBe(TAG_CODE_LENGTH);
    expect(dump(COLL.SCAN_LOGS)).toHaveLength(0);
  });

  test('查不到狗 → NOT_FOUND dogs,且不写 scanLogs', async () => {
    const { ctx, dump } = setup({ dogs: [makeDog()] });
    const res = await core({ tagCode: 'zzzz99' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
    expect(dump(COLL.SCAN_LOGS)).toHaveLength(0);
  });

  test('event 缺省不抛异常', async () => {
    const { ctx } = setup({ dogs: [makeDog()] });
    await expect(core(undefined, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'tagCode',
    });
  });
});
