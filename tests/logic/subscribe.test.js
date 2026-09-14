/**
 * 订阅额度记账 —— owner: T3。
 *
 * 对应 spec 3.2 users.subQuota、3.4「订阅消息额度为 0 → 不报错」、
 * spec 6 节 T3 行:「额度为 0 时 deduct() 返回 false 且不抛错」。
 */

const sub = require('../../miniprogram/logic/subscribe');

describe('subscribe: 余额读取(remaining / canSend)', () => {
  test('正常余额原样读出,canSend 与之一致', () => {
    const q = { 'tpl-out': 3, 'tpl-scan': 0 };
    expect(sub.remaining(q, 'tpl-out')).toBe(3);
    expect(sub.canSend(q, 'tpl-out')).toBe(true);
    expect(sub.remaining(q, 'tpl-scan')).toBe(0);
    expect(sub.canSend(q, 'tpl-scan')).toBe(false);
  });

  test('subQuota 缺失 / 不是对象 / templateKey 非法,一律当 0,不抛错', () => {
    expect(sub.remaining(undefined, 'tpl-out')).toBe(0);
    expect(sub.remaining(null, 'tpl-out')).toBe(0);
    expect(sub.remaining('nope', 'tpl-out')).toBe(0);
    expect(sub.remaining({ 'tpl-out': 3 }, '')).toBe(0);
    expect(sub.remaining({ 'tpl-out': 3 }, undefined)).toBe(0);
    expect(sub.canSend(undefined, 'tpl-out')).toBe(false);
  });

  test('脏值归一:负数 / NaN / 小数 / 非数字都收敛成非负整数', () => {
    const q = { a: -5, b: NaN, c: 2.7, d: '3', e: Infinity };
    expect(sub.remaining(q, 'a')).toBe(0);
    expect(sub.remaining(q, 'b')).toBe(0);
    expect(sub.remaining(q, 'c')).toBe(2);
    expect(sub.remaining(q, 'd')).toBe(0);
    expect(sub.remaining(q, 'e')).toBe(0);
  });
});

describe('subscribe: 扣减(deduct)', () => {
  test('额度为 0 时 deduct() 返回 false 且不抛错,余额不动', () => {
    const q = { 'tpl-out': 0 };
    let r;
    expect(() => {
      r = sub.deduct(q, 'tpl-out');
    }).not.toThrow();
    expect(r).toBe(false);
    expect(q['tpl-out']).toBe(0);
  });

  test('templateKey 不存在时当 0 处理:返回 false 且不抛错,不会凭空建 key', () => {
    const q = {};
    let r;
    expect(() => {
      r = sub.deduct(q, 'tpl-never-granted');
    }).not.toThrow();
    expect(r).toBe(false);
    expect(q).toEqual({});
  });

  test('subQuota 整个缺失时 deduct() 返回 false 且不抛错', () => {
    expect(() => sub.deduct(undefined, 'tpl-out')).not.toThrow();
    expect(sub.deduct(undefined, 'tpl-out')).toBe(false);
    expect(sub.deduct(null, 'tpl-out')).toBe(false);
  });

  test('有额度时就地扣 1 并返回 true,扣到 0 后再扣返回 false', () => {
    const q = { 'tpl-out': 2 };
    expect(sub.deduct(q, 'tpl-out')).toBe(true);
    expect(q['tpl-out']).toBe(1);
    expect(sub.deduct(q, 'tpl-out')).toBe(true);
    expect(q['tpl-out']).toBe(0);
    expect(sub.deduct(q, 'tpl-out')).toBe(false);
    expect(q['tpl-out']).toBe(0); // 不会扣成负数
  });

  test('只动被扣的那个 templateKey,别的额度不受影响', () => {
    const q = { 'tpl-out': 1, 'tpl-scan': 5 };
    sub.deduct(q, 'tpl-out');
    expect(q).toEqual({ 'tpl-out': 0, 'tpl-scan': 5 });
  });
});

describe('subscribe: 发放(grant)', () => {
  test('用户每授权一次 +1,key 不存在时从 0 起账', () => {
    const q = {};
    expect(sub.grant(q, 'tpl-out')).toBe(1);
    expect(sub.grant(q, 'tpl-out')).toBe(2);
    expect(q).toEqual({ 'tpl-out': 2 });
  });

  test('可一次发放多条;非法 count 与非法入参都不抛错', () => {
    const q = { 'tpl-out': 1 };
    expect(sub.grant(q, 'tpl-out', 3)).toBe(4);
    expect(sub.grant(q, 'tpl-out', 0)).toBe(4);
    expect(sub.grant(q, 'tpl-out', -2)).toBe(4);
    expect(() => sub.grant(undefined, 'tpl-out', 1)).not.toThrow();
    expect(sub.grant(undefined, 'tpl-out', 1)).toBe(0);
  });

  test('发放后 deduct 能扣出来 —— 记账闭环', () => {
    const q = {};
    sub.grant(q, 'tpl-lost', 2);
    expect(sub.deduct(q, 'tpl-lost')).toBe(true);
    expect(sub.deduct(q, 'tpl-lost')).toBe(true);
    expect(sub.deduct(q, 'tpl-lost')).toBe(false);
    expect(sub.remaining(q, 'tpl-lost')).toBe(0);
  });
});
