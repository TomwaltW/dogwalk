/**
 * T9 —— 狗档案编辑页 pages/dog/edit/edit.js(v2 字段 + 传照片)
 *
 * 独有验收(spec 6 节 T9 行 / 派单 T9-a):
 *   ① 名字超 12 码位本地拦下,不调 api;
 *   ② 选照片后调 api.uploadFile,返回的 fileID 写进 data.dog.avatarFileID;
 *   ③ 提交载荷只有 spec 3.3.2 的 12 个可写字段(含 tags / vaccinated / licenseNo)。
 * 共同约束:
 *   3.4 —— 捕获 ApiError 后设 data.errMsg,不得抛出;
 *   3.3.4 —— 页面里不许出现 new Date() / Date.now(),当前时间走自己目录下的 clock.js。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');
// 上传路径要唯一,唯一性来自 clock.nowMs();钉死它,断言才能看 cloudPath
jest.mock('../../miniprogram/pages/dog/clock', () => ({ nowMs: () => 1758009600000 }));

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/dog/edit/edit.js';

/** spec 3.3.2「客户端可写字段」那 12 个,一个不多一个不少 */
const WRITABLE = [
  'name',
  'breed',
  'gender',
  'birthMonth',
  'sizeClass',
  'neutered',
  'vaccinated',
  'licenseNo',
  'tags',
  'avatarFileID',
  'lostMode',
  'lostNote',
];

/** api 层 reject 的形状(spec 3.3.3):带 code 的 Error */
function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** 一只符合 spec 3.2.2 dogs(v2)形状的狗 */
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
      licenseNo: 'HZ-2023-0001',
      tags: ['ball', 'calm'],
      avatarFileID: '',
      tagCode: '',
      qrFileID: '',
      lostMode: false,
      lostNote: '',
    },
    over || {}
  );
}

/** wx.chooseMedia 给一张图 */
const WX_PHOTO = {
  chooseMedia: (o) => o.success({ tempFiles: [{ tempFilePath: '/tmp/wx-photo.jpg', size: 2048 }] }),
};

function setField(page, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } });
}

/** 载入并停在新建态 */
async function loadNew() {
  const page = loadPage(PAGE);
  await page.onLoad({});
  return page;
}

/** 载入并停在编辑态(dogId = d1) */
async function loadExisting(over, stubs) {
  api.listMyDogs.mockResolvedValue([makeDog(over)]);
  const page = loadPage(PAGE, stubs);
  await page.onLoad({ dogId: 'd1' });
  return page;
}

describe('狗档案编辑页 —— 加载', () => {
  test('带 dogId 进来时,v2 字段全填进表单(tags / vaccinated / licenseNo)', async () => {
    const page = await loadExisting({ name: '二哈', licenseNo: 'HZ-9', tags: ['shy'] });

    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.dog.name).toBe('二哈');
    expect(page.data.dog.licenseNo).toBe('HZ-9');
    expect(page.data.dog.vaccinated).toBe(true);
    expect(page.data.dog.tags).toEqual(['shy']);
    expect(page.data.isNew).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('不带 dogId 就是新建,不调 api,表单是空档案', async () => {
    const page = await loadNew();

    expect(api.listMyDogs).not.toHaveBeenCalled();
    expect(page.data.isNew).toBe(true);
    expect(page.data.dog.name).toBe('');
    expect(page.data.dog.sizeClass).toBe('medium');
    expect(page.data.dog.tags).toEqual([]);
    expect(page.data.errMsg).toBe('');
  });

  test('dogId 不在自己的档案里 —— 给 errMsg,不白屏', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'other' })]);

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

describe('狗档案编辑页 —— 本地校验(T9-a ①)', () => {
  test('名字超 12 码位本地拦下,api.saveDog 未被调用', async () => {
    const page = await loadNew();
    setField(page, 'name', '一二三四五六七八九十十一十二十三');

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('12');
  });

  test('名字恰好 12 码位 —— 放行,调 api.saveDog', async () => {
    api.saveDog.mockResolvedValue(makeDog({ name: '一二三四五六七八九十十一' }));

    const page = await loadNew();
    setField(page, 'name', '一二三四五六七八九十十一');
    await page.onSave();

    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0].name).toBe('一二三四五六七八九十十一');
    expect(page.data.errMsg).toBe('');
  });

  test('名字里有 emoji 时按码位数,不按 length', async () => {
    const page = await loadNew();
    // 13 个码位(12 个字 + 1 个 emoji),JS length 是 14
    setField(page, 'name', '一二三四五六七八九十十一十二🐶');

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('12');
  });

  test('名字为空(或全是空格)本地拦下,不调 api', async () => {
    const page = await loadNew();
    setField(page, 'name', '   ');

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('品种超 20 码位本地拦下,不调 api', async () => {
    const page = await loadNew();
    setField(page, 'name', '旺财');
    setField(page, 'breed', '超长的品种名'.repeat(4));

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('20');
  });

  test('犬证号超 32 码位本地拦下,不调 api', async () => {
    const page = await loadNew();
    setField(page, 'name', '旺财');
    setField(page, 'licenseNo', 'HZ' + '1'.repeat(31));

    await page.onSave();

    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('32');
  });

  test('犬证号选填 —— 空串放行', async () => {
    api.saveDog.mockResolvedValue(makeDog({ licenseNo: '' }));

    const page = await loadNew();
    setField(page, 'name', '旺财');
    await page.onSave();

    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0].licenseNo).toBe('');
  });

  test('出生年月不是 YYYY-MM 时本地拦下,空串是合法的', async () => {
    api.saveDog.mockResolvedValue(makeDog({ birthMonth: '' }));

    const page = await loadNew();
    setField(page, 'name', '旺财');
    setField(page, 'birthMonth', '2023/5');
    await page.onSave();
    expect(api.saveDog).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('YYYY-MM');

    setField(page, 'birthMonth', '');
    await page.onSave();
    expect(api.saveDog).toHaveBeenCalledTimes(1);
    expect(api.saveDog.mock.calls[0][0].birthMonth).toBe('');
  });
});

describe('狗档案编辑页 —— 照片上传(T9-a ②)', () => {
  test('选照片后调 api.uploadFile,返回的 fileID 写进 data.dog.avatarFileID', async () => {
    let page = null;
    let uploadingWhileUploading = null;
    api.uploadFile.mockImplementation(() => {
      uploadingWhileUploading = page.data.uploading;
      return Promise.resolve('cloud://dogs/d1-1758009600000.jpg');
    });

    page = loadPage(PAGE, { wx: WX_PHOTO });
    await page.onLoad({});
    await page.onChooseAvatar();

    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    const [cloudPath, filePath] = api.uploadFile.mock.calls[0];
    expect(filePath).toBe('/tmp/wx-photo.jpg');
    expect(cloudPath).toContain('1758009600000'); // 唯一性来自 clock.nowMs(),不是 Date.now()
    expect(cloudPath).toMatch(/\.jpg$/);
    expect(page.data.dog.avatarFileID).toBe('cloud://dogs/d1-1758009600000.jpg');
    expect(uploadingWhileUploading).toBe(true);
    expect(page.data.uploading).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('上传失败 —— errMsg 非空、uploading 复位、不抛异常', async () => {
    api.uploadFile.mockRejectedValue(apiError('INTERNAL', 'uploadFile failed'));

    const page = loadPage(PAGE, { wx: WX_PHOTO });
    await page.onLoad({});
    await expect(page.onChooseAvatar()).resolves.toBeUndefined();

    expect(page.data.uploading).toBe(false);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dog.avatarFileID).toBe('');
  });

  test('用户在相册里取消(没拿到临时路径)—— 不调 api.uploadFile,也不报错', async () => {
    const page = loadPage(PAGE, {
      wx: { chooseMedia: (o) => o.fail({ errMsg: 'chooseMedia:fail cancel' }) },
    });
    await page.onLoad({});
    await expect(page.onChooseAvatar()).resolves.toBeUndefined();

    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(page.data.uploading).toBe(false);
    expect(page.data.errMsg).toBe('');
  });
});

describe('狗档案编辑页 —— 提交载荷(T9-a ③)', () => {
  test('载荷只有契约里的 12 个可写字段,含 tags / vaccinated / licenseNo', async () => {
    api.saveDog.mockResolvedValue(makeDog());

    const page = await loadExisting();
    await page.onSave();

    const payload = api.saveDog.mock.calls[0][0];
    // _id 决定 create / update,不算可写字段
    expect(Object.keys(payload).sort()).toEqual(WRITABLE.concat(['_id']).sort());
    expect(payload.tags).toEqual(['ball', 'calm']);
    expect(payload.vaccinated).toBe(true);
    expect(payload.licenseNo).toBe('HZ-2023-0001');
  });

  test('新建时载荷不带 _id(api 据此走 create),字段仍是那 12 个', async () => {
    api.saveDog.mockResolvedValue(makeDog());

    const page = await loadNew();
    setField(page, 'name', '旺财');
    await page.onSave();

    const payload = api.saveDog.mock.calls[0][0];
    expect(payload._id).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(WRITABLE.slice().sort());
  });

  test('性格标签 chips 点一下进、再点一下出,进载荷', async () => {
    api.saveDog.mockResolvedValue(makeDog());

    const page = await loadNew();
    setField(page, 'name', '旺财');
    const ev = { currentTarget: { dataset: { value: 'fearsBig' } } };

    page.onToggleTag(ev);
    expect(page.data.dog.tags).toContain('fearsBig');
    page.onToggleTag({ currentTarget: { dataset: { value: 'shy' } } });
    page.onToggleTag(ev);
    expect(page.data.dog.tags).not.toContain('fearsBig');

    await page.onSave();
    expect(api.saveDog.mock.calls[0][0].tags).toEqual(['shy']);
  });

  test('picker 选体型 / 性别 —— 下标换成枚举值', async () => {
    const page = await loadNew();

    page.onPickerChange({
      currentTarget: { dataset: { field: 'sizeClass', options: 'sizeOptions' } },
      detail: { value: '2' },
    });
    page.onPickerChange({
      currentTarget: { dataset: { field: 'gender', options: 'genderOptions' } },
      detail: { value: 1 },
    });

    expect(page.data.dog.sizeClass).toBe('large');
    expect(page.data.dog.gender).toBe('female');
  });

  test('保存成功后用 api 返回值刷新 data.dog,errMsg 清空、saving 复位', async () => {
    api.saveDog.mockResolvedValue(makeDog({ name: '旺财二世' }));

    const page = await loadExisting();
    await page.onSave();

    expect(page.data.dog.name).toBe('旺财二世');
    expect(page.data.errMsg).toBe('');
    expect(page.data.saving).toBe(false);
    expect(page.data.isNew).toBe(false);
  });

  test('保存时 api 抛 ApiError —— errMsg 非空,不抛出,saving 复位', async () => {
    api.saveDog.mockRejectedValue(apiError('FORBIDDEN', '不是你的狗'));

    const page = await loadNew();
    setField(page, 'name', '旺财');
    await expect(page.onSave()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.saving).toBe(false);
  });

  test('CONTENT_RISKY 的 msg 是字段名 —— errMsg 翻成人话', async () => {
    api.saveDog.mockRejectedValue(apiError('CONTENT_RISKY', 'name'));

    const page = await loadNew();
    setField(page, 'name', '旺财');
    await page.onSave();

    expect(page.data.errMsg).toContain('名字');
    expect(page.data.errMsg).toContain('不合适的内容');
  });
});

describe('狗档案编辑页 —— 身份牌入口与删除', () => {
  test('已保存的狗点「身份牌」—— navigateTo 到 dog/tag 并带上 dogId', async () => {
    const page = await loadExisting();

    page.onOpenTag();

    const nav = page.__wx.__calls.filter((c) => c.name === 'navigateTo');
    expect(nav).toHaveLength(1);
    expect(nav[0].opts.url).toBe('/pages/dog/tag/tag?dogId=d1');
  });

  test('还没保存过的狗没有身份牌入口,点了也不跳', async () => {
    const page = await loadNew();

    page.onOpenTag();

    expect(page.data.isNew).toBe(true);
    expect(page.__wx.__calls.some((c) => c.name === 'navigateTo')).toBe(false);
    expect(page.data.errMsg).not.toBe('');
  });

  test('删除已有的狗 —— 确认后调 api.removeDog 再退回上一页', async () => {
    api.removeDog.mockResolvedValue({ removed: true });

    const page = await loadExisting();
    await page.onRemove();

    expect(api.removeDog).toHaveBeenCalledWith('d1');
    expect(page.__wx.__calls.some((c) => c.name === 'navigateBack')).toBe(true);
  });

  test('删除弹窗里点取消 —— 不调 api.removeDog', async () => {
    const page = await loadExisting(undefined, {
      wx: { showModal: (o) => o.success({ confirm: false, cancel: true }) },
    });
    await page.onRemove();

    expect(api.removeDog).not.toHaveBeenCalled();
  });

  test('新建态点删除 —— 不调 api,直接退回', async () => {
    const page = await loadNew();
    await page.onRemove();

    expect(api.removeDog).not.toHaveBeenCalled();
  });
});

describe('狗档案编辑页 —— 静态约束', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');

  test('页面源码里没有 new Date() / Date.now()(spec 3.3.4)', () => {
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });

  test('页面不直接调 wx.cloud.*(spec 3.3.3)', () => {
    expect(src).not.toMatch(/wx\.cloud\./);
  });
});
