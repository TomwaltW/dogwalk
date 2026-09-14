/**
 * 发广播「我出门了」—— 验收 T4-a。
 *
 * 重点:未选狗必须在页面本地拦下 —— data.errMsg 非空,且 api 一次都不许被调用。
 * 时间统一走 pages/checkin/clock.js(页面里不出现裸时钟,见 spec 3.3.4),测试把它 mock 死。
 */

jest.mock('../../miniprogram/api/index');
jest.mock('../../miniprogram/pages/checkin/clock');

const api = require('../../miniprogram/api/index');
const clock = require('../../miniprogram/pages/checkin/clock');
const { ApiError } = jest.requireActual('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/checkin/checkin.js';
const NOW = '2026-09-14T11:30:00.000Z';

function dog(id, name) {
  return {
    _id: id,
    ownerOpenid: 'o1',
    name,
    breed: '',
    sizeClass: 'medium',
    birthMonth: '',
    gender: 'male',
    neutered: true,
    avatarFileID: '',
    playStyle: [],
    temperament: [],
    okWithSmallDogs: true,
    socialOk: true,
    tagCode: '',
    qrFileID: '',
    lostMode: false,
  };
}

function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

/** 加载页面并跑完 onLoad,dogs 是 api.listMyDogs 要返回的狗 */
async function open(dogs, query) {
  api.listMyDogs.mockResolvedValue(dogs);
  const page = loadPage(PAGE);
  await page.onLoad.call(page, query || { spotId: 's1' });
  return page;
}

beforeEach(() => {
  clock.nowIso.mockReturnValue(NOW);
  api.createCheckin.mockResolvedValue({
    checkinId: 'ck1',
    expireAt: '2026-09-14T13:00:00.000Z',
    notified: 3,
  });
});

describe('pages/checkin —— 发广播', () => {
  test('未选狗时提交被拦下:data.errMsg 非空,且 api.createCheckin 一次都没被调用', async () => {
    const page = await open([dog('d1', '豆豆'), dog('d2', '球球')]);
    expect(page.data.selectedDogIds).toEqual([]);

    await expect(page.submit.call(page)).resolves.not.toThrow();

    expect(page.data.errMsg).not.toBe('');
    expect(api.createCheckin).not.toHaveBeenCalled();
    expect(page.data.submitting).toBe(false);
  });

  test('一只狗都没有时同样拦下,不调 api', async () => {
    const page = await open([]);

    await page.submit.call(page);

    expect(page.data.errMsg).not.toBe('');
    expect(api.createCheckin).not.toHaveBeenCalled();
  });

  test('onLoad 记下 spotId 并拉我的狗;只有一只时默认选中', async () => {
    const page = await open([dog('d1', '豆豆')]);

    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.spotId).toBe('s1');
    expect(page.data.dogs).toHaveLength(1);
    expect(page.data.selectedDogIds).toEqual(['d1']);
  });

  test('多只狗时不替用户做主,一只都不预选', async () => {
    const page = await open([dog('d1', '豆豆'), dog('d2', '球球')]);
    expect(page.data.selectedDogIds).toEqual([]);
  });

  test('toggleDog 选中再点一次取消', async () => {
    const page = await open([dog('d1', '豆豆'), dog('d2', '球球')]);

    page.toggleDog.call(page, { currentTarget: { dataset: { dogId: 'd2' } } });
    expect(page.data.selectedDogIds).toEqual(['d2']);

    page.toggleDog.call(page, { currentTarget: { dataset: { dogId: 'd1' } } });
    expect(page.data.selectedDogIds).toEqual(['d2', 'd1']);

    page.toggleDog.call(page, { currentTarget: { dataset: { dogId: 'd2' } } });
    expect(page.data.selectedDogIds).toEqual(['d1']);
  });

  test('提交成功:按契约形状调 createCheckin,startAt 走 clock,然后回上一页', async () => {
    const page = await open([dog('d1', '豆豆')]);
    page.onNoteInput.call(page, { detail: { value: '在滑梯旁边' } });

    await page.submit.call(page);

    expect(api.createCheckin).toHaveBeenCalledTimes(1);
    expect(api.createCheckin).toHaveBeenCalledWith({
      spotId: 's1',
      dogIds: ['d1'],
      startAt: NOW,
      note: '在滑梯旁边',
    });
    expect(page.data.now).toBe(NOW);
    expect(page.data.errMsg).toBe('');
    expect(page.data.submitting).toBe(false);
    expect(callsOf(page, 'showToast')).toHaveLength(1);
    expect(callsOf(page, 'navigateBack')).toHaveLength(1);
  });

  test('CONFLICT(已有进行中的广播)落到 errMsg,不抛异常也不返回上一页', async () => {
    const page = await open([dog('d1', '豆豆')]);
    api.createCheckin.mockRejectedValue(new ApiError('CONFLICT', 'active checkin exists'));

    await expect(page.submit.call(page)).resolves.not.toThrow();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.errMsg).not.toBe('CONFLICT');
    expect(callsOf(page, 'navigateBack')).toHaveLength(0);
    expect(page.data.submitting).toBe(false);
  });

  test('留言超过 30 字本地拦下,不调 api', async () => {
    const page = await open([dog('d1', '豆豆')]);
    page.onNoteInput.call(page, { detail: { value: '狗'.repeat(31) } });

    await page.submit.call(page);

    expect(page.data.errMsg).not.toBe('');
    expect(api.createCheckin).not.toHaveBeenCalled();
  });

  test('没有 spotId 时本地拦下,不调 api', async () => {
    const page = await open([dog('d1', '豆豆')], {});

    await page.submit.call(page);

    expect(page.data.errMsg).not.toBe('');
    expect(api.createCheckin).not.toHaveBeenCalled();
  });

  test('连点两下只发一条广播', async () => {
    const page = await open([dog('d1', '豆豆')]);

    await Promise.all([page.submit.call(page), page.submit.call(page)]);

    expect(api.createCheckin).toHaveBeenCalledTimes(1);
  });

  test('拉狗列表失败时 errMsg 非空,onLoad 自身不抛异常', async () => {
    api.listMyDogs.mockRejectedValue(new ApiError('AUTH_REQUIRED', 'AUTH_REQUIRED'));
    const page = loadPage(PAGE);

    await expect(page.onLoad.call(page, { spotId: 's1' })).resolves.not.toThrow();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dogs).toEqual([]);
    expect(page.data.loading).toBe(false);
  });

  test('选了狗之后清掉上一次的错误提示', async () => {
    const page = await open([dog('d1', '豆豆'), dog('d2', '球球')]);
    await page.submit.call(page);
    expect(page.data.errMsg).not.toBe('');

    page.toggleDog.call(page, { currentTarget: { dataset: { dogId: 'd1' } } });
    expect(page.data.errMsg).toBe('');
  });
});
