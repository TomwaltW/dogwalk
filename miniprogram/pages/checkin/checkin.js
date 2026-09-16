// miniprogram/pages/checkin/checkin.js —— owner: T4
// 发广播「我出门了」:选狗 -> 可选留一句话 -> 提交(spec 3.3.2 checkin 的 event)。
// 广播有效期固定 90 分钟,由云函数算 expireAt,页面不参与。

const api = require('../../api/index');
// 页面里不出现裸时钟(spec 3.3.4),当前时间只从这里取一次、写进 data.now
const clock = require('./clock');

/** note 长度上限,与 spec 3.2 checkins.note 的 0-30 字符对齐 */
const NOTE_MAX = 30;

/** ApiError -> 给用户看的一句话。code 见 spec 3.1。 */
function errText(e) {
  const code = e && e.code;
  if (code === 'AUTH_REQUIRED') return '还没登录,回「我的」登录一下再来';
  if (code === 'CONFLICT') return '你在这个点位已经有一条进行中的广播了';
  if (code === 'NOT_FOUND') return '点位或者狗不存在,回上一页重新进来';
  if (code === 'INVALID_PARAM') return '信息填得不太对,检查一下再发';
  return (e && e.message) || '发送失败,稍后再试';
}

/** 把选中状态标到每只狗上 —— WXML 的表达式里调不了 indexOf */
function markSelected(dogs, ids) {
  return dogs.map((d) => Object.assign({}, d, { selected: ids.indexOf(d._id) >= 0 }));
}

const options = {
  data: {
    spotId: '',
    /** @type {Array<object>} spec 3.2 dogs 文档,外加一个给 WXML 用的 selected */
    dogs: [],
    /** @type {string[]} 选中的狗,至少 1 个才能提交 */
    selectedDogIds: [],
    note: '',
    noteMax: NOTE_MAX,
    loading: false,
    submitting: false,
    errMsg: '',
    // 提交那一刻的 ISO8601 时间,即 event.startAt;来源见 ./clock
    now: '',
  },

  async onLoad(query) {
    this.setData({ spotId: (query && query.spotId) || '' });
    await this.loadDogs();
  },

  async loadDogs() {
    this.setData({ loading: true, errMsg: '' });
    try {
      const dogs = await api.listMyDogs();
      const list = Array.isArray(dogs) ? dogs : [];
      // 只有一只狗的人是多数,核心动作该是「点一下我出门了」,不该先逼他勾选
      const selectedDogIds = list.length === 1 ? [list[0]._id] : [];
      this.setData({ dogs: markSelected(list, selectedDogIds), selectedDogIds });
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleDog(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.dogId) return;
    const next = this.data.selectedDogIds.slice();
    const i = next.indexOf(ds.dogId);
    if (i >= 0) next.splice(i, 1);
    else next.push(ds.dogId);
    this.setData({
      selectedDogIds: next,
      dogs: markSelected(this.data.dogs, next),
      errMsg: '',
    });
  },

  onNoteInput(e) {
    this.setData({ note: (e && e.detail && e.detail.value) || '' });
  },

  async submit() {
    // 连点两下只发一条:submitting 在 await 之前就置上,第二次同步进来直接退出
    if (this.data.submitting) return;
    if (!this.data.spotId) {
      this.setData({ errMsg: '没拿到点位,回上一页重新进来' });
      return;
    }
    if (!this.data.selectedDogIds.length) {
      this.setData({ errMsg: '先选一只要带出门的狗' });
      return;
    }
    if (this.data.note.length > NOTE_MAX) {
      this.setData({ errMsg: '留言最多 ' + NOTE_MAX + ' 个字' });
      return;
    }

    this.setData({ submitting: true, errMsg: '', now: clock.nowIso() });
    try {
      await api.createCheckin({
        spotId: this.data.spotId,
        dogIds: this.data.selectedDogIds,
        startAt: this.data.now,
        note: this.data.note,
      });
      wx.showToast({ title: '已经告诉大家了', icon: 'success' });
      wx.navigateBack({ delta: 1 });
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ submitting: false });
    }
  },
};

Page(options);
module.exports = options;
