/**
 * 内存版云开发 db —— spec 3.3.5,T0 提供,T1-T5 只使用不修改。
 *
 * 支持:
 *   collection(n).where(q)/.orderBy(f,dir)/.limit(n)/.skip(n)/.get()/.count()
 *   collection(n).doc(id).get()/.update({data})/.set({data})/.remove()
 *   collection(n).add({data})   —— 未给 _id 时自动生成
 *   command: _.gt _.gte _.lt _.lte _.eq _.neq _.in _.nin _.and _.or _.inc
 *            (_.gt(1).and(_.lt(9)) 这种链式也支持)
 *
 * 不支持: 聚合 aggregate、地理查询、事务。需要这些 = 停下来报告(spec 7.3)。
 *
 * 行为对齐真实 wx-server-sdk 的几处关键点:
 *   - doc(id).get()    文档不存在时 reject,不是 resolve(null)
 *   - doc(id).update() 文档不存在时 resolve({stats:{updated:0}}),不 reject
 *   - doc(id).set()    upsert
 *   - 读出来的都是深拷贝,调用方改返回值不会污染库内数据
 */

let autoId = 0;

function genId() {
  autoId += 1;
  return 'fake_' + String(autoId).padStart(6, '0');
}

/** 深拷贝,保留 Date */
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}

// ---------------------------------------------------------------- command

const OP = Symbol('fake-db.op');

class Command {
  constructor(op, value) {
    this[OP] = op;
    this.value = value;
  }
  and(...rest) {
    return new Command('and', [this, ...flatten(rest)]);
  }
  or(...rest) {
    return new Command('or', [this, ...flatten(rest)]);
  }
}

function isCommand(v) {
  return v instanceof Command;
}

function flatten(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

const command = {
  eq: (v) => new Command('eq', v),
  neq: (v) => new Command('neq', v),
  gt: (v) => new Command('gt', v),
  gte: (v) => new Command('gte', v),
  lt: (v) => new Command('lt', v),
  lte: (v) => new Command('lte', v),
  in: (v) => new Command('in', v),
  nin: (v) => new Command('nin', v),
  and: (...a) => new Command('and', flatten(a)),
  or: (...a) => new Command('or', flatten(a)),
  inc: (v) => new Command('inc', v),
};

/** Date 参与比较时按毫秒 */
function cmpValue(v) {
  return v instanceof Date ? v.getTime() : v;
}

function looseEqual(a, b) {
  if (a instanceof Date || b instanceof Date) return cmpValue(a) === cmpValue(b);
  if (a === null || b === null) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/** 取 'a.b.c' 这种路径 */
function getPath(doc, path) {
  let cur = doc;
  for (const seg of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setPath(doc, path, value) {
  const segs = String(path).split('.');
  let cur = doc;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const s = segs[i];
    if (cur[s] === null || typeof cur[s] !== 'object') cur[s] = {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

/** 单个字段值是否满足条件(条件可能是 command,也可能是字面值) */
function matchCondition(fieldValue, cond) {
  if (isCommand(cond)) {
    const op = cond[OP];
    const a = cmpValue(fieldValue);
    const b = cmpValue(cond.value);
    switch (op) {
      case 'eq':
        return looseEqual(fieldValue, cond.value);
      case 'neq':
        return !looseEqual(fieldValue, cond.value);
      case 'gt':
        return fieldValue !== undefined && a > b;
      case 'gte':
        return fieldValue !== undefined && a >= b;
      case 'lt':
        return fieldValue !== undefined && a < b;
      case 'lte':
        return fieldValue !== undefined && a <= b;
      case 'in':
        return (cond.value || []).some((x) => looseEqual(fieldValue, x));
      case 'nin':
        return !(cond.value || []).some((x) => looseEqual(fieldValue, x));
      case 'and':
        return cond.value.every((c) => matchCondition(fieldValue, c));
      case 'or':
        return cond.value.some((c) => matchCondition(fieldValue, c));
      default:
        throw new Error('fake-db: 不支持的 command: ' + String(op));
    }
  }
  // 数组字段配字面值:命中任一元素即算(对齐云开发行为)
  if (Array.isArray(fieldValue) && !Array.isArray(cond)) {
    return fieldValue.some((x) => looseEqual(x, cond));
  }
  return looseEqual(fieldValue, cond);
}

/**
 * where 查询对象 → 是否命中。
 * 顶层的 _.and / _.or 视为整文档层面的逻辑组合;
 * { 'a.b': v } 与 { a: { b: v } } 等价。
 */
function matchQuery(doc, query) {
  if (!query) return true;
  if (isCommand(query)) {
    const op = query[OP];
    if (op === 'and') return query.value.every((q) => matchQuery(doc, q));
    if (op === 'or') return query.value.some((q) => matchQuery(doc, q));
    throw new Error('fake-db: where() 顶层只接受 _.and / _.or,收到: ' + String(op));
  }
  return Object.keys(query).every((key) => {
    const cond = query[key];
    // 嵌套普通对象 → 展开成点号路径;command 和 Date 不展开
    if (
      cond !== null &&
      typeof cond === 'object' &&
      !isCommand(cond) &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      return Object.keys(cond).every((sub) =>
        matchCondition(getPath(doc, key + '.' + sub), cond[sub])
      );
    }
    return matchCondition(getPath(doc, key), cond);
  });
}

/** update 的 data:支持点号路径和 _.inc */
function applyUpdate(doc, data) {
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (isCommand(v)) {
      if (v[OP] !== 'inc') {
        throw new Error('fake-db: update 的 data 里只支持 _.inc,收到: ' + String(v[OP]));
      }
      const old = getPath(doc, key);
      setPath(doc, key, (typeof old === 'number' ? old : 0) + v.value);
    } else {
      setPath(doc, key, clone(v));
    }
  }
}

// ------------------------------------------------------------- collection

class Query {
  constructor(store, name, state) {
    this._store = store;
    this._name = name;
    this._state = state || { query: null, orders: [], limit: null, skip: 0 };
  }

  _fork(patch) {
    return new Query(this._store, this._name, Object.assign({}, this._state, patch));
  }

  where(query) {
    return this._fork({ query });
  }

  orderBy(field, direction) {
    const dir = direction === 'desc' ? 'desc' : 'asc';
    return this._fork({ orders: this._state.orders.concat([{ field, dir }]) });
  }

  limit(n) {
    return this._fork({ limit: n });
  }

  skip(n) {
    return this._fork({ skip: n });
  }

  /** 应用 where + orderBy + skip + limit,返回库内文档的引用(内部用) */
  _resolve() {
    const rows = this._store[this._name] || [];
    let out = rows.filter((d) => matchQuery(d, this._state.query));
    for (let i = this._state.orders.length - 1; i >= 0; i -= 1) {
      const { field, dir } = this._state.orders[i];
      out = out.slice().sort((x, y) => {
        const a = cmpValue(getPath(x, field));
        const b = cmpValue(getPath(y, field));
        if (a === b) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return (a < b ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      });
    }
    if (this._state.skip) out = out.slice(this._state.skip);
    if (this._state.limit !== null && this._state.limit !== undefined) {
      out = out.slice(0, this._state.limit);
    }
    return out;
  }

  async get() {
    return { data: this._resolve().map(clone) };
  }

  async count() {
    const rows = this._store[this._name] || [];
    return { total: rows.filter((d) => matchQuery(d, this._state.query)).length };
  }

  /** 批量更新命中的文档(云开发里只有服务端 SDK 支持) */
  async update({ data }) {
    const hit = this._resolve();
    hit.forEach((d) => applyUpdate(d, data));
    return { stats: { updated: hit.length } };
  }

  /** 批量删除命中的文档 */
  async remove() {
    const hit = this._resolve();
    const rows = this._store[this._name] || [];
    hit.forEach((d) => {
      const i = rows.indexOf(d);
      if (i >= 0) rows.splice(i, 1);
    });
    return { stats: { removed: hit.length } };
  }
}

class Doc {
  constructor(store, name, id) {
    this._store = store;
    this._name = name;
    this._id = id;
  }

  _row() {
    return (this._store[this._name] || []).find((d) => d._id === this._id);
  }

  /** 不存在时 reject —— 对齐真实 SDK */
  async get() {
    const row = this._row();
    if (!row) {
      const e = new Error('document.get:fail document does not exist');
      e.errCode = -1;
      throw e;
    }
    return { data: clone(row) };
  }

  /** 不存在时 updated:0,不 reject —— 对齐真实 SDK */
  async update({ data }) {
    const row = this._row();
    if (!row) return { stats: { updated: 0 } };
    applyUpdate(row, data);
    return { stats: { updated: 1 } };
  }

  /** upsert */
  async set({ data }) {
    const row = this._row();
    if (row) {
      Object.keys(row).forEach((k) => {
        if (k !== '_id') delete row[k];
      });
      Object.assign(row, clone(data), { _id: this._id });
      return { stats: { updated: 1, created: 0 } };
    }
    if (!this._store[this._name]) this._store[this._name] = [];
    this._store[this._name].push(Object.assign({}, clone(data), { _id: this._id }));
    return { stats: { updated: 0, created: 1 } };
  }

  async remove() {
    const rows = this._store[this._name] || [];
    const i = rows.findIndex((d) => d._id === this._id);
    if (i < 0) return { stats: { removed: 0 } };
    rows.splice(i, 1);
    return { stats: { removed: 1 } };
  }
}

class Collection extends Query {
  constructor(store, name) {
    super(store, name, null);
  }

  doc(id) {
    return new Doc(this._store, this._name, id);
  }

  async add({ data }) {
    if (!this._store[this._name]) this._store[this._name] = [];
    const _id = data && data._id !== undefined ? data._id : genId();
    this._store[this._name].push(Object.assign({}, clone(data), { _id }));
    return { _id };
  }
}

// ------------------------------------------------------------------ 入口

/**
 * @param {Object<string, Array<object>>} [seed]  集合名 -> 初始文档数组
 * @returns {{db: object, _: object, dump: (coll:string)=>Array<object>}}
 */
function createFakeDb(seed) {
  const store = {};
  for (const name of Object.keys(seed || {})) {
    store[name] = (seed[name] || []).map((d, i) =>
      Object.assign({}, clone(d), { _id: d._id === undefined ? name + '_' + i : d._id })
    );
  }

  const db = {
    command,
    collection(name) {
      if (!store[name]) store[name] = [];
      return new Collection(store, name);
    },
    /** 云开发有 db.serverDate(),测试里退化成取当前时间 —— 需要可控时间请用 ctx.now */
    serverDate() {
      return new Date();
    },
  };

  /** 直接读某个集合的全部文档(深拷贝),断言用 */
  function dump(coll) {
    return (store[coll] || []).map(clone);
  }

  return { db, _: command, dump };
}

module.exports = { createFakeDb };
