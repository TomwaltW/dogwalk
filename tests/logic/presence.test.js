/**
 * tests/logic/presence.test.js —— owner: T2
 *
 * 对应 spec 2.2 B8:
 *   ① aggregateBoard() 把同一用户多只狗合并为一条在场记录
 *   ② isActive() 对边界时刻(恰好等于 expireAt)返回 false
 */

const { isActive, aggregateBoard, presenceCounts } = require('../../miniprogram/logic/presence');
const { CHECKIN_DURATION_MS } = require('../../cloudfunctions/_shared/contracts');

const T0 = new Date('2026-09-14T19:30:00+08:00');
const at = (ms) => new Date(T0.getTime() + ms);

/** 一条默认在场的广播 */
function checkin(patch) {
  return Object.assign(
    {
      _id: 'c1',
      openid: 'o1',
      spotId: 's1',
      dogIds: ['d1'],
      startAt: T0,
      expireAt: at(CHECKIN_DURATION_MS),
      note: '',
      status: 'active',
    },
    patch
  );
}

const DOGS = [
  { _id: 'd1', ownerOpenid: 'o1', name: '旺财', avatarFileID: 'f-d1', sizeClass: 'small', socialOk: true },
  { _id: 'd2', ownerOpenid: 'o1', name: '来福', avatarFileID: 'f-d2', sizeClass: 'large', socialOk: true },
  { _id: 'd3', ownerOpenid: 'o2', name: '二黑', avatarFileID: 'f-d3', sizeClass: 'medium', socialOk: true },
  { _id: 'd9', ownerOpenid: 'o1', name: '社恐', avatarFileID: '', sizeClass: 'small', socialOk: false },
];

const USERS = [
  { _id: 'o1', _openid: 'o1', nickname: '阿甲', avatarFileID: 'f-o1' },
  { _id: 'o2', _openid: 'o2', nickname: '阿乙', avatarFileID: 'f-o2' },
];

const opts = (patch) => Object.assign({ now: T0, dogs: DOGS, users: USERS }, patch);

describe('presence.isActive —— B8②', () => {
  test('B8②: 边界时刻(now 恰好等于 expireAt)返回 false', () => {
    const c = checkin();
    expect(isActive(c, at(CHECKIN_DURATION_MS))).toBe(false);
  });

  test('未到期返回 true,过期一毫秒即 false', () => {
    const c = checkin();
    expect(isActive(c, at(CHECKIN_DURATION_MS - 1))).toBe(true);
    expect(isActive(c, at(CHECKIN_DURATION_MS + 1))).toBe(false);
    expect(isActive(c, T0)).toBe(true);
  });

  test('status 不是 active 一律 false,即便还没到期', () => {
    expect(isActive(checkin({ status: 'cancelled' }), T0)).toBe(false);
  });

  test('ISO 字符串与毫秒数与 Date 等价', () => {
    const c = checkin({ startAt: T0.toISOString(), expireAt: at(CHECKIN_DURATION_MS).toISOString() });
    expect(isActive(c, T0.toISOString())).toBe(true);
    expect(isActive(c, at(CHECKIN_DURATION_MS).getTime())).toBe(false);
  });

  test('脏数据不抛异常,一律 false', () => {
    expect(isActive(null, T0)).toBe(false);
    expect(isActive(checkin({ expireAt: 'not-a-date' }), T0)).toBe(false);
    expect(isActive(checkin(), 'not-a-date')).toBe(false);
  });
});

describe('presence.aggregateBoard —— B8①', () => {
  test('B8①: 同一用户多只狗合并为一条在场记录(一条广播带多只狗)', () => {
    const board = aggregateBoard([checkin({ dogIds: ['d1', 'd2'] })], opts());
    expect(board).toHaveLength(1);
    expect(board[0].openid).toBe('o1');
    expect(board[0].dogs.map((d) => d.name)).toEqual(['旺财', '来福']);
  });

  test('B8①: 同一用户多条在场广播也合并为一条记录,狗去重取并集', () => {
    const board = aggregateBoard(
      [
        checkin({ _id: 'c1', dogIds: ['d1'], startAt: at(0), expireAt: at(CHECKIN_DURATION_MS) }),
        checkin({ _id: 'c2', dogIds: ['d1', 'd2'], startAt: at(60000), expireAt: at(60000 + CHECKIN_DURATION_MS) }),
      ],
      opts()
    );
    expect(board).toHaveLength(1);
    expect(board[0].dogs.map((d) => d.name)).toEqual(['旺财', '来福']);
    // 起点取最早、终点取最晚
    expect(board[0].startAt).toBe(at(0).toISOString());
    expect(board[0].expireAt).toBe(at(60000 + CHECKIN_DURATION_MS).toISOString());
  });

  test('不同用户各自一条,BoardSession 形状与 spec 3.3.2 一致', () => {
    const board = aggregateBoard(
      [checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1'], note: '在南门' }), checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'] })],
      opts()
    );
    expect(board).toHaveLength(2);
    expect(Object.keys(board[0]).sort()).toEqual(
      ['avatarFileID', 'dogs', 'expireAt', 'nickname', 'note', 'openid', 'startAt'].sort()
    );
    expect(board[0]).toMatchObject({ openid: 'o1', nickname: '阿甲', avatarFileID: 'f-o1', note: '在南门' });
    expect(Object.keys(board[0].dogs[0]).sort()).toEqual(['avatarFileID', 'name', 'sizeClass']);
  });

  test('已过期与已取消的广播不进看板', () => {
    const board = aggregateBoard(
      [
        checkin({ _id: 'c1', openid: 'o1', expireAt: at(-1) }),
        checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'], status: 'cancelled' }),
      ],
      opts()
    );
    expect(board).toEqual([]);
  });

  test('socialOk:false 的狗不露出;整条广播都不社交时整条记录消失', () => {
    const mixed = aggregateBoard([checkin({ dogIds: ['d1', 'd9'] })], opts());
    expect(mixed[0].dogs.map((d) => d.name)).toEqual(['旺财']);

    const allHidden = aggregateBoard([checkin({ dogIds: ['d9'] })], opts());
    expect(allHidden).toEqual([]);
  });

  test('传不进来的 dogId 被跳过,不制造空壳记录', () => {
    expect(aggregateBoard([checkin({ dogIds: ['ghost'] })], opts())).toEqual([]);
  });

  test('users 里查不到的人给出空昵称,不抛异常', () => {
    const board = aggregateBoard([checkin({ openid: 'o9', dogIds: ['d1'] })], opts());
    expect(board[0]).toMatchObject({ openid: 'o9', nickname: '', avatarFileID: '' });
  });

  test('空输入返回空数组而非报错', () => {
    expect(aggregateBoard([], opts())).toEqual([]);
    expect(aggregateBoard(null, opts())).toEqual([]);
  });

  test('缺 now 时直接报错,不静默返回空看板', () => {
    expect(() => aggregateBoard([checkin()], { dogs: DOGS, users: USERS })).toThrow(/now/);
  });
});

describe('presence.presenceCounts', () => {
  test('人数按 session 计、狗数按去重后的狗计', () => {
    const board = aggregateBoard(
      [checkin({ _id: 'c1', openid: 'o1', dogIds: ['d1', 'd2'] }), checkin({ _id: 'c2', openid: 'o2', dogIds: ['d3'] })],
      opts()
    );
    expect(presenceCounts(board)).toEqual({ activePeopleCount: 2, activeDogCount: 3 });
  });

  test('空看板计数为 0', () => {
    expect(presenceCounts([])).toEqual({ activePeopleCount: 0, activeDogCount: 0 });
  });
});
