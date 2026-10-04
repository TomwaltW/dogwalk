// miniprogram/pages/walk/detail/detail.js —— owner: T10
// 约遛详情:按 myStatus 分出五种视角(none / pending / approved / host / rejected|left),
// 加一块合拍度提示(logic/compat.js)和一块留言区(只对 host 与 approved 开放)。
// 形状见 spec 3.2.3 WalkDetail;成员卡片只显示 DogCard 字段,没有主人昵称。

const api = require('../../../api/index');
const host = require('../../../logic/host');
const compat = require('../../../logic/compat');
const {
  LIMITS,
  MEMBER_STATUS_LABEL,
  SIZE_LABEL,
  labelOf,
  labelsOfTags,
  charLength,
} = require('../../../logic/enums');
const fmt = require('../format');
const { errText } = require('../errors');
const clock = require('../clock');

/** 各种「只能看不能动」的状态下给一句话,免得用户对着灰按钮猜 */
const NOTICE = {
  pending: '已经申请了,等发起人确认',
  rejected: '发起人婉拒了这次申请,看看别的约遛吧',
  left: '你已经退出这次约遛了',
};
/** 退出后约遛还没开始:服务端允许重新申请(walkOps join,spec 第 9 节假设 7) */
const NOTICE_LEFT_REJOIN = '你已经退出这次约遛了,想去的话可以重新申请';
const NOTICE_STARTED = '这次约遛已经开始了,不能再申请';
/** walkOps join 对已开始 / 已取消的约遛回 CONFLICT 'walk closed' */
const MSG_WALK_CLOSED = 'walk closed';

/** 顶部那句提示:退出后还能回来就告诉用户;没参与的人碰上已开始的约遛也说一声 */
function noticeOf(myStatus, canJoin, started) {
  if (myStatus === 'left' && canJoin) return NOTICE_LEFT_REJOIN;
  if (NOTICE[myStatus]) return NOTICE[myStatus];
  return myStatus === 'none' && started ? NOTICE_STARTED : '';
}

/**
 * DogCard -> 视图。原始的 sizeClass / tags 留着,合拍度规则要用;
 * 主人字段一个都不进来(spec 2.1「不展示主人昵称、头像、openid」)。
 */
function toDogView(d, pickedIds) {
  return {
    dogId: d.dogId,
    name: d.name,
    avatarFileID: d.avatarFileID || '',
    sizeClass: d.sizeClass,
    tags: Array.isArray(d.tags) ? d.tags.slice() : [],
    sizeText: labelOf(SIZE_LABEL, d.sizeClass),
    tagText: labelsOfTags(d.tags),
    picked: !!pickedIds && pickedIds.indexOf(d.dogId) >= 0,
  };
}

/** WalkMember -> 视图 */
function toMemberView(m) {
  return {
    memberId: m.memberId,
    status: m.status,
    statusText: labelOf(MEMBER_STATUS_LABEL, m.status),
    isMe: !!m.isMe,
    dogs: (m.dogs || []).map((d) => toDogView(d)),
  };
}

/** WalkMessage -> 视图。署名是狗名,不是主人昵称(spec 第 9 节假设 8) */
function toMessageView(g) {
  return {
    messageId: g.messageId,
    dogName: g.dogName || '',
    text: g.text || '',
    isMe: !!g.isMe,
    timeText: fmt.mdHm(g.createdAt),
  };
}

/** 弹一次确认框;取不到 wx 或用户点了取消都返回 false */
async function confirm(page, title, content) {
  const wx = host.wxOf(page);
  if (!wx) return false;
  try {
    const res = await host.promisify(wx, 'showModal')({ title, content });
    return !!(res && res.confirm);
  } catch (e) {
    return false;
  }
}

const options = {
  data: {
    walkId: '',
    /** @type {object|null} WalkSummary 去掉 hostDogs 之后的部分 */
    walk: null,
    timeText: '',
    /** @type {Array<object>} 发起人的狗 */
    hostDogs: [],
    /** @type {Array<object>} 全部成员(host 视角能看到 pending / rejected) */
    members: [],
    pendingMembers: [],
    approvedMembers: [],
    /** @type {Array<object>} 只有 myStatus ∈ {host, approved} 时非空 */
    messages: [],
    /** @type {Array<object>} 我自己的狗,申请弹窗与合拍度都用它 */
    myDogs: [],
    myStatus: 'none',
    isHost: false,

    /** @type {Array<{level:string,text:string}>} 来自 logic/compat.js */
    compatHints: [],
    hasWarnHint: false,

    // 这一组决定哪些按钮出现;已取消 / 已婉拒 / 已退出时全部为 false
    readonly: false,
    canJoin: false,
    canCancelJoin: false,
    canLeave: false,
    canCancelWalk: false,
    canDecide: false,
    canSend: false,
    showMessages: false,

    noticeText: '',
    cancelledText: '',

    // 申请加入的选狗弹窗
    picking: false,
    pickedDogIds: [],

    draft: '',
    messageMax: LIMITS.MESSAGE_MAX,

    loading: false,
    submitting: false,
    errMsg: '',
    /** onLoad 刚拉过一次,紧跟着的那次 onShow 不用再拉 */
    shown: false,
  },

  async onLoad(query) {
    const walkId = (query && query.walkId) || '';
    this.setData({ walkId });
    if (!walkId) {
      this.setData({ errMsg: '没拿到约遛编号,回列表重新进来' });
      return;
    }
    await this.load();
  },

  // 从选狗页 / 别的页面回来时状态可能已经变了,重拉一次
  async onShow() {
    if (!this.data.shown) {
      this.setData({ shown: true });
      return;
    }
    await this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    const wx = host.wxOf(this);
    if (wx) wx.stopPullDownRefresh();
  },

  async load() {
    if (!this.data.walkId) return;
    this.setData({ loading: true, errMsg: '' });
    try {
      const detail = await api.getWalk(this.data.walkId);
      this.applyDetail(detail);
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** WalkDetail -> 一整页 data。所有派生字段都在这里一次算完,WXML 里不做判断 */
  applyDetail(detail) {
    const walk = (detail && detail.walk) || null;
    if (!walk) {
      this.setData({ errMsg: '这条约遛不在了,回列表看看别的' });
      return;
    }

    const myStatus = walk.myStatus || 'none';
    const isHost = myStatus === 'host';
    const cancelled = walk.status === 'cancelled';
    // 已经开始的约遛不收新申请(与 walkOps join 同一条线:startAt <= 现在)
    const started = Date.parse(walk.startAt) <= Date.parse(clock.nowIso());
    // 被婉拒 / 已退出的人只能看;约遛取消后谁都不能动
    const readonly = cancelled || myStatus === 'rejected' || myStatus === 'left';
    // 申请入口:没申请过的,或者退出后想回来的(服务端允许,假设 7);被婉拒的不行
    const canJoin = !cancelled && !started && (myStatus === 'none' || myStatus === 'left');

    const hostDogs = (walk.hostDogs || []).map((d) => toDogView(d));
    const members = ((detail && detail.members) || []).map(toMemberView);
    const messages = ((detail && detail.messages) || []).map(toMessageView);
    const myDogs = ((detail && detail.myDogs) || []).map((d) => toDogView(d, []));

    // 合拍度:对方 = 发起人的狗 + 已批准且不是我的成员狗(spec 3.3.6)
    const others = members
      .filter((m) => m.status === 'approved' && !m.isMe)
      .reduce((acc, m) => acc.concat(m.dogs), hostDogs.slice());
    const mine = isHost ? hostDogs : myDogs;
    const compatHints = compat.compatHints(mine, others);

    const canSend = !readonly && (isHost || myStatus === 'approved');

    this.setData({
      walk: {
        walkId: walk.walkId,
        parkId: walk.parkId,
        parkName: walk.parkName || '',
        startAt: walk.startAt,
        note: walk.note || '',
        dogCount: walk.dogCount,
        maxDogs: walk.maxDogs,
        status: walk.status,
        countText: walk.dogCount + '/' + walk.maxDogs,
      },
      timeText: fmt.mdHm(walk.startAt),
      hostDogs,
      members,
      pendingMembers: members.filter((m) => m.status === 'pending'),
      approvedMembers: members.filter((m) => m.status === 'approved'),
      messages,
      myDogs,
      myStatus,
      isHost,

      compatHints,
      hasWarnHint: compatHints.some((h) => h.level === 'warn'),

      readonly,
      canJoin,
      canCancelJoin: !readonly && myStatus === 'pending',
      canLeave: !readonly && myStatus === 'approved',
      canCancelWalk: !readonly && isHost,
      canDecide: !readonly && isHost,
      canSend,
      // 留言已经存在就让人看得到,哪怕自己已经退出了
      showMessages: messages.length > 0 || isHost || myStatus === 'approved',

      noticeText: noticeOf(myStatus, canJoin, started && !cancelled && !isHost),
      cancelledText: cancelled ? '这次约遛已取消' : '',
    });
  },

  // ---------------------------------------------------------------- 申请加入

  onTapJoin() {
    if (!this.data.canJoin) return;
    if (!this.data.myDogs.length) {
      this.setData({ errMsg: '你还没有狗狗档案,先去「我的」加一只再来约' });
      return;
    }
    this.setData({
      picking: true,
      pickedDogIds: [],
      myDogs: this.data.myDogs.map((d) => Object.assign({}, d, { picked: false })),
      errMsg: '',
    });
  },

  onPickDog(e) {
    const dogId = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!dogId) return;
    const ids = this.data.pickedDogIds.slice();
    const at = ids.indexOf(dogId);
    if (at >= 0) ids.splice(at, 1);
    else ids.push(dogId);
    this.setData({
      pickedDogIds: ids,
      myDogs: this.data.myDogs.map((d) => Object.assign({}, d, { picked: ids.indexOf(d.dogId) >= 0 })),
      errMsg: '',
    });
  },

  onCancelPick() {
    this.setData({ picking: false, pickedDogIds: [] });
  },

  async onConfirmJoin() {
    if (this.data.submitting) return;
    if (!this.data.canJoin) return;
    if (!this.data.pickedDogIds.length) {
      this.setData({ errMsg: '至少选一只狗再申请' });
      return;
    }

    this.setData({ submitting: true, errMsg: '' });
    try {
      await api.joinWalk(this.data.walkId, this.data.pickedDogIds.slice());
      this.setData({ picking: false });
      await this.load();
    } catch (e) {
      // CONFLICT 有两种:约遛已开始/取消('walk closed'),或已经有一条申请。别把前者说成后者
      const closed = e && e.code === 'CONFLICT' && e.message === MSG_WALK_CLOSED;
      this.setData({
        errMsg: errText(e, {
          CONFLICT: closed ? '这次约遛已经开始或取消了,看看别的吧' : '你已经申请过这场了,等发起人确认',
          FORBIDDEN: '这是你自己发起的约遛,不用再申请',
        }),
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------------------------------------------------------------- 退出 / 取消

  async onLeave() {
    if (this.data.submitting) return;
    if (!this.data.canLeave && !this.data.canCancelJoin) return;

    // 已经加入的退出会影响别人,先确认;还在排队的取消申请就不啰嗦了
    if (this.data.canLeave) {
      const ok = await confirm(this, '退出这次约遛?', '发起人那边会看到你退出了');
      if (!ok) return;
    }

    this.setData({ submitting: true, errMsg: '' });
    try {
      await api.leaveWalk(this.data.walkId);
      await this.load();
    } catch (e) {
      this.setData({ errMsg: errText(e, { FORBIDDEN: '发起人不能退出,只能取消整场约遛' }) });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onCancelWalk() {
    if (this.data.submitting) return;
    if (!this.data.canCancelWalk) return;

    const ok = await confirm(this, '取消这次约遛?', '已经加入的狗主人会看到约遛被取消');
    if (!ok) return;

    this.setData({ submitting: true, errMsg: '' });
    try {
      await api.cancelWalk(this.data.walkId);
      await this.load();
    } catch (e) {
      this.setData({ errMsg: errText(e) });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------------------------------------------------------------- 发起人审批

  async onDecide(e) {
    if (this.data.submitting) return;
    if (!this.data.canDecide) return;

    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const memberId = ds.id;
    // WXML 上写的是 data-approve="{{true}}",但真机上也可能变成字符串,两种都认
    const approve = ds.approve === true || ds.approve === 'true';
    if (!memberId) return;

    this.setData({ submitting: true, errMsg: '' });
    try {
      await api.decideJoin(memberId, approve);
      await this.load();
    } catch (err) {
      // WALK_FULL 的默认文案就是「狗数已满,改上限得重新发起」(pages/walk/errors.js)
      this.setData({ errMsg: errText(err, { NOT_FOUND: '这条申请已经不在了,刷新看看' }) });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------------------------------------------------------------- 留言

  onDraftInput(e) {
    this.setData({ draft: (e && e.detail && e.detail.value) || '', errMsg: '' });
  },

  async onSend() {
    if (this.data.submitting) return;
    if (!this.data.canSend) return;

    const text = String(this.data.draft || '').trim();
    if (!text) return;
    if (charLength(text) > LIMITS.MESSAGE_MAX) {
      this.setData({ errMsg: '留言最多 ' + LIMITS.MESSAGE_MAX + ' 个字' });
      return;
    }

    this.setData({ submitting: true, errMsg: '' });
    try {
      await api.postMessage(this.data.walkId, text);
      this.setData({ draft: '' });
      await this.load();
    } catch (e) {
      this.setData({
        errMsg: errText(e, {
          CONFLICT: '这次约遛已经取消了,发不了留言',
          FORBIDDEN: '只有发起人和已加入的成员能留言',
        }),
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------------------------------------------------------------- 跳转

  onBackToList() {
    const wx = host.wxOf(this);
    // 约遛列表是 tab 页,只能 switchTab(spec 3.3.4)
    if (wx) wx.switchTab({ url: '/pages/walk/list/list' });
  },
};

Page(options);
module.exports = options;
