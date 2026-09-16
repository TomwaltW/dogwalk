// miniprogram/pages/walk/list/list.js —— owner: T10
// 约遛列表(tab 页):按公园 / 日期筛,点进详情,右下角发起。
// 数据形状见 spec 3.2.3 WalkSummary;页面只认那几个字段,不碰库、不显示主人身份。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const { MEMBER_STATUS_LABEL, SIZE_LABEL, labelOf, labelsOfTags } = require('../../../logic/enums');
// 页面里不出现裸时钟(spec 3.3.4),「今天」只从这里取
const clock = require('../clock');
const fmt = require('../format');
const { errText } = require('../errors');

const ALL_PARKS = '全部公园';

/** WalkSummary.myStatus -> 列表行右上角那句「我的关系」;陌生人不显示 */
function relTextOf(myStatus) {
  if (myStatus === 'host') return '我发起的';
  if (!myStatus || myStatus === 'none') return '';
  return labelOf(MEMBER_STATUS_LABEL, myStatus);
}

/** DogCard -> 行内头像用的视图;字段只能少不能多(spec 3.2.3) */
function toDogView(d) {
  return {
    dogId: d.dogId,
    name: d.name,
    avatarFileID: d.avatarFileID || '',
    sizeText: labelOf(SIZE_LABEL, d.sizeClass),
    tagText: labelsOfTags(d.tags),
  };
}

/** WalkSummary -> 列表行。WXML 里算不了这些拼接,先在 js 里算好 */
function toRow(w) {
  return {
    walkId: w.walkId,
    parkName: w.parkName || '',
    note: w.note || '',
    dogCount: w.dogCount,
    maxDogs: w.maxDogs,
    status: w.status,
    cancelled: w.status === 'cancelled',
    hostDogs: (w.hostDogs || []).map(toDogView),
    timeText: fmt.mdHm(w.startAt),
    countText: w.dogCount + '/' + w.maxDogs,
    relText: relTextOf(w.myStatus),
  };
}

/** 空状态文案 —— 选了日期就把「这天」点出来,不然用户不知道是筛没了还是真没有 */
function emptyTextOf(date) {
  return date ? '这天还没有人约遛,发起一个吧' : '最近还没有人约遛,发起一个吧';
}

const options = {
  data: {
    /** @type {Array<{parkId:string,name:string}>} 筛选用,不放坐标 */
    parks: [],
    /** picker 的 range,首项固定是「全部公园」 */
    parkNames: [ALL_PARKS],
    /** picker 的 index;0 = 全部 */
    parkIndex: 0,
    /** '' = 不筛公园 */
    parkId: '',
    /** '' = 不筛日期,'YYYY-MM-DD' 东八区 */
    date: '',
    /** date picker 的最早可选日,来自 ./clock */
    minDate: '',
    /** @type {Array<object>} toRow 之后的行 */
    walks: [],
    loading: false,
    errMsg: '',
    emptyText: '',
  },

  async onLoad() {
    this.setData({ minDate: fmt.ymd(clock.nowIso()) });
    await this.loadParks();
  },

  // tab 页每次切回来都重拉:别人刚发起的约遛该看得见
  async onShow() {
    await this.loadWalks();
  },

  async onPullDownRefresh() {
    await this.loadWalks();
    const wx = host.wxOf(this);
    if (wx) wx.stopPullDownRefresh();
  },

  async loadParks() {
    try {
      const parks = await api.listParks();
      const list = Array.isArray(parks) ? parks : [];
      this.setData({
        parks: list.map((p) => ({ parkId: p.parkId, name: p.name })),
        parkNames: [ALL_PARKS].concat(list.map((p) => p.name)),
      });
    } catch (e) {
      // 公园拉不到不该挡住列表,退化成只有「全部公园」
      this.setData({ parks: [], parkNames: [ALL_PARKS], errMsg: errText(e) });
    }
  },

  async loadWalks() {
    // 没选的筛选项不传那个 key(spec 3.3.2 list 的 event)
    const filter = {};
    if (this.data.parkId) filter.parkId = this.data.parkId;
    if (this.data.date) filter.date = this.data.date;

    this.setData({ loading: true, errMsg: '' });
    try {
      const walks = await api.listWalks(filter);
      const list = Array.isArray(walks) ? walks : [];
      this.setData({
        walks: list.map(toRow),
        emptyText: list.length ? '' : emptyTextOf(this.data.date),
      });
    } catch (e) {
      this.setData({ walks: [], emptyText: '', errMsg: errText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onParkChange(e) {
    const index = Number((e && e.detail && e.detail.value) || 0);
    const park = index > 0 ? this.data.parks[index - 1] : null;
    this.setData({ parkIndex: index, parkId: park ? park.parkId : '' });
    await this.loadWalks();
  },

  async onDateChange(e) {
    this.setData({ date: (e && e.detail && e.detail.value) || '' });
    await this.loadWalks();
  },

  async onClearDate() {
    this.setData({ date: '' });
    await this.loadWalks();
  },

  onTapWalk(e) {
    const walkId = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!walkId) return;
    const wx = host.wxOf(this);
    if (wx) wx.navigateTo({ url: '/pages/walk/detail/detail?walkId=' + walkId });
  },

  onTapCreate() {
    const wx = host.wxOf(this);
    if (wx) wx.navigateTo({ url: '/pages/walk/create/create' });
  },
};

Page(options);
module.exports = options;
