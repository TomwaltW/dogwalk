// miniprogram/pages/spot/spot.js —— owner: T4
// 点位详情:这个点位此刻有谁带着哪几只狗在场(spec 3.3.2 spotBoard 带 spotId 的 data)。
// 聊天外包给微信群,这里只展示一张群二维码图片(spec 1「明确不做」)。

const api = require('../../api/index');
const { formatHm } = require('./format');

/** ApiError -> 给用户看的一句话。code 见 spec 3.1。 */
function errText(e) {
  const code = e && e.code;
  if (code === 'AUTH_REQUIRED') return '还没登录,回「我的」登录一下再来';
  if (code === 'NOT_FOUND') return '这个点位不存在或者已经下线了';
  return (e && e.message) || '看板加载失败,下拉重试';
}

/** BoardSession -> 加上 WXML 直接能用的派生字段(WXML 里做不了字符串运算) */
function decorate(s) {
  const dogs = (s && s.dogs) || [];
  return Object.assign({}, s, {
    dogs,
    dogText: dogs.map((d) => d.name).join('、'),
    timeText: formatHm(s && s.startAt) + '-' + formatHm(s && s.expireAt),
  });
}

const options = {
  data: {
    spotId: '',
    /** @type {object|null} spec 3.2 spots 文档 */
    spot: null,
    /** @type {Array<object>} BoardSession + dogText/timeText */
    sessions: [],
    peopleCount: 0,
    dogCount: 0,
    wxGroupQrFileID: '',
    loading: false,
    errMsg: '',
    entered: false,
  },

  async onLoad(query) {
    const spotId = (query && query.spotId) || '';
    this.setData({ spotId });
    if (!spotId) {
      // 正常路径进不来,只有手搓 url 或者跳转漏传参数才会;别让页面白屏
      this.setData({ errMsg: '没拿到点位,回首页重新选一个' });
      return;
    }
    await this.loadBoard();
  },

  async onShow() {
    if (!this.data.entered) {
      this.setData({ entered: true });
      return;
    }
    // 从发广播页返回,自己那条应该立刻出现在看板上
    if (this.data.spotId) await this.loadBoard();
  },

  async onPullDownRefresh() {
    if (this.data.spotId) await this.loadBoard();
    wx.stopPullDownRefresh();
  },

  async loadBoard() {
    this.setData({ loading: true, errMsg: '' });
    try {
      const board = await api.getSpotBoard(this.data.spotId);
      const raw = (board && board.sessions) || [];
      const sessions = raw.map(decorate);
      this.setData({
        spot: (board && board.spot) || null,
        sessions,
        peopleCount: sessions.length,
        dogCount: sessions.reduce((n, s) => n + s.dogs.length, 0),
        wxGroupQrFileID: (board && board.wxGroupQrFileID) || '',
      });
      if (board && board.spot && board.spot.name) {
        wx.setNavigationBarTitle({ title: board.spot.name });
      }
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },

  goCheckin() {
    if (!this.data.spotId) return;
    wx.navigateTo({ url: '/pages/checkin/checkin?spotId=' + this.data.spotId });
  },

  previewQr() {
    const fileID = this.data.wxGroupQrFileID;
    if (!fileID) return;
    wx.previewImage({ urls: [fileID] });
  },
};

Page(options);
module.exports = options;
