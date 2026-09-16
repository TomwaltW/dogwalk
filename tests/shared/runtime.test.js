/** _shared/runtime.js 的自测 —— T0' owner。handler 组 ctx + 兜底异常。 */
const { handler, makeCtx, createStorage } = require('../../cloudfunctions/_shared/runtime');

function fakeCloud(overrides) {
  return Object.assign(
    {
      getWXContext: () => ({ OPENID: 'o1' }),
      database: () => ({ command: { inc: () => 'inc' }, collection: () => ({}) }),
      openapi: { security: {} },
      downloadFile: async ({ fileID }) => ({ fileContent: Buffer.from('c:' + fileID) }),
      uploadFile: async ({ cloudPath }) => ({ fileID: 'cloud://env/' + cloudPath }),
    },
    overrides || {}
  );
}

describe('runtime.handler', () => {
  test('core 收到齐全的 ctx,返回值原样透传', async () => {
    let got = null;
    const core = async (event, ctx) => {
      got = { event, ctx };
      return { ok: true, data: 1 };
    };
    const r = await handler(fakeCloud(), core)({ a: 1 });
    expect(r).toEqual({ ok: true, data: 1 });
    expect(got.event).toEqual({ a: 1 });
    expect(got.ctx.openid).toBe('o1');
    expect(got.ctx._).toEqual({ inc: expect.any(Function) });
    expect(got.ctx.now()).toBeInstanceOf(Date);
    expect(typeof got.ctx.storage.uploadFile).toBe('function');
    expect(typeof got.ctx.security.checkText).toBe('function');
    expect(got.ctx.logger).toBe(console);
  });

  test('event 缺省为 {};OPENID 缺失时 openid 为 空串', async () => {
    let got = null;
    const cloud = fakeCloud({ getWXContext: () => ({}) });
    await handler(cloud, async (e, c) => {
      got = { e, c };
      return { ok: true, data: null };
    })();
    expect(got.e).toEqual({});
    expect(got.c.openid).toBe('');
  });

  test('core 抛异常 → fail(INTERNAL),不往外抛', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await handler(fakeCloud(), async () => {
      throw new Error('boom');
    })({});
    expect(r).toEqual({ ok: false, code: 'INTERNAL', msg: 'boom' });
    expect(spy).toHaveBeenCalled();
  });
});

describe('runtime.createStorage / makeCtx', () => {
  test('storage 把 wx-server-sdk 的返回拆成 Buffer / fileID', async () => {
    const s = createStorage(fakeCloud());
    expect((await s.downloadFile('f1')).toString()).toBe('c:f1');
    expect(await s.uploadFile('p/x.png', Buffer.from('x'))).toBe('cloud://env/p/x.png');
  });

  test('makeCtx 可注入 now / logger', () => {
    const now = () => new Date('2026-09-16T00:00:00Z');
    const logger = { error() {}, info() {} };
    const cloud = fakeCloud();
    const ctx = makeCtx({ cloud, db: cloud.database(), openid: 'o2', now, logger });
    expect(ctx.now().toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(ctx.logger).toBe(logger);
    expect(ctx.openid).toBe('o2');
  });
});
