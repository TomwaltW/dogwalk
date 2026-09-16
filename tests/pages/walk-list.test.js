/**
 * T10-b —— 约遛列表 pages/walk/list/list.js
 *
 * 覆盖:切换公园筛选后 api.listWalks 收到对应 parkId;清空日期后不传 date;
 *       空结果 data.emptyText 非空;listWalks reject 时 data.errMsg 非空且不抛。
 */

jest.mock('../../miniprogram/api/index');
jest.mock('../../miniprogram/pages/walk/clock');

const api = require('../../miniprogram/api/index');
const clock = require('../../miniprogram/pages/walk/clock');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/walk/list/list.js';
const NOW = '2026-09-16T02:00:00.000Z'; // = 东八区 2026-09-16 10:00

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

function park(over) {
  return Object.assign(
    { parkId: 'p1', name: '西湖公园', latitude: 30.25, longitude: 120.15, radiusM: 300, activeDogCount: 2 },
    over || {}
  );
}

function card(over) {
  return Object.assign({ dogId: 'd1', name: '旺财', avatarFileID: '', sizeClass: 'medium', tags: [] }, over || {});
}

/** WalkSummary(spec 3.2.3) */
function walk(over) {
  return Object.assign(
    {
      walkId: 'w1',
      parkId: 'p1',
      parkName: '西湖公园',
      startAt: '2026-09-16T10:30:00.000Z',
      note: '带球来',
      maxDogs: 3,
      dogCount: 1,
      hostDogs: [card()],
      status: 'open',
      isHost: false,
      myStatus: 'none',
    },
    over || {}
  );
}

const PARKS = [park(), park({ parkId: 'p2', name: '城北公园' })];

function wxCalls(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

beforeEach(() => {
  clock.nowIso.mockReturnValue(NOW);
});

describe('约遛列表 —— 加载(T10-b)', () => {
  test('onLoad 拉公园填 picker,首项是「全部公园」', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});

    expect(api.listParks).toHaveBeenCalledTimes(1);
    expect(page.data.parkNames[0]).toBe('全部公园');
    expect(page.data.parkNames).toEqual(['全部公园', '西湖公园', '城北公园']);
    expect(page.data.parkId).toBe('');
    expect(page.data.errMsg).toBe('');
  });

  test('onShow 拉约遛,没选筛选时 filter 是空对象', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([walk(), walk({ walkId: 'w2' })]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();

    expect(api.listWalks).toHaveBeenCalledTimes(1);
    expect(api.listWalks).toHaveBeenCalledWith({});
    expect(page.data.walks).toHaveLength(2);
    expect(page.data.emptyText).toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('行上有公园名 / 时间 / 狗数 / 我的关系', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([
      walk({ dogCount: 2, maxDogs: 4, myStatus: 'host', isHost: true }),
      walk({ walkId: 'w2', myStatus: 'pending' }),
      walk({ walkId: 'w3', myStatus: 'none' }),
    ]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();

    const [a, b, c] = page.data.walks;
    expect(a.parkName).toBe('西湖公园');
    expect(a.countText).toBe('2/4');
    // 东八区 2026-09-16 18:30
    expect(a.timeText).toBe('09-16 18:30');
    expect(a.relText).toBe('我发起的');
    expect(b.relText).toBe('待确认');
    expect(c.relText).toBe('');
    // 发起人的狗只用 DogCard 字段
    expect(a.hostDogs[0].name).toBe('旺财');
  });

  test('列表页 data 里没有主人身份字段', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([walk()]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toMatch(/openid/i);
    expect(dumped).not.toMatch(/nickname/i);
  });
});

describe('约遛列表 —— 筛选(T10-b)', () => {
  test('切换公园筛选后 api.listWalks 收到对应 parkId', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();
    api.listWalks.mockClear();

    await page.onParkChange({ detail: { value: '2' } }); // 城北公园

    expect(page.data.parkId).toBe('p2');
    expect(api.listWalks).toHaveBeenCalledTimes(1);
    expect(api.listWalks).toHaveBeenCalledWith({ parkId: 'p2' });
  });

  test('选回「全部公园」后不再传 parkId', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onParkChange({ detail: { value: '1' } });
    api.listWalks.mockClear();

    await page.onParkChange({ detail: { value: '0' } });

    expect(page.data.parkId).toBe('');
    expect(api.listWalks).toHaveBeenCalledWith({});
  });

  test('选日期后带 date,清空后不传 date', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onDateChange({ detail: { value: '2026-09-20' } });

    expect(page.data.date).toBe('2026-09-20');
    expect(api.listWalks).toHaveBeenLastCalledWith({ date: '2026-09-20' });

    await page.onClearDate();

    expect(page.data.date).toBe('');
    const last = api.listWalks.mock.calls[api.listWalks.mock.calls.length - 1][0];
    expect(Object.prototype.hasOwnProperty.call(last, 'date')).toBe(false);
    expect(last).toEqual({});
  });

  test('公园 + 日期一起选时两个 key 都带', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onParkChange({ detail: { value: '1' } });
    await page.onDateChange({ detail: { value: '2026-09-20' } });

    expect(api.listWalks).toHaveBeenLastCalledWith({ parkId: 'p1', date: '2026-09-20' });
  });

  test('日期 picker 的最早可选日来自 clock,不用裸时钟', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});

    expect(clock.nowIso).toHaveBeenCalled();
    expect(page.data.minDate).toBe('2026-09-16');
  });
});

describe('约遛列表 —— 空与失败(T10-b)', () => {
  test('空结果时 data.emptyText 非空', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();

    expect(page.data.walks).toEqual([]);
    expect(page.data.emptyText).not.toBe('');
    expect(typeof page.data.emptyText).toBe('string');
  });

  test('选了日期又没结果时,提示里点出「这天」', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onDateChange({ detail: { value: '2026-09-20' } });

    expect(page.data.emptyText).toBe('这天还没有人约遛,发起一个吧');
  });

  test('listWalks reject 时 errMsg 非空且不抛', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));

    const page = loadPage(PAGE);
    await page.onLoad({});
    await expect(page.onShow()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.walks).toEqual([]);
    expect(page.data.loading).toBe(false);
  });

  test('listParks reject 时也不抛,筛选退化成只有「全部公园」', async () => {
    api.listParks.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await expect(page.onLoad({})).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.parkNames).toEqual(['全部公园']);
  });

  test('下拉刷新重新拉一次并停掉刷新动画', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    api.listWalks.mockClear();

    await page.onPullDownRefresh();

    expect(api.listWalks).toHaveBeenCalledTimes(1);
    expect(wxCalls(page, 'stopPullDownRefresh')).toHaveLength(1);
  });
});

describe('约遛列表 —— 跳转(T10-b)', () => {
  test('点右下角悬浮按钮进发起页', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    page.onTapCreate();

    expect(wxCalls(page, 'navigateTo')[0].opts.url).toBe('/pages/walk/create/create');
  });

  test('点行进详情页,带上 walkId', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listWalks.mockResolvedValue([walk({ walkId: 'w9' })]);

    const page = loadPage(PAGE);
    await page.onLoad({});
    await page.onShow();
    page.onTapWalk({ currentTarget: { dataset: { id: 'w9' } } });

    expect(wxCalls(page, 'navigateTo')[0].opts.url).toBe('/pages/walk/detail/detail?walkId=w9');
  });
});
