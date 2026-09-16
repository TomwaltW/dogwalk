// miniprogram/pages/dog/edit/edit.js —— owner: T9
// 狗档案编辑(v2 字段)。页面模块约定见 spec 3.3.4:Page(options) 之后 module.exports = options;
// 只调 api 层(spec 3.3.3),失败一律落 data.errMsg(spec 3.4),不抛、不白屏。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const meta = require('../dog-meta');
const clock = require('../clock');

const enums = meta.enums;
const L = enums.LIMITS;

/** 客户端可写的 12 个字段 —— spec 3.3.2 dogCRUD 那一行,顺序照抄 */
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

/** 空档案 —— 默认值照 spec 3.2.2 的 dogs 形状 */
function emptyDog() {
  return {
    name: '',
    breed: '',
    gender: 'male',
    birthMonth: '',
    sizeClass: 'medium',
    neutered: false,
    vaccinated: false,
    licenseNo: '',
    tags: [],
    avatarFileID: '',
    lostMode: false,
    lostNote: '',
  };
}

/** 把 api 返回的 Dog 合进表单形状;createdAt / tagCode 这些不归本页管的字段不进 data */
function toForm(dog) {
  const src = dog || {};
  const form = emptyDog();
  WRITABLE.forEach((k) => {
    if (src[k] !== undefined && src[k] !== null) form[k] = src[k];
  });
  form.tags = Array.isArray(form.tags) ? form.tags.slice() : [];
  form.neutered = !!form.neutered;
  form.vaccinated = !!form.vaccinated;
  form.lostMode = !!form.lostMode;
  if (src._id) form._id = src._id;
  return form;
}

/** 提交给 api.saveDog 的载荷:只带那 12 个;_id 决定 create 还是 update */
function toPayload(form) {
  const out = {};
  WRITABLE.forEach((k) => {
    out[k] = form[k];
  });
  out.name = String(out.name || '').trim();
  out.breed = String(out.breed || '').trim();
  out.birthMonth = String(out.birthMonth || '').trim();
  out.licenseNo = String(out.licenseNo || '').trim();
  out.lostNote = String(out.lostNote || '');
  out.tags = Array.isArray(out.tags) ? out.tags.slice() : [];
  out.neutered = !!out.neutered;
  out.vaccinated = !!out.vaccinated;
  out.lostMode = !!out.lostMode;
  out.avatarFileID = out.avatarFileID || '';
  if (form._id) out._id = form._id;
  return out;
}

/** wxml 直接用的派生值:枚举翻中文 + 多选的选中映射 + 几个计数 */
function viewOf(form) {
  return {
    sizeText: meta.sizeText(form.sizeClass),
    genderText: meta.genderText(form.gender),
    tagChecked: meta.checkedMap(form.tags),
    nameLen: enums.charLength(String(form.name || '').trim()),
    breedLen: enums.charLength(String(form.breed || '').trim()),
    licenseLen: enums.charLength(String(form.licenseNo || '').trim()),
  };
}

/**
 * 头像的云存储路径。同一只狗换头像不能互相覆盖,所以带上时间戳;
 * 时间来自 ../clock.js —— 页面里不许出现裸的当前时间调用(spec 3.3.4)。
 */
function cloudPathOf(dogId, tempFilePath) {
  const m = String(tempFilePath).match(/\.[a-zA-Z0-9]+$/);
  const ext = m ? m[0].toLowerCase() : '.jpg';
  return 'dogs/' + (dogId || 'new') + '-' + clock.nowMs() + ext;
}

const options = {
  data: {
    dog: emptyDog(),
    view: viewOf(emptyDog()),
    isNew: true,
    loading: false,
    saving: false,
    uploading: false,
    errMsg: '',
    // 给 wxml 的选项表与长度上限
    sizeOptions: enums.optionsOf(enums.SIZE_CLASS, enums.SIZE_LABEL),
    genderOptions: enums.optionsOf(enums.GENDER, enums.GENDER_LABEL),
    tagOptions: enums.optionsOf(enums.TAGS, enums.TAG_LABEL),
    limits: { name: L.NAME_MAX, breed: L.BREED_MAX, license: L.LICENSE_MAX },
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
      // api 里没有「按 id 取单只狗」,只有 listMyDogs;编辑页本来也只能编自己的狗(spec 3.3.3)
      const dogs = await api.listMyDogs();
      const found = (Array.isArray(dogs) ? dogs : []).find((d) => d && d._id === dogId);
      if (!found) {
        this.setData({ loading: false, errMsg: '没找到这只狗,可能已经被删了' });
        return;
      }
      const form = toForm(found);
      this.setData({ dog: form, view: viewOf(form), loading: false, errMsg: '' });
    } catch (err) {
      this.setData({ loading: false, errMsg: meta.readableError(err, '档案加载失败,退出去再进一次') });
    }
  },

  /** 单值字段:input / switch 都走这一个,字段名放 data-field */
  onFieldInput(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset.field;
    if (!field) return;
    const detail = e.detail || {};
    const value = detail.value !== undefined ? detail.value : detail;
    const next = Object.assign({}, this.data.dog, { [field]: value });
    this.setData({ ['dog.' + field]: value, view: viewOf(next), errMsg: '' });
  },

  /** picker 回来的是下标,按 data-options 指的那张表换成枚举值 */
  onPickerChange(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const list = this.data[ds.options] || [];
    const picked = list[Number(e.detail.value)];
    if (!ds.field || !picked) return;
    const next = Object.assign({}, this.data.dog, { [ds.field]: picked.value });
    this.setData({ ['dog.' + ds.field]: picked.value, view: viewOf(next), errMsg: '' });
  },

  /** 性格标签:点一下进,再点一下出 */
  onToggleTag(e) {
    const value = e && e.currentTarget && e.currentTarget.dataset.value;
    if (!value) return;

    const cur = Array.isArray(this.data.dog.tags) ? this.data.dog.tags.slice() : [];
    const at = cur.indexOf(value);
    if (at >= 0) cur.splice(at, 1);
    else cur.push(value);

    const next = Object.assign({}, this.data.dog, { tags: cur });
    this.setData({ 'dog.tags': cur, view: viewOf(next), errMsg: '' });
  },

  /** 选一张照片传上去。sizeType 压缩过 —— 服务端的图片安全检查限单图 1MB(假设 11) */
  async onChooseAvatar() {
    if (this.data.uploading) return;
    const w = host.wxOf(this);
    if (!w) return;

    let tempFilePath = '';
    try {
      const res = await host.promisify(w, 'chooseMedia')({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
      });
      const files = (res && res.tempFiles) || [];
      tempFilePath = (files[0] && files[0].tempFilePath) || '';
    } catch (e) {
      // 用户在相册里点了取消 —— 不是错误,静默返回
      return;
    }
    if (!tempFilePath) return;

    this.setData({ uploading: true, errMsg: '' });
    try {
      const fileID = await api.uploadFile(cloudPathOf(this.data.dog._id, tempFilePath), tempFilePath);
      this.setData({ 'dog.avatarFileID': fileID || '', uploading: false, errMsg: '' });
    } catch (err) {
      this.setData({ uploading: false, errMsg: meta.readableError(err, '照片没传上去,再试一次') });
    }
  },

  onPreviewAvatar() {
    const url = this.data.dog.avatarFileID;
    if (!url) return;
    const w = host.wxOf(this);
    if (w) w.previewImage({ urls: [url], current: url });
  },

  async onSave() {
    if (this.data.saving || this.data.uploading) return;

    const bad = meta.validateDog(this.data.dog);
    if (bad) {
      // 本地就拦下,不往 api 发(spec 6 节 T9)
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
      this.setData({ saving: false, errMsg: meta.readableError(err, '保存失败,请重试') });
    }
  },

  /** 身份牌是单独一页(小程序码 / 存相册 / 走失模式 / 寻回留言都在那边) */
  onOpenTag() {
    const dogId = this.data.dog._id;
    if (!dogId) {
      this.setData({ errMsg: '先保存档案,再领身份牌' });
      return;
    }
    const w = host.wxOf(this);
    if (w) w.navigateTo({ url: '/pages/dog/tag/tag?dogId=' + dogId });
  },

  async onRemove() {
    const dogId = this.data.dog._id;
    const w = host.wxOf(this);
    if (!dogId) {
      // 还没存过的狗没什么可删的,直接退回去
      if (w) w.navigateBack({ delta: 1 });
      return;
    }

    let confirmed = false;
    try {
      const res = await host.promisify(w, 'showModal')({
        title: '删掉这只狗?',
        content: '档案和身份牌会一起删掉,找不回来',
        confirmText: '删掉',
      });
      confirmed = !!(res && res.confirm);
    } catch (e) {
      // 弹窗弹不出来就当没确认 —— 宁可不删
      return;
    }
    if (!confirmed) return;

    this.setData({ errMsg: '' });
    try {
      await api.removeDog(dogId);
      if (w) {
        w.showToast({ title: '已删掉', icon: 'success' });
        w.navigateBack({ delta: 1 });
      }
    } catch (err) {
      this.setData({ errMsg: meta.readableError(err, '删除失败,请重试') });
    }
  },
};

Page(options);
module.exports = options;
