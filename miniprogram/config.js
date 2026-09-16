/**
 * 需要你亲手填的配置,全部集中在这一个文件。
 * 占位符一律以 `<<` 开头,页面里用 isPlaceholder() 判断有没有填。
 *
 * 另外两处是微信强制放在别的位置的,README「配置」一节有说明:
 *   - 小程序 AppID:project.config.json 的 "appid"
 *   - 云函数运行时:不需要配置,自动用当前环境(DYNAMIC_CURRENT_ENV)
 */

module.exports = {
  /** 云开发环境 ID(云开发控制台 → 设置 → 环境 ID)。不填则用账号下的默认环境 */
  ENV_ID: '<<填云开发环境ID>>',

  /**
   * 订阅消息模板 ID(小程序后台 → 订阅消息 → 我的模板)。
   * key 必须与 logic/enums.js 的 TEMPLATE_KEYS 一致;用户授权时前端把 id 一起带给 subscribeGrant,
   * 服务端发消息时从用户文档里读,所以只需要在这里填一次。
   */
  SUBSCRIBE_TEMPLATES: {
    foundReport: '<<填「寻回留言」订阅消息模板ID>>',
  },

  /** 首页地图默认中心(公园列表还没拉到时用),先放杭州 */
  DEFAULT_MAP_CENTER: { latitude: 30.2741, longitude: 120.1551 },
  DEFAULT_MAP_SCALE: 13,

  /** @returns {boolean} 这个配置项还没填 */
  isPlaceholder(v) {
    return typeof v !== 'string' || v === '' || v.indexOf('<<') === 0;
  },
};
