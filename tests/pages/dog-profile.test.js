/**
 * T9 —— 寻回页 pages/dog/profile/profile.js(扫身份牌的落地页)
 *
 * 独有验收(spec 2.2 B10 / 派单 B10):
 *   ① 游客态正常渲染、不跳登录、data.dog 有值;
 *   ② lostMode:true 时 data.showLostBanner === true;
 *   ③ 提交留言调 api.reportFound,勾了位置时载荷含 latitude / longitude;
 *   ④ 页面 data 里没有任何主人字段。
 * 依据:spec 3.2.3 DogPublic(恰好 9 个 key)、第 9 节假设 12(寻回页不给任何联系方式)。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/dog/profile/profile.js';

/** spec 3.2.3 DogPublic 的 9 个 key */
const DOG_PUBLIC_KEYS = [
  'name',
  'breed',
  'sizeClass',
  'gender',
  'birthMonth',
  'avatarFileID',
  'tags',
  'lostMode',
  'lostNote',
];

/** 跳转类 wx 调用 —— 「不跳登录」就是这一组必须为空 */
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

/** 云函数按契约只返回这 9 个字段 */
function makeDogPublic(over) {
  return Object.assign(
    {
      name: '旺财',
      breed: '柴犬',
      sizeClass: 'medium',
      gender: 'male',
      birthMonth: '2023-05',
      avatarFileID: '',
      tags: ['ball', 'shy'],
      lostMode: false,
      lostNote: '',
    },
    over || {}
  );
}

/** wx.getLocation 给一对真坐标 */
const WX_LOC = {
  getLocation: (o) => o.success({ latitude: 30.31, longitude: 120.17 }),
};

const GUEST_APP = { globalData: { user: null, logged: false } };

async function loadProfile(dogOver, stubs) {
  api.getDogPublic.mockResolvedValue(makeDogPublic(dogOver));
  const page = loadPage(PAGE, Object.assign({ app: GUEST_APP }, stubs || {}));
  await page.onLoad({ tagCode: 'a1b2c3' });
  return page;
}

describe('寻回页 —— 游客态渲染(B10 ①)', () => {
  test('游客扫码进来正常渲染,data.dog 有值,一次跳转都没有(不跳登录)', async () => {
    const page = await loadProfile();

    expect(api.getDogPublic).toHaveBeenCalledWith('a1b2c3');
    expect(page.data.dog).not.toBeNull();
    expect(page.data.dog.name).toBe('旺财');
    expect(page.data.loading).toBe(false);
    expect(page.data.errMsg).toBe('');
    expect(navCalls(page)).toEqual([]);
  });

  test('tagCode 两条来路都认:query.scene(被编码过)与 query.tagCode', async () => {
    api.getDogPublic.mockResolvedValue(makeDogPublic());

    const fromScene = loadPage(PAGE, { app: GUEST_APP });
    await fromScene.onLoad({ scene: encodeURIComponent('z9y8x7') });
    expect(fromScene.data.tagCode).toBe('z9y8x7');
    expect(api.getDogPublic).toHaveBeenLastCalledWith('z9y8x7');

    const fromQuery = loadPage(PAGE, { app: GUEST_APP });
    await fromQuery.onLoad({ tagCode: 'a1b2c3' });
    expect(fromQuery.data.tagCode).toBe('a1b2c3');
    expect(api.getDogPublic).toHaveBeenLastCalledWith('a1b2c3');
  });

  test('DogPublic 的字段都进了 data,标签翻成中文', async () => {
    const page = await loadProfile();

    expect(page.data.view.sizeText).toBe('中型犬');
    expect(page.data.view.genderText).toBe('公');
    expect(page.data.view.tagsText).toBe('爱玩球 / 怕生');
    expect(page.data.dog.birthMonth).toBe('2023-05');
  });

  test('没读到 tagCode —— errMsg 非空,不跳转,不调 api', async () => {
    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({});

    expect(api.getDogPublic).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(navCalls(page)).toEqual([]);
  });

  test('这个牌子查不到档案 —— errMsg 非空、不抛、不跳转', async () => {
    api.getDogPublic.mockRejectedValue(apiError('NOT_FOUND', 'dogs'));

    const page = loadPage(PAGE, { app: GUEST_APP });
    await expect(page.onLoad({ tagCode: 'zzzzzz' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
    expect(navCalls(page)).toEqual([]);
  });
});

describe('寻回页 —— 走失横幅(B10 ②)', () => {
  test('lostMode:true 时 data.showLostBanner === true,主人留言一起显示', async () => {
    const page = await loadProfile({ lostMode: true, lostNote: '9 月 15 日在城北公园走丢' });

    expect(page.data.showLostBanner).toBe(true);
    expect(page.data.dog.lostNote).toBe('9 月 15 日在城北公园走丢');
  });

  test('非走失态 showLostBanner 为 false,lostNote 恒为空串', async () => {
    const page = await loadProfile();

    expect(page.data.showLostBanner).toBe(false);
    expect(page.data.dog.lostNote).toBe('');
  });

  test('走失态转发标题是「帮忙找找 X」', async () => {
    const page = await loadProfile({ lostMode: true });
    const share = page.onShareAppMessage();

    expect(share.title).toBe('帮忙找找 旺财');
    expect(share.path).toBe('/pages/dog/profile/profile?tagCode=a1b2c3');
  });
});

describe('寻回页 —— 留言(B10 ③)', () => {
  test('游客提交留言 —— api.reportFound 收到 { tagCode, message },没多余字段', async () => {
    api.reportFound.mockResolvedValue({ reportId: 'r1', notified: true });

    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '在城北公园西门看到它了' } });
    await page.onSubmit();

    expect(api.reportFound).toHaveBeenCalledTimes(1);
    const payload = api.reportFound.mock.calls[0][0];
    expect(payload).toEqual({ tagCode: 'a1b2c3', message: '在城北公园西门看到它了' });
    expect(page.data.sent).toBe(true);
    expect(page.data.sentText).toBe('已通知主人');
    expect(navCalls(page)).toEqual([]); // 游客留言也不跳登录
  });

  test('勾了「附上我的位置」—— 先 wx.getLocation,载荷含 latitude / longitude', async () => {
    api.reportFound.mockResolvedValue({ reportId: 'r2', notified: true });

    const page = await loadProfile(undefined, { wx: WX_LOC });
    page.onMessageInput({ detail: { value: '它在西门树下' } });
    page.onToggleLocation({ detail: { value: true } });
    await page.onSubmit();

    const payload = api.reportFound.mock.calls[0][0];
    expect(payload.latitude).toBe(30.31);
    expect(payload.longitude).toBe(120.17);
    expect(payload.tagCode).toBe('a1b2c3');
    expect(payload.message).toBe('它在西门树下');
  });

  test('定位失败 —— errMsg 提示、自动取消勾选、这一次不提交;再点一次就不带位置发出去', async () => {
    api.reportFound.mockResolvedValue({ reportId: 'r3', notified: false });

    const page = await loadProfile(undefined, {
      wx: { getLocation: (o) => o.fail({ errMsg: 'getLocation:fail auth deny' }) },
    });
    page.onMessageInput({ detail: { value: '它在西门树下' } });
    page.onToggleLocation({ detail: { value: true } });

    await expect(page.onSubmit()).resolves.toBeUndefined();
    expect(api.reportFound).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.attachLocation).toBe(false);
    expect(page.data.submitting).toBe(false);

    await page.onSubmit();
    expect(api.reportFound).toHaveBeenCalledTimes(1);
    expect(api.reportFound.mock.calls[0][0]).toEqual({
      tagCode: 'a1b2c3',
      message: '它在西门树下',
    });
  });

  test('notified:false —— 文案改成「已留言,主人打开小程序就能看到」', async () => {
    api.reportFound.mockResolvedValue({ reportId: 'r4', notified: false });

    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '看到它了' } });
    await page.onSubmit();

    expect(page.data.sent).toBe(true);
    expect(page.data.sentText).toBe('已留言,主人打开小程序就能看到');
  });

  test('空留言本地拦下,不调 api', async () => {
    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '   ' } });
    await page.onSubmit();

    expect(api.reportFound).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('留言超 200 字本地拦下,不调 api', async () => {
    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '在城北公园西门看到它了'.repeat(19) } });
    await page.onSubmit();

    expect(api.reportFound).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('200');
  });

  test('CONTENT_RISKY —— errMsg 是人话,submitting 复位,不抛', async () => {
    api.reportFound.mockRejectedValue(apiError('CONTENT_RISKY', 'message'));

    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '看到它了' } });
    await expect(page.onSubmit()).resolves.toBeUndefined();

    expect(page.data.errMsg).toContain('留言');
    expect(page.data.errMsg).toContain('不合适的内容');
    expect(page.data.sent).toBe(false);
    expect(page.data.submitting).toBe(false);
  });

  test('提交时 api 抛别的错 —— errMsg 非空,不抛,可以再试', async () => {
    api.reportFound.mockRejectedValue(apiError('INTERNAL', '网络开小差'));

    const page = await loadProfile();
    page.onMessageInput({ detail: { value: '看到它了' } });
    await expect(page.onSubmit()).resolves.toBeUndefined();

    expect(page.data.sent).toBe(false);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.submitting).toBe(false);
  });
});

describe('寻回页 —— 主人字段一个都不落进 data(B10 ④)', () => {
  test('云函数万一多返回了主人字段,页面也只留 DogPublic 那 9 个 key', async () => {
    // 契约里 scanTag 不会返回这些;这里故意塞进来,证明页面自己也做了裁剪
    api.getDogPublic.mockResolvedValue(
      Object.assign(makeDogPublic({ lostMode: true, lostNote: '走丢了' }), {
        ownerOpenid: 'o1',
        ownerPhone: '13800000000',
        nickname: '张三',
        _id: 'd1',
        tagCode: 'a1b2c3',
      })
    );

    const page = loadPage(PAGE, { app: GUEST_APP });
    await page.onLoad({ tagCode: 'a1b2c3' });

    expect(Object.keys(page.data.dog).sort()).toEqual(DOG_PUBLIC_KEYS.slice().sort());

    const blob = JSON.stringify(page.data);
    expect(blob).not.toMatch(/owner/i); // ownerOpenid / 联系方式之类,一个都不许有
    expect(blob).not.toContain('nickname');
    expect(blob).not.toContain('13800000000');
  });

  test('页面上没有「联系主人」这类入口(假设 12:只能留言)', async () => {
    const page = await loadProfile({ lostMode: true });

    expect(page.onContactOwner).toBeUndefined();
    expect(page.data.canContact).toBeUndefined();

    const wxml = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'miniprogram/pages/dog/profile/profile.wxml'),
      'utf8'
    );
    expect(wxml).not.toContain('联系主人');
  });
});

describe('寻回页 —— 静态约束', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');

  test('页面源码里没有 new Date() / Date.now()(spec 3.3.4)', () => {
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });

  test('页面不直接调 wx.cloud.*(spec 3.3.3)', () => {
    expect(src).not.toMatch(/wx\.cloud\./);
  });
});
