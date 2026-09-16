/**
 * T9 —— 身份牌页 pages/dog/tag/tag.js
 *
 * 独有验收(spec 2.2 B11 / 派单 B11):
 *   ① 无 qrFileID 时调 api.genTag;
 *   ② 「保存到相册」先 api.downloadFile 再 wx.saveImageToPhotosAlbum;
 *   ③ 用户接受订阅 → api.grantSubscribe 再 api.setLostMode(dogId, true, note);
 *   ④ 用户拒绝订阅 → 不调 grantSubscribe,但仍 setLostMode(dogId, true, note)。
 * 共同约束:3.4 捕获 ApiError 落 errMsg 不抛;3.3.4 页面里不许出现 new Date()。
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../miniprogram/api/index');
// 真的 config.js 里模板 id 还是占位符(总管填),测试给一个假 id,好断言它被带去 grantSubscribe
jest.mock('../../miniprogram/config', () => ({
  ENV_ID: 'test-env',
  SUBSCRIBE_TEMPLATES: { foundReport: 'tmpl-found-report' },
  DEFAULT_MAP_CENTER: { latitude: 30.2741, longitude: 120.1551 },
  DEFAULT_MAP_SCALE: 13,
  isPlaceholder(v) {
    return typeof v !== 'string' || v === '' || v.indexOf('<<') === 0;
  },
}));

const api = require('../../miniprogram/api/index');
const config = require('../../miniprogram/config');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/dog/tag/tag.js';
const TMPL = 'tmpl-found-report';

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
      gender: 'male',
      birthMonth: '2023-05',
      sizeClass: 'medium',
      neutered: true,
      vaccinated: true,
      licenseNo: '',
      tags: ['ball'],
      avatarFileID: '',
      tagCode: 'a1b2c3',
      qrFileID: 'cloud://tags/a1b2c3.png',
      lostMode: false,
      lostNote: '它叫旺财,怕生,看到请打电话给我',
    },
    over || {}
  );
}

/** FoundReport(spec 3.2.3) */
function makeReport(over) {
  return Object.assign(
    {
      reportId: 'r1',
      message: '在城北公园西门看到它了',
      latitude: 30.31,
      longitude: 120.17,
      createdAt: '2026-09-16T02:05:00.000Z', // 东八区 2026-09-16 10:05
    },
    over || {}
  );
}

/**
 * wx.requestSubscribeMessage 的替身:把每次调用的 tmplIds 记进 log,
 * 这样「模板没配置时跳过这一步」才是句能证伪的断言(默认 stub 会被这里整个换掉,
 * 换掉之后就不进 wx.__calls 了)。
 * @param {'accept'|'reject'} answer 用户点的是允许还是取消
 * @param {Array} log 调用记录
 */
function wxSub(answer, log) {
  return {
    requestSubscribeMessage: (o) => {
      log.push(o.tmplIds);
      o.success({ errMsg: 'ok', [TMPL]: answer });
    },
  };
}

async function loadTag(over, stubs) {
  api.listMyDogs.mockResolvedValue([makeDog(over)]);
  api.listFoundReports.mockResolvedValue([]);
  const page = loadPage(PAGE, stubs);
  await page.onLoad({ dogId: 'd1' });
  return page;
}

describe('身份牌页 —— 加载与补码(B11 ①)', () => {
  test('无 qrFileID 时调 api.genTag,拿回的 tagCode / qrFileID 落进 data', async () => {
    api.genTag.mockResolvedValue({ tagCode: 'z9y8x7', qrFileID: 'cloud://tags/z9y8x7.png' });

    const page = await loadTag({ tagCode: '', qrFileID: '' });

    expect(api.genTag).toHaveBeenCalledWith('d1');
    expect(page.data.tagCode).toBe('z9y8x7');
    expect(page.data.qrFileID).toBe('cloud://tags/z9y8x7.png');
    expect(page.data.loading).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('已经有 qrFileID 就不再调 api.genTag', async () => {
    const page = await loadTag();

    expect(api.genTag).not.toHaveBeenCalled();
    expect(page.data.tagCode).toBe('a1b2c3');
    expect(page.data.qrFileID).toBe('cloud://tags/a1b2c3.png');
  });

  test('genTag 抛错 —— errMsg 非空,页面其他部分照常显示', async () => {
    api.genTag.mockRejectedValue(apiError('INTERNAL', '小程序码生成失败'));
    api.listMyDogs.mockResolvedValue([makeDog({ tagCode: '', qrFileID: '' })]);
    api.listFoundReports.mockResolvedValue([makeReport()]);

    const page = loadPage(PAGE);
    await expect(page.onLoad({ dogId: 'd1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.dogName).toBe('旺财'); // 狗还在
    expect(page.data.reports).toHaveLength(1); // 留言列表照常拉
    expect(page.data.loading).toBe(false);
  });

  test('没带 dogId 进来 —— errMsg 非空,不调 api', async () => {
    const page = loadPage(PAGE);
    await page.onLoad({});

    expect(api.listMyDogs).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('这只狗不在自己的列表里 —— errMsg 非空,不抛', async () => {
    api.listMyDogs.mockResolvedValue([makeDog({ _id: 'other' })]);

    const page = loadPage(PAGE);
    await expect(page.onLoad({ dogId: 'd1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
  });

  test('listMyDogs 抛错 —— errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockRejectedValue(apiError('AUTH_REQUIRED', '请先登录'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({ dogId: 'd1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });
});

describe('身份牌页 —— 保存到相册(B11 ②)', () => {
  test('先 api.downloadFile 再 wx.saveImageToPhotosAlbum', async () => {
    const order = [];
    api.downloadFile.mockImplementation(() => {
      order.push('downloadFile');
      return Promise.resolve('/tmp/tag-a1b2c3.png');
    });

    const page = await loadTag(undefined, {
      wx: {
        saveImageToPhotosAlbum: (o) => {
          order.push('saveImageToPhotosAlbum:' + o.filePath);
          o.success({});
        },
      },
    });
    await page.onSaveAlbum();

    expect(api.downloadFile).toHaveBeenCalledWith('cloud://tags/a1b2c3.png');
    expect(order).toEqual(['downloadFile', 'saveImageToPhotosAlbum:/tmp/tag-a1b2c3.png']);
    expect(page.data.savingAlbum).toBe(false);
    expect(page.data.errMsg).toBe('');
  });

  test('相册授权被拒(errMsg 含 auth deny)—— 提示去设置并给「去设置」入口', async () => {
    api.downloadFile.mockResolvedValue('/tmp/tag.png');

    const page = await loadTag(undefined, {
      wx: {
        saveImageToPhotosAlbum: (o) =>
          o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }),
      },
    });
    await expect(page.onSaveAlbum()).resolves.toBeUndefined();

    expect(page.data.needSetting).toBe(true);
    expect(page.data.errMsg).toContain('设置');
    expect(page.data.savingAlbum).toBe(false);

    page.onOpenSetting();
    expect(page.__wx.__calls.some((c) => c.name === 'openSetting')).toBe(true);
  });

  test('下载失败 —— errMsg 非空、不调 saveImageToPhotosAlbum、不抛', async () => {
    api.downloadFile.mockRejectedValue(apiError('INTERNAL', 'downloadFile failed'));

    const page = await loadTag();
    await expect(page.onSaveAlbum()).resolves.toBeUndefined();

    expect(page.__wx.__calls.some((c) => c.name === 'saveImageToPhotosAlbum')).toBe(false);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.needSetting).toBe(false);
  });
});

describe('身份牌页 —— 走失模式与订阅(B11 ③ ④)', () => {
  test('用户接受订阅 → grantSubscribe(foundReport, tmplId) 再 setLostMode(dogId, true, note)', async () => {
    const order = [];
    api.grantSubscribe.mockImplementation(() => {
      order.push('grantSubscribe');
      return Promise.resolve({ remaining: 1 });
    });
    api.setLostMode.mockImplementation(() => {
      order.push('setLostMode');
      return Promise.resolve(makeDog({ lostMode: true }));
    });

    const subLog = [];
    const page = await loadTag(undefined, { wx: wxSub('accept', subLog) });
    await page.onToggleLost({ detail: { value: true } });

    expect(subLog).toEqual([[TMPL]]); // 先弹订阅,带的是 config 里的模板 id
    expect(api.grantSubscribe).toHaveBeenCalledWith('foundReport', TMPL);
    expect(api.setLostMode).toHaveBeenCalledWith('d1', true, '它叫旺财,怕生,看到请打电话给我');
    expect(order).toEqual(['grantSubscribe', 'setLostMode']);
    expect(page.data.lostMode).toBe(true);
    expect(page.data.saving).toBe(false);
  });

  test('用户拒绝订阅 → 不调 grantSubscribe,但仍 setLostMode(dogId, true, note)', async () => {
    api.setLostMode.mockResolvedValue(makeDog({ lostMode: true }));

    const subLog = [];
    const page = await loadTag(undefined, { wx: wxSub('reject', subLog) });
    await page.onToggleLost({ detail: { value: true } });

    expect(subLog).toEqual([[TMPL]]); // 弹了,只是用户没同意
    expect(api.grantSubscribe).not.toHaveBeenCalled();
    expect(api.setLostMode).toHaveBeenCalledWith('d1', true, '它叫旺财,怕生,看到请打电话给我');
    expect(page.data.lostMode).toBe(true);
    expect(page.data.errMsg).toBe('');
  });

  test('订阅弹窗自己失败(用户左上角叉掉)—— 不调 grantSubscribe,仍开走失模式', async () => {
    api.setLostMode.mockResolvedValue(makeDog({ lostMode: true }));

    const page = await loadTag(undefined, {
      wx: { requestSubscribeMessage: (o) => o.fail({ errMsg: 'requestSubscribeMessage:fail' }) },
    });
    await expect(page.onToggleLost({ detail: { value: true } })).resolves.toBeUndefined();

    expect(api.grantSubscribe).not.toHaveBeenCalled();
    expect(api.setLostMode).toHaveBeenCalledWith('d1', true, '它叫旺财,怕生,看到请打电话给我');
    expect(page.data.lostMode).toBe(true);
  });

  test('模板 id 还是占位符 —— 跳过 requestSubscribeMessage,页面提示「模板未配置」,走失模式照开', async () => {
    const real = config.SUBSCRIBE_TEMPLATES.foundReport;
    config.SUBSCRIBE_TEMPLATES.foundReport = '<<填「寻回留言」订阅消息模板ID>>';
    try {
      api.setLostMode.mockResolvedValue(makeDog({ lostMode: true }));

      const subLog = [];
      const page = await loadTag(undefined, { wx: wxSub('accept', subLog) });
      expect(page.data.templateReady).toBe(false);

      await page.onToggleLost({ detail: { value: true } });

      expect(subLog).toEqual([]); // 模板没填就别弹,弹了用户也收不到
      expect(api.grantSubscribe).not.toHaveBeenCalled();
      expect(api.setLostMode).toHaveBeenCalledWith('d1', true, '它叫旺财,怕生,看到请打电话给我');
    } finally {
      config.SUBSCRIBE_TEMPLATES.foundReport = real;
    }
  });

  test('模板 id 填好时 templateReady 为 true', async () => {
    const page = await loadTag();
    expect(page.data.templateReady).toBe(true);
  });

  test('关走失模式 —— setLostMode(dogId, false),不带 note、不弹订阅', async () => {
    api.setLostMode.mockResolvedValue(makeDog({ lostMode: false }));

    const subLog = [];
    const page = await loadTag({ lostMode: true }, { wx: wxSub('accept', subLog) });
    await page.onToggleLost({ detail: { value: false } });

    expect(api.setLostMode).toHaveBeenCalledWith('d1', false);
    expect(subLog).toEqual([]);
    expect(api.grantSubscribe).not.toHaveBeenCalled();
    expect(page.data.lostMode).toBe(false);
  });

  test('setLostMode 失败 —— 开关拨回原样、errMsg 非空、不抛', async () => {
    api.setLostMode.mockRejectedValue(apiError('FORBIDDEN', '不是你的狗'));

    const page = await loadTag(undefined, { wx: wxSub('reject', []) });
    await expect(page.onToggleLost({ detail: { value: true } })).resolves.toBeUndefined();

    expect(page.data.lostMode).toBe(false);
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.saving).toBe(false);
  });

  test('走失态下改留言再保存 —— setLostMode(dogId, true, 新 note)', async () => {
    api.setLostMode.mockResolvedValue(makeDog({ lostMode: true, lostNote: '在城北公园走丢的' }));

    const page = await loadTag({ lostMode: true });
    page.onNoteInput({ detail: { value: '在城北公园走丢的' } });
    await page.onSaveNote();

    expect(api.setLostMode).toHaveBeenCalledWith('d1', true, '在城北公园走丢的');
    expect(page.data.lostNote).toBe('在城北公园走丢的');
    expect(page.data.errMsg).toBe('');
  });

  test('留言超 50 字 —— 本地拦下,不调 api', async () => {
    const page = await loadTag({ lostMode: true });
    page.onNoteInput({ detail: { value: '在城北公园走丢的'.repeat(7) } });
    await page.onSaveNote();

    expect(api.setLostMode).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('50');
  });
});

describe('身份牌页 —— 寻回留言列表', () => {
  test('留言按 api.listFoundReports 渲染,时间转成 YYYY-MM-DD HH:mm(东八区)', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.listFoundReports.mockResolvedValue([makeReport(), makeReport({ reportId: 'r2', latitude: null, longitude: null })]);

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });

    expect(api.listFoundReports).toHaveBeenCalledWith('d1');
    expect(page.data.reports).toHaveLength(2);
    expect(page.data.reports[0].timeText).toBe('2026-09-16 10:05');
    expect(page.data.reports[0].message).toBe('在城北公园西门看到它了');
    expect(page.data.reports[0].hasLocation).toBe(true);
    expect(page.data.reports[1].hasLocation).toBe(false);
  });

  test('一条留言都没有 —— 给空状态文案,不报错', async () => {
    const page = await loadTag();

    expect(page.data.reports).toEqual([]);
    expect(page.data.emptyText).toContain('还没有人留言');
    expect(page.data.errMsg).toBe('');
  });

  test('有坐标的留言点「看位置」—— wx.openLocation 收到经纬度', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.listFoundReports.mockResolvedValue([makeReport()]);

    const page = loadPage(PAGE);
    await page.onLoad({ dogId: 'd1' });
    page.onOpenLocation({ currentTarget: { dataset: { index: 0 } } });

    const call = page.__wx.__calls.find((c) => c.name === 'openLocation');
    expect(call).toBeDefined();
    expect(call.opts.latitude).toBe(30.31);
    expect(call.opts.longitude).toBe(120.17);
  });

  test('listFoundReports 抛错 —— errMsg 非空且不抛异常', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    api.listFoundReports.mockRejectedValue(apiError('INTERNAL', '读不出来'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({ dogId: 'd1' })).resolves.toBeUndefined();

    expect(page.data.reports).toEqual([]);
    expect(page.data.errMsg).not.toBe('');
  });
});

describe('身份牌页 —— 其他交互', () => {
  test('点小程序码看大图 —— wx.previewImage 收到 qrFileID', async () => {
    const page = await loadTag();
    page.onPreviewQr();

    const call = page.__wx.__calls.find((c) => c.name === 'previewImage');
    expect(call).toBeDefined();
    expect(call.opts.urls).toEqual(['cloud://tags/a1b2c3.png']);
  });

  test('下拉刷新 —— 重新拉一次并 stopPullDownRefresh', async () => {
    const page = await loadTag();
    await page.onPullDownRefresh();

    expect(api.listMyDogs).toHaveBeenCalledTimes(2);
    expect(page.__wx.__calls.some((c) => c.name === 'stopPullDownRefresh')).toBe(true);
  });
});

describe('身份牌页 —— 静态约束', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', PAGE), 'utf8');

  test('页面源码里没有 new Date() / Date.now()(spec 3.3.4)', () => {
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });

  test('页面不直接调 wx.cloud.*(spec 3.3.3)', () => {
    expect(src).not.toMatch(/wx\.cloud\./);
  });
});
