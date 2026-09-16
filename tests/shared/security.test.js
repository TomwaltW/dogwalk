/** _shared/security.js 的自测 —— T0' owner。口径见 spec 3.3.1:明确 risky 才拒,接口挂了放行。 */
const { createSecurity, contentTypeOf, RISKY_ERR_CODE } = require('../../cloudfunctions/_shared/security');

function makeDeps(overrides) {
  const errors = [];
  const downloads = [];
  const deps = Object.assign(
    {
      openapi: {
        security: {
          msgSecCheck: async () => ({ errCode: 0, result: { suggest: 'pass' } }),
          imgSecCheck: async () => ({ errCode: 0 }),
        },
      },
      storage: {
        downloadFile: async (id) => {
          downloads.push(id);
          return Buffer.from('img');
        },
      },
      openid: 'o1',
      logger: { error: (...a) => errors.push(a), info: () => {} },
    },
    overrides || {}
  );
  return { deps, errors, downloads };
}

describe('security.checkText', () => {
  test('pass → true,risky / review → false', async () => {
    const { deps } = makeDeps();
    const sec = createSecurity(deps);
    expect(await sec.checkText('你好')).toBe(true);
    deps.openapi.security.msgSecCheck = async () => ({ errCode: 0, result: { suggest: 'risky' } });
    expect(await sec.checkText('x')).toBe(false);
    deps.openapi.security.msgSecCheck = async () => ({ errCode: 0, result: { suggest: 'review' } });
    expect(await sec.checkText('x')).toBe(false);
  });

  test('v2 请求形状:带 openid / scene 2 / version 2 / content', async () => {
    let seen = null;
    const { deps } = makeDeps();
    deps.openapi.security.msgSecCheck = async (p) => {
      seen = p;
      return { errCode: 0, result: { suggest: 'pass' } };
    };
    await createSecurity(deps).checkText('abc');
    expect(seen).toEqual({ openid: 'o1', scene: 2, version: 2, content: 'abc' });
  });

  test('接口抛 87014 → false;抛别的 → 放行并记 error', async () => {
    const { deps, errors } = makeDeps();
    deps.openapi.security.msgSecCheck = async () => {
      const e = new Error('risky');
      e.errCode = RISKY_ERR_CODE;
      throw e;
    };
    expect(await createSecurity(deps).checkText('x')).toBe(false);
    deps.openapi.security.msgSecCheck = async () => {
      throw new Error('network');
    };
    expect(await createSecurity(deps).checkText('x')).toBe(true);
    expect(errors).toHaveLength(1);
  });

  test('空串 / 纯空白 / 非字符串直接 true,不调接口', async () => {
    let called = 0;
    const { deps } = makeDeps();
    deps.openapi.security.msgSecCheck = async () => {
      called += 1;
      return { errCode: 0, result: { suggest: 'risky' } };
    };
    const sec = createSecurity(deps);
    expect(await sec.checkText('')).toBe(true);
    expect(await sec.checkText('   ')).toBe(true);
    expect(await sec.checkText(undefined)).toBe(true);
    expect(called).toBe(0);
  });

  test('openapi 缺失 → 放行并记 error', async () => {
    const { deps, errors } = makeDeps({ openapi: {} });
    expect(await createSecurity(deps).checkText('x')).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

describe('security.checkImage', () => {
  test('先下载再检,errCode 0 → true', async () => {
    const { deps, downloads } = makeDeps();
    let media = null;
    deps.openapi.security.imgSecCheck = async (p) => {
      media = p.media;
      return { errCode: 0 };
    };
    expect(await createSecurity(deps).checkImage('cloud://a/b.png')).toBe(true);
    expect(downloads).toEqual(['cloud://a/b.png']);
    expect(media.contentType).toBe('image/png');
    expect(Buffer.isBuffer(media.value)).toBe(true);
  });

  test('返回 / 抛出 87014 → false', async () => {
    const { deps } = makeDeps();
    deps.openapi.security.imgSecCheck = async () => ({ errCode: RISKY_ERR_CODE });
    expect(await createSecurity(deps).checkImage('cloud://x.jpg')).toBe(false);
    deps.openapi.security.imgSecCheck = async () => {
      const e = new Error('risky');
      e.errCode = RISKY_ERR_CODE;
      throw e;
    };
    expect(await createSecurity(deps).checkImage('cloud://x.jpg')).toBe(false);
  });

  test('下载失败 / 接口挂 → 放行并记 error;空 fileID 直接 true', async () => {
    const { deps, errors } = makeDeps();
    deps.storage.downloadFile = async () => {
      throw new Error('download failed');
    };
    const sec = createSecurity(deps);
    expect(await sec.checkImage('cloud://x.jpg')).toBe(true);
    expect(errors).toHaveLength(1);
    expect(await sec.checkImage('')).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

describe('security.contentTypeOf', () => {
  test('按扩展名猜,猜不出按 jpeg', () => {
    expect(contentTypeOf('cloud://a/b.png')).toBe('image/png');
    expect(contentTypeOf('cloud://a/b.JPG')).toBe('image/jpeg');
    expect(contentTypeOf('cloud://a/b.webp')).toBe('image/webp');
    expect(contentTypeOf('cloud://a/b')).toBe('image/jpeg');
  });
});
