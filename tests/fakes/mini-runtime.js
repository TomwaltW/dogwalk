/**
 * 小程序页面模块的加载器 —— spec 3.3.5,T0 提供,T1-T5 只使用不修改。
 *
 * 页面按 spec 3.3.4 写成:
 *   const options = { data: {...}, async onLoad(query){...} };
 *   Page(options);
 *   module.exports = options;
 *
 * loadPage() 在 require 之前把 Page/Component/App/getApp/wx 注入 global,
 * require 完立刻还原,不污染其他测试。返回的 options 上挂了可用的 setData,
 * 调用后 options.data 会被真实更新,所以断言直接读 options.data。
 */

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INJECTED = ['Page', 'Component', 'App', 'getApp', 'getCurrentPages', 'wx'];

/** 深拷贝,保留 Date */
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}

/** 把 'a.b[0].c' 拆成 ['a','b',0,'c'] */
function parsePath(key) {
  const out = [];
  String(key)
    .split('.')
    .forEach((seg) => {
      const m = seg.match(/^([^[\]]*)((\[\d+\])*)$/);
      if (!m) {
        out.push(seg);
        return;
      }
      if (m[1] !== '') out.push(m[1]);
      const idx = m[2] ? m[2].match(/\d+/g) : null;
      if (idx) idx.forEach((n) => out.push(Number(n)));
    });
  return out;
}

function setByPath(root, key, value) {
  const segs = parsePath(key);
  let cur = root;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const s = segs[i];
    if (cur[s] === null || typeof cur[s] !== 'object') {
      cur[s] = typeof segs[i + 1] === 'number' ? [] : {};
    }
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

/** 页面里常用的 wx API —— 默认全是能 resolve 的 noop,调用记录挂在 wx.__calls 上 */
function defaultWx() {
  const calls = [];
  const record = (name) => (opts) => {
    calls.push({ name, opts });
    if (opts && typeof opts.success === 'function') opts.success({});
    if (opts && typeof opts.complete === 'function') opts.complete({});
    return Promise.resolve({});
  };
  return {
    __calls: calls,
    cloud: {
      init: record('cloud.init'),
      callFunction: record('cloud.callFunction'),
    },
    showToast: record('showToast'),
    hideToast: record('hideToast'),
    showLoading: record('showLoading'),
    hideLoading: record('hideLoading'),
    showModal: record('showModal'),
    navigateTo: record('navigateTo'),
    redirectTo: record('redirectTo'),
    switchTab: record('switchTab'),
    navigateBack: record('navigateBack'),
    reLaunch: record('reLaunch'),
    setNavigationBarTitle: record('setNavigationBarTitle'),
    stopPullDownRefresh: record('stopPullDownRefresh'),
    previewImage: record('previewImage'),
    chooseMedia: record('chooseMedia'),
    setStorageSync: () => {},
    getStorageSync: () => '',
    removeStorageSync: () => {},
    requestSubscribeMessage: record('requestSubscribeMessage'),
  };
}

/**
 * @param {string} modulePath  相对仓库根的路径,如 'miniprogram/pages/index/index.js'
 * @param {object} [stubs]     { wx?: object, app?: object }
 * @returns {object} 页面 options 对象(已注入 setData,data 会被真实更新)
 */
function loadPage(modulePath, stubs) {
  const opts = stubs || {};
  const abs = path.isAbsolute(modulePath) ? modulePath : path.join(REPO_ROOT, modulePath);

  // 保存现场
  const saved = {};
  INJECTED.forEach((k) => {
    saved[k] = { had: Object.prototype.hasOwnProperty.call(global, k), value: global[k] };
  });

  let captured = null;
  const app = opts.app || {};

  global.Page = (o) => {
    captured = o;
    return o;
  };
  global.Component = (o) => {
    captured = o;
    return o;
  };
  global.App = (o) => o;
  global.getApp = () => app;
  global.getCurrentPages = () => [];
  const injectedWx = Object.assign(defaultWx(), opts.wx || {});
  global.wx = injectedWx;

  let mod;
  try {
    delete require.cache[require.resolve(abs)];
    mod = require(abs);
  } finally {
    // 还原现场
    INJECTED.forEach((k) => {
      if (saved[k].had) global[k] = saved[k].value;
      else delete global[k];
    });
  }

  // 优先用 module.exports(spec 3.3.4),没有就用 Page() 捕获到的
  const source = mod && typeof mod === 'object' && Object.keys(mod).length ? mod : captured;
  if (!source) {
    throw new Error(
      'mini-runtime: ' + modulePath + ' 既没 module.exports 也没调用 Page(),不符合 spec 3.3.4'
    );
  }

  // 每次 loadPage 都返回独立副本:方法按引用带过来(调用时 this 指向本副本),
  // data 深拷贝。不能指望 delete require.cache —— jest 有自己的模块系统,
  // 那句在 jest 下不生效,两次 loadPage 会拿到同一个 options,测试互相串台。
  const page = Object.assign({}, source);
  page.data = clone(source.data || {});

  // 本次注入的 wx / app 挂出来,方便断言「页面调了 wx.showToast」这类副作用
  page.__wx = injectedWx;
  page.__app = app;

  const setDataCalls = [];
  page.setData = function setData(patch, cb) {
    setDataCalls.push(patch);
    Object.keys(patch || {}).forEach((k) => setByPath(page.data, k, patch[k]));
    if (typeof cb === 'function') cb();
  };
  page.__setDataCalls = setDataCalls;

  return page;
}

module.exports = { loadPage };
