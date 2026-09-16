// miniprogram/pages/me/me.js —— owner: T9
// 我的:登录 / 我的狗(编辑 + 身份牌两个入口)/ 我发起的约遛 / 我参加的约遛。
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败一律落 data.errMsg(spec 3.4)。
// 这是 tab 页,跳别人用 navigateTo;别人跳过来才用 switchTab。

const api = require('../../api/index');
const host = require('../../logic/host');
const meta = require('../dog/dog-meta');

const enums = meta.enums;

/** dogs(spec 3.2.2)-> 列表行,中文串提前算好省得 wxml 里绕 */
function toDogRow(dog) {
  const d = dog || {};
  return {
    _id: d._id,
    name: d.name || '',
    avatarFileID: d.avatarFileID || '',
    sizeText: meta.sizeText(d.sizeClass),
    tagsText: meta.tagsText(d.tags),
    lostMode: !!d.lostMode,
  };
}

/**
 * 一条约遛在「我的」里怎么标状态:
 * 整场取消了就一律是「已取消」;否则我是发起人就标「我发起的」,
 * 是参与者就把 myStatus 翻成中文(spec 3.2.1 MEMBER_STATUS_LABEL)。
 */
function statusTextOf(walk) {
  if (walk.status === 'cancelled') return '已取消';
  if (walk.isHost) return '我发起的';
  return enums.labelOf(enums.MEMBER_STATUS_LABEL, walk.myStatus);
}

/** WalkSummary(spec 3.2.3)-> 列表行 */
function toWalkRow(walk) {
  const w = walk || {};
  return {
    walkId: w.walkId,
    parkName: w.parkName || '',
    timeText: meta.formatIsoMinute(w.startAt),
    dogCount: w.dogCount || 0,
    maxDogs: w.maxDogs || 0,
    note: w.note || '',
    isHost: !!w.isHost,
    cancelled: w.status === 'cancelled',
    statusText: statusTextOf(w),
  };
}

const options = {
  data: {
    user: null,
    logged: false,

    dogs: [],
    hostedWalks: [],
    joinedWalks: [],

    loading: false,
    walksLoading: false,
    errMsg: '',

    dogsEmptyText: '还没有狗,先加一只',
    hostedEmptyText: '还没发起过约遛,去公园页约一场',
    joinedEmptyText: '还没参加过别人的约遛',
  },

  onLoad() {
    // 只同步登录态;拉数据交给 onShow —— onLoad 之后必定跟一次 onShow,
    // 两边都拉就是每次进页面拉两遍。
    this.syncUser();
  },

  /** 从编辑页 / 身份牌页回来要看到最新的(tab 页每次切回来也会走这里) */
  async onShow() {
    this.syncUser();
    await this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  /** 登录态来自 app.globalData(app.js 里 login 之后写的),这里只读不改 */
  syncUser() {
    const g = host.globalDataOf(this);
    this.setData({ user: g.user || null, logged: !!g.logged });
  },

  /** 狗和约遛各拉各的:一边挂了另一边照常显示(所以 errMsg 只在开头清一次) */
  async refresh() {
    this.setData({ loading: true, walksLoading: true, errMsg: '' });
    await Promise.all([this.loadDogs(), this.loadWalks()]);
  },

  async loadDogs() {
    try {
      const dogs = await api.listMyDogs();
      this.setData({
        dogs: (Array.isArray(dogs) ? dogs : []).map(toDogRow),
        loading: false,
      });
    } catch (err) {
      this.setData({
        dogs: [],
        loading: false,
        errMsg: meta.readableError(err, '狗列表没拉到,下拉重试'),
      });
    }
  },

  /** 一次拉回我的全部约遛(含已取消),按 isHost 分两栏 */
  async loadWalks() {
    try {
      const walks = await api.listWalks({ mine: true });
      const rows = (Array.isArray(walks) ? walks : []).map(toWalkRow);
      this.setData({
        hostedWalks: rows.filter((w) => w.isHost),
        joinedWalks: rows.filter((w) => !w.isHost),
        walksLoading: false,
      });
    } catch (err) {
      this.setData({
        hostedWalks: [],
        joinedWalks: [],
        walksLoading: false,
        errMsg: meta.readableError(err, '约遛没拉到,下拉重试'),
      });
    }
  },

  /** 没登录时页面上那个登录按钮 —— 不自动弹,由用户点 */
  async onLogin() {
    this.setData({ errMsg: '' });
    try {
      const res = await api.login();
      const user = (res && res.user) || null;
      const dogs = (res && Array.isArray(res.dogs) ? res.dogs : []).map(toDogRow);

      const app = host.appOf(this);
      if (app && app.globalData) {
        app.globalData.user = user;
        app.globalData.logged = !!user;
      }

      this.setData({ user, logged: !!user, dogs, errMsg: '' });
    } catch (err) {
      this.setData({ errMsg: meta.readableError(err, '登录没成,再试一次') });
    }
  },

  onAddDog() {
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/dog/edit/edit' });
  },

  onEditDog(e) {
    const dogId = e && e.currentTarget && e.currentTarget.dataset.dogId;
    if (!dogId) return;
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/dog/edit/edit?dogId=' + dogId });
  },

  /** 身份牌页:小程序码 / 存相册 / 走失模式 / 寻回留言都在那边 */
  onOpenTag(e) {
    const dogId = e && e.currentTarget && e.currentTarget.dataset.dogId;
    if (!dogId) return;
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/dog/tag/tag?dogId=' + dogId });
  },

  onOpenWalk(e) {
    const walkId = e && e.currentTarget && e.currentTarget.dataset.walkId;
    if (!walkId) return;
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/walk/detail/detail?walkId=' + walkId });
  },
};

Page(options);
module.exports = options;
