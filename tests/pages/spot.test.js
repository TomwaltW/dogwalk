/**
 * 点位详情(看板)—— 验收 T4-b。
 *
 * 消费 spec 3.3.2 spotBoard(带 spotId)的 data:
 *   { spot, sessions: [BoardSession], wxGroupQrFileID }
 *   BoardSession = { openid, nickname, avatarFileID, dogs:[{name,avatarFileID,sizeClass}], startAt, expireAt, note }
 */

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { ApiError } = jest.requireActual('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');
const { formatHm } = require('../../miniprogram/pages/spot/format');

const PAGE = 'miniprogram/pages/spot/spot.js';

/** 用本地时间造 ISO 串,断言才不会随机器时区漂 */
function localIso(h, m) {
  return new Date(2026, 8, 14, h, m, 0, 0).toISOString();
}

function session(openid, nickname, dogNames, extra) {
  return Object.assign(
    {
      openid,
      nickname,
      avatarFileID: '',
      dogs: dogNames.map((name) => ({ name, avatarFileID: '', sizeClass: 'medium' })),
      startAt: localIso(19, 30),
      expireAt: localIso(21, 0),
      note: '',
    },
    extra || {}
  );
}

function board(sessions, extra) {
  return Object.assign(
    {
      spot: {
        _id: 's1',
        name: '中心花园南侧草坪',
        communityId: 'c1',
        wxGroupQrFileID: 'cloud://qr.png',
        peakHint: '工作日 19:30-20:30',
        regularCount: 8,
        active: true,
      },
      sessions,
      wxGroupQrFileID: 'cloud://qr.png',
    },
    extra || {}
  );
}

function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

describe('pages/spot —— 点位看板', () => {
  test('onLoad 后 data.sessions 来自 api.getSpotBoard', async () => {
    const sessions = [session('o1', '豆豆妈', ['豆豆']), session('o2', '球球爸', ['球球', '小白'])];
    api.getSpotBoard.mockResolvedValue(board(sessions));

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });

    expect(api.getSpotBoard).toHaveBeenCalledWith('s1');
    expect(page.data.sessions).toHaveLength(2);
    expect(page.data.sessions[0].nickname).toBe('豆豆妈');
    expect(page.data.spot.name).toBe('中心花园南侧草坪');
    expect(page.data.wxGroupQrFileID).toBe('cloud://qr.png');
    expect(page.data.errMsg).toBe('');
  });

  test('api 抛错时 data.errMsg 非空,且 onLoad 自身不抛异常', async () => {
    api.getSpotBoard.mockRejectedValue(new ApiError('INTERNAL', 'callFunction spotBoard failed'));

    const page = loadPage(PAGE);
    await expect(page.onLoad.call(page, { spotId: 's1' })).resolves.not.toThrow();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.sessions).toEqual([]);
    expect(page.data.loading).toBe(false);
  });

  test('NOT_FOUND 给的是「点位不存在」这种人话,不是裸错误码', async () => {
    api.getSpotBoard.mockRejectedValue(new ApiError('NOT_FOUND', 'spots'));

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 'nope' });

    expect(page.data.errMsg).toContain('点位');
    expect(page.data.errMsg).not.toBe('NOT_FOUND');
  });

  test('query 里没有 spotId 时本地拦下,不调 api', async () => {
    const page = loadPage(PAGE);
    await expect(page.onLoad.call(page, {})).resolves.not.toThrow();

    expect(api.getSpotBoard).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('在场人数按 session 数、狗数按 dogs 累加', async () => {
    api.getSpotBoard.mockResolvedValue(
      board([session('o1', '豆豆妈', ['豆豆']), session('o2', '球球爸', ['球球', '小白'])])
    );

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });

    expect(page.data.peopleCount).toBe(2);
    expect(page.data.dogCount).toBe(3);
  });

  test('每条在场记录带上给 WXML 直接用的狗名和时间段', async () => {
    api.getSpotBoard.mockResolvedValue(
      board([session('o2', '球球爸', ['球球', '小白'], { note: '带球来的' })])
    );

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });

    const s = page.data.sessions[0];
    expect(s.dogText).toBe('球球、小白');
    expect(s.timeText).toBe('19:30-21:00');
    expect(s.note).toBe('带球来的');
  });

  test('没人在场时是空数组加一句空状态,不报错', async () => {
    api.getSpotBoard.mockResolvedValue(board([]));

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });

    expect(page.data.sessions).toEqual([]);
    expect(page.data.peopleCount).toBe(0);
    expect(page.data.errMsg).toBe('');
  });

  test('点「我出门了」跳 checkin 页并带上 spotId', async () => {
    api.getSpotBoard.mockResolvedValue(board([]));

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });
    page.goCheckin.call(page);

    const nav = callsOf(page, 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/checkin/checkin?spotId=s1');
  });

  test('有群二维码才 previewImage,没有就不弹', async () => {
    api.getSpotBoard.mockResolvedValue(board([]));
    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });
    page.previewQr.call(page);
    expect(callsOf(page, 'previewImage')).toHaveLength(1);

    api.getSpotBoard.mockResolvedValue(board([], { wxGroupQrFileID: '' }));
    const bare = loadPage(PAGE);
    await bare.onLoad.call(bare, { spotId: 's1' });
    bare.previewQr.call(bare);
    expect(callsOf(bare, 'previewImage')).toHaveLength(0);
  });

  test('发完广播返回(onShow)刷新看板,首次进入不重复拉', async () => {
    api.getSpotBoard.mockResolvedValue(board([]));

    const page = loadPage(PAGE);
    await page.onLoad.call(page, { spotId: 's1' });
    await page.onShow.call(page);
    expect(api.getSpotBoard).toHaveBeenCalledTimes(1);

    api.getSpotBoard.mockResolvedValue(board([session('o1', '豆豆妈', ['豆豆'])]));
    await page.onShow.call(page);
    expect(api.getSpotBoard).toHaveBeenCalledTimes(2);
    expect(page.data.sessions).toHaveLength(1);
  });
});

describe('pages/spot/format —— ISO 时间转展示文本', () => {
  test('转成两位数的本地 HH:MM', () => {
    expect(formatHm(localIso(9, 5))).toBe('09:05');
    expect(formatHm(localIso(21, 0))).toBe('21:00');
  });

  test('空值和非法串都退回空字符串,不让 NaN 进 WXML', () => {
    expect(formatHm('')).toBe('');
    expect(formatHm(null)).toBe('');
    expect(formatHm('不是时间')).toBe('');
  });
});
