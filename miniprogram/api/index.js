/**
 * 前端 api 封装 —— spec(docs/dev-spec-2026-09-16.md)3.3.3,冻结契约。
 *
 * 全部返回 Promise:成功直接 resolve data(即云函数 { ok:true, data } 里的 data);
 * 失败 reject 一个 ApiError(code, msg)。
 *
 * 页面禁止直接调 wx.cloud.*,一律走这里。
 * 测试时 jest.mock('../../miniprogram/api/index')。
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

// ------------------------------------------------------------ 档案 / 身份牌 / 寻回

/** @returns {Promise<{user:object, dogs:object[]}>} */
function login(profile) {
  return call('login', profile ? { profile } : {});
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

/** @returns {Promise<{tagCode:string, qrFileID:string}>} */
function genTag(dogId) {
  return call('genTagCode', { dogId });
}

/** 游客可调。 @returns {Promise<object>} DogPublic */
function getDogPublic(tagCode) {
  return call('scanTag', { tagCode });
}

/**
 * 开 / 关走失模式。内部就是 dogCRUD update,单独一个方法是为了页面语义清楚。
 * @param {string} dogId
 * @param {boolean} on
 * @param {string} [note] 走失模式下给路人看的留言,关闭时可不传
 * @returns {Promise<object>} Dog
 */
function setLostMode(dogId, on, note) {
  const dog = { _id: dogId, lostMode: !!on };
  if (note !== undefined) dog.lostNote = note;
  return call('dogCRUD', { action: 'update', dog });
}

/**
 * 路人扫牌留言,游客可调。
 * @param {{tagCode:string, message:string, latitude?:number, longitude?:number}} payload
 * @returns {Promise<{reportId:string, notified:boolean}>}
 */
function reportFound(payload) {
  return call('reportFound', payload);
}

/** @returns {Promise<object[]>} FoundReport[] */
function listFoundReports(dogId) {
  return call('foundReports', { dogId });
}

/** 用户在 wx.requestSubscribeMessage 里同意一次就调一次。 @returns {Promise<{remaining:number}>} */
function grantSubscribe(templateKey, templateId) {
  return call('subscribeGrant', { templateKey, templateId });
}

// ------------------------------------------------------------ 公园 / 签到

/** 幂等,parks 非空时不插。 @returns {Promise<{inserted:number, total:number}>} */
function initParks() {
  return call('initParks', {});
}

/** @returns {Promise<object[]>} ParkSummary[] */
function listParks() {
  return call('parkBoard', {});
}

/** @returns {Promise<object>} ParkBoard */
function getParkBoard(parkId) {
  return call('parkBoard', { parkId });
}

/**
 * @param {{parkId:string, dogIds:string[], latitude:number, longitude:number}} payload
 * @returns {Promise<{checkinId:string, expireAt:string}>}
 */
function checkin(payload) {
  return call('checkin', payload);
}

/** @returns {Promise<{cancelled:boolean}>} */
function cancelCheckin(checkinId) {
  return call('checkinCancel', { checkinId });
}

// ------------------------------------------------------------ 约遛

/**
 * @param {{parkId:string, startAt:string, dogIds:string[], note?:string, maxDogs?:number}} payload
 * @returns {Promise<object>} WalkSummary
 */
function createWalk(payload) {
  return call('walkOps', Object.assign({ action: 'create' }, payload));
}

/**
 * @param {{parkId?:string, date?:string, mine?:boolean}} [filter]
 * @returns {Promise<object[]>} WalkSummary[]
 */
function listWalks(filter) {
  return call('walkOps', Object.assign({ action: 'list' }, filter || {}));
}

/** @returns {Promise<object>} WalkDetail */
function getWalk(walkId) {
  return call('walkOps', { action: 'get', walkId });
}

/** @returns {Promise<{memberId:string, status:string}>} */
function joinWalk(walkId, dogIds) {
  return call('walkOps', { action: 'join', walkId, dogIds });
}

/** 只有发起人能调。 @returns {Promise<{memberId:string, status:string}>} */
function decideJoin(memberId, approve) {
  return call('walkOps', { action: 'decide', memberId, approve: !!approve });
}

/** @returns {Promise<{left:boolean}>} */
function leaveWalk(walkId) {
  return call('walkOps', { action: 'leave', walkId });
}

/** 只有发起人能调。 @returns {Promise<{cancelled:boolean}>} */
function cancelWalk(walkId) {
  return call('walkOps', { action: 'cancel', walkId });
}

/** @returns {Promise<{messageId:string}>} */
function postMessage(walkId, text) {
  return call('walkOps', { action: 'message', walkId, text });
}

// ------------------------------------------------------------ 云存储

/**
 * 上传本地文件到云存储。
 * @param {string} cloudPath 云端路径,如 'dogs/<openid>/<ts>.jpg'
 * @param {string} filePath  wx.chooseMedia 拿到的临时路径
 * @returns {Promise<string>} fileID
 */
function uploadFile(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(res) {
        if (res && res.fileID) resolve(res.fileID);
        else reject(new ApiError(INTERNAL, 'uploadFile: no fileID'));
      },
      fail(err) {
        reject(new ApiError(INTERNAL, (err && err.errMsg) || 'uploadFile failed'));
      },
    });
  });
}

/**
 * 把云存储文件下到本地临时路径(保存到相册前要先下下来)。
 * @param {string} fileID
 * @returns {Promise<string>} tempFilePath
 */
function downloadFile(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success(res) {
        if (res && res.tempFilePath) resolve(res.tempFilePath);
        else reject(new ApiError(INTERNAL, 'downloadFile: no tempFilePath'));
      },
      fail(err) {
        reject(new ApiError(INTERNAL, (err && err.errMsg) || 'downloadFile failed'));
      },
    });
  });
}

module.exports = {
  ApiError,
  login,
  listMyDogs,
  saveDog,
  removeDog,
  genTag,
  getDogPublic,
  setLostMode,
  reportFound,
  listFoundReports,
  grantSubscribe,
  initParks,
  listParks,
  getParkBoard,
  checkin,
  cancelCheckin,
  createWalk,
  listWalks,
  getWalk,
  joinWalk,
  decideJoin,
  leaveWalk,
  cancelWalk,
  postMessage,
  uploadFile,
  downloadFile,
};
