/**
 * T10-a —— 发起约遛 pages/walk/create/create.js
 *
 * 覆盖:未选狗 / 未选公园 / 时间在过去时本地拦下不调 api;
 *       合法提交载荷形状正确并 redirectTo 详情页。
 */

jest.mock('../../miniprogram/api/index');
jest.mock('../../miniprogram/pages/walk/clock');

const api = require('../../miniprogram/api/index');
const clock = require('../../miniprogram/pages/walk/clock');
const { loadPage } = require('../fakes/mini-runtime');
const { LIMITS } = require('../../miniprogram/logic/enums');

const PAGE = 'miniprogram/pages/walk/create/create.js';
const NOW = '2026-09-16T02:00:00.000Z'; // = 东八区 2026-09-16 10:00

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

function park(over) {
  return Object.assign(
    { parkId: 'p1', name: '西湖公园', latitude: 30.25, longitude: 120.15, radiusM: 300, activeDogCount: 0 },
    over || {}
  );
}

/** api.listMyDogs 返回的是完整 Dog 文档(spec 3.2.2),页面得自己收敛成 DogCard */
function dog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: 'o1',
      name: '旺财',
      avatarFileID: '',
      breed: '柴犬',
      gender: 'male',
      birthMonth: '2023-05',
      sizeClass: 'medium',
      neutered: true,
      vaccinated: true,
      licenseNo: '',
      tags: ['ball'],
      tagCode: '',
      qrFileID: '',
      lostMode: false,
      lostNote: '',
    },
    over || {}
  );
}

const PARKS = [park(), park({ parkId: 'p2', name: '城北公园' })];
const DOGS = [dog(), dog({ _id: 'd2', name: '豆豆', sizeClass: 'small' })];

function wxCalls(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

/** 走一遍 onLoad + 填好一份能过的表单 */
async function ready(over) {
  api.listParks.mockResolvedValue(PARKS);
  api.listMyDogs.mockResolvedValue(DOGS);
  const page = loadPage(PAGE);
  await page.onLoad((over && over.query) || {});
  return page;
}

beforeEach(() => {
  clock.nowIso.mockReturnValue(NOW);
});

describe('发起约遛 —— 加载(T10-a)', () => {
  test('onLoad 并行拉公园和我的狗', async () => {
    const page = await ready();

    expect(api.listParks).toHaveBeenCalledTimes(1);
    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.parkNames).toEqual(['西湖公园', '城北公园']);
    expect(page.data.dogs.map((d) => d.name)).toEqual(['旺财', '豆豆']);
    expect(page.data.errMsg).toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('query.parkId 预选公园', async () => {
    const page = await ready({ query: { parkId: 'p2' } });

    expect(page.data.parkId).toBe('p2');
    expect(page.data.parkIndex).toBe(1);
  });

  test('没带 parkId 时不预选', async () => {
    const page = await ready();

    expect(page.data.parkId).toBe('');
    expect(page.data.parkIndex).toBe(-1);
  });

  test('只有一只狗时默认选中', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listMyDogs.mockResolvedValue([dog()]);

    const page = loadPage(PAGE);
    await page.onLoad({});

    expect(page.data.selectedDogIds).toEqual(['d1']);
    expect(page.data.dogs[0].selected).toBe(true);
  });

  test('多只狗时不替用户做主', async () => {
    const page = await ready();

    expect(page.data.selectedDogIds).toEqual([]);
  });

  test('默认时间取自 clock,不早于现在;最早可选日也来自 clock', async () => {
    const page = await ready();

    expect(clock.nowIso).toHaveBeenCalled();
    expect(page.data.minDate).toBe('2026-09-16');
    expect(page.data.date).toBe('2026-09-16');
    expect(page.data.time).toBe('11:00'); // 东八区 10:00 往后推一个整点
  });

  test('狗数上限默认取 LIMITS.WALK_MAX_DOGS_DEFAULT', async () => {
    const page = await ready();

    expect(page.data.maxDogs).toBe(LIMITS.WALK_MAX_DOGS_DEFAULT);
    expect(page.data.maxDogsCap).toBe(LIMITS.WALK_MAX_DOGS_CAP);
    expect(page.data.noteMax).toBe(LIMITS.WALK_NOTE_MAX);
  });

  test('页面 data 里没有主人身份字段(狗只留 DogCard 字段)', async () => {
    const page = await ready();

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toMatch(/openid/i);
    expect(dumped).not.toMatch(/nickname/i);
    expect(page.data.dogs[0].dogId).toBe('d1');
    expect(page.data.dogs[0].ownerOpenid).toBeUndefined();
  });

  test('listMyDogs reject 时 errMsg 非空且不抛', async () => {
    api.listParks.mockResolvedValue(PARKS);
    api.listMyDogs.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({})).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });
});

describe('发起约遛 —— 本地拦截(T10-a)', () => {
  test('没选公园 —— 不调 api,errMsg 非空', async () => {
    const page = await ready();
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.submitting).toBe(false);
  });

  test('没选狗 —— 不调 api,errMsg 非空', async () => {
    const page = await ready({ query: { parkId: 'p1' } });

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('时间在过去 —— 不调 api,errMsg 非空', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onDateChange({ detail: { value: '2026-09-15' } });
    page.onTimeChange({ detail: { value: '08:00' } });

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('同一天但时刻已过 —— 也拦下', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onDateChange({ detail: { value: '2026-09-16' } });
    page.onTimeChange({ detail: { value: '09:00' } }); // 东八区 09:00 < 现在 10:00

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('备注超长 —— 不调 api,errMsg 非空', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onNoteInput({ detail: { value: '狗'.repeat(LIMITS.WALK_NOTE_MAX + 1) } });

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('选的狗比上限多 —— 不调 api,errMsg 非空', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd2' } } });
    page.setData({ maxDogs: 1 });

    await page.onSubmit();

    expect(api.createWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('发起约遛 —— 上限增减(T10-a)', () => {
  test('加到 cap 就不再涨,减不到已选狗数以下', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd2' } } });

    for (let i = 0; i < LIMITS.WALK_MAX_DOGS_CAP + 3; i += 1) page.onMaxDogsPlus();
    expect(page.data.maxDogs).toBe(LIMITS.WALK_MAX_DOGS_CAP);

    for (let i = 0; i < LIMITS.WALK_MAX_DOGS_CAP + 3; i += 1) page.onMaxDogsMinus();
    expect(page.data.maxDogs).toBe(2); // 已经选了两只狗
  });

  test('一只狗都没选时最小到 1', async () => {
    const page = await ready({ query: { parkId: 'p1' } });

    for (let i = 0; i < 10; i += 1) page.onMaxDogsMinus();

    expect(page.data.maxDogs).toBe(1);
  });
});

describe('发起约遛 —— 提交(T10-a)', () => {
  test('合法提交:载荷形状正确,redirectTo 带 walkId', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    page.onDateChange({ detail: { value: '2026-09-20' } });
    page.onTimeChange({ detail: { value: '18:30' } });
    page.onNoteInput({ detail: { value: '带球来' } });
    page.onMaxDogsPlus();
    api.createWalk.mockResolvedValue({ walkId: 'w7', parkId: 'p1', status: 'open' });

    await page.onSubmit();

    expect(api.createWalk).toHaveBeenCalledTimes(1);
    const payload = api.createWalk.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['dogIds', 'maxDogs', 'note', 'parkId', 'startAt']);
    expect(payload.parkId).toBe('p1');
    expect(payload.dogIds).toEqual(['d1']);
    expect(payload.note).toBe('带球来');
    expect(payload.maxDogs).toBe(LIMITS.WALK_MAX_DOGS_DEFAULT + 1);
    // 东八区 2026-09-20 18:30
    expect(payload.startAt).toBe('2026-09-20T10:30:00.000Z');
    expect(new Date(payload.startAt).getTime()).toBeGreaterThan(new Date(NOW).getTime());

    expect(wxCalls(page, 'redirectTo')[0].opts.url).toBe('/pages/walk/detail/detail?walkId=w7');
    expect(page.data.submitting).toBe(false);
  });

  test('切换公园 picker 后提交用新公园', async () => {
    const page = await ready();
    page.onParkChange({ detail: { value: '1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd2' } } });
    api.createWalk.mockResolvedValue({ walkId: 'w8' });

    await page.onSubmit();

    expect(api.createWalk.mock.calls[0][0].parkId).toBe('p2');
    expect(api.createWalk.mock.calls[0][0].dogIds).toEqual(['d2']);
  });

  test('createWalk reject —— errMsg 非空,不跳转,不抛', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    api.createWalk.mockRejectedValue(apiError('CONTENT_RISKY', 'note'));

    await expect(page.onSubmit()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(wxCalls(page, 'redirectTo')).toHaveLength(0);
    expect(page.data.submitting).toBe(false);
  });

  test('提交中重复点击只发一次', async () => {
    const page = await ready({ query: { parkId: 'p1' } });
    page.onToggleDog({ currentTarget: { dataset: { id: 'd1' } } });
    let release;
    api.createWalk.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ walkId: 'w9' });
      })
    );

    const first = page.onSubmit();
    await page.onSubmit();
    release();
    await first;

    expect(api.createWalk).toHaveBeenCalledTimes(1);
  });
});
