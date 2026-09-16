// miniprogram/pages/checkin/checkin.js —— owner: T8
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败落 data.errMsg 不抛(spec 3.4)。

const api = require('../../api/index');
const host = require('../../logic/host');
const enums = require('../../logic/enums');

const HOURS = enums.CHECKIN_DURATION_MS / (60 * 60 * 1000);
const TIP_TEXT = '签到 ' + HOURS + ' 小时内有效,坐标只用来校验你在不在公园里,不会保存。';
const LOCATION_FAIL = '需要定位权限才能签到,请到设置里打开';

/**
 * 签到失败的人话。OUT_OF_RANGE 的 msg 就是四舍五入后的米数(spec 3.4)。
 * @param {Error & {code?: string}} err
 * @returns {string}
 */
function readableError(err) {
  if (!err) return '签到没成,再试一次';
  switch (err.code) {
    case 'OUT_OF_RANGE':
      return '你离公园还有 ' + err.message + ' 米,走近一点再签到';
    case 'CONFLICT':
      return '你已经在这个公园签到过了';
    case 'NOT_FOUND':
      return '这个公园不见了,回地图重新选一个';
    case 'FORBIDDEN':
      return '选中的狗里有不是你的,回去重新选';
    case 'INVALID_PARAM':
      return '签到信息不对,退回去重进一次';
    case 'AUTH_REQUIRED':
      return '请先到「我的」里登录';
    default:
      return err.message || '签到没成,再试一次';
  }
}

/** 坐标得是有限数,不然拿去调 checkin 只会换回 INVALID_PARAM */
function hasCoords(loc) {
  return !!loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude);
}

/**
 * dogs 文档(spec 3.2.2)-> 选择列表的一行。只挑展示要用的字段,
 * ownerOpenid 这类不进 data。
 * @param {object} d
 * @param {boolean} selected
 */
function toRow(d, selected) {
  return {
    dogId: d._id,
    name: d.name,
    avatarFileID: d.avatarFileID || '',
    sizeText: enums.labelOf(enums.SIZE_LABEL, d.sizeClass),
    tagsText: enums.labelsOfTags(d.tags),
    selected,
  };
}

const options = {
  data: {
    parkId: '',
    dogs: [],
    tipText: TIP_TEXT,
    emptyText: '',
    loading: false,
    submitting: false,
    errMsg: '',
    // 定位被拒时才显示「去设置」
    needSetting: false,
  },

  async onLoad(query) {
    const parkId = (query && query.parkId) || '';
    this.setData({ parkId, errMsg: parkId ? '' : '没拿到公园,回上一页重新进' });
    await this.loadDogs();
  },

  async loadDogs() {
    this.setData({ loading: true });
    try {
      const list = await api.listMyDogs();
      const dogs = Array.isArray(list) ? list : [];
      // 只有一只就别让人多点一下
      const only = dogs.length === 1;
      this.setData({
        dogs: dogs.map((d) => toRow(d, only)),
        emptyText: dogs.length ? '' : '你还没有狗,先去「我的」加一只',
        loading: false,
      });
    } catch (err) {
      this.setData({
        dogs: [],
        loading: false,
        errMsg: (err && err.message) || '狗列表没拉到,退回去重进一次',
      });
    }
  },

  onToggleDog(e) {
    const dogId = e && e.currentTarget && e.currentTarget.dataset.dogId;
    if (!dogId) return;
    this.setData({
      dogs: this.data.dogs.map((d) =>
        d.dogId === dogId ? Object.assign({}, d, { selected: !d.selected }) : d
      ),
      errMsg: '',
    });
  },

  async onSubmit() {
    if (this.data.submitting) return; // 连点保护
    const parkId = this.data.parkId;
    if (!parkId) {
      this.setData({ errMsg: '没拿到公园,回上一页重新进' });
      return;
    }
    const dogIds = this.data.dogs.filter((d) => d.selected).map((d) => d.dogId);
    if (!dogIds.length) {
      // 本地就拦下来,不浪费一次云函数调用
      this.setData({ errMsg: '先选一只要签到的狗' });
      return;
    }

    this.setData({ submitting: true, errMsg: '', needSetting: false });

    const w = host.wxOf(this);
    let loc = null;
    try {
      loc = await host.promisify(w, 'getLocation')({ type: 'gcj02', isHighAccuracy: true });
    } catch (err) {
      loc = null;
    }
    if (!hasCoords(loc)) {
      // 拿不到坐标就到此为止,不调 api.checkin(spec 3.4 末行)
      this.setData({ submitting: false, errMsg: LOCATION_FAIL, needSetting: true });
      return;
    }

    try {
      await api.checkin({
        parkId,
        dogIds,
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      this.setData({ submitting: false, errMsg: '' });
      if (w) {
        w.showToast({ title: '签到成功', icon: 'success' });
        w.navigateBack();
      }
    } catch (err) {
      this.setData({ submitting: false, errMsg: readableError(err) });
    }
  },

  /** 用户在设置页把定位打开了就把提示收掉,让他直接再点一次签到 */
  async onOpenSetting() {
    const w = host.wxOf(this);
    try {
      const res = await host.promisify(w, 'openSetting')();
      const setting = (res && res.authSetting) || {};
      if (setting['scope.userLocation']) {
        this.setData({ needSetting: false, errMsg: '' });
      }
    } catch (err) {
      this.setData({ errMsg: LOCATION_FAIL });
    }
  },
};

Page(options);
module.exports = options;
