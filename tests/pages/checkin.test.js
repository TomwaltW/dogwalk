/**
 * T8 —— 签到页 pages/checkin/checkin.js
 *
 * 验收 B9(spec 2.2):
 *   未选狗时提交被拦下,api.checkin 未被调;
 *   wx.getLocation 成功后 api.checkin 收到 {parkId, dogIds, latitude, longitude};
 *   OUT_OF_RANGE 时 data.errMsg 含 msg 里的米数;
 *   getLocation 失败时 errMsg 提示定位且 api.checkin 未被调。
 */

jest.mock('../../miniprogram/api/index');

const api = require('../../miniprogram/api/index');
const { loadPage } = require('../fakes/mini-runtime');

const PAGE = 'miniprogram/pages/checkin/checkin.js';

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** dogs 集合文档(spec 3.2.2),含主人字段,页面必须只取展示用的那几个 */
function makeDog(over) {
  return Object.assign(
    {
      _id: 'd1',
      ownerOpenid: 'o-should-not-leak',
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

/** 让 getLocation 真给一对坐标(默认 stub 只 success({})) */
const GPS_OK = {
  wx: { getLocation: (o) => o.success({ latitude: 30.27, longitude: 120.15 }) },
};
const GPS_DENIED = {
  wx: { getLocation: (o) => o.fail({ errMsg: 'getLocation:fail auth deny' }) },
};

function callsOf(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

/** 把已排队的 microtask 全部跑完 —— 断言「此刻调了几次」前用 */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 载页 + onLoad,省得每个用例抄四行 */
async function open(dogs, stubs) {
  api.listMyDogs.mockResolvedValue(dogs);
  const page = loadPage(PAGE, stubs);
  await page.onLoad({ parkId: 'p1' });
  return page;
}

describe('签到页 —— 选狗(B9)', () => {
  test('onLoad 拉自己的狗,只有一只时默认选中', async () => {
    const page = await open([makeDog()]);

    expect(api.listMyDogs).toHaveBeenCalledTimes(1);
    expect(page.data.dogs).toHaveLength(1);
    expect(page.data.dogs[0].dogId).toBe('d1');
    expect(page.data.dogs[0].selected).toBe(true);
    expect(page.data.dogs[0].sizeText).toBe('中型犬');
    expect(page.data.errMsg).toBe('');
  });

  test('多于一只时都不预选,点一下能选中、再点取消', async () => {
    const page = await open([makeDog(), makeDog({ _id: 'd2', name: '二哈' })]);

    expect(page.data.dogs.map((d) => d.selected)).toEqual([false, false]);

    page.onToggleDog({ currentTarget: { dataset: { dogId: 'd2' } } });
    expect(page.data.dogs.map((d) => d.selected)).toEqual([false, true]);

    page.onToggleDog({ currentTarget: { dataset: { dogId: 'd2' } } });
    expect(page.data.dogs.map((d) => d.selected)).toEqual([false, false]);
  });

  test('一只狗都没有时给空状态提示', async () => {
    const page = await open([]);

    expect(page.data.dogs).toEqual([]);
    expect(page.data.emptyText).not.toBe('');
    expect(page.data.emptyText).toContain('我的');
  });

  test('listMyDogs 抛错时落 errMsg,不抛', async () => {
    api.listMyDogs.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));
    const page = loadPage(PAGE);
    await expect(page.onLoad({ parkId: 'p1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.loading).toBe(false);
  });
});

describe('签到页 —— 提交(B9)', () => {
  test('未选狗时提交被拦下,api.checkin 未被调', async () => {
    const page = await open([makeDog(), makeDog({ _id: 'd2', name: '二哈' })], GPS_OK);

    await page.onSubmit();

    expect(api.checkin).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
    expect(page.data.submitting).toBe(false);
  });

  test('没拿到 parkId 时提交被拦下,api.checkin 未被调', async () => {
    api.listMyDogs.mockResolvedValue([makeDog()]);
    const page = loadPage(PAGE, GPS_OK);
    await page.onLoad({});

    await page.onSubmit();

    expect(api.checkin).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('getLocation 成功后 api.checkin 收到 {parkId, dogIds, latitude, longitude}', async () => {
    api.checkin.mockResolvedValue({ checkinId: 'c1', expireAt: '2026-09-16T12:00:00+08:00' });
    const page = await open([makeDog()], GPS_OK);

    await page.onSubmit();

    expect(api.checkin).toHaveBeenCalledTimes(1);
    expect(api.checkin).toHaveBeenCalledWith({
      parkId: 'p1',
      dogIds: ['d1'],
      latitude: 30.27,
      longitude: 120.15,
    });
    expect(page.data.errMsg).toBe('');
    expect(callsOf(page, 'showToast')).toHaveLength(1);
    expect(callsOf(page, 'navigateBack')).toHaveLength(1);
  });

  test('签到成功后 submitting 复位', async () => {
    api.checkin.mockResolvedValue({ checkinId: 'c1', expireAt: '2026-09-16T12:00:00+08:00' });
    const page = await open([makeDog()], GPS_OK);

    await page.onSubmit();
    expect(page.data.submitting).toBe(false);
  });

  test('连点保护:第一次还没回来时第二次不重复调 api.checkin', async () => {
    let release;
    api.checkin.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const page = await open([makeDog()], GPS_OK);

    const first = page.onSubmit();
    await flush(); // 让第一次走完 getLocation、停在 api.checkin 上
    const second = page.onSubmit();
    await second;

    expect(api.checkin).toHaveBeenCalledTimes(1);

    release({ checkinId: 'c1', expireAt: '2026-09-16T12:00:00+08:00' });
    await first;
    expect(api.checkin).toHaveBeenCalledTimes(1);
  });
});

describe('签到页 —— 失败面(B9 / spec 3.4)', () => {
  test('OUT_OF_RANGE 时 errMsg 含 msg 里的米数', async () => {
    api.checkin.mockRejectedValue(Object.assign(new Error('350'), { code: 'OUT_OF_RANGE' }));
    const page = await open([makeDog()], GPS_OK);

    await expect(page.onSubmit()).resolves.toBeUndefined();

    expect(page.data.errMsg).toContain('350');
    expect(page.data.errMsg).toContain('米');
    expect(page.data.submitting).toBe(false);
  });

  test('CONFLICT / NOT_FOUND / FORBIDDEN / INVALID_PARAM 各给一句人话', async () => {
    const codes = ['CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_PARAM'];
    const seen = [];
    for (const code of codes) {
      api.checkin.mockRejectedValue(apiError(code, code));
      const page = await open([makeDog()], GPS_OK);
      await page.onSubmit();
      expect(page.data.errMsg).not.toBe('');
      expect(page.data.errMsg).not.toBe(code); // 不能把错误码原样甩给用户
      seen.push(page.data.errMsg);
    }
    expect(new Set(seen).size).toBe(codes.length);
  });

  test('没见过的错误码退回 e.message', async () => {
    api.checkin.mockRejectedValue(apiError('INTERNAL', '云函数挂了'));
    const page = await open([makeDog()], GPS_OK);

    await page.onSubmit();
    expect(page.data.errMsg).toBe('云函数挂了');
  });

  test('getLocation 失败时 errMsg 提示定位,且 api.checkin 未被调', async () => {
    const page = await open([makeDog()], GPS_DENIED);

    await expect(page.onSubmit()).resolves.toBeUndefined();

    expect(api.checkin).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('定位');
    expect(page.data.needSetting).toBe(true);
    expect(page.data.submitting).toBe(false);
  });

  test('getLocation 成功却没给坐标时按定位失败处理,不调 api.checkin', async () => {
    // mini-runtime 的默认 stub 就是 success({}),真机上偶尔也会这样
    const page = await open([makeDog()]);

    await page.onSubmit();

    expect(api.checkin).not.toHaveBeenCalled();
    expect(page.data.errMsg).toContain('定位');
  });

  test('「去设置」调 wx.openSetting,用户打开定位后清掉提示', async () => {
    const page = await open([makeDog()], {
      wx: {
        getLocation: (o) => o.fail({ errMsg: 'getLocation:fail auth deny' }),
        openSetting: (o) => o.success({ authSetting: { 'scope.userLocation': true } }),
      },
    });
    await page.onSubmit();
    expect(page.data.needSetting).toBe(true);

    await page.onOpenSetting();

    expect(page.data.needSetting).toBe(false);
    expect(page.data.errMsg).toBe('');
  });
});

describe('签到页 —— 说明与隐私', () => {
  test('页面写明 2 小时有效、坐标不保存', async () => {
    const page = await open([makeDog()], GPS_OK);
    expect(page.data.tipText).toContain('2 小时');
    expect(page.data.tipText).toContain('不会保存');
  });

  test('JSON.stringify(page.data) 不含 openid / nickname', async () => {
    const page = await open([makeDog()], GPS_OK);

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toContain('openid');
    expect(dumped).not.toContain('nickname');
  });
});
