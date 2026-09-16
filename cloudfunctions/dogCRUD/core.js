// cloudfunctions/dogCRUD/core.js —— owner: T6
// _shared 一律走 '../_shared/xxx';部署时由 scripts/deploy-shared.js 重写为 './_shared/xxx'。
// 注意该脚本只重写 core.js,所以 _shared 的 require 只能出现在本文件里,不要拆文件。
//
// spec 3.3.2
// event: { action: 'create'|'update'|'get'|'listMine'|'remove', dog?: Partial<Dog>, dogId?: String }
// data:  Dog | [Dog] | { removed: true }
//
// 校验顺序(spec 3.3.2):归属 → 字段合法(INVALID_PARAM) → 内容安全(CONTENT_RISKY)。
// 任何一项不过都不写库。归属排在最前是刻意的:别人的狗不该从报错里看出自己填对没有。

const { COLL, SIZE_CLASS, GENDER, TAGS, LIMITS } = require('../_shared/contracts');
const { CODES, fail, ok } = require('../_shared/errors');

const BIRTH_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM'

/**
 * 客户端能写的 12 个字段(spec 3.3.2)。刻意排除:
 *   _id / ownerOpenid      —— 由服务端定,否则可以冒名建狗、改别人家的狗归属
 *   tagCode / qrFileID     —— 狗牌由 genTagCode 生成,tagCode 全局唯一,放开写等于放开抢码
 *   createdAt / updatedAt  —— 一律取 ctx.now()
 */
const WRITABLE = [
  'name',
  'breed',
  'gender',
  'birthMonth',
  'sizeClass',
  'neutered',
  'vaccinated',
  'licenseNo',
  'tags',
  'avatarFileID',
  'lostMode',
  'lostNote',
];

/** create 时这些字段没给就用默认值 */
const DEFAULTS = {
  breed: '',
  birthMonth: '',
  neutered: false,
  vaccinated: false,
  licenseNo: '',
  tags: [],
  avatarFileID: '',
  lostMode: false,
  lostNote: '',
};

/** 要过文本内容安全的字段(spec 3.3.2),顺序即送审顺序 */
const TEXT_FIELDS = ['name', 'breed', 'licenseNo', 'lostNote'];

/** 各文本字段的长度上限,按码位数比 */
const TEXT_MAX = {
  breed: LIMITS.BREED_MAX,
  licenseNo: LIMITS.LICENSE_MAX,
  lostNote: LIMITS.LOST_NOTE_MAX,
};

const BOOL_FIELDS = ['neutered', 'vaccinated', 'lostMode'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 字符数按码位算 —— 'a'.length 和 '🐶'.length 不一样,中文名和 emoji 名
 * 都得按人眼看到的字数来数,否则「12 字符」这条线会错位。
 *
 * @param {string} s
 * @returns {number}
 */
function charLength(s) {
  return Array.from(String(s)).length;
}

/** 数组且每项都在 allowed 里 */
function isSubsetOf(v, allowed) {
  return Array.isArray(v) && v.every((x) => allowed.indexOf(x) >= 0);
}

/**
 * 校验狗档案入参。通过返回 null,失败返回字段名。
 * 规则与前端 miniprogram/pages/dog/dog-meta.js 一致 —— 前端那份只为省一次往返,
 * 这份才是真正的边界,两边都得有。改了这里记得同步改那边。
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
    const n = charLength(dog.name.trim());
    if (n < 1 || n > LIMITS.NAME_MAX) return 'name';
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
  for (const k of Object.keys(TEXT_MAX)) {
    if (has(k) && (typeof dog[k] !== 'string' || charLength(dog[k]) > TEXT_MAX[k])) return k;
  }
  if (has('avatarFileID') && typeof dog.avatarFileID !== 'string') return 'avatarFileID';
  if (has('tags') && !isSubsetOf(dog.tags, TAGS)) return 'tags';
  for (const k of BOOL_FIELDS) {
    if (has(k) && typeof dog[k] !== 'boolean') return k;
  }

  return null;
}

/** 只挑 WRITABLE 里给了的字段;name 去空格,tags 去重 */
function pickWritable(dog) {
  const out = {};
  for (const k of WRITABLE) {
    if (dog[k] === undefined) continue;
    if (k === 'name') out[k] = dog[k].trim();
    else if (k === 'tags') out[k] = dog[k].filter((t, i) => dog[k].indexOf(t) === i);
    else out[k] = dog[k];
  }
  return out;
}

/**
 * 内容安全:只查这次给了的字段(spec 3.3.2)。
 * 头像只在「给了、非空、且与库里现有的不同」时才送审 —— 没换图就没必要重复花额度。
 *
 * @param {object} patch        pickWritable 之后的字段
 * @param {object|null} oldDog  库里现有的狗,create 时为 null
 * @param {object} ctx
 * @returns {Promise<string|null>} 不安全的字段名,全过则 null
 */
async function checkContent(patch, oldDog, ctx) {
  for (const k of TEXT_FIELDS) {
    if (patch[k] === undefined) continue;
    if (!(await ctx.security.checkText(patch[k]))) return k;
  }
  const avatar = patch.avatarFileID;
  const oldAvatar = oldDog && typeof oldDog.avatarFileID === 'string' ? oldDog.avatarFileID : '';
  if (avatar && avatar !== oldAvatar && !(await ctx.security.checkImage(avatar))) {
    return 'avatarFileID';
  }
  return null;
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
  if (dog.ownerOpenid !== ctx.openid) return { err: fail(CODES.FORBIDDEN) };

  return { dog };
}

async function actionCreate(event, ctx) {
  const bad = validateDog(event.dog);
  if (bad) return fail(CODES.INVALID_PARAM, bad);

  const patch = pickWritable(event.dog);
  const risky = await checkContent(patch, null, ctx);
  if (risky) return fail(CODES.CONTENT_RISKY, risky);

  const now = ctx.now();
  const doc = Object.assign({}, DEFAULTS, patch, {
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
  const risky = await checkContent(patch, loaded.dog, ctx);
  if (risky) return fail(CODES.CONTENT_RISKY, risky);

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
 * @param {object} ctx                  见 spec 3.3.1
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
