// miniprogram/pages/park/park.js —— owner: T8
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败落 data.errMsg 不抛(spec 3.4)。

const api = require('../../api/index');
const host = require('../../logic/host');
const enums = require('../../logic/enums');
const format = require('./format');

const EMPTY_NOW = '这个公园还没有狗狗,签到成为第一只吧';
const EMPTY_TODAY = '今天还没有狗来过这儿';

function readableError(err, fallback) {
  if (!err) return fallback;
  const byCode = {
    AUTH_REQUIRED: '请先到「我的」里登录',
    NOT_FOUND: '这个公园不见了,回地图重新选一个',
    FORBIDDEN: '这条签到不是你的',
  };
  return byCode[err.code] || err.message || fallback;
}

/**
 * DogCard -> 卡片要显示的东西。只挑 spec 3.2.3 的五个字段并就地转成中文,
 * 后端万一多塞了主人字段也进不来 data(spec 1:公园页不展示主人)。
 * @param {object} d DogCard
 */
function toCard(d) {
  return {
    dogId: d.dogId,
    name: d.name,
    avatarFileID: d.avatarFileID || '',
    sizeText: enums.labelOf(enums.SIZE_LABEL, d.sizeClass),
    tagsText: enums.labelsOfTags(d.tags),
  };
}

function toCards(list) {
  return (Array.isArray(list) ? list : []).map(toCard);
}

const options = {
  data: {
    parkId: '',
    park: null,
    dogs: [],
    todayDogs: [],
    myCheckin: null,
    expireText: '',
    emptyText: '',
    todayEmptyText: '',
    loading: false,
    errMsg: '',
  },

  async onLoad(query) {
    const parkId = (query && query.parkId) || '';
    if (!parkId) {
      this.setData({ errMsg: '没拿到公园,回地图重新选一个' });
      return;
    }
    this.setData({ parkId });
    await this.loadBoard();
  },

  /**
   * 从签到页 navigateBack 回来要立刻看到自己的狗。
   * 首次 onShow 紧跟在 onLoad 后面,那次跳过,免得白拉一遍。
   */
  async onShow() {
    if (!this.shown) {
      this.shown = true;
      return;
    }
    if (!this.data.parkId) return;
    await this.loadBoard();
  },

  async onPullDownRefresh() {
    if (this.data.parkId) await this.loadBoard();
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  async loadBoard() {
    this.setData({ loading: true });
    try {
      const board = (await api.getParkBoard(this.data.parkId)) || {};
      const park = board.park || null;
      const dogs = toCards(board.dogs);
      const todayDogs = toCards(board.todayDogs);
      const myCheckin = board.myCheckin
        ? {
            checkinId: board.myCheckin.checkinId,
            dogIds: board.myCheckin.dogIds || [],
            expireAt: board.myCheckin.expireAt || '',
          }
        : null;

      this.setData({
        park: park
          ? { parkId: park.parkId, name: park.name, activeDogCount: park.activeDogCount || 0 }
          : null,
        dogs,
        todayDogs,
        myCheckin,
        expireText: myCheckin ? format.hhmm(myCheckin.expireAt) : '',
        emptyText: dogs.length ? '' : EMPTY_NOW,
        todayEmptyText: todayDogs.length ? '' : EMPTY_TODAY,
        loading: false,
        errMsg: '',
      });

      const w = host.wxOf(this);
      if (w && park && park.name) w.setNavigationBarTitle({ title: park.name });
    } catch (err) {
      this.setData({ loading: false, errMsg: readableError(err, '公园看板没拉到,下拉重试') });
    }
  },

  onCheckin() {
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/checkin/checkin?parkId=' + this.data.parkId });
  },

  async onCancel() {
    const myCheckin = this.data.myCheckin;
    if (!myCheckin) return;
    this.setData({ errMsg: '' });
    try {
      await api.cancelCheckin(myCheckin.checkinId);
      await this.loadBoard();
    } catch (err) {
      this.setData({ errMsg: readableError(err, '签退没成,再试一次') });
    }
  },

  onCreateWalk() {
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/walk/create/create?parkId=' + this.data.parkId });
  },
};

Page(options);
module.exports = options;
