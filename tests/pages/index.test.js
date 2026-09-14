/**
 * 首页(点位列表)—— 验收 B6。
 *
 * 注意 mock 路径:spec 3.3.3 里的 jest.mock('../../api/index') 是从页面文件视角写的,
 * 测试文件在 tests/pages/ 下,要写成 '../../miniprogram/api/index'。
 */

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { ApiError } = jest.requireActual('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/index/index.js';

/** SpotSummary —— spec 3.3.2 spotBoard 无 spotId 时的 data 形状 */
function spot(id, name, extra) {
  return Object.assign(
    {
      spotId: id,
      name,
      peakHint: '工作日 19:30-20:30',
      regularCount: 8,
      activeDogCount: 0,
      activePeopleCount: 0,
    },
    extra || {}
  );
}

/**
 * mini-runtime 在 require 完就把 global.wx 还原了,而页面方法是在那之后才调用的,
 * 所以这里把本次注入的 wx 重新挂回去,afterEach 再摘掉 —— 页面源码因此可以保持
 * 小程序里惯常的 wx.navigateTo(...) 写法,调用记录照常落在 page.__wx.__calls。
 */
function openPage() {
  const page = loadPage(PAGE);
  global.wx = page.__wx;
  return page;
}

afterEach(() => {
  delete global.wx;
});

/** 取某个 wx API 的调用记录 */
function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

describe('pages/index —— 点位列表', () => {
  test('onLoad 后 data.spots 长度等于 api.listSpots 返回的点位数', async () => {
    const seeded = [
      spot('s1', '中心花园南侧草坪', { activePeopleCount: 2, activeDogCount: 3 }),
      spot('s2', '三期小广场'),
      spot('s3', '河边步道入口'),
    ];
    api.listSpots.mockResolvedValue(seeded);

    const page = openPage();
    await page.onLoad.call(page, {});

    expect(api.listSpots).toHaveBeenCalledTimes(1);
    expect(page.data.spots).toHaveLength(seeded.length);
    expect(page.data.spots[0].name).toBe('中心花园南侧草坪');
    expect(page.data.errMsg).toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('api 抛错时 data.errMsg 非空,且 onLoad 自身不抛异常', async () => {
    api.listSpots.mockRejectedValue(new ApiError('INTERNAL', 'callFunction spotBoard failed'));

    const page = openPage();
    await expect(page.onLoad.call(page, {})).resolves.not.toThrow();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.spots).toEqual([]);
    expect(page.data.loading).toBe(false);
  });

  test('AUTH_REQUIRED 也只落到 errMsg,不跳转、不白屏', async () => {
    api.listSpots.mockRejectedValue(new ApiError('AUTH_REQUIRED', 'AUTH_REQUIRED'));

    const page = openPage();
    await page.onLoad.call(page, {});

    expect(page.data.errMsg).toContain('登录');
    expect(callsOf(page, 'redirectTo')).toHaveLength(0);
    expect(callsOf(page, 'navigateTo')).toHaveLength(0);
  });

  test('返回值不是数组时归一成空数组,不让脏数据进 data', async () => {
    api.listSpots.mockResolvedValue(null);

    const page = openPage();
    await page.onLoad.call(page, {});

    expect(page.data.spots).toEqual([]);
  });

  test('点某个点位 navigateTo 到 spot 页并带上 spotId', async () => {
    api.listSpots.mockResolvedValue([spot('s1', '中心花园南侧草坪')]);

    const page = openPage();
    await page.onLoad.call(page, {});
    page.goSpot.call(page, { currentTarget: { dataset: { spotId: 's1' } } });

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/spot/spot?spotId=s1');
  });

  test('dataset 里没有 spotId 就不跳转', async () => {
    api.listSpots.mockResolvedValue([]);

    const page = openPage();
    await page.onLoad.call(page, {});
    page.goSpot.call(page, { currentTarget: { dataset: {} } });

    expect(callsOf(page, 'navigateTo')).toHaveLength(0);
  });

  test('下拉刷新重新拉取,并且一定 stopPullDownRefresh', async () => {
    api.listSpots.mockResolvedValue([spot('s1', '中心花园南侧草坪')]);

    const page = openPage();
    await page.onLoad.call(page, {});
    api.listSpots.mockRejectedValue(new ApiError('INTERNAL', 'boom'));
    await expect(page.onPullDownRefresh.call(page)).resolves.not.toThrow();

    expect(api.listSpots).toHaveBeenCalledTimes(2);
    expect(page.data.errMsg).not.toBe('');
    expect(callsOf(page, 'stopPullDownRefresh')).toHaveLength(1);
  });

  test('首次进入时 onShow 不重复拉;从子页返回时才刷新在场人数', async () => {
    api.listSpots.mockResolvedValue([spot('s1', '中心花园南侧草坪')]);

    const page = openPage();
    await page.onLoad.call(page, {});
    await page.onShow.call(page); // 紧跟在 onLoad 后面的那次,应当跳过
    expect(api.listSpots).toHaveBeenCalledTimes(1);

    api.listSpots.mockResolvedValue([
      spot('s1', '中心花园南侧草坪', { activePeopleCount: 4, activeDogCount: 5 }),
    ]);
    await page.onShow.call(page); // 从 spot 页返回
    expect(api.listSpots).toHaveBeenCalledTimes(2);
    expect(page.data.spots[0].activePeopleCount).toBe(4);
  });
});
