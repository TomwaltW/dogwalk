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
    wx.cloud.init({ env: wx.cloud.DYNAMIC_CURRENT_ENV, traceUser: true });
  },
};

App(options);
module.exports = options;
