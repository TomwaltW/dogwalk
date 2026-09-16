// miniprogram/app.js —— T0' 提供,各轨只读。
// 做三件事:初始化云开发、注册隐私授权回调、放一份登录态给页面读。

const config = require('./config');

const options = {
  globalData: {
    // login 云函数返回的 user,由各页面按需刷新
    user: null,
    // 是否已经跑过 login,页面据此决定是否要先登录
    logged: false,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库版本过低,请使用 2.2.3 及以上');
      return;
    }
    // config.js 没填环境 ID 就用账号下的默认环境;客户端没有 DYNAMIC_CURRENT_ENV 这个说法
    const init = { traceUser: true };
    if (!config.isPlaceholder(config.ENV_ID)) init.env = config.ENV_ID;
    wx.cloud.init(init);

    this.bindPrivacy();
  },

  /**
   * 隐私保护指引(app.json 里 __usePrivacyCheck__: true)。
   * 页面调 wx.getLocation / chooseMedia / saveImageToPhotosAlbum 时,微信会先回调这里;
   * 我们找当前页面上的 <privacy-popup id="privacy-popup" /> 弹出来,用户点「同意」那个
   * open-type="agreePrivacyAuthorization" 的按钮后 resolve。页面自己不用管。
   */
  bindPrivacy() {
    if (typeof wx.onNeedPrivacyAuthorization !== 'function') return;
    wx.onNeedPrivacyAuthorization((resolve) => {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const page = pages[pages.length - 1];
      const popup = page && typeof page.selectComponent === 'function'
        ? page.selectComponent('#privacy-popup')
        : null;
      if (popup && typeof popup.open === 'function') {
        popup.open(resolve);
      } else {
        // 页面忘了放组件 —— 不能替用户点同意,只能拒绝,并把问题喊出来
        console.error('app: 当前页面没有 <privacy-popup id="privacy-popup" />,隐私授权被拒绝');
        resolve({ event: 'reject' });
      }
    });
  },
};

App(options);
module.exports = options;
