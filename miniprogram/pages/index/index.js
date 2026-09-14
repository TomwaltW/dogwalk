// miniprogram/pages/index/index.js —— owner: T4
// 首页:小区里的几个固定遛狗点位,各自显示此刻有几个人几只狗在场。
// 点位由运营手工录入(spec 1),这里只读;不做地图、不做附近、不取定位。

const api = require('../../api/index');

/** ApiError -> 给用户看的一句话。code 见 spec 3.1。 */
function errText(e) {
  const code = e && e.code;
  if (code === 'AUTH_REQUIRED') return '还没登录,回「我的」登录一下再来';
  return (e && e.message) || '加载失败,下拉重试';
}

const options = {
  data: {
    /** @type {Array<{spotId:string,name:string,peakHint:string,regularCount:number,activeDogCount:number,activePeopleCount:number}>} */
    spots: [],
    loading: false,
    errMsg: '',
    // onLoad 已经拉过一次,首次进入时紧跟其后的 onShow 不重复拉
    entered: false,
  },

  async onLoad() {
    await this.loadSpots();
  },

  async onShow() {
    if (!this.data.entered) {
      this.setData({ entered: true });
      return;
    }
    // 从点位详情 / 发广播页返回,在场人数可能已经变了
    await this.loadSpots();
  },

  async onPullDownRefresh() {
    await this.loadSpots();
    wx.stopPullDownRefresh();
  },

  async loadSpots() {
    this.setData({ loading: true, errMsg: '' });
    try {
      const spots = await api.listSpots();
      this.setData({ spots: Array.isArray(spots) ? spots : [] });
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },

  goSpot(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.spotId) return;
    wx.navigateTo({ url: '/pages/spot/spot?spotId=' + ds.spotId });
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/me' });
  },
};

Page(options);
module.exports = options;
