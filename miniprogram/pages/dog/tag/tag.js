// miniprogram/pages/dog/tag/tag.js —— owner: T9。此刻是 T0' 的占位骨架,真实现见 docs/dispatch/T9.md。
// 页面模块约定见 spec 3.3.4:Page(options) 之后 module.exports = options;wx 通过 host.wxOf(this) 取。
const api = require('../../../api/index');
const host = require('../../../logic/host');

const options = {
  data: {
    errMsg: '',
    loading: false,
  },

  onLoad() {},
};

Page(options);
module.exports = options;
// 占位期间引用一下,免得 lint 报未使用;真实现时删掉这两行
void api;
void host;
