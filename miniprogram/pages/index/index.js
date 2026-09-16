// miniprogram/pages/index/index.js —— owner: T8
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败落 data.errMsg 不抛(spec 3.4)。

const api = require('../../api/index');
const host = require('../../logic/host');
const config = require('../../config');

/** marker 图标放在本页目录里 —— <map> 的 marker 漏了 iconPath 真机不显示 */
const MARKER_ICON = '/pages/index/marker.png';

function readableError(err, fallback) {
  if (!err) return fallback;
  const byCode = {
    AUTH_REQUIRED: '请先到「我的」里登录',
    INTERNAL: fallback,
  };
  return byCode[err.code] || err.message || fallback;
}

/**
 * ParkSummary[] -> <map> 的 markers。
 * id 必须是数字,onMarkerTap 靠它回查 parks 的下标(spec 3.2.3 的 parkId 是字符串)。
 * @param {object[]} parks
 * @returns {object[]}
 */
function toMarkers(parks) {
  return parks.map((p, i) => ({
    id: i,
    parkId: p.parkId,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.name,
    iconPath: MARKER_ICON,
    width: 28,
    height: 28,
    callout: {
      content: p.name + ' · ' + (p.activeDogCount || 0) + ' 只狗',
      display: 'ALWAYS',
      padding: 8,
      borderRadius: 8,
      fontSize: 12,
    },
  }));
}

/** 只留列表要显示的几个字段,后端多给什么都不往 data 里带(spec 1「不展示主人」) */
function toRow(p) {
  return {
    parkId: p.parkId,
    name: p.name,
    activeDogCount: p.activeDogCount || 0,
  };
}

const options = {
  data: {
    parks: [],
    markers: [],
    // 公园还没拉到时先落在默认中心(config.js),别让地图停在非洲外海
    center: {
      latitude: config.DEFAULT_MAP_CENTER.latitude,
      longitude: config.DEFAULT_MAP_CENTER.longitude,
    },
    scale: config.DEFAULT_MAP_SCALE,
    loading: false,
    errMsg: '',
    // 空库只自动 seed 一次,免得 initParks 一直失败时每次刷新都白调
    seeded: false,
  },

  async onLoad() {
    await this.loadParks();
  },

  /** tab 页:从公园页退回来要立刻看到新的在场数 */
  async onShow() {
    await this.loadParks();
  },

  async onPullDownRefresh() {
    await this.loadParks();
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  async loadParks() {
    this.setData({ loading: true });
    try {
      let parks = await this.fetchParks();

      // 云库还是空的(第一次装上小程序)—— 自己灌一次示例公园再拉
      if (!parks.length && !this.data.seeded) {
        this.setData({ seeded: true });
        await api.initParks();
        parks = await this.fetchParks();
      }

      const patch = {
        parks: parks.map(toRow),
        markers: toMarkers(parks),
        loading: false,
        errMsg: '',
      };
      if (parks.length) {
        patch.center = { latitude: parks[0].latitude, longitude: parks[0].longitude };
      }
      this.setData(patch);
    } catch (err) {
      // 拉不到就留在上一次的列表 + 提示,不白屏也不抛(spec 3.4)
      this.setData({ loading: false, errMsg: readableError(err, '公园没拉到,下拉重试') });
    }
  },

  /** @returns {Promise<object[]>} ParkSummary[],后端给什么怪东西都收敛成数组 */
  async fetchParks() {
    const parks = await api.listParks();
    return Array.isArray(parks) ? parks : [];
  },

  /** e.detail.markerId 就是 toMarkers 里给的数字下标 */
  onMarkerTap(e) {
    const markerId = e && e.detail && e.detail.markerId;
    const park = this.data.parks[Number(markerId)];
    if (!park) return;
    this.goPark(park.parkId);
  },

  /** 模拟器里 <map> 不一定渲染,下面那列公园卡片是兜底入口 */
  onTapPark(e) {
    const parkId = e && e.currentTarget && e.currentTarget.dataset.parkId;
    if (!parkId) return;
    this.goPark(parkId);
  },

  goPark(parkId) {
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/park/park?parkId=' + parkId });
  },
};

Page(options);
module.exports = options;
