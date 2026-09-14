/**
 * T5 —— 我的 pages/me/me.js
 *
 * 派单 T5-b:
 *   onLoad 后 data.dogs 来自 api.listMyDogs;api 抛错时 data.errMsg 非空且不抛异常。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/me/me.js';

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

function makeDog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: 'o1',
      name: '旺财',
      breed: '柴犬',
      sizeClass: 'medium',
      birthMonth: '2023-05',
      gender: 'male',
      neutered: true,
      avatarFileID: '',
      playStyle: ['chase'],
      temperament: ['friendly'],
      okWithSmallDogs: true,
      socialOk: true,
      tagCode: '',
      qrFileID: '',
      lostMode: false,
    },
    over || {}
  );
}

const LOGGED_APP = { globalData: { user: { _id: 'o1', nickname: '张三' }, logged: true } };
const GUEST_APP = { globalData: { user: null, logged: false } };

describe('我的 —— 加载狗列表(T5-b)', () => {
  test('onLoad 后 data.dogs 来自 api.listMyDogs', async () => {
    const dogs = [makeDog(), makeDog({ _id: 'd2', name: '二哈', sizeClass: 'large' })];
    api.listMyDogs.mockResolvedValue(dogs);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});

    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.dogs).toHaveLength(2);
    expect(page.data.dogs.map((d) => d.name)).toEqual(['旺财', '二哈']);
    expect(page.data.errMsg).toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('api 抛错时 data.errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await expect(page.onLoad({})).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dogs).toEqual([]);
    expect(page.data.loading).toBe(false);
  });

  test('一只狗都没有 —— dogs 为空数组,不报错', async () => {
    api.listMyDogs.mockResolvedValue([]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});

    expect(page.data.dogs).toEqual([]);
    expect(page.data.errMsg).toBe('');
  });

  test('api 返回的不是数组也不把脏数据塞进 data.dogs', async () => {
    api.listMyDogs.mockResolvedValue(undefined);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await expect(page.onLoad({})).resolves.toBeUndefined();

    expect(Array.isArray(page.data.dogs)).toBe(true);
  });

  test('onShow 会重新拉一次(从编辑页退回来要刷新)', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    await page.onShow();

    expect(api.listMyDogs).toHaveBeenCalledTimes(2);
  });

  test('上一次的 errMsg 在重拉成功后被清掉', async () => {
    api.listMyDogs.mockRejectedValueOnce(apiError('INTERNAL', '超时'));

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    expect(page.data.errMsg).not.toBe('');

    api.listMyDogs.mockResolvedValue([makeDog()]);
    await page.onShow();

    expect(page.data.errMsg).toBe('');
    expect(page.data.dogs).toHaveLength(1);
  });
});

describe('我的 —— 登录态', () => {
  test('已登录时 data.user 取自 globalData,不再调 api.login', async () => {
    api.listMyDogs.mockResolvedValue([]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});

    expect(page.data.user.nickname).toBe('张三');
    expect(page.data.logged).toBe(true);
    expect(api.login).not.toHaveBeenCalled();
  });

  test('未登录时不自动跳转,只把 logged 标成 false', async () => {
    api.listMyDogs.mockResolvedValue([]);

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({});

    expect(page.data.logged).toBe(false);
    const nav = page.__wx.__calls.filter(
      (c) => ['navigateTo', 'redirectTo', 'reLaunch'].indexOf(c.name) >= 0
    );
    expect(nav).toEqual([]);
  });

  test('点登录 —— 调 api.login,结果写回 data 和 globalData', async () => {
    api.listMyDogs.mockResolvedValue([]);
    api.login.mockResolvedValue({
      user: { _id: 'o1', nickname: '李四' },
      dogs: [makeDog({ name: '三花' })],
    });

    const app = { globalData: { user: null, logged: false } };
    const page = loadPage(PAGE, { app });
    await page.onLoad({});
    await page.onLogin();

    expect(api.login).toHaveBeenCalledTimes(1);
    expect(page.data.user.nickname).toBe('李四');
    expect(page.data.logged).toBe(true);
    expect(page.data.dogs.map((d) => d.name)).toEqual(['三花']);
    expect(app.globalData.user.nickname).toBe('李四');
    expect(app.globalData.logged).toBe(true);
  });

  test('登录失败 —— errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockResolvedValue([]);
    api.login.mockRejectedValue(apiError('INTERNAL', '网络开小差'));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({});
    await expect(page.onLogin()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.logged).toBe(false);
  });
});

describe('我的 —— 跳转', () => {
  test('点「加一只狗」跳到新建档案页,不带 dogId', async () => {
    api.listMyDogs.mockResolvedValue([]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    page.onAddDog();

    const nav = page.__wx.__calls.filter((c) => c.name === 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/dog/edit/edit');
  });

  test('点某只狗跳到它的编辑页,url 带上 dogId', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'd7' })]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    page.onEditDog({ currentTarget: { dataset: { dogId: 'd7' } } });

    const nav = page.__wx.__calls.filter((c) => c.name === 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/dog/edit/edit?dogId=d7');
  });

  test('狗牌已生成时可以跳到它的公开主页预览', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'd7', tagCode: 'a1b2c3' })]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    page.onViewPublic({ currentTarget: { dataset: { tagCode: 'a1b2c3' } } });

    const nav = page.__wx.__calls.filter((c) => c.name === 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/dog/profile/profile?tagCode=a1b2c3');
  });

  test('狗牌还没生成时点预览 —— 不跳转,给 errMsg', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'd7', tagCode: '' })]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({});
    page.onViewPublic({ currentTarget: { dataset: { tagCode: '' } } });

    expect(page.__wx.__calls.filter((c) => c.name === 'navigateTo')).toHaveLength(0);
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('我的 —— 静态约束', () => {
  test('页面源码里没有 new Date()(spec 3.3.4)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/new\s+Date\s*\(/);
  });

  test('页面不直接调 wx.cloud.callFunction(spec 3.3.3)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/wx\.cloud\.callFunction/);
  });
});
