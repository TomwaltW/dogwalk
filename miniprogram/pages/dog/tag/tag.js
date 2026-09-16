// miniprogram/pages/dog/tag/tag.js —— owner: T9
// 身份牌:小程序码 / 存相册 / 走失模式 / 寻回留言。扫这张码的落地页是 pages/dog/profile。
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败一律落 data.errMsg(spec 3.4)。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const config = require('../../../config');
const meta = require('../dog-meta');

const enums = meta.enums;
const L = enums.LIMITS;
/** 本轮只有这一个订阅模板(spec 3.2.1 TEMPLATE_KEYS) */
const FOUND_REPORT = enums.TEMPLATE_KEYS.FOUND_REPORT;

/** FoundReport(spec 3.2.3)-> 列表行 */
function toReportRow(r) {
  const row = r || {};
  // latitude 是 Number | null;Number(null) 是 0,会把「没坐标」当成赤道上一点,所以先看类型
  const hasLocation =
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude);
  return {
    reportId: row.reportId,
    message: row.message || '',
    timeText: meta.formatIsoMinute(row.createdAt),
    hasLocation,
    latitude: hasLocation ? row.latitude : null,
    longitude: hasLocation ? row.longitude : null,
  };
}

/** 相册授权被拒 —— 微信给的 errMsg 里会出现这几个词,只有这种情况才引导去设置 */
function isAuthDenied(raw) {
  const s = String(raw || '');
  return s.indexOf('auth deny') >= 0 || s.indexOf('auth denied') >= 0 || s.indexOf('authorize') >= 0;
}

const options = {
  data: {
    dogId: '',
    dogName: '',
    avatarFileID: '',
    tagCode: '',
    qrFileID: '',

    lostMode: false,
    lostNote: '',
    noteMax: L.LOST_NOTE_MAX,
    /** 订阅模板 id 填了没(config.js 里的占位符,总管填);没填就别弹订阅,弹了也收不到 */
    templateReady: false,

    reports: [],
    reportsLoading: false,

    loading: true,
    saving: false,
    savingNote: false,
    savingAlbum: false,
    /** 相册授权被拒过 —— 给个「去设置」入口 */
    needSetting: false,
    errMsg: '',

    emptyText: '还没有人留言',
    hint: '打印后挂在项圈上,路人扫码能看到档案并给你留言',
    lostHint: '已开启走失模式,路人扫牌会看到你的留言',
    noTemplateHint: '订阅消息模板还没配置,有人留言时收不到通知(留言仍会记在下面)',
  },

  /**
   * @param {{dogId?: string}} query
   */
  async onLoad(query) {
    const dogId = (query && query.dogId) || '';
    this.setData({ templateReady: !config.isPlaceholder(config.SUBSCRIBE_TEMPLATES[FOUND_REPORT]) });

    if (!dogId) {
      this.setData({ loading: false, errMsg: '没拿到是哪只狗,回上一页重进' });
      return;
    }
    this.setData({ dogId, loading: true, errMsg: '' });
    await this.refresh();
  },

  async onPullDownRefresh() {
    if (this.data.dogId) await this.refresh();
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  /** 拉狗 -> 缺码就补 -> 拉留言。三段各自兜错,一段挂掉不影响另外两段 */
  async refresh() {
    let dog = null;
    try {
      // api 里没有「按 id 取单只狗」,只有 listMyDogs;身份牌本来也只看自己的狗
      const dogs = await api.listMyDogs();
      dog = (Array.isArray(dogs) ? dogs : []).find((d) => d && d._id === this.data.dogId) || null;
    } catch (err) {
      this.setData({ loading: false, errMsg: meta.readableError(err, '身份牌没读出来,下拉重试') });
      return;
    }
    if (!dog) {
      this.setData({ loading: false, errMsg: '没找到这只狗,可能已经被删了' });
      return;
    }

    this.setData({
      dogName: dog.name || '',
      avatarFileID: dog.avatarFileID || '',
      tagCode: dog.tagCode || '',
      qrFileID: dog.qrFileID || '',
      lostMode: !!dog.lostMode,
      lostNote: dog.lostNote || '',
      loading: false,
      errMsg: '',
    });

    if (!dog.qrFileID) await this.ensureTag();
    await this.loadReports();
  },

  /** 还没生成过小程序码就补一张(genTagCode 幂等,已生成的会复用) */
  async ensureTag() {
    try {
      const res = await api.genTag(this.data.dogId);
      this.setData({
        tagCode: (res && res.tagCode) || '',
        qrFileID: (res && res.qrFileID) || '',
      });
    } catch (err) {
      // 补码失败只影响这一块,走失模式与留言列表照常显示
      this.setData({ errMsg: meta.readableError(err, '小程序码没生成出来,下拉重试') });
    }
  },

  async loadReports() {
    this.setData({ reportsLoading: true });
    try {
      const list = await api.listFoundReports(this.data.dogId);
      this.setData({
        reports: (Array.isArray(list) ? list : []).map(toReportRow),
        reportsLoading: false,
      });
    } catch (err) {
      this.setData({
        reports: [],
        reportsLoading: false,
        errMsg: meta.readableError(err, '寻回留言没拉到,下拉重试'),
      });
    }
  },

  onPreviewQr() {
    const url = this.data.qrFileID;
    if (!url) return;
    const w = host.wxOf(this);
    if (w) w.previewImage({ urls: [url], current: url });
  },

  /** 存相册:云存储的图得先下到本地临时路径,再交给 saveImageToPhotosAlbum */
  async onSaveAlbum() {
    if (this.data.savingAlbum) return;
    if (!this.data.qrFileID) {
      this.setData({ errMsg: '小程序码还没生成好,下拉重试' });
      return;
    }
    const w = host.wxOf(this);
    if (!w) return;

    this.setData({ savingAlbum: true, errMsg: '', needSetting: false });
    try {
      const filePath = await api.downloadFile(this.data.qrFileID);
      await host.promisify(w, 'saveImageToPhotosAlbum')({ filePath });
      this.setData({ savingAlbum: false, errMsg: '' });
      w.showToast({ title: '已存进相册', icon: 'success' });
    } catch (err) {
      if (isAuthDenied(err && (err.errMsg || err.message))) {
        this.setData({
          savingAlbum: false,
          needSetting: true,
          errMsg: '没有相册权限,去设置里打开「保存到相册」再试',
        });
        return;
      }
      this.setData({ savingAlbum: false, errMsg: meta.readableError(err, '没存成,再试一次') });
    }
  },

  onOpenSetting() {
    const w = host.wxOf(this);
    if (w) w.openSetting({});
  },

  /**
   * 走失模式开关。
   * 开:先请订阅(模板没配就跳过),用户同意就记一条额度;**不管用户接不接受**,
   *    接着都要把走失模式打开 —— 收不收得到通知是另一回事,牌子上的提示不能少(spec 2.2 B11)。
   * 关:只调一次 setLostMode,不带 note。
   */
  async onToggleLost(e) {
    if (this.data.saving) return;
    const on = !!(e && e.detail && e.detail.value);
    const before = this.data.lostMode;

    this.setData({ lostMode: on, saving: true, errMsg: '' });
    try {
      if (on) {
        await this.askSubscribe();
        const note = String(this.data.lostNote || '');
        this.applyDog(await api.setLostMode(this.data.dogId, true, note), true, note);
      } else {
        this.applyDog(await api.setLostMode(this.data.dogId, false), false, this.data.lostNote);
      }
      this.setData({ saving: false });
    } catch (err) {
      // 没改成就把开关拨回去,别让页面显示成已开
      this.setData({
        lostMode: before,
        saving: false,
        errMsg: meta.readableError(err, '走失模式没改成,再试一次'),
      });
    }
  },

  /** 请一次订阅授权。全程吞错:用户拒绝 / 叉掉 / 额度没记上,都不该拦住走失模式 */
  async askSubscribe() {
    const tmplId = config.SUBSCRIBE_TEMPLATES[FOUND_REPORT];
    if (config.isPlaceholder(tmplId)) return;
    const w = host.wxOf(this);
    if (!w) return;

    let res = null;
    try {
      res = await host.promisify(w, 'requestSubscribeMessage')({ tmplIds: [tmplId] });
    } catch (e) {
      return;
    }
    if (!res || res[tmplId] !== 'accept') return;

    try {
      await api.grantSubscribe(FOUND_REPORT, tmplId);
    } catch (e) {
      // 额度没记上顶多收不到这一条通知,不影响走失模式本身
    }
  },

  /** 用 api 返回的 Dog 刷新本页的走失两字段;返回值缺字段就用刚提交的值兜底 */
  applyDog(dog, on, note) {
    const d = dog || {};
    this.setData({
      lostMode: d.lostMode === undefined ? !!on : !!d.lostMode,
      lostNote: d.lostNote === undefined ? String(note || '') : d.lostNote || '',
    });
  },

  onNoteInput(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ lostNote: value, errMsg: '' });
  },

  /** 走失态下改留言 —— 还是走 setLostMode(dogId, true, 新 note) */
  async onSaveNote() {
    if (this.data.savingNote) return;
    const note = String(this.data.lostNote || '').trim();
    if (enums.charLength(note) > L.LOST_NOTE_MAX) {
      this.setData({ errMsg: '留言最多 ' + L.LOST_NOTE_MAX + ' 个字' });
      return;
    }

    this.setData({ savingNote: true, errMsg: '' });
    try {
      this.applyDog(await api.setLostMode(this.data.dogId, true, note), true, note);
      this.setData({ savingNote: false });
      const w = host.wxOf(this);
      if (w) w.showToast({ title: '已更新', icon: 'success' });
    } catch (err) {
      this.setData({ savingNote: false, errMsg: meta.readableError(err, '留言没存上,再试一次') });
    }
  },

  onOpenLocation(e) {
    const i = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const row = this.data.reports[i];
    if (!row || !row.hasLocation) return;
    const w = host.wxOf(this);
    if (!w) return;
    w.openLocation({
      latitude: row.latitude,
      longitude: row.longitude,
      scale: 17,
      name: '路人看到' + (this.data.dogName || '它') + '的位置',
    });
  },
};

Page(options);
module.exports = options;
