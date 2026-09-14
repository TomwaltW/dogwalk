// miniprogram/pages/dog/profile/profile.js —— owner: T5
// 扫狗牌二维码的落地页。spec 2.2 B7:**游客态**也必须能看,不许跳登录。
// 页面模块约定见 spec 3.3.4;只调 api 层(spec 3.3.3);失败落 data.errMsg(spec 3.4)。

const api = require('../../../api/index');
const meta = require('../dog-meta');
const host = require('../page-host');

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

/** ApiError 的人话。注意 AUTH_REQUIRED 也只是提示,不跳登录(B7) */
function readableError(err, fallback) {
  if (!err) return fallback;
  const byCode = {
    NOT_FOUND: '这个狗牌查不到档案,确认一下牌子上的码',
    INVALID_PARAM: '狗牌号看起来不对',
    AUTH_REQUIRED: '暂时读不到这只狗的档案',
  };
  return byCode[err.code] || err.message || fallback;
}

/** 给 wxml 用的展示串,顺手把枚举翻成中文 */
function toView(dog) {
  return {
    sizeClassText: meta.labelOf('sizeClass', dog.sizeClass),
    genderText: meta.labelOf('gender', dog.gender),
    playStyleText: meta.labelsOf('playStyle', dog.playStyle),
    temperamentText: meta.labelsOf('temperament', dog.temperament),
    neuteredText: dog.neutered ? '已绝育' : '未绝育',
    okWithSmallDogsText: dog.okWithSmallDogs ? '和小型犬相处良好' : '和小型犬需要留意',
  };
}

const options = {
  data: {
    tagCode: '',
    /** DogPublic(spec 3.2),拿不到时为 null */
    dog: null,
    view: null,
    /** 未登录 —— 只影响页面上要不要显示「登录后可以…」这类提示,不影响能否看档案 */
    isGuest: true,
    /** 只有走失模式下 ownerContact 才非 null(spec 3.2),据此决定要不要给联系入口 */
    canContact: false,
    loading: true,
    errMsg: '',
  },

  async onLoad(query) {
    const tagCode = resolveTagCode(query);

    // 登录态只用来决定文案,读档案本身不需要登录(scanTag 允许游客,spec 3.4)
    const logged = !!host.globalDataOf(this).logged;
    this.setData({ isGuest: !logged });

    if (!tagCode) {
      this.setData({ loading: false, errMsg: '没读到狗牌号,请重新扫一次牌子' });
      return;
    }

    this.setData({ tagCode, loading: true, errMsg: '' });
    await this.fetch(tagCode);
  },

  /** 拉一次公开档案。无论成败都不跳转 —— 游客必须能停在这一页(B7) */
  async fetch(tagCode) {
    try {
      const dog = await api.getDogPublic(tagCode);
      const safe = dog || {};
      this.setData({
        dog: safe,
        view: toView(safe),
        // ownerContact 只在 lostMode 时非 null,两个条件都要,不靠单边字段
        canContact: !!(safe.lostMode && safe.ownerContact),
        loading: false,
        errMsg: '',
      });
    } catch (err) {
      this.setData({
        dog: null,
        view: null,
        canContact: false,
        loading: false,
        errMsg: readableError(err, '档案没读出来,下拉重试'),
      });
    }
  },

  /** 走失模式下把主人联系方式亮出来。用弹窗,方便长按复制 */
  onContactOwner() {
    if (!this.data.canContact) {
      this.setData({ errMsg: '这只狗没有开走失模式,看不到主人联系方式' });
      return;
    }
    const w = host.wxOf(this);
    if (!w) return;
    w.showModal({
      title: '联系主人',
      content: this.data.dog.ownerContact,
      confirmText: '知道了',
      showCancel: false,
    });
  },

  onPreviewAvatar() {
    const url = this.data.dog && this.data.dog.avatarFileID;
    if (!url) return;
    const w = host.wxOf(this);
    if (w) w.previewImage({ urls: [url], current: url });
  },

  async onPullDownRefresh() {
    if (this.data.tagCode) await this.fetch(this.data.tagCode);
    const w = host.wxOf(this);
    if (w) w.stopPullDownRefresh();
  },

  /** 转发出去还是这一页,带上同一个狗牌号 */
  onShareAppMessage() {
    const name = (this.data.dog && this.data.dog.name) || '这只狗';
    return {
      title: this.data.dog && this.data.dog.lostMode ? '帮忙找找 ' + name : name + ' 的档案',
      path: '/pages/dog/profile/profile?tagCode=' + this.data.tagCode,
    };
  },
};

Page(options);
module.exports = options;
