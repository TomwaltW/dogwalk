/**
 * 取宿主对象(wx / getApp)—— spec 3.3.4,T0' 提供,所有页面共用。
 *
 * 为什么不直接写 `wx.showToast(...)`:
 * 测试脚手架 loadPage(tests/fakes/mini-runtime.js)只在 **require 期间** 把 wx / getApp
 * 注入 global,require 一结束就还原。页面方法是在那之后才被调用的,那时全局里已经
 * 没有 wx 了,直接引用会 ReferenceError。loadPage 把本次注入的那份挂成了页面上的
 * `__wx` / `__app`,所以退回去取它。
 *
 * 不能改成在模块顶层 `const wx_ = wx` 捕获:jest 下模块只求值一次,第二次 loadPage
 * 拿到的是新的 wx,而模块里捕获的还是第一次那份 —— 断言会串台。必须每次调用时现取。
 *
 * 真机上走的永远是第一条分支,行为与直接写 wx.xxx 完全一致。
 */

/**
 * @param {object} page 页面 options(调用处传 this)
 * @returns {object|null} 宿主 wx;两边都取不到时 null,调用处自己跳过
 */
function wxOf(page) {
  if (typeof wx !== 'undefined' && wx) return wx;
  return (page && page.__wx) || null;
}

/**
 * @param {object} page 页面 options(调用处传 this)
 * @returns {object|null} App 实例(app.js 里 module.exports 的那个 options)
 */
function appOf(page) {
  if (typeof getApp === 'function') {
    const app = getApp();
    if (app) return app;
  }
  return (page && page.__app) || null;
}

/** app.globalData 的只读快照,取不到就给个空壳,省得调用处层层判空 */
function globalDataOf(page) {
  const app = appOf(page);
  return (app && app.globalData) || {};
}

/**
 * 把 wx 的回调风格 API 包成 Promise:promisify(w, 'getLocation')({ type: 'gcj02' })。
 * 失败 reject 的是 wx 给的 err 对象(带 errMsg)。
 * @param {object} w    wxOf(this)
 * @param {string} name wx 上的方法名
 * @returns {(opts?:object) => Promise<object>}
 */
function promisify(w, name) {
  return (opts) =>
    new Promise((resolve, reject) => {
      if (!w || typeof w[name] !== 'function') {
        reject(new Error('wx.' + name + ' 不可用'));
        return;
      }
      w[name](Object.assign({}, opts || {}, { success: resolve, fail: reject }));
    });
}

module.exports = { wxOf, appOf, globalDataOf, promisify };
