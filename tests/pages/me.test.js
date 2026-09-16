/**
 * T9 —— 我的 pages/me/me.js(狗列表 + 约遛两栏)
 *
 * 独有验收(spec 6 节 T9 行 / 派单 T9-b):
 *   api.listWalks({ mine: true }) 的结果按 isHost 分到 data.hostedWalks / data.joinedWalks。
 * 另覆盖:listMyDogs reject 时 errMsg 非空且不抛;两个入口分别跳 dog/edit 与 dog/tag。
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

/** spec 3.2.2 dogs(v2) */
function makeDog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: 'o1',
      name: '旺财',
      breed: '柴犬',
      gender: 'male',
      birthMonth: '2023-05',
      sizeClass: 'medium',
      neutered: true,
      vaccinated: true,
      licenseNo: '',
      tags: ['ball', 'shy'],
      avatarFileID: '',
      tagCode: 'a1b2c3',
      qrFileID: 'cloud://tags/a1b2c3.png',
      lostMode: false,
      lostNote: '',
    },
    over || {}
  );
}

/** spec 3.2.3 WalkSummary */
function makeWalk(over) {
  return Object.assign(
    {
      walkId: 'w1',
      parkId: 'p1',
      parkName: '城北公园',
      startAt: '2026-09-17T02:30:00.000Z', // 东八区 2026-09-17 10:30
      note: '一起遛',
      maxDogs: 3,
      dogCount: 2,
      hostDogs: [{ dogId: 'd1', name: '旺财', avatarFileID: '', sizeClass: 'medium', tags: [] }],
      status: 'open',
      isHost: true,
      myStatus: 'host',
    },
    over || {}
  );
}

const LOGGED_APP = { globalData: { user: { _id: 'o1', nickname: '张三' }, logged: true } };
const GUEST_APP = { globalData: { user: null, logged: false } };

/** onShow 是重拉的入口(从编辑页 / 身份牌页回来要看到最新) */
async function showMe(dogs, walks, app) {
  api.listMyDogs.mockResolvedValue(dogs || []);
  api.listWalks.mockResolvedValue(walks || []);
  const page = loadPage(PAGE, { app: app || LOGGED_APP });
  await page.onLoad({});
  await page.onShow();
  return page;
}

describe('我的 —— 我的狗', () => {
  test('狗列表来自 api.listMyDogs,行上有体型与标签文案', async () => {
    const page = await showMe([makeDog(), makeDog({ _id: 'd2', name: '二哈', sizeClass: 'large', tags: [] })]);

    expect(api.listMyDogs).toHaveBeenCalled();
    expect(page.data.dogs).toHaveLength(2);
    expect(page.data.dogs[0].name).toBe('旺财');
    expect(page.data.dogs[0].sizeText).toBe('中型犬');
    expect(page.data.dogs[0].tagsText).toBe('爱玩球 / 怕生');
    expect(page.data.dogs[1].tagsText).toBe('');
    expect(page.data.loading).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('一只狗都没有 —— 空状态文案是「还没有狗,先加一只」', async () => {
    const page = await showMe([]);

    expect(page.data.dogs).toEqual([]);
    expect(page.data.dogsEmptyText).toContain('还没有狗');
  });

  test('listMyDogs reject —— errMsg 非空且不抛异常,约遛两栏照常', async () => {
    api.listMyDogs.mockRejectedValue(apiError('AUTH_REQUIRED', '请先登录'));
    api.listWalks.mockResolvedValue([makeWalk()]);

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await expect(page.onShow()).resolves.toBeUndefined();

    expect(page.data.dogs).toEqual([]);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.hostedWalks).toHaveLength(1);
    expect(page.data.loading).toBe(false);
  });

  test('「编辑」跳 dog/edit、「身份牌」跳 dog/tag,都用 navigateTo 并带 dogId', async () => {
    const page = await showMe([makeDog()]);

    page.onEditDog({ currentTarget: { dataset: { dogId: 'd1' } } });
    page.onOpenTag({ currentTarget: { dataset: { dogId: 'd1' } } });
    page.onAddDog();

    const urls = page.__wx.__calls.filter((c) => c.name === 'navigateTo').map((c) => c.opts.url);
    expect(urls).toEqual([
      '/pages/dog/edit/edit?dogId=d1',
      '/pages/dog/tag/tag?dogId=d1',
      '/pages/dog/edit/edit',
    ]);
    expect(page.__wx.__calls.some((c) => c.name === 'switchTab')).toBe(false);
  });
});

describe('我的 —— 约遛两栏(T9-b)', () => {
  test('listWalks({mine:true}) 的结果按 isHost 分到 hostedWalks / joinedWalks', async () => {
    const walks = [
      makeWalk({ walkId: 'w1', isHost: true, myStatus: 'host' }),
      makeWalk({ walkId: 'w2', isHost: false, myStatus: 'pending', parkName: '城西公园' }),
      makeWalk({ walkId: 'w3', isHost: false, myStatus: 'approved' }),
    ];
    const page = await showMe([], walks);

    expect(api.listWalks).toHaveBeenCalledWith({ mine: true });
    expect(page.data.hostedWalks.map((w) => w.walkId)).toEqual(['w1']);
    expect(page.data.joinedWalks.map((w) => w.walkId)).toEqual(['w2', 'w3']);
    expect(page.data.walksLoading).toBe(false);
  });

  test('每条显示公园名 + 时间(东八区 YYYY-MM-DD HH:mm)+ 狗数', async () => {
    const page = await showMe([], [makeWalk({ dogCount: 4 })]);

    const row = page.data.hostedWalks[0];
    expect(row.parkName).toBe('城北公园');
    expect(row.timeText).toBe('2026-09-17 10:30');
    expect(row.dogCount).toBe(4);
  });

  test('myStatus 显示成中文,status:cancelled 标「已取消」', async () => {
    const walks = [
      makeWalk({ walkId: 'w1', status: 'cancelled' }),
      makeWalk({ walkId: 'w2', isHost: false, myStatus: 'pending' }),
      makeWalk({ walkId: 'w3', isHost: false, myStatus: 'approved' }),
      makeWalk({ walkId: 'w4', isHost: false, myStatus: 'rejected', status: 'cancelled' }),
    ];
    const page = await showMe([], walks);

    expect(page.data.hostedWalks[0].statusText).toBe('已取消');
    expect(page.data.joinedWalks[0].statusText).toBe('待确认');
    expect(page.data.joinedWalks[1].statusText).toBe('已加入');
    expect(page.data.joinedWalks[2].statusText).toBe('已取消'); // cancelled 压过 myStatus
  });

  test('两栏各自有空状态文案', async () => {
    const page = await showMe([], []);

    expect(page.data.hostedWalks).toEqual([]);
    expect(page.data.joinedWalks).toEqual([]);
    expect(page.data.hostedEmptyText).not.toBe('');
    expect(page.data.joinedEmptyText).not.toBe('');
  });

  test('点一条约遛 —— navigateTo 到 walk/detail 并带 walkId', async () => {
    const page = await showMe([], [makeWalk()]);
    page.onOpenWalk({ currentTarget: { dataset: { walkId: 'w1' } } });

    const call = page.__wx.__calls.find((c) => c.name === 'navigateTo');
    expect(call.opts.url).toBe('/pages/walk/detail/detail?walkId=w1');
  });

  test('listWalks reject —— errMsg 非空且不抛异常,狗列表照常', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.listWalks.mockRejectedValue(apiError('INTERNAL', '读不出来'));

    const page = loadPage(PAGE, { app: LOGGED_APP });
    await expect(page.onShow()).resolves.toBeUndefined();

    expect(page.data.hostedWalks).toEqual([]);
    expect(page.data.joinedWalks).toEqual([]);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dogs).toHaveLength(1);
  });

  test('onShow 每次都重拉(从编辑页 / 身份牌页回来要看到最新)', async () => {
    const page = await showMe([makeDog()], [makeWalk()]);
    await page.onShow();

    expect(api.listMyDogs).toHaveBeenCalledTimes(2);
    expect(api.listWalks).toHaveBeenCalledTimes(2);
  });
});

describe('我的 —— 登录', () => {
  test('点登录 —— api.login 的结果写进 globalData 与 data', async () => {
    api.login.mockResolvedValue({ user: { _id: 'o1', nickname: '张三' }, dogs: [makeDog()] });
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.listWalks.mockResolvedValue([]);

    const app = { globalData: { user: null, logged: false } };
    const page = loadPage(PAGE, { app });
    await page.onLoad({});
    await page.onLogin();

    expect(page.data.logged).toBe(true);
    expect(page.data.user.nickname).toBe('张三');
    expect(app.globalData.logged).toBe(true);
    expect(app.globalData.user._id).toBe('o1');
    expect(page.data.dogs).toHaveLength(1);
  });

  test('未登录时 data.logged 为 false(页面上只显示登录按钮)', async () => {
    const page = await showMe([], [], GUEST_APP);

    expect(page.data.logged).toBe(false);
    expect(page.data.user).toBeNull();
  });

  test('登录失败 —— errMsg 非空且不抛异常', async () => {
    api.login.mockRejectedValue(apiError('INTERNAL', '登录服务开小差'));

    const page = loadPage(PAGE, { app: { globalData: {} } });
    await expect(page.onLogin()).resolves.toBeUndefined();

    expect(page.data.logged).toBe(false);
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('我的 —— 静态约束', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');

  test('页面源码里没有 new Date() / Date.now()(spec 3.3.4)', () => {
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });

  test('页面不直接调 wx.cloud.*(spec 3.3.3)', () => {
    expect(src).not.toMatch(/wx\.cloud\./);
  });
});
