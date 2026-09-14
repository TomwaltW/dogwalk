/**
 * 前端 api 封装 —— spec 3.3.3,冻结契约。
 *
 * 全部返回 Promise:成功直接 resolve data(即云函数 { ok:true, data } 里的 data);
 * 失败 reject 一个 ApiError(code, msg)。
 *
 * 页面禁止直接调 wx.cloud.callFunction,一律走这里。
 * 测试时 jest.mock('../../api/index')。
 */

class ApiError extends Error {
  constructor(code, msg) {
    super(msg);
    this.name = 'ApiError';
    this.code = code;
  }
}

// 兜底错误码。这里刻意不 require cloudfunctions/_shared/errors ——
// 小程序只打包 miniprogram/ 根内的文件,跨根 require 在真机上 resolve 不到。
// 取值与 _shared/errors.js 的 CODES.INTERNAL 一致,变更需同步两边。
const INTERNAL = 'INTERNAL';

/**
 * wx.cloud.callFunction 的薄封装:把统一返回形状拆成 resolve(data) / reject(ApiError)。
 *
 * @param {string} name   云函数名
 * @param {object} [data] event 入参
 * @returns {Promise<*>}
 */
function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success(res) {
        const r = res && res.result;
        // 云函数永远返回 { ok } 形状;拿不到就是运行时挂了
        if (!r || typeof r.ok !== 'boolean') {
          reject(new ApiError(INTERNAL, 'bad response shape from ' + name));
          return;
        }
        if (r.ok) {
          resolve(r.data);
        } else {
          reject(new ApiError(r.code || INTERNAL, r.msg || r.code || INTERNAL));
        }
      },
      fail(err) {
        // 网络 / 云函数不存在 / 超时,都归成 INTERNAL
        reject(new ApiError(INTERNAL, (err && err.errMsg) || ('callFunction ' + name + ' failed')));
      },
    });
  });
}

/** @returns {Promise<{user:object, dogs:object[]}>} */
function login(profile) {
  return call('login', profile ? { profile } : {});
}

/** @returns {Promise<object[]>} SpotSummary[] */
function listSpots() {
  return call('spotBoard', {});
}

/** @returns {Promise<{spot:object, sessions:object[], wxGroupQrFileID:string}>} */
function getSpotBoard(spotId) {
  return call('spotBoard', { spotId });
}

/** @param {{spotId:string, dogIds:string[], startAt:string, note?:string}} payload
 *  @returns {Promise<{checkinId:string, expireAt:string, notified:number}>} */
function createCheckin(payload) {
  return call('checkin', payload);
}

/** @returns {Promise<{cancelled:boolean}>} */
function cancelCheckin(checkinId) {
  return call('checkinCancel', { checkinId });
}

/** @returns {Promise<object[]>} Dog[] */
function listMyDogs() {
  return call('dogCRUD', { action: 'listMine' });
}

/** 有 _id 走 update,无 _id 走 create。 @returns {Promise<object>} Dog */
function saveDog(dog) {
  const action = dog && dog._id ? 'update' : 'create';
  return call('dogCRUD', { action, dog });
}

/** @returns {Promise<{removed:boolean}>} */
function removeDog(dogId) {
  return call('dogCRUD', { action: 'remove', dogId });
}

/** 游客可调。 @returns {Promise<object>} DogPublic */
function getDogPublic(tagCode) {
  return call('scanTag', { tagCode });
}

/** @returns {Promise<{tagCode:string, qrFileID:string}>} */
function genTag(dogId) {
  return call('genTagCode', { dogId });
}

module.exports = {
  ApiError,
  login,
  listSpots,
  getSpotBoard,
  createCheckin,
  cancelCheckin,
  listMyDogs,
  saveDog,
  removeDog,
  getDogPublic,
  genTag,
};
