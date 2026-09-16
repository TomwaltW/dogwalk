/**
 * T10 / B13 —— 合拍度规则 miniprogram/logic/compat.js(spec 3.3.6)
 *
 * 规则表单独成文件就是为了以后改规则不用碰页面,所以这里既钉行为,也钉 RULES 的形状。
 * 纯函数:不 require 页面、不碰 wx,入参脏了也不许抛。
 */

const compat = require('../../miniprogram/logic/compat');

/** DogCard(spec 3.2.3):字段只能少不能多 */
function card(over) {
  return Object.assign({ dogId: 'd1', name: '旺财', avatarFileID: '', sizeClass: 'medium', tags: [] }, over || {});
}

describe('compatHints —— fearsBig vs large(B13)', () => {
  test('对方怕大狗、我方是大型犬 —— 至少一条 warn,且文案点名豆豆', () => {
    const mine = [card({ dogId: 'd1', name: '旺财', sizeClass: 'large', tags: [] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })];

    const hints = compat.compatHints(mine, other);

    const warns = hints.filter((h) => h.level === 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns.some((h) => h.text.indexOf('豆豆') >= 0)).toBe(true);
    // 两只狗都该被点名,不然主人不知道说的是谁
    expect(warns.some((h) => h.text.indexOf('旺财') >= 0)).toBe(true);
  });

  test('反过来 —— 我的狗怕大狗、对方是大型犬,同样 warn', () => {
    const mine = [card({ dogId: 'd1', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })];
    const other = [card({ dogId: 'd2', name: '旺财', sizeClass: 'large', tags: [] })];

    const hints = compat.compatHints(mine, other);

    expect(hints.some((h) => h.level === 'warn' && h.text.indexOf('豆豆') >= 0)).toBe(true);
  });

  test('怕大狗但对面没有大型犬 —— 不出 warn', () => {
    const mine = [card({ name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })];
    const other = [card({ dogId: 'd2', name: '奶黄', sizeClass: 'small', tags: [] })];

    expect(compat.compatHints(mine, other).filter((h) => h.level === 'warn')).toEqual([]);
  });
});

describe('compatHints —— 其余规则(B13)', () => {
  test('两边都没标签且体型相同 —— 返回 []', () => {
    const mine = [card({ dogId: 'd1', name: '旺财', sizeClass: 'medium', tags: [] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'medium', tags: [] })];

    expect(compat.compatHints(mine, other)).toEqual([]);
  });

  test('一方 small 一方 large —— 出一条 info(size-gap)', () => {
    const mine = [card({ dogId: 'd1', name: '小小', sizeClass: 'small', tags: [] })];
    const other = [card({ dogId: 'd2', name: '大黄', sizeClass: 'large', tags: [] })];

    const hints = compat.compatHints(mine, other);
    const infos = hints.filter((h) => h.level === 'info');

    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(infos.some((h) => h.text.indexOf('小小') >= 0 && h.text.indexOf('大黄') >= 0)).toBe(true);
  });

  test('任一方 foodGuard —— 出一条提零食的 info', () => {
    const mine = [card({ dogId: 'd1', name: '旺财', sizeClass: 'medium', tags: [] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'medium', tags: ['foodGuard'] })];

    const hints = compat.compatHints(mine, other);

    expect(hints.some((h) => h.level === 'info' && h.text.indexOf('零食') >= 0 && h.text.indexOf('豆豆') >= 0)).toBe(
      true
    );
  });

  test('任一方 shy —— 出一条牵绳慢慢熟悉的 info', () => {
    const mine = [card({ dogId: 'd1', name: '胆胆', sizeClass: 'medium', tags: ['shy'] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'medium', tags: [] })];

    const hints = compat.compatHints(mine, other);

    expect(hints.some((h) => h.level === 'info' && h.text.indexOf('胆胆') >= 0)).toBe(true);
  });

  test('一方 chaser 一方 calm —— 出一条 info,点名两只', () => {
    const mine = [card({ dogId: 'd1', name: '闪电', sizeClass: 'medium', tags: ['chaser'] })];
    const other = [card({ dogId: 'd2', name: '安安', sizeClass: 'medium', tags: ['calm'] })];

    const hints = compat.compatHints(mine, other);

    expect(hints.some((h) => h.level === 'info' && h.text.indexOf('闪电') >= 0 && h.text.indexOf('安安') >= 0)).toBe(
      true
    );
  });

  test('多条规则同时命中 —— 都返回,顺序跟 RULES 一致', () => {
    const mine = [card({ dogId: 'd1', name: '旺财', sizeClass: 'large', tags: ['foodGuard'] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'small', tags: ['fearsBig', 'shy'] })];

    const hints = compat.compatHints(mine, other);

    expect(hints.length).toBeGreaterThanOrEqual(3);
    hints.forEach((h) => {
      expect(['warn', 'info']).toContain(h.level);
      expect(typeof h.text).toBe('string');
      expect(h.text.length).toBeGreaterThan(0);
      expect(Object.keys(h).sort()).toEqual(['level', 'text']);
    });
  });
});

describe('compatHints —— 脏入参不抛(B13)', () => {
  test('空数组 / undefined / null 一律返回 []', () => {
    expect(compat.compatHints([], [])).toEqual([]);
    expect(compat.compatHints(undefined, undefined)).toEqual([]);
    expect(compat.compatHints(null, null)).toEqual([]);
    expect(compat.compatHints([card()], [])).toEqual([]);
    expect(compat.compatHints([], [card()])).toEqual([]);
  });

  test('缺 tags / tags 不是数组 / 元素是 null —— 不抛', () => {
    const mine = [{ dogId: 'd1', name: '旺财', sizeClass: 'large' }, null];
    const other = [{ dogId: 'd2', name: '豆豆', sizeClass: 'small', tags: 'fearsBig' }, undefined];

    expect(() => compat.compatHints(mine, other)).not.toThrow();
    compat.compatHints(mine, other).forEach((h) => {
      expect(['warn', 'info']).toContain(h.level);
    });
  });

  test('不修改入参', () => {
    const mine = [card({ dogId: 'd1', name: '旺财', sizeClass: 'large', tags: [] })];
    const other = [card({ dogId: 'd2', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })];
    const snapshot = JSON.stringify({ mine, other });

    compat.compatHints(mine, other);

    expect(JSON.stringify({ mine, other })).toBe(snapshot);
  });
});

describe('RULES 形状(B13)', () => {
  test('是非空数组,每条有 id / level / when / text', () => {
    expect(Array.isArray(compat.RULES)).toBe(true);
    expect(compat.RULES.length).toBeGreaterThanOrEqual(5);

    compat.RULES.forEach((r) => {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(['warn', 'info']).toContain(r.level);
      expect(typeof r.when).toBe('function');
      expect(typeof r.text).toBe('function');
    });
  });

  test('id 不重复,且包含 spec 3.3.6 点名的五条', () => {
    const ids = compat.RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    ['fearsBig-vs-large', 'size-gap', 'foodGuard', 'shy', 'chaser-vs-calm'].forEach((id) => {
      expect(ids).toContain(id);
    });
  });

  test('每条 when 对空入参都能跑且不抛', () => {
    compat.RULES.forEach((r) => {
      expect(() => r.when([], [])).not.toThrow();
      expect(r.when([], [])).toBe(false);
    });
  });
});
