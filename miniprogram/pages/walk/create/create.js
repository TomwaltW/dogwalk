// miniprogram/pages/walk/create/create.js —— owner: T10
// 发起约遛:选公园 / 时间 / 带哪几只狗 / 备注 / 狗数上限 -> walkOps create(spec 3.3.2)。
// 能在本地判死的都不发请求:没选公园、没选狗、时间在过去、备注超长、选的狗比上限多。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const { LIMITS, SIZE_LABEL, labelOf, labelsOfTags, charLength } = require('../../../logic/enums');
// 页面里不出现裸时钟(spec 3.3.4),「现在」只从这里取
const clock = require('../clock');
const fmt = require('../format');
const { errText } = require('../errors');

/**
 * api.listMyDogs 返回的是完整 Dog 文档(带 ownerOpenid),
 * 这里收敛成 DogCard + 视图字段再进 data:页面 data 里不该出现任何主人身份字段。
 */
function toDogView(d, selectedIds) {
  return {
    dogId: d._id,
    name: d.name,
    avatarFileID: d.avatarFileID || '',
    sizeText: labelOf(SIZE_LABEL, d.sizeClass),
    tagText: labelsOfTags(d.tags),
    selected: selectedIds.indexOf(d._id) >= 0,
  };
}

/** 本地校验 —— 返回空串表示可以发。顺序跟用户从上往下填的顺序一致 */
function validate(d) {
  if (!d.parkId) return '先选一个公园';
  if (!d.selectedDogIds.length) return '至少带一只狗一起去';
  const startAt = fmt.toIso(d.date, d.time);
  if (!startAt) return '日期和时间都要选一下';
  if (fmt.notAfter(startAt, clock.nowIso())) return '约的时间不能早于现在,往后挪一挪';
  if (charLength(d.note) > LIMITS.WALK_NOTE_MAX) return '备注最多 ' + LIMITS.WALK_NOTE_MAX + ' 个字';
  if (d.selectedDogIds.length > d.maxDogs) return '带的狗比上限还多,把上限调大一点';
  return '';
}

const options = {
  data: {
    /** @type {Array<{parkId:string,name:string}>} */
    parks: [],
    parkNames: [],
    /** picker 的 index;-1 = 还没选,WXML 上显示占位文案 */
    parkIndex: -1,
    parkId: '',
    /** @type {Array<object>} toDogView 之后的我的狗 */
    dogs: [],
    /** @type {string[]} 带去的狗,至少一只 */
    selectedDogIds: [],
    /** 'YYYY-MM-DD' 东八区 */
    date: '',
    /** 'HH:mm' 东八区 */
    time: '',
    /** date picker 的最早可选日,来自 ./clock */
    minDate: '',
    note: '',
    noteMax: LIMITS.WALK_NOTE_MAX,
    maxDogs: LIMITS.WALK_MAX_DOGS_DEFAULT,
    maxDogsCap: LIMITS.WALK_MAX_DOGS_CAP,
    loading: false,
    submitting: false,
    errMsg: '',
  },

  async onLoad(query) {
    const nowIso = clock.nowIso();
    const start = fmt.defaultStart(nowIso);
    this.setData({
      minDate: fmt.ymd(nowIso),
      date: start.date,
      time: start.time,
      loading: true,
      errMsg: '',
    });

    const wantParkId = (query && query.parkId) || '';
    try {
      // 两个请求互不依赖,并行发
      const [parks, dogs] = await Promise.all([api.listParks(), api.listMyDogs()]);
      const parkList = Array.isArray(parks) ? parks : [];
      const dogList = Array.isArray(dogs) ? dogs : [];
      // 只有一只狗的人是多数,别逼他先勾一下
      const selectedDogIds = dogList.length === 1 ? [dogList[0]._id] : [];
      const parkIndex = parkList.findIndex((p) => p.parkId === wantParkId);

      this.setData({
        parks: parkList.map((p) => ({ parkId: p.parkId, name: p.name })),
        parkNames: parkList.map((p) => p.name),
        parkIndex,
        parkId: parkIndex >= 0 ? parkList[parkIndex].parkId : '',
        dogs: dogList.map((d) => toDogView(d, selectedDogIds)),
        selectedDogIds,
      });
    } catch (e) {
      this.setData({ errMsg: errText(e, { NOT_FOUND: '公园或狗的数据没拉到,下拉重进试试' }) });
    } finally {
      this.setData({ loading: false });
    }
  },

  onParkChange(e) {
    const index = Number((e && e.detail && e.detail.value) || 0);
    const park = this.data.parks[index];
    if (!park) return;
    this.setData({ parkIndex: index, parkId: park.parkId, errMsg: '' });
  },

  onDateChange(e) {
    this.setData({ date: (e && e.detail && e.detail.value) || '', errMsg: '' });
  },

  onTimeChange(e) {
    this.setData({ time: (e && e.detail && e.detail.value) || '', errMsg: '' });
  },

  onToggleDog(e) {
    const dogId = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!dogId) return;
    const ids = this.data.selectedDogIds.slice();
    const at = ids.indexOf(dogId);
    if (at >= 0) ids.splice(at, 1);
    else ids.push(dogId);
    this.setData({
      selectedDogIds: ids,
      dogs: this.data.dogs.map((d) => Object.assign({}, d, { selected: ids.indexOf(d.dogId) >= 0 })),
      errMsg: '',
    });
  },

  onNoteInput(e) {
    this.setData({ note: (e && e.detail && e.detail.value) || '', errMsg: '' });
  },

  onMaxDogsPlus() {
    this.setData({ maxDogs: Math.min(this.data.maxDogsCap, this.data.maxDogs + 1) });
  },

  onMaxDogsMinus() {
    // 上限不能低于已经选好的狗数,不然一提交就被自己的校验拦下
    const floor = Math.max(1, this.data.selectedDogIds.length);
    this.setData({ maxDogs: Math.max(floor, this.data.maxDogs - 1) });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const err = validate(this.data);
    if (err) {
      this.setData({ errMsg: err });
      return;
    }

    const payload = {
      parkId: this.data.parkId,
      startAt: fmt.toIso(this.data.date, this.data.time),
      dogIds: this.data.selectedDogIds.slice(),
      note: this.data.note,
      maxDogs: this.data.maxDogs,
    };

    this.setData({ submitting: true, errMsg: '' });
    try {
      const res = await api.createWalk(payload);
      const walkId = (res && res.walkId) || '';
      const wx = host.wxOf(this);
      // redirectTo:发完就该在详情页里,返回键不该再回到这张空表单
      if (wx) wx.redirectTo({ url: '/pages/walk/detail/detail?walkId=' + walkId });
    } catch (e) {
      this.setData({
        errMsg: errText(e, {
          NOT_FOUND: '公园或者狗不在了,回上一页重新进来',
          CONTENT_RISKY: '备注没通过内容检查,换个说法再发',
        }),
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBackToList() {
    const wx = host.wxOf(this);
    // 约遛列表是 tab 页,只能 switchTab(spec 3.3.4)
    if (wx) wx.switchTab({ url: '/pages/walk/list/list' });
  },
};

Page(options);
module.exports = options;
