// miniprogram/pages/me/me.js —— owner: T5
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败落 data.errMsg(spec 3.4)。

const api = require('../../api/index');
const meta = require('../dog/dog-meta');
const host = require('../dog/page-host');

function readableError(err, fallback) {
  if (!err) return fallback;
  const byCode = {
    AUTH_REQUIRED: '请先登录再看自己的狗',
    NOT_FOUND: '档案不见了',
  };
  return byCode[err.code] || err.message || fallback;
}

/** 列表项上要显示的几个中文串,提前算好省得 wxml 里绕 */
function toRow(dog) {
  return Object.assign({}, dog, {
    sizeClassText: meta.labelOf('sizeClass', dog.sizeClass),
    genderText: meta.labelOf('gender', dog.gender),
    temperamentText: meta.labelsOf('temperament', dog.temperament),
    hasTag: !!dog.tagCode,
  });
}

const options = {
  data: {
    user: null,
    logged: false,
    dogs: [],
    loading: false,
    errMsg: '',
  },

  async onLoad() {
    this.syncUser();
    await this.refresh();
  },

  /** 从编辑页退回来要看到改完的样子 */
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

  async refresh() {
    this.setData({ loading: true });
    try {
      const dogs = await api.listMyDogs();
      this.setData({
        dogs: (Array.isArray(dogs) ? dogs : []).map(toRow),
        loading: false,
        errMsg: '',
      });
    } catch (err) {
      // 拉不到就维持空列表 + 提示,不白屏也不抛(spec 3.4)
      this.setData({ dogs: [], loading: false, errMsg: readableError(err, '狗列表没拉到,下拉重试') });
    }
  },

  /** 没登录时页面上那个登录按钮 —— 不自动弹,由用户点 */
  async onLogin() {
    this.setData({ errMsg: '' });
    try {
      const res = await api.login();
      const user = (res && res.user) || null;
      const dogs = (res && Array.isArray(res.dogs) ? res.dogs : []).map(toRow);

      const app = host.appOf(this);
      if (app && app.globalData) {
        app.globalData.user = user;
        app.globalData.logged = !!user;
      }

      this.setData({ user, logged: !!user, dogs, errMsg: '' });
    } catch (err) {
      this.setData({ errMsg: readableError(err, '登录没成,再试一次') });
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

  /** 看看别人扫了这只狗的牌子会看到什么 */
  onViewPublic(e) {
    const tagCode = (e && e.currentTarget && e.currentTarget.dataset.tagCode) || '';
    if (!tagCode) {
      this.setData({ errMsg: '这只狗还没生成狗牌,先去档案页生成' });
      return;
    }
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/dog/profile/profile?tagCode=' + tagCode });
  },
};

Page(options);
module.exports = options;
