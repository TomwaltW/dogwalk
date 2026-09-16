// miniprogram/pages/dog/edit/edit.js —— owner: T5
// 页面模块约定见 spec 3.3.4:Page(options) 之后 module.exports = options。
// 页面只调 api 层(spec 3.3.3),不碰云函数;失败一律落到 data.errMsg(spec 3.4)。

const api = require('../../../api/index');
const meta = require('../dog-meta');
const host = require('../page-host');

/** 空档案 —— 字段与默认值照 spec 3.2 的 dogs 形状 */
function emptyDog() {
  return {
    name: '',
    breed: '',
    sizeClass: 'medium',
    birthMonth: '',
    gender: 'male',
    neutered: false,
    avatarFileID: '',
    playStyle: [],
    temperament: [],
    okWithSmallDogs: true,
    socialOk: true,
    tagCode: '',
    qrFileID: '',
    lostMode: false,
  };
}

/** 把 api 返回的 Dog 合进表单形状,多余字段(createdAt 等)不进 data */
function toForm(dog) {
  const form = Object.assign(emptyDog(), dog || {});
  form.playStyle = Array.isArray(form.playStyle) ? form.playStyle.slice() : [];
  form.temperament = Array.isArray(form.temperament) ? form.temperament.slice() : [];
  return form;
}

/** 提交给 api.saveDog 的载荷:只带用户能改的字段;_id 决定 create 还是 update */
function toPayload(form) {
  const out = {
    name: String(form.name || '').trim(),
    breed: String(form.breed || '').trim(),
    sizeClass: form.sizeClass,
    birthMonth: String(form.birthMonth || '').trim(),
    gender: form.gender,
    neutered: !!form.neutered,
    avatarFileID: form.avatarFileID || '',
    playStyle: form.playStyle.slice(),
    temperament: form.temperament.slice(),
    okWithSmallDogs: !!form.okWithSmallDogs,
    socialOk: !!form.socialOk,
  };
  if (form._id) out._id = form._id;
  return out;
}

/**
 * 本地校验 —— 拦在调 api 之前,省一次往返,也让用户立刻看见哪儿不对。
 * 规则来自 spec 3.2;云函数那边还会再校一次(spec 3.4 INVALID_PARAM),这里不是唯一防线。
 * @param {object} form
 * @returns {string} 出错原因;'' 表示通过
 */
function validate(form) {
  const name = String(form.name || '').trim();
  const len = meta.charLength(name);
  if (len === 0) return '狗的名字不能为空';
  if (len > meta.NAME_MAX) return '狗的名字最多 ' + meta.NAME_MAX + ' 个字符,现在是 ' + len + ' 个';

  if (meta.SIZE_CLASS.indexOf(form.sizeClass) < 0) return 'sizeClass 只能是小型/中型/大型犬';
  if (meta.GENDER.indexOf(form.gender) < 0) return 'gender 只能是公或母';

  const birthMonth = String(form.birthMonth || '').trim();
  if (birthMonth !== '' && !meta.BIRTH_MONTH_RE.test(birthMonth)) {
    return 'birthMonth 要写成 YYYY-MM,例如 2023-05';
  }

  if (!meta.isSubset(form.playStyle, meta.PLAY_STYLE)) return 'playStyle 有不认识的取值';
  if (!meta.isSubset(form.temperament, meta.TEMPERAMENT)) return 'temperament 有不认识的取值';

  return '';
}

/**
 * 选中态摊成 { chase: true } 这样的映射 —— wxml 表达式里调不了 indexOf,
 * 只能取属性,所以选中与否得在 js 侧先算好。
 */
function checkedMap(values) {
  const out = {};
  (Array.isArray(values) ? values : []).forEach((v) => {
    out[v] = true;
  });
  return out;
}

/** wxml 直接用的派生值:枚举翻中文 + 多选的选中映射 */
function viewOf(form) {
  return {
    sizeClassText: meta.labelOf('sizeClass', form.sizeClass),
    genderText: meta.labelOf('gender', form.gender),
    playStyleChecked: checkedMap(form.playStyle),
    temperamentChecked: checkedMap(form.temperament),
    nameLen: meta.charLength(String(form.name || '').trim()),
  };
}

/** ApiError 的人话(spec 3.3.3:reject 的是带 code 的 Error) */
function readableError(err, fallback) {
  if (!err) return fallback;
  const byCode = {
    AUTH_REQUIRED: '请先登录',
    FORBIDDEN: '这不是你的狗',
    NOT_FOUND: '这只狗不在了',
    INVALID_PARAM: '有字段填得不对:' + (err.message || ''),
  };
  return byCode[err.code] || err.message || fallback;
}

const options = {
  data: {
    dog: emptyDog(),
    view: viewOf(emptyDog()),
    isNew: true,
    loading: false,
    saving: false,
    errMsg: '',
    // 给 wxml 的选项表
    sizeClassOptions: meta.optionsOf('sizeClass', meta.SIZE_CLASS),
    genderOptions: meta.optionsOf('gender', meta.GENDER),
    playStyleOptions: meta.optionsOf('playStyle', meta.PLAY_STYLE),
    temperamentOptions: meta.optionsOf('temperament', meta.TEMPERAMENT),
    nameMax: meta.NAME_MAX,
  },

  /**
   * @param {{dogId?: string}} query 带 dogId = 编辑,不带 = 新建
   */
  async onLoad(query) {
    const dogId = (query && query.dogId) || '';
    if (!dogId) {
      const blank = emptyDog();
      this.setData({ dog: blank, view: viewOf(blank), isNew: true, loading: false, errMsg: '' });
      return;
    }

    this.setData({ isNew: false, loading: true, errMsg: '' });
    try {
      // api 的十个方法里没有「按 id 取单只狗」,只有 listMyDogs;
      // 编辑页本来就只能编自己的狗,从自己的列表里挑即可(spec 3.3.3)。
      const dogs = await api.listMyDogs();
      const found = (Array.isArray(dogs) ? dogs : []).find((d) => d && d._id === dogId);
      if (!found) {
        this.setData({ loading: false, errMsg: '没找到这只狗,可能已经被删了' });
        return;
      }
      const form = toForm(found);
      this.setData({ dog: form, view: viewOf(form), loading: false, errMsg: '' });
    } catch (err) {
      this.setData({ loading: false, errMsg: readableError(err, '档案加载失败,下拉重试') });
    }
  },

  /** 单值字段:input / picker / switch 都走这一个,字段名放 data-field */
  onFieldInput(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset.field;
    if (!field) return;
    const detail = e.detail || {};
    const value = detail.value !== undefined ? detail.value : detail;
    const next = Object.assign({}, this.data.dog, { [field]: value });
    this.setData({ ['dog.' + field]: value, view: viewOf(next), errMsg: '' });
  },

  /** picker 回来的是下标,按 data-options 的字段名换成枚举值 */
  onPickerChange(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const list = this.data[ds.options] || [];
    const picked = list[Number(e.detail.value)];
    if (!ds.field || !picked) return;
    const next = Object.assign({}, this.data.dog, { [ds.field]: picked.value });
    this.setData({ ['dog.' + ds.field]: picked.value, view: viewOf(next), errMsg: '' });
  },

  /** 多值字段(playStyle / temperament):点一下进,再点一下出 */
  onToggleMulti(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const field = ds.field;
    const value = ds.value;
    if (!field || !value) return;

    const cur = Array.isArray(this.data.dog[field]) ? this.data.dog[field].slice() : [];
    const at = cur.indexOf(value);
    if (at >= 0) cur.splice(at, 1);
    else cur.push(value);

    const next = Object.assign({}, this.data.dog, { [field]: cur });
    this.setData({ ['dog.' + field]: cur, view: viewOf(next), errMsg: '' });
  },

  async onSave() {
    if (this.data.saving) return;

    const bad = validate(this.data.dog);
    if (bad) {
      // 本地就拦下,不往 api 发(spec 6 节 T5)
      this.setData({ errMsg: bad });
      return;
    }

    this.setData({ saving: true, errMsg: '' });
    try {
      const saved = toForm(await api.saveDog(toPayload(this.data.dog)));
      this.setData({ dog: saved, view: viewOf(saved), isNew: false, saving: false, errMsg: '' });
      const w = host.wxOf(this);
      if (w) w.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      this.setData({ saving: false, errMsg: readableError(err, '保存失败,请重试') });
    }
  },

  async onRemove() {
    const dogId = this.data.dog._id;
    const w = host.wxOf(this);
    if (!dogId) {
      // 还没存过的狗没什么可删的,直接退回去
      if (w) w.navigateBack({ delta: 1 });
      return;
    }

    this.setData({ errMsg: '' });
    try {
      await api.removeDog(dogId);
      if (w) {
        w.showToast({ title: '已删除', icon: 'success' });
        w.navigateBack({ delta: 1 });
      }
    } catch (err) {
      this.setData({ errMsg: readableError(err, '删除失败,请重试') });
    }
  },

  /** 生成狗牌小程序码 —— 狗得先存下来才有 _id */
  async onGenTag() {
    const dogId = this.data.dog._id;
    if (!dogId) {
      this.setData({ errMsg: '先保存档案,再生成狗牌' });
      return;
    }

    this.setData({ errMsg: '' });
    try {
      const res = await api.genTag(dogId);
      this.setData({
        'dog.tagCode': (res && res.tagCode) || '',
        'dog.qrFileID': (res && res.qrFileID) || '',
        errMsg: '',
      });
    } catch (err) {
      this.setData({ errMsg: readableError(err, '狗牌生成失败,请重试') });
    }
  },

  /** 点狗牌图看大图 */
  onPreviewTag() {
    const url = this.data.dog.qrFileID;
    if (!url) return;
    const w = host.wxOf(this);
    if (w) w.previewImage({ urls: [url], current: url });
  },
};

Page(options);
module.exports = options;
