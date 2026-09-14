/**
 * genTagCode —— owner: T3。对应 spec 3.3.2、3.4、6 节 T3 行。
 *
 * 覆盖两件事(6 节 T3):
 *   ① tagCode 长度为 TAG_CODE_LENGTH(6)
 *   ② 重复生成时复用已有 tagCode,不新建
 */

const core = require('../../cloudfunctions/genTagCode/core');
const { createFakeDb } = require('../fakes/fake-db');
const { fixedClock } = require('../fakes/clock');
const { COLL, TAG_CODE_LENGTH } = require('../../cloudfunctions/_shared/contracts');

const NOW = '2026-09-14T20:00:00+08:00';
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
      avatarFileID: '',
      playStyle: [],
      temperament: [],
      okWithSmallDogs: true,
      socialOk: true,
      tagCode: '',
      qrFileID: '',
      lostMode: false,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
    over
  );
}

function makeCtx(fake, over) {
  return Object.assign(
    {
      db: fake.db,
      _: fake._,
      openid: OWNER,
      now: fixedClock(NOW),
      openapi: { wxacode: { getUnlimited: jest.fn(async () => ({ fileID: 'cloud://qr-new.png' })) } },
      logger: { info: jest.fn(), error: jest.fn() },
    },
    over
  );
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

describe('genTagCode: 生成', () => {
  test('① tagCode 长度为 6(= TAG_CODE_LENGTH),字符集 [a-z0-9],并写回 dog 文档', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const res = await core({ dogId: 'd1' }, makeCtx(fake));

    expect(res.ok).toBe(true);
    expect(res.data.tagCode).toHaveLength(TAG_CODE_LENGTH);
    expect(TAG_CODE_LENGTH).toBe(6);
    expect(res.data.tagCode).toMatch(/^[a-z0-9]+$/);
    expect(res.data.tagCode).toMatch(new RegExp('^[a-z0-9]{' + TAG_CODE_LENGTH + '}$'));

    const dog = fake.dump(COLL.DOGS)[0];
    expect(dog.tagCode).toBe(res.data.tagCode);
    expect(dog.updatedAt).toEqual(new Date(NOW));
  });

  test('新生成的 tagCode 与库里已有的不重复:撞了就重摇', async () => {
    const fake = createFakeDb({
      dogs: [makeDog({ _id: 'other', ownerOpenid: 'o-x', tagCode: 'aaaaaa' }), makeDog()],
    });
    queueCodes(['aaaaaa', 'bbbbbb']); // 第一发撞上已有的,第二发才干净

    const res = await core({ dogId: 'd1' }, makeCtx(fake));
    expect(res.ok).toBe(true);
    expect(res.data.tagCode).toBe('bbbbbb');

    const codes = fake.dump(COLL.DOGS).map((d) => d.tagCode);
    expect(new Set(codes).size).toBe(codes.length); // 全局唯一
  });

  test('小程序码生成成功时把 fileID 写进 qrFileID', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const ctx = makeCtx(fake);
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.qrFileID).toBe('cloud://qr-new.png');
    expect(ctx.openapi.wxacode.getUnlimited).toHaveBeenCalledTimes(1);
    expect(fake.dump(COLL.DOGS)[0].qrFileID).toBe('cloud://qr-new.png');
  });

  test('openapi 调用失败只记 logger.error,不影响主流程返回 ok(spec 3.4)', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const ctx = makeCtx(fake, {
      openapi: {
        wxacode: {
          getUnlimited: jest.fn(async () => {
            throw new Error('openapi down');
          }),
        },
      },
    });
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.tagCode).toHaveLength(TAG_CODE_LENGTH);
    expect(res.data.qrFileID).toBe(''); // 3.2:未生成时为空串
    expect(ctx.logger.error).toHaveBeenCalled();
    expect(fake.dump(COLL.DOGS)[0].tagCode).toBe(res.data.tagCode); // 短码照样落库
  });
});

describe('genTagCode: 复用', () => {
  test('② 已生成过就复用已有 tagCode,不新建', async () => {
    const fake = createFakeDb({ dogs: [makeDog({ tagCode: 'ab12cd', qrFileID: 'cloud://old.png' })] });
    const ctx = makeCtx(fake);
    const res = await core({ dogId: 'd1' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.tagCode).toBe('ab12cd');
    expect(res.data.qrFileID).toBe('cloud://old.png');
    expect(fake.dump(COLL.DOGS)[0].tagCode).toBe('ab12cd');
    expect(ctx.openapi.wxacode.getUnlimited).not.toHaveBeenCalled(); // 码也不重生成
  });

  test('连续调用两次拿到同一个 tagCode', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const first = await core({ dogId: 'd1' }, makeCtx(fake));
    const second = await core({ dogId: 'd1' }, makeCtx(fake));

    expect(first.data.tagCode).toBe(second.data.tagCode);
    expect(fake.dump(COLL.DOGS)).toHaveLength(1);
  });
});

describe('genTagCode: 失败面(spec 3.4)', () => {
  test('游客调用 → AUTH_REQUIRED', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const res = await core({ dogId: 'd1' }, makeCtx(fake, { openid: '' }));
    expect(res).toEqual({ ok: false, code: 'AUTH_REQUIRED', msg: 'AUTH_REQUIRED' });
    expect(fake.dump(COLL.DOGS)[0].tagCode).toBe('');
  });

  test('dogId 缺失 → INVALID_PARAM dogId', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    expect(await core({}, makeCtx(fake))).toEqual({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
    expect(await core({ dogId: 123 }, makeCtx(fake))).toEqual({
      ok: false,
      code: 'INVALID_PARAM',
      msg: 'dogId',
    });
  });

  test('狗不存在 → NOT_FOUND dogs', async () => {
    const fake = createFakeDb({ dogs: [makeDog()] });
    const res = await core({ dogId: 'nope' }, makeCtx(fake));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(res.msg).toBe(COLL.DOGS);
  });

  test('给别人的狗发码 → FORBIDDEN,且不动那条狗', async () => {
    const fake = createFakeDb({ dogs: [makeDog({ ownerOpenid: 'o-someone-else' })] });
    const res = await core({ dogId: 'd1' }, makeCtx(fake));

    expect(res.ok).toBe(false);
    expect(res.code).toBe('FORBIDDEN');
    expect(fake.dump(COLL.DOGS)[0].tagCode).toBe('');
  });
});
