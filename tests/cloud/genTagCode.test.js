/**
 * tests/cloud/genTagCode.test.js —— owner: T6(第二轮:小程序码真上传)
 *
 * 派工包 T6-b 要求覆盖:
 *   ① qrFileID 等于 ctx.storage.uploadFile 的返回值,
 *      且 calls.uploads[0].cloudPath === 'tags/<tagCode>.png'
 *   ② 重复生成复用 tagCode 且不再上传
 *
 * 另覆盖 spec 3.4:openapi 抛错 / 没带 buffer 时记 logger.error、qrFileID 留空串、
 * 主流程仍返回 ok。
 */

const core = require('../../cloudfunctions/genTagCode/core');
const { makeTestCtx, DEFAULT_NOW } = require('../fakes/cloud-ctx');
const { COLL, TAG_CODE_LENGTH } = require('../../cloudfunctions/_shared/contracts');

const NOW = new Date(DEFAULT_NOW);
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
      vaccinated: false,
      licenseNo: '',
      tags: [],
      avatarFileID: '',
      tagCode: '',
      qrFileID: '',
      lostMode: false,
      lostNote: '',
      createdAt: NOW,
      updatedAt: NOW,
    },
    over
  );
}

function setup(opts) {
  const o = opts || {};
  return makeTestCtx({
    seed: o.seed || { dogs: [makeDog()] },
    openid: o.openid === undefined ? OWNER : o.openid,
    openapi: o.openapi,
  });
}

/**
 * 让 Math.random 按给定的短码序列出牌 —— 用来确定性地验证「撞了就重摇」。
 * 与实现里的字符集顺序耦合,这是刻意的:字符集变了这条测试就该重写。
 */
function queueCodes(codes) {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const vals = [];
  codes.forEach((code) =>
    code.split('').forEach((ch) => vals.push(ALPHABET.indexOf(ch) / ALPHABET.length))
  );
  let i = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => (i < vals.length ? vals[i++] : 0));
}

describe('genTagCode: 生成与上传', () => {
  test('① qrFileID 等于 ctx.storage.uploadFile 的返回值,cloudPath 是 tags/<tagCode>.png', async () => {
    const { ctx, calls, dump } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0].cloudPath).toBe('tags/' + res.data.tagCode + '.png');
    expect(res.data.qrFileID).toBe('cloud://fake/tags/' + res.data.tagCode + '.png');
    expect(dump(COLL.DOGS)[0].qrFileID).toBe(res.data.qrFileID);
  });

  test('上传的就是 wxacode 返回的 buffer', async () => {
    const { ctx, calls } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(calls.wxacode).toHaveLength(1);
    expect(Buffer.isBuffer(calls.uploads[0].buffer)).toBe(true);
    expect(calls.uploads[0].buffer.toString()).toBe('fake-png:' + res.data.tagCode);
  });

  test('getUnlimited 的参数按 spec 3.3.2:scene / page / checkPath', async () => {
    const { ctx, calls } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(calls.wxacode[0]).toEqual({
      scene: res.data.tagCode,
      page: 'pages/dog/profile/profile',
      checkPath: false,
    });
  });

  test('tagCode 长度为 TAG_CODE_LENGTH(6),字符集 [a-z0-9],并写回 dog 文档', async () => {
    const { ctx, dump } = setup();
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.data.tagCode).toHaveLength(TAG_CODE_LENGTH);
    expect(TAG_CODE_LENGTH).toBe(6);
    expect(res.data.tagCode).toMatch(new RegExp('^[a-z0-9]{' + TAG_CODE_LENGTH + '}$'));

    const dog = dump(COLL.DOGS)[0];
    expect(dog.tagCode).toBe(res.data.tagCode);
    expect(dog.updatedAt).toEqual(NOW);
  });

  test('新生成的 tagCode 与库里已有的不重复:撞了就重摇', async () => {
    const { ctx, dump } = setup({
      seed: {
        dogs: [makeDog({ _id: 'other', ownerOpenid: 'o-x', tagCode: 'aaaaaa' }), makeDog()],
      },
    });
    queueCodes(['aaaaaa', 'bbbbbb']); // 第一发撞上已有的,第二发才干净

    const res = await core({ dogId: 'd1' }, ctx);
    expect(res.data.tagCode).toBe('bbbbbb');

    const codes = dump(COLL.DOGS).map((d) => d.tagCode);
    expect(new Set(codes).size).toBe(codes.length); // 全局唯一
  });
});

describe('genTagCode: 复用', () => {
  test('② 已生成过就复用 tagCode 与 qrFileID,不重摇也不重传', async () => {
    const { ctx, calls, dump } = setup({
      seed: { dogs: [makeDog({ tagCode: 'ab12cd', qrFileID: 'cloud://old.png' })] },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.data).toEqual({ tagCode: 'ab12cd', qrFileID: 'cloud://old.png' });
    expect(calls.wxacode).toHaveLength(0);
    expect(calls.uploads).toHaveLength(0);
    expect(dump(COLL.DOGS)[0].tagCode).toBe('ab12cd');
  });

  test('有 tagCode 但上次没传成码:复用短码,只补传一次图', async () => {
    const { ctx, calls } = setup({
      seed: { dogs: [makeDog({ tagCode: 'ab12cd', qrFileID: '' })] },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.data.tagCode).toBe('ab12cd');
    expect(res.data.qrFileID).toBe('cloud://fake/tags/ab12cd.png');
    expect(calls.uploads).toHaveLength(1);
  });

  test('连续调用两次拿到同一个 tagCode,只上传一次', async () => {
    const { ctx, calls, dump } = setup();
    const first = await core({ dogId: 'd1' }, ctx);
    const second = await core({ dogId: 'd1' }, ctx);

    expect(first.data).toEqual(second.data);
    expect(calls.uploads).toHaveLength(1);
    expect(dump(COLL.DOGS)).toHaveLength(1);
  });
});

describe('genTagCode: openapi 失败面(spec 3.4)', () => {
  test('getUnlimited 抛错:记 logger.error、qrFileID 留空串、主流程仍 ok', async () => {
    const { ctx, calls, dump } = setup({
      openapi: {
        wxacode: {
          async getUnlimited() {
            throw new Error('openapi down');
          },
        },
      },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.tagCode).toHaveLength(TAG_CODE_LENGTH);
    expect(res.data.qrFileID).toBe('');
    expect(calls.errors.length).toBeGreaterThan(0);
    expect(calls.uploads).toHaveLength(0);
    expect(dump(COLL.DOGS)[0].tagCode).toBe(res.data.tagCode); // 短码照样落库
  });

  test('getUnlimited 没带 buffer:不上传、qrFileID 留空串、主流程仍 ok', async () => {
    const { ctx, calls } = setup({
      openapi: { wxacode: { async getUnlimited() { return { contentType: 'image/png' }; } } },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.qrFileID).toBe('');
    expect(calls.uploads).toHaveLength(0);
    expect(calls.errors.length).toBeGreaterThan(0);
  });

  test('上传失败:记 logger.error、qrFileID 留空串、主流程仍 ok', async () => {
    const { ctx, calls } = setup();
    ctx.storage.uploadFile = async () => {
      throw new Error('cos down');
    };
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.qrFileID).toBe('');
    expect(calls.errors.length).toBeGreaterThan(0);
  });

  test('openapi.wxacode 整个不可用也不炸', async () => {
    const { ctx } = setup({ openapi: {} });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.qrFileID).toBe('');
  });
});

describe('genTagCode: 失败面(spec 3.4)', () => {
  test('游客调用 → AUTH_REQUIRED', async () => {
    const { ctx, dump } = setup({ openid: '' });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res).toEqual({ ok: false, code: 'AUTH_REQUIRED', msg: 'AUTH_REQUIRED' });
    expect(dump(COLL.DOGS)[0].tagCode).toBe('');
  });

  test('dogId 缺失 / 不是字符串 → INVALID_PARAM dogId', async () => {
    const { ctx } = setup();

    await expect(core({}, ctx)).resolves.toEqual({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
    await expect(core({ dogId: 123 }, ctx)).resolves.toEqual({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
  });

  test('狗不存在 → NOT_FOUND dogs', async () => {
    const { ctx } = setup();
    const res = await core({ dogId: 'nope' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND', msg: COLL.DOGS });
  });

  test('给别人的狗发码 → FORBIDDEN,且不动那条狗、不调 openapi', async () => {
    const { ctx, calls, dump } = setup({
      seed: { dogs: [makeDog({ ownerOpenid: 'o-someone-else' })] },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dump(COLL.DOGS)[0].tagCode).toBe('');
    expect(calls.wxacode).toHaveLength(0);
  });
});

describe('genTagCode: 并发补码', () => {
  afterEach(() => jest.restoreAllMocks());

  test('两次并发给同一只老狗补码:返回同一个码,且就是库里那个', async () => {
    queueCodes(['aaaaaa', 'bbbbbb']);
    const { ctx, dump } = setup();
    const [r1, r2] = await Promise.all([core({ dogId: 'd1' }, ctx), core({ dogId: 'd1' }, ctx)]);

    expect(r1.ok && r2.ok).toBe(true);
    const stored = dump(COLL.DOGS)[0].tagCode;
    expect(r1.data.tagCode).toBe(stored);
    expect(r2.data.tagCode).toBe(stored);
  });
});
