// cloudfunctions/dogCRUD/core.js —— owner: T1
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { action: 'create'|'update'|'get'|'listMine'|'remove', dog?: Partial<Dog>, dogId?: String }
// data:  Dog | [Dog] | { removed: true }
// 他人的狗 → fail(FORBIDDEN);枚举非法 → fail(INVALID_PARAM, '<字段名>')

const { COLL, SIZE_CLASS, PLAY_STYLE, TEMPERAMENT } = require('../_shared/contracts');
const { CODES, fail, ok } = require('../_shared/errors');

const GENDER = ['male', 'female'];
const NAME_MAX = 12; // spec 3.2:name 1-12 字符
const BIRTH_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM'

/**
 * 客户端能写的字段。刻意排除:
 *   _id / ownerOpenid  —— 由服务端定,否则可以冒名建狗、改别人家的狗归属
 *   tagCode / qrFileID —— 狗牌由 genTagCode(T3)生成,tagCode 全局唯一,
 *                        放开写等于放开抢码
 *   createdAt / updatedAt —— 一律取 ctx.now()
 */
const WRITABLE = [
  'name',
  'breed',
  'sizeClass',
  'birthMonth',
  'gender',
  'neutered',
  'avatarFileID',
  'playStyle',
  'temperament',
  'okWithSmallDogs',
  'socialOk',
  'lostMode',
];

/** create 时这些字段没给就用默认值 */
const DEFAULTS = {
  breed: '',
  birthMonth: '',
  neutered: false,
  avatarFileID: '',
  playStyle: [],
  temperament: [],
  okWithSmallDogs: true,
  socialOk: true,
  lostMode: false,
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isSubsetOf(v, allowed) {
  return Array.isArray(v) && v.every((x) => allowed.indexOf(x) >= 0);
}

/**
 * 校验狗档案入参。
 *
 * 本该调 _shared/schema.js 的 validateDog,但它本轮是 NOT_IMPLEMENTED 且属 T0 只读,
 * 所以按同一套约定(通过返回 null,失败返回字段名)就地实现。
 * 规则与前端 miniprogram/logic/dog.js 一致 —— 前端那份只为省一次往返,
 * 这份才是真正的边界,两边都得有。
 *
 * @param {object} dog                  待校验的 dog(可为 Partial<Dog>)
 * @param {{partial?: boolean}} [opts]  partial=true 时缺失字段不算错(update 场景)
 * @returns {string|null} 出错字段名,通过则 null
 */
function validateDog(dog, opts) {
  if (!isPlainObject(dog)) return 'dog';
  const partial = !!(opts && opts.partial);
  const has = (k) => dog[k] !== undefined;

  // 必填三件套:没有合理默认值的字段。其余缺省由 DEFAULTS 补。
  if (has('name')) {
    if (typeof dog.name !== 'string') return 'name';
    const n = dog.name.trim().length;
    if (n < 1 || n > NAME_MAX) return 'name';
  } else if (!partial) {
    return 'name';
  }

  if (has('sizeClass')) {
    if (SIZE_CLASS.indexOf(dog.sizeClass) < 0) return 'sizeClass';
  } else if (!partial) {
    return 'sizeClass';
  }

  if (has('gender')) {
    if (GENDER.indexOf(dog.gender) < 0) return 'gender';
  } else if (!partial) {
    return 'gender';
  }

  if (has('birthMonth') && !(dog.birthMonth === '' || BIRTH_MONTH_RE.test(dog.birthMonth))) {
    return 'birthMonth';
  }
  if (has('breed') && typeof dog.breed !== 'string') return 'breed';
  if (has('avatarFileID') && typeof dog.avatarFileID !== 'string') return 'avatarFileID';
  if (has('playStyle') && !isSubsetOf(dog.playStyle, PLAY_STYLE)) return 'playStyle';
  if (has('temperament') && !isSubsetOf(dog.temperament, TEMPERAMENT)) return 'temperament';

  const bools = ['neutered', 'okWithSmallDogs', 'socialOk', 'lostMode'];
  for (const k of bools) {
    if (has(k) && typeof dog[k] !== 'boolean') return k;
  }

  return null;
}

/** 只挑 WRITABLE 里给了的字段 */
function pickWritable(dog) {
  const out = {};
  for (const k of WRITABLE) {
    if (dog[k] !== undefined) out[k] = k === 'name' ? dog[k].trim() : dog[k];
  }
  return out;
}

/**
 * 按 _id 取狗。doc(id).get() 在文档不存在时 reject,这里走 where 避免 try/catch 混进业务分支。
 *
 * @returns {Promise<object|undefined>}
 */
async function findDog(ctx, dogId) {
  const r = await ctx.db.collection(COLL.DOGS).where({ _id: dogId }).get();
  return r.data[0];
}

/**
 * update / get / remove 共用的前置:取 dogId、查存在、比归属。
 *
 * @returns {Promise<{err: object}|{dog: object}>} err 是可直接返回的 fail(...)
 */
async function loadOwnDog(event, ctx) {
  const dogId = event.dogId || (isPlainObject(event.dog) ? event.dog._id : undefined);
  if (!dogId || typeof dogId !== 'string') return { err: fail(CODES.INVALID_PARAM, 'dogId') };

  const dog = await findDog(ctx, dogId);
  if (!dog) return { err: fail(CODES.NOT_FOUND, COLL.DOGS) };
  // 归属先于字段校验:别人的狗不该从报错里看出自己填对没有(spec 3.4)
  if (dog.ownerOpenid !== ctx.openid) return { err: fail(CODES.FORBIDDEN) };

  return { dog };
}

async function actionCreate(event, ctx) {
  const bad = validateDog(event.dog);
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  const now = ctx.now();
  const doc = Object.assign({}, DEFAULTS, pickWritable(event.dog), {
    ownerOpenid: ctx.openid,
    tagCode: '',
    qrFileID: '',
    createdAt: now,
    updatedAt: now,
  });

  const added = await ctx.db.collection(COLL.DOGS).add({ data: doc });
  return ok(Object.assign({ _id: added._id }, doc));
}

async function actionUpdate(event, ctx) {
  const loaded = await loadOwnDog(event, ctx);
  if (loaded.err) return loaded.err;

  const bad = validateDog(event.dog, { partial: true });
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  const patch = pickWritable(event.dog);
  patch.updatedAt = ctx.now();
  await ctx.db.collection(COLL.DOGS).doc(loaded.dog._id).update({ data: patch });

  return ok(Object.assign(loaded.dog, patch));
}

async function actionGet(event, ctx) {
  const loaded = await loadOwnDog(event, ctx);
  return loaded.err ? loaded.err : ok(loaded.dog);
}

async function actionListMine(event, ctx) {
  const r = await ctx.db
    .collection(COLL.DOGS)
    .where({ ownerOpenid: ctx.openid })
    .orderBy('createdAt', 'asc')
    .get();
  return ok(r.data);
}

async function actionRemove(event, ctx) {
  const loaded = await loadOwnDog(event, ctx);
  if (loaded.err) return loaded.err;

  await ctx.db.collection(COLL.DOGS).doc(loaded.dog._id).remove();
  return ok({ removed: true });
}

const ACTIONS = {
  create: actionCreate,
  update: actionUpdate,
  get: actionGet,
  listMine: actionListMine,
  remove: actionRemove,
};

/**
 * @param {object} event                云函数入参
 * @param {object} ctx
 * @param {object} ctx.db               云开发 db 实例(测试时为 fake-db)
 * @param {object} ctx._                db.command
 * @param {string} ctx.openid           调用者 openid,游客为 ''
 * @param {() => Date} ctx.now          取当前时间,禁止直接 new Date()
 * @param {object} ctx.openapi          cloud.openapi,测试时为 mock
 * @param {{info:Function,error:Function}} ctx.logger
 * @returns {Promise<{ok:true,data:any}|{ok:false,code:string,msg:string}>}
 */
module.exports = async function core(event, ctx) {
  const e = event || {};

  if (!ctx.openid) return fail(CODES.AUTH_REQUIRED);

  const run = Object.prototype.hasOwnProperty.call(ACTIONS, e.action) ? ACTIONS[e.action] : null;
  if (!run) return fail(CODES.INVALID_PARAM, 'action');

  try {
    return await run(e, ctx);
  } catch (err) {
    // core 永远不把异常抛给调用方(spec 3.1)
    if (ctx.logger && ctx.logger.error) ctx.logger.error('dogCRUD ' + e.action + ' failed', err);
    return fail(CODES.INTERNAL, err.message);
  }
};
