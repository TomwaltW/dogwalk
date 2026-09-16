// miniprogram/pages/dog/profile/profile.js —— owner: T9
// 扫身份牌的落地页(寻回页)。spec 2.2 B10:**游客态**必须能看、能留言,不许跳登录。
// 按第 9 节假设 12:这一页不给任何主人联系方式,路人只能留言;主人靠订阅消息 + 身份牌页看到。
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败一律落 data.errMsg(spec 3.4)。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const meta = require('../dog-meta');

const enums = meta.enums;
const L = enums.LIMITS;

/**
 * tagCode 有两条来路:
 *   1. 扫小程序码 —— 在 query.scene 里,且被 URL 编码过
 *   2. 站内 navigateTo —— 直接是 query.tagCode
 * @param {object} query
 * @returns {string} 取不到就是空串
 */
function resolveTagCode(query) {
  const q = query || {};
  if (q.tagCode) return String(q.tagCode).trim();
  if (q.scene) {
    try {
      return decodeURIComponent(String(q.scene)).trim();
    } catch (e) {
      // scene 不是合法编码就按原样用,总比白屏强
      return String(q.scene).trim();
    }
  }
  return '';
}

/**
 * 只留 DogPublic 的 9 个字段(spec 3.2.3)。
 * 云函数那边已经按契约裁过一遍,这里再裁一次:主人字段一个都不该落进页面 data,
 * 哪怕以后后端不小心多返回了什么(B10 ④ 就是钉这条)。
 */
function toPublic(dog) {
  const src = dog || {};
  const lostMode = !!src.lostMode;
  return {
    name: src.name || '',
    breed: src.breed || '',
    sizeClass: src.sizeClass || '',
    gender: src.gender || '',
    birthMonth: src.birthMonth || '',
    avatarFileID: src.avatarFileID || '',
    tags: Array.isArray(src.tags) ? src.tags.slice() : [],
    lostMode,
    lostNote: lostMode ? src.lostNote || '' : '',
  };
}

/** 给 wxml 的展示串 */
function viewOf(dog) {
  return {
    sizeText: meta.sizeText(dog.sizeClass),
    genderText: meta.genderText(dog.gender),
    tagsText: meta.tagsText(dog.tags),
  };
}

/** 读档案 / 提交留言时 ApiError 的人话。AUTH_REQUIRED 也只是提示,不跳登录(B10) */
const ERR_TEXT = {
  NOT_FOUND: '这个身份牌查不到档案,确认一下牌子上的码',
  INVALID_PARAM: '身份牌号看起来不对',
  AUTH_REQUIRED: '暂时读不到这只狗的档案',
};

const options = {
  data: {
    tagCode: '',
    /** DogPublic(spec 3.2.3),拿不到时为 null */
    dog: null,
    view: null,
    /** 走失态的醒目横幅 */
    showLostBanner: false,

    // 留言表单 —— 游客也能用
    message: '',
    messageMax: L.FOUND_MSG_MAX,
    attachLocation: false,
    sent: false,
    sentText: '',

    loading: true,
    submitting: false,
    errMsg: '',

    lostTitle: '我走丢了,看到我请给主人留言',
    formHint: '留言会直接发给主人。附上位置能让他更快找过来,不想给也可以不勾',
  },

  async onLoad(query) {
    const tagCode = resolveTagCode(query);
    if (!tagCode) {
      this.setData({ loading: false, errMsg: '没读到身份牌号,请重新扫一次牌子' });
      return;
    }
    this.setData({ tagCode, loading: true, errMsg: '' });
    await this.fetch(tagCode);
  },

  /** 拉一次公开档案。无论成败都不跳转 —— 游客必须能停在这一页(B10) */
  async fetch(tagCode) {
    try {
      const dog = toPublic(await api.getDogPublic(tagCode));
      this.setData({
        dog,
        view: viewOf(dog),
        showLostBanner: !!dog.lostMode,
        loading: false,
        errMsg: '',
      });
    } catch (err) {
      this.setData({
        dog: null,
        view: null,
        showLostBanner: false,
        loading: false,
        errMsg: meta.readableError(err, '档案没读出来,下拉重试', ERR_TEXT),
      });
    }
  },

  async onPullDownRefresh() {
    if (this.data.tagCode) await this.fetch(this.data.tagCode);
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  onPreviewAvatar() {
    const url = this.data.dog && this.data.dog.avatarFileID;
    if (!url) return;
    const w = host.wxOf(this);
    if (w) w.previewImage({ urls: [url], current: url });
  },

  onMessageInput(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ message: value, errMsg: '' });
  },

  onToggleLocation(e) {
    const on = !!(e && e.detail && e.detail.value);
    this.setData({ attachLocation: on, errMsg: '' });
  },

  /**
   * 取一次定位。拿不到就返回 null —— 调用处据此降级成「不带位置」,
   * 不让定位失败挡住留言本身(spec 3.4 最后一行是签到页的口径,寻回这边位置是选填)。
   */
  async pickLocation() {
    const w = host.wxOf(this);
    if (!w) return null;
    try {
      const res = await host.promisify(w, 'getLocation')({ type: 'gcj02' });
      const lat = res && res.latitude;
      const lng = res && res.longitude;
      if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const message = String(this.data.message || '').trim();
    if (!message) {
      this.setData({ errMsg: '写一句话告诉主人你在哪儿看到它' });
      return;
    }
    if (enums.charLength(message) > L.FOUND_MSG_MAX) {
      this.setData({ errMsg: '留言最多 ' + L.FOUND_MSG_MAX + ' 个字' });
      return;
    }
    if (!this.data.tagCode) {
      this.setData({ errMsg: '没读到身份牌号,请重新扫一次牌子' });
      return;
    }

    this.setData({ submitting: true, errMsg: '' });

    const payload = { tagCode: this.data.tagCode, message };
    if (this.data.attachLocation) {
      const loc = await this.pickLocation();
      if (!loc) {
        // 取消勾选 + 提示,留言原样留在框里;再点一次「发送」就不带位置发出去
        this.setData({
          attachLocation: false,
          submitting: false,
          errMsg: '没拿到你的位置(可以去设置里打开定位);再点一次「发送」就不带位置提交',
        });
        return;
      }
      payload.latitude = loc.latitude;
      payload.longitude = loc.longitude;
    }

    try {
      const res = await api.reportFound(payload);
      this.setData({
        sent: true,
        submitting: false,
        message: '',
        errMsg: '',
        sentText: res && res.notified ? '已通知主人' : '已留言,主人打开小程序就能看到',
      });
    } catch (err) {
      this.setData({
        submitting: false,
        errMsg: meta.readableError(err, '留言没发出去,再试一次', ERR_TEXT),
      });
    }
  },

  /** 再留一条(比如先报了位置,又想补一句) */
  onAgain() {
    this.setData({ sent: false, sentText: '', message: '', errMsg: '' });
  },

  /** 转发出去还是这一页,带上同一个身份牌号 */
  onShareAppMessage() {
    const name = (this.data.dog && this.data.dog.name) || '这只狗';
    return {
      title: this.data.showLostBanner ? '帮忙找找 ' + name : name + ' 的档案',
      path: '/pages/dog/profile/profile?tagCode=' + this.data.tagCode,
    };
  },
};

Page(options);
module.exports = options;
