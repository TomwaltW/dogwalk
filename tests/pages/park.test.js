/**
 * T8 —— 公园详情 pages/park/park.js
 *
 * 验收 T8-a(派单第 7 节):
 *   dogs 为空时 data.emptyText 含「第一只」;
 *   myCheckin 非 null 时显示签退并能调 api.cancelCheckin;
 *   getParkBoard 抛错时 errMsg 非空;
 *   JSON.stringify(page.data) 不含 openid / nickname。
 */

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const format = require('../../miniprogram/pages/park/format');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/park/park.js';

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** DogCard(spec 3.2.3)—— 故意多塞两个主人字段,页面必须把它们丢掉 */
function makeDog(over) {
  return Object.assign(
    {
      dogId: 'd1',
      name: '旺财',
      avatarFileID: '',
      sizeClass: 'medium',
      tags: ['ball', 'shy'],
      ownerOpenid: 'o-should-not-leak',
      nickname: '张三',
    },
    over || {}
  );
}

/** ParkBoard(spec 3.2.3) */
function makeBoard(over) {
  return Object.assign(
    {
      park: {
        parkId: 'p1',
        name: '城西公园',
        latitude: 30.28,
        longitude: 120.12,
        radiusM: 200,
        activeDogCount: 2,
      },
      dogs: [makeDog(), makeDog({ dogId: 'd2', name: '二哈', sizeClass: 'large', tags: [] })],
      todayDogs: [makeDog()],
      myCheckin: null,
    },
    over || {}
  );
}

function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

describe('公园详情 —— 看板加载(T8-a)', () => {
  test('onLoad 后 park / dogs / todayDogs 落到 data,标题用公园名', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard());

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });

    expect(api.getParkBoard).toHaveBeenCalledWith('p1');
    expect(page.data.park.name).toBe('城西公园');
    expect(page.data.dogs).toHaveLength(2);
    expect(page.data.dogs[0].name).toBe('旺财');
    // DogCard 只展示体型与标签的中文,不展示任何主人信息
    expect(page.data.dogs[0].sizeText).toBe('中型犬');
    expect(page.data.dogs[0].tagsText).toBe('爱玩球 / 怕生');
    expect(page.data.todayDogs).toHaveLength(1);
    expect(page.data.errMsg).toBe('');
    expect(page.data.loading).toBe(false);

    const titles = callsOf(page, 'setNavigationBarTitle');
    expect(titles).toHaveLength(1);
    expect(titles[0].opts.title).toBe('城西公园');
  });

  test('dogs 为空时 data.emptyText 含「第一只」,todayDogs 为空时另给一句', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard({ dogs: [], todayDogs: [] }));

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });

    expect(page.data.emptyText).toContain('第一只');
    expect(page.data.todayEmptyText).not.toBe('');
    expect(page.data.todayEmptyText).not.toBe(page.data.emptyText);
  });

  test('getParkBoard 抛错时 errMsg 非空且不抛异常', async () => {
    api.getParkBoard.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({ parkId: 'p1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('没拿到 parkId 时落 errMsg,不调 api', async () => {
    const page = loadPage(PAGE);
    await expect(page.onLoad({})).resolves.toBeUndefined();

    expect(api.getParkBoard).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('onShow 首次不重复拉,从签到页回来时重新拉', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard());

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });
    expect(api.getParkBoard).toHaveBeenCalledTimes(1);

    await page.onShow(); // 首次:onLoad 刚拉过
    expect(api.getParkBoard).toHaveBeenCalledTimes(1);

    await page.onShow(); // 从签到页退回来
    expect(api.getParkBoard).toHaveBeenCalledTimes(2);
  });

  test('下拉刷新重新拉并停掉刷新动画', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard());

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });
    await page.onPullDownRefresh();

    expect(api.getParkBoard).toHaveBeenCalledTimes(2);
    expect(callsOf(page, 'stopPullDownRefresh')).toHaveLength(1);
  });
});

describe('公园详情 —— 签到 / 签退入口(T8-a)', () => {
  test('myCheckin 为 null 时点签到跳到带 parkId 的签到页', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard());

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });
    expect(page.data.myCheckin).toBeNull();

    page.onCheckin();

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/checkin/checkin?parkId=p1');
  });

  test('myCheckin 非 null 时显示在场中与有效时间,onCancel 调 api.cancelCheckin 并重拉', async () => {
    const board = makeBoard({
      myCheckin: { checkinId: 'c1', dogIds: ['d1'], expireAt: '2026-09-16T12:00:00+08:00' },
    });
    api.getParkBoard.mockResolvedValue(board);
    api.cancelCheckin.mockResolvedValue({ cancelled: true });

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });

    expect(page.data.myCheckin.checkinId).toBe('c1');
    expect(page.data.expireText).toBe('12:00');

    await page.onCancel();

    expect(api.cancelCheckin).toHaveBeenCalledWith('c1');
    expect(api.getParkBoard).toHaveBeenCalledTimes(2); // 签退后重拉看板
  });

  test('cancelCheckin 抛错时落 errMsg,不抛', async () => {
    api.getParkBoard.mockResolvedValue(
      makeBoard({ myCheckin: { checkinId: 'c1', dogIds: ['d1'], expireAt: '2026-09-16T12:00:00+08:00' } })
    );
    api.cancelCheckin.mockRejectedValue(apiError('FORBIDDEN', '不是你的签到'));

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });
    await expect(page.onCancel()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
  });

  test('「在这发起约遛」跳到带 parkId 的发起页', async () => {
    api.getParkBoard.mockResolvedValue(makeBoard());

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });
    page.onCreateWalk();

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/walk/create/create?parkId=p1');
  });
});

describe('公园详情 —— 不泄露主人信息(T8-a)', () => {
  test('JSON.stringify(page.data) 不含 openid / nickname', async () => {
    api.getParkBoard.mockResolvedValue(
      makeBoard({ myCheckin: { checkinId: 'c1', dogIds: ['d1'], expireAt: '2026-09-16T12:00:00+08:00' } })
    );

    const page = loadPage(PAGE);
    await page.onLoad({ parkId: 'p1' });

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toContain('openid');
    expect(dumped).not.toContain('nickname');
    expect(dumped).not.toContain('张三');
  });
});

describe('公园详情 —— format.hhmm 纯函数', () => {
  test('带 +08:00 的 ISO 直接取时分', () => {
    expect(format.hhmm('2026-09-16T09:05:00+08:00')).toBe('09:05');
  });

  test('UTC 的 ISO 折算到东八区', () => {
    expect(format.hhmm('2026-09-16T04:00:00.000Z')).toBe('12:00');
    expect(format.hhmm('2026-09-16T20:30:00Z')).toBe('04:30'); // 跨天回绕
  });

  test('不带时区的按本地时分原样返回', () => {
    expect(format.hhmm('2026-09-16T23:59:00')).toBe('23:59');
  });

  test('空 / 乱串返回空字符串,不抛', () => {
    expect(format.hhmm('')).toBe('');
    expect(format.hhmm(null)).toBe('');
    expect(format.hhmm('明天中午')).toBe('');
  });
});
