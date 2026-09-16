// miniprogram/components/privacy-popup/privacy-popup.js —— T0' 提供,各轨只读。
// 隐私保护指引弹层。app.js 的 wx.onNeedPrivacyAuthorization 回调里找到本组件调 open(resolve);
// 用户点「同意并继续」(open-type="agreePrivacyAuthorization")后 resolve({event:'agree', buttonId})。
// 每个页面 WXML 末尾都放一份:<privacy-popup id="privacy-popup" />

Component({
  data: {
    visible: false,
    contractName: '《隐私保护指引》',
  },

  methods: {
    /**
     * @param {(r:{event:'agree'|'reject', buttonId?:string}) => void} resolve 微信给的回调
     */
    open(resolve) {
      this._resolve = resolve;
      if (typeof wx.getPrivacySetting === 'function') {
        wx.getPrivacySetting({
          success: (r) => {
            if (r && r.privacyContractName) this.setData({ contractName: r.privacyContractName });
          },
        });
      }
      this.setData({ visible: true });
    },

    onAgree() {
      this.setData({ visible: false });
      const r = this._resolve;
      this._resolve = null;
      if (r) r({ event: 'agree', buttonId: 'privacy-agree-btn' });
    },

    onReject() {
      this.setData({ visible: false });
      const r = this._resolve;
      this._resolve = null;
      if (r) r({ event: 'reject' });
    },

    onOpenContract() {
      if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({});
    },

    // 蒙层上的滑动不穿透
    noop() {},
  },
});
