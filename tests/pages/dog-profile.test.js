/**
 * T5 —— 狗主页 pages/dog/profile/profile.js(扫狗牌二维码的落地页)
 *
 * 独有验收(spec 2.2 B7):
 *   游客态(api.getDogPublic 成功但未登录)页面正常渲染,data.dog 有值,不跳转登录。
 * 另外守住 spec 3.2「公开视图 DogPublic」:
 *   ownerContact 只在 lostMode === true 时非 null。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/dog/profile/profile.js';

/** 跳转类 wx 调用 —— 「不跳转登录」就是这一组必须为空 */
const NAV = ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab'];

function navCalls(page) {
  return page.__wx.__calls.filter((c) => NAV.indexOf(c.name) >= 0).map((c) => c.name);
}

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** spec 3.2 的 DogPublic —— 字段只能少不能多 */
function makeDogPublic(over) {
  return Object.assign(
    {
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
      lostMode: false,
      ownerContact: null,
    },
    over || {}
  );
}

const GUEST_APP = { globalData: { user: null, logged: false } };
const LOGGED_APP = { globalData: { user: { _id: 'o1', nickname: '张三' }, logged: true } };

describe('狗主页 —— 游客态(B7)', () => {
  test('游客态:getDogPublic 成功但未登录 —— 页面正常渲染、data.dog 有值、不跳转登录', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(api.getDogPublic).toHaveBeenCalledWith('a1b2c3');
    expect(page.data.dog).toBeTruthy();
    expect(page.data.dog.name).toBe('旺财');
    expect(page.data.isGuest).toBe(true);
    expect(page.data.loading).toBe(false);
    expect(page.data.errMsg).toBe('');
    expect(navCalls(page)).toEqual([]);
  });

  test('游客态:globalData 整个不存在时也不跳转登录,照常渲染', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic({ name: '二哈' }));

    const page = loadPage(PAGE);
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(page.data.dog.name).toBe('二哈');
    expect(page.data.isGuest).toBe(true);
    expect(navCalls(page)).toEqual([]);
  });

  test('游客态:读档案不需要登录,页面不调 api.login', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(api.login).not.toHaveBeenCalled();
  });

  test('已登录时同样正常渲染,isGuest 为 false', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(page.data.dog).toBeTruthy();
    expect(page.data.isGuest).toBe(false);
    expect(navCalls(page)).toEqual([]);
  });
});

describe('狗主页 —— tagCode 的来路', () => {
  test('扫小程序码进来时 tagCode 在 query.scene 里,且是 URL 编码过的', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ scene: encodeURIComponent('a1b2c3') });

    expect(api.getDogPublic).toHaveBeenCalledWith('a1b2c3');
    expect(page.data.tagCode).toBe('a1b2c3');
  });

  test('没有 tagCode —— 给 errMsg,不调 api,不跳转', async () => {
    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({});

    expect(api.getDogPublic).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
    expect(navCalls(page)).toEqual([]);
  });
});

describe('狗主页 —— 走失模式与联系方式', () => {
  test('非走失狗:ownerContact 为 null,页面不给联系入口', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic({ lostMode: false, ownerContact: null }));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(page.data.dog.ownerContact).toBeNull();
    expect(page.data.canContact).toBe(false);
  });

  test('走失狗:ownerContact 非 null,页面给出联系入口', async () => {
    api.getDogPublic.mockResolvedValue(
      makeDogPublic({ lostMode: true, ownerContact: '13800000000' })
    );

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(page.data.canContact).toBe(true);
    expect(page.data.dog.ownerContact).toBe('13800000000');
  });

  test('走失狗:游客点联系主人 —— 弹窗展示联系方式,不跳转登录', async () => {
    api.getDogPublic.mockResolvedValue(
      makeDogPublic({ lostMode: true, ownerContact: '13800000000' })
    );

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });
    page.onContactOwner();

    const modal = page.__wx.__calls.filter((c) => c.name === 'showModal');
    expect(modal).toHaveLength(1);
    expect(modal[0].opts.content).toContain('13800000000');
    expect(navCalls(page)).toEqual([]);
  });

  test('非走失狗点联系主人 —— 不弹联系方式', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic({ lostMode: false, ownerContact: null }));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });
    page.onContactOwner();

    expect(page.__wx.__calls.filter((c) => c.name === 'showModal')).toHaveLength(0);
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('狗主页 —— 失败面(spec 3.4)', () => {
  test('狗牌查不到(NOT_FOUND)—— errMsg 非空、不抛异常、不跳转', async () => {
    api.getDogPublic.mockRejectedValue(apiError('NOT_FOUND', 'dogs'));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await expect(page.onLoad({ tagCode: 'zzzzzz' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dog).toBeNull();
    expect(page.data.loading).toBe(false);
    expect(navCalls(page)).toEqual([]);
  });

  test('游客态碰到 AUTH_REQUIRED 也只是 errMsg,绝不跳登录', async () => {
    api.getDogPublic.mockRejectedValue(apiError('AUTH_REQUIRED', '请先登录'));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await expect(page.onLoad({ tagCode: 'a1b2c3' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(navCalls(page)).toEqual([]);
  });

  test('下拉刷新重新拉一次,并停掉刷新动画', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });
    await page.onPullDownRefresh();

    expect(api.getDogPublic).toHaveBeenCalledTimes(2);
    expect(page.__wx.__calls.some((c) => c.name === 'stopPullDownRefresh')).toBe(true);
  });
});

describe('狗主页 —— 静态约束', () => {
  test('页面源码里没有 new Date()(spec 3.3.4)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/new\s+Date\s*\(/);
  });

  test('页面不直接调 wx.cloud.callFunction(spec 3.3.3)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/wx\.cloud\.callFunction/);
  });
});
