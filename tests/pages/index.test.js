/**
 * T8 —— 首页地图 pages/index/index.js
 *
 * 验收 B8(spec 2.2):
 *   onLoad 后 data.markers.length 等于 mock listParks 返回的公园数,
 *   每个 marker 的 callout.content 含该公园的 activeDogCount;
 *   listParks 返回 [] 时调一次 initParks 再拉;
 *   api 抛错时 data.errMsg 非空且不抛异常。
 */

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const config = require('../../miniprogram/config');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/index/index.js';

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** ParkSummary(spec 3.2.3) */
function makePark(over) {
  return Object.assign(
    {
      parkId: 'p1',
      name: '城西公园',
      latitude: 30.28,
      longitude: 120.12,
      radiusM: 200,
      activeDogCount: 3,
    },
    over || {}
  );
}

const TWO_PARKS = [
  makePark(),
  makePark({ parkId: 'p2', name: '运河边草坪', latitude: 30.31, longitude: 120.14, activeDogCount: 0 }),
];

/** 页面注入的那份 wx 上,某个 API 的调用记录 */
function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

describe('首页地图 —— 拉公园与 marker(B8)', () => {
  test('onLoad 后 markers 数量等于公园数,每个 callout.content 含该公园的 activeDogCount', async () => {
    api.listParks.mockResolvedValue(TWO_PARKS);

    const page = loadPage(PAGE);
    await page.onLoad();

    expect(api.listParks).toHaveBeenCalledTimes(1);
    expect(api.initParks).not.toHaveBeenCalled();
    expect(page.data.markers).toHaveLength(TWO_PARKS.length);

    page.data.markers.forEach((m, i) => {
      const park = TWO_PARKS[i];
      expect(m.id).toBe(i);
      expect(m.parkId).toBe(park.parkId);
      expect(m.latitude).toBe(park.latitude);
      expect(m.longitude).toBe(park.longitude);
      expect(m.title).toBe(park.name);
      // 漏了 iconPath 真机不显示 marker
      expect(m.iconPath).toBeTruthy();
      expect(m.callout.content).toContain(String(park.activeDogCount));
      expect(m.callout.content).toContain(park.name);
      expect(m.callout.display).toBe('ALWAYS');
    });

    expect(page.data.loading).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('有公园时地图中心取第一个公园,没有公园时留在 config 的默认中心', async () => {
    api.listParks.mockResolvedValue(TWO_PARKS);
    const page = loadPage(PAGE);
    await page.onLoad();
    expect(page.data.center).toEqual({ latitude: 30.28, longitude: 120.12 });
    expect(page.data.scale).toBe(config.DEFAULT_MAP_SCALE);

    api.listParks.mockResolvedValue([]);
    api.initParks.mockResolvedValue({ inserted: 0, total: 0 });
    const blank = loadPage(PAGE);
    await blank.onLoad();
    expect(blank.data.center).toEqual(config.DEFAULT_MAP_CENTER);
  });

  test('listParks 返回 [] 时调一次 initParks 再拉,重复刷新不会再 init', async () => {
    api.listParks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(TWO_PARKS)
      .mockResolvedValue([]); // 之后再拉都是空,看它会不会再 seed 一次
    api.initParks.mockResolvedValue({ inserted: 3, total: 3 });

    const page = loadPage(PAGE);
    await page.onLoad();

    expect(api.initParks).toHaveBeenCalledTimes(1);
    expect(api.listParks).toHaveBeenCalledTimes(2);
    expect(page.data.parks).toHaveLength(2);
    expect(page.data.markers).toHaveLength(2);
    expect(page.data.seeded).toBe(true);

    await page.onPullDownRefresh();
    expect(api.initParks).toHaveBeenCalledTimes(1);
    expect(callsOf(page, 'stopPullDownRefresh')).toHaveLength(1);
  });

  test('listParks 抛错时 data.errMsg 非空且 onLoad 不抛异常', async () => {
    api.listParks.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));

    const page = loadPage(PAGE);
    await expect(page.onLoad()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
    expect(page.data.markers).toEqual([]);
  });

  test('initParks 抛错时也只落 errMsg,不抛', async () => {
    api.listParks.mockResolvedValue([]);
    api.initParks.mockRejectedValue(apiError('INTERNAL', 'init 挂了'));

    const page = loadPage(PAGE);
    await expect(page.onLoad()).resolves.toBeUndefined();
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('首页地图 —— 进公园页(B8)', () => {
  test('onMarkerTap 跳到带 parkId 的公园页', async () => {
    api.listParks.mockResolvedValue(TWO_PARKS);
    const page = loadPage(PAGE);
    await page.onLoad();

    page.onMarkerTap({ detail: { markerId: 1 } });

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/park/park?parkId=p2');
  });

  test('点下面的公园卡片同样进公园页', async () => {
    api.listParks.mockResolvedValue(TWO_PARKS);
    const page = loadPage(PAGE);
    await page.onLoad();

    page.onTapPark({ currentTarget: { dataset: { parkId: 'p1' } } });

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/park/park?parkId=p1');
  });

  test('markerId 对不上任何公园时什么都不做,不抛', async () => {
    api.listParks.mockResolvedValue(TWO_PARKS);
    const page = loadPage(PAGE);
    await page.onLoad();

    expect(() => page.onMarkerTap({ detail: { markerId: 99 } })).not.toThrow();
    expect(() => page.onMarkerTap({})).not.toThrow();
    expect(callsOf(page, 'navigateTo')).toHaveLength(0);
  });
});

describe('首页地图 —— 不泄露主人信息', () => {
  test('页面 data 里不出现 openid / nickname', async () => {
    api.listParks.mockResolvedValue([
      Object.assign(makePark(), { ownerOpenid: 'o1', nickname: '张三' }),
    ]);

    const page = loadPage(PAGE);
    await page.onLoad();

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toContain('openid');
    expect(dumped).not.toContain('nickname');
    expect(dumped).not.toContain('张三');
  });
});
