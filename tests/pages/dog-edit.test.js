/**
 * T5 —— 狗档案编辑页 pages/dog/edit/edit.js
 *
 * 独有验收(spec 6 节 T5 行 / 派单 T5-a):
 *   名字超 12 字符时本地校验拦下,不调 api。
 * 共同约束:
 *   3.4 —— 捕获 ApiError 后设 data.errMsg,不得抛出;
 *   3.3.4 —— 页面里不许出现 new Date()。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/dog/edit/edit.js';

/** api 层 reject 的形状(spec 3.3.3):带 code 的 Error */
function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** 一只符合 spec 3.2 dogs 形状的狗 */
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

/** 把页面载入并停在新建态 */
async function loadNew() {
  const page = loadPage(PAGE);
  await page.onLoad({});
  return page;
}

describe('狗档案编辑页 —— 加载', () => {
  test('带 dogId 进来时,表单被已有的狗填满', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'd9', name: '二哈' }), makeDog()]);

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd9' });

    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.dog.name).toBe('二哈');
    expect(page.data.dog._id).toBe('d9');
    expect(page.data.isNew).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('不带 dogId 就是新建,不调 api,表单是空档案', async () => {
    const page = await loadNew();

    expect(api.listMyDogs).not.toHaveBeenCalled();
    expect(page.data.isNew).toBe(true);
    expect(page.data.dog.name).toBe('');
    expect(page.data.dog.sizeClass).toBe('medium');
    expect(page.data.errMsg).toBe('');
  });

  test('dogId 不在自己的档案里 —— 给 errMsg,不白屏', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'd1' })]);

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'nope' });

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('加载时 api 抛 ApiError —— errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockRejectedValue(apiError('AUTH_REQUIRED', '请先登录'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({ dogId: 'd1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });
});

describe('狗档案编辑页 —— 本地校验(T5-a)', () => {
  test('名字超 12 字符时本地校验拦下,不调 api', async () => {
    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '一二三四五六七八九十十一十二十三' },
    });

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.errMsg).toContain('12');
  });

  test('名字恰好 12 字符 —— 放行,调 api.saveDog', async () => {
    api.saveDog.mockResolvedValue(makeDog({ name: '一二三四五六七八九十十一' }));

    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '一二三四五六七八九十十一' },
    });

    await page.onSave();

    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0].name).toBe('一二三四五六七八九十十一');
    expect(page.data.errMsg).toBe('');
  });

  test('名字为空(或全是空格)时本地校验拦下,不调 api', async () => {
    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '   ' },
    });

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('sizeClass 非法时本地校验拦下,不调 api', async () => {
    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '旺财' },
    });
    page.setData({ 'dog.sizeClass': 'huge' });

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('sizeClass');
  });

  test('birthMonth 不是 YYYY-MM 时本地校验拦下,不调 api', async () => {
    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '旺财' },
    });
    page.setData({ 'dog.birthMonth': '2023/5' });

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('birthMonth');
  });

  test('birthMonth 为空串是合法的(spec 3.2 可为 \'\')', async () => {
    api.saveDog.mockResolvedValue(makeDog({ birthMonth: '' }));

    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '旺财' },
    });

    await page.onSave();

    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0].birthMonth).toBe('');
  });
});

describe('狗档案编辑页 —— 保存', () => {
  test('保存成功后用 api 返回值刷新 data.dog,errMsg 清空', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.saveDog.mockResolvedValue(makeDog({ name: '旺财二世' }));

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });
    await page.onSave();

    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0]._id).toBe('d1');
    expect(page.data.dog.name).toBe('旺财二世');
    expect(page.data.errMsg).toBe('');
    expect(page.data.saving).toBe(false);
  });

  test('新建时提交的 dog 不带 _id(api 据此走 create)', async () => {
    api.saveDog.mockResolvedValue(makeDog());

    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '旺财' },
    });
    await page.onSave();

    expect(api.saveDog.mock.calls[0][0]._id).toBeUndefined();
  });

  test('保存时 api 抛 ApiError —— errMsg 非空,不抛出,saving 复位', async () => {
    api.saveDog.mockRejectedValue(apiError('FORBIDDEN', '不是你的狗'));

    const page = await loadNew();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'name' } },
      detail: { value: '旺财' },
    });

    await expect(page.onSave()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.saving).toBe(false);
  });
});

describe('狗档案编辑页 —— 多选与狗牌', () => {
  test('playStyle 反复点同一项 = 加进去再去掉', async () => {
    const page = await loadNew();
    const ev = { currentTarget: { dataset: { field: 'playStyle', value: 'wrestle' } } };

    page.onToggleMulti(ev);
    expect(page.data.dog.playStyle).toContain('wrestle');

    page.onToggleMulti(ev);
    expect(page.data.dog.playStyle).not.toContain('wrestle');
  });

  test('未保存的新狗不能生成狗牌,不调 api', async () => {
    const page = await loadNew();

    await page.onGenTag();

    expect(api.genTag).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('已有狗生成狗牌 —— tagCode / qrFileID 落进 data', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.genTag.mockResolvedValue({ tagCode: 'a1b2c3', qrFileID: 'cloud://qr.png' });

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });
    await page.onGenTag();

    expect(api.genTag).toHaveBeenCalledWith('d1');
    expect(page.data.dog.tagCode).toBe('a1b2c3');
    expect(page.data.dog.qrFileID).toBe('cloud://qr.png');
    expect(page.data.errMsg).toBe('');
  });

  test('生成狗牌失败 —— errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.genTag.mockRejectedValue(apiError('INTERNAL', '小程序码生成失败'));

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });
    await expect(page.onGenTag()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
  });
});

describe('狗档案编辑页 —— 删除', () => {
  test('删除已有的狗 —— 调 api.removeDog 后退回上一页', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.removeDog.mockResolvedValue({ removed: true });

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });
    await page.onRemove();

    expect(api.removeDog).toHaveBeenCalledWith('d1');
    expect(page.__wx.__calls.some((c) => c.name === 'navigateBack')).toBe(true);
  });

  test('新建态点删除 —— 不调 api', async () => {
    const page = await loadNew();

    await page.onRemove();

    expect(api.removeDog).not.toHaveBeenCalled();
  });
});

describe('狗档案编辑页 —— 静态约束', () => {
  test('页面源码里没有 new Date()(spec 3.3.4)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/new\s+Date\s*\(/);
  });

  test('页面不直接调 wx.cloud.callFunction(spec 3.3.3)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');
    expect(src).not.toMatch(/wx\.cloud\.callFunction/);
  });
});
