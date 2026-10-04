/**
 * B12 —— 约遛详情 pages/walk/detail/detail.js
 *
 * 覆盖(派单第 7 节 B12 那一格):
 *   ① myStatus:'none' 时 data.messages 为空且显示申请入口(data.canJoin === true)
 *   ② host 看到 pending 成员并能 decideJoin(memberId, true)
 *   ③ fearsBig 的成员狗 + large 的 host 狗时 data.compatHints 非空
 *   ④ walk.status:'cancelled' 时 data.readonly === true
 *   ⑤ getWalk reject 时 errMsg 非空且不抛
 */

jest.mock('../../miniprogram/api/index');
jest.mock('../../miniprogram/pages/walk/clock');

const api = require('../../miniprogram/api/index');
const clock = require('../../miniprogram/pages/walk/clock');
const { loadPage } = require('../fakes/mini-runtime');
const { LIMITS } = require('../../miniprogram/logic/enums');

const PAGE = 'miniprogram/pages/walk/detail/detail.js';
const NOW = '2026-09-16T02:00:00.000Z'; // = 东八区 2026-09-16 10:00

function apiError(code, msg) {
  const e = new Error(msg || code);
  e.name = 'ApiError';
  e.code = code;
  return e;
}

/** DogCard(spec 3.2.3) */
function card(over) {
  return Object.assign({ dogId: 'd1', name: '旺财', avatarFileID: '', sizeClass: 'medium', tags: [] }, over || {});
}

/** WalkSummary */
function summary(over) {
  return Object.assign(
    {
      walkId: 'w1',
      parkId: 'p1',
      parkName: '西湖公园',
      startAt: '2026-09-16T10:30:00.000Z',
      note: '带球来',
      maxDogs: 3,
      dogCount: 1,
      hostDogs: [card()],
      status: 'open',
      isHost: false,
      myStatus: 'none',
    },
    over || {}
  );
}

/** WalkDetail */
function detail(over) {
  const base = {
    walk: summary(),
    members: [],
    messages: [],
    myDogs: [card({ dogId: 'md1', name: '豆豆', sizeClass: 'small' })],
  };
  return Object.assign(base, over || {});
}

function member(over) {
  return Object.assign(
    { memberId: 'm1', status: 'pending', dogs: [card({ dogId: 'd9', name: '奶黄' })], isMe: false },
    over || {}
  );
}

function message(over) {
  return Object.assign(
    { messageId: 'g1', dogName: '旺财', text: '我到了', createdAt: '2026-09-16T10:35:00.000Z', isMe: false },
    over || {}
  );
}

function wxCalls(page, name) {
  return page.__wx.__calls.filter((c) => c.name === name);
}

async function open(walkDetail, stubs) {
  api.getWalk.mockResolvedValue(walkDetail);
  const page = loadPage(PAGE, stubs);
  await page.onLoad({ walkId: walkDetail.walk.walkId });
  return page;
}

beforeEach(() => {
  clock.nowIso.mockReturnValue(NOW);
});

describe('约遛详情 —— 加载与陌生人视角(B12 ①)', () => {
  test('onLoad 用 query.walkId 拉详情', async () => {
    const page = await open(detail());

    expect(api.getWalk).toHaveBeenCalledTimes(1);
    expect(api.getWalk).toHaveBeenCalledWith('w1');
    expect(page.data.walk.parkName).toBe('西湖公园');
    expect(page.data.hostDogs).toHaveLength(1);
    expect(page.data.timeText).toBe('09-16 18:30');
    expect(page.data.errMsg).toBe('');
    expect(page.data.loading).toBe(false);
  });

  test('myStatus:none —— data.messages 为空,且显示申请入口 canJoin === true', async () => {
    const page = await open(detail({ messages: [] }));

    expect(page.data.myStatus).toBe('none');
    expect(page.data.messages).toEqual([]);
    expect(page.data.canJoin).toBe(true);
    expect(page.data.showMessages).toBe(false);
    expect(page.data.readonly).toBe(false);
  });

  test('onShow 首次不重复拉,再次 onShow 才重拉', async () => {
    const page = await open(detail());

    await page.onShow();
    expect(api.getWalk).toHaveBeenCalledTimes(1);

    await page.onShow();
    expect(api.getWalk).toHaveBeenCalledTimes(2);
  });

  test('详情页 data 里没有主人身份字段', async () => {
    const page = await open(
      detail({
        walk: summary({ myStatus: 'approved' }),
        members: [member({ status: 'approved' })],
        messages: [message()],
      })
    );

    const dumped = JSON.stringify(page.data);
    expect(dumped).not.toMatch(/openid/i);
    expect(dumped).not.toMatch(/nickname/i);
  });

  test('getWalk reject —— errMsg 非空且不抛(B12 ⑤)', async () => {
    api.getWalk.mockRejectedValue(apiError('NOT_FOUND', 'walks'));

    const page = loadPage(PAGE);
    await expect(page.onLoad({ walkId: 'w1' })).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
    expect(page.data.walk).toBe(null);
    expect(page.data.loading).toBe(false);
  });
});

describe('约遛详情 —— 申请加入(B12 ①)', () => {
  test('点申请先弹选狗,不直接调 api', async () => {
    const page = await open(detail());

    page.onTapJoin();

    expect(page.data.picking).toBe(true);
    expect(api.joinWalk).not.toHaveBeenCalled();
    expect(page.data.myDogs.map((d) => d.name)).toEqual(['豆豆']);
  });

  test('一只狗都没有时提示去加,不弹选狗', async () => {
    const page = await open(detail({ myDogs: [] }));

    page.onTapJoin();

    expect(page.data.picking).toBe(false);
    expect(page.data.errMsg).not.toBe('');
    expect(api.joinWalk).not.toHaveBeenCalled();
  });

  test('选好狗确认 —— joinWalk 收到 (walkId, dogIds) 并重拉', async () => {
    const page = await open(detail());
    api.joinWalk.mockResolvedValue({ memberId: 'm2', status: 'pending' });
    api.getWalk.mockResolvedValue(
      detail({ walk: summary({ myStatus: 'pending' }), members: [member({ memberId: 'm2', isMe: true })] })
    );

    page.onTapJoin();
    page.onPickDog({ currentTarget: { dataset: { id: 'md1' } } });
    await page.onConfirmJoin();

    expect(api.joinWalk).toHaveBeenCalledWith('w1', ['md1']);
    expect(api.getWalk).toHaveBeenCalledTimes(2);
    expect(page.data.picking).toBe(false);
    expect(page.data.myStatus).toBe('pending');
  });

  test('一只没勾就确认 —— 拦下不调 api', async () => {
    const page = await open(detail());

    page.onTapJoin();
    await page.onConfirmJoin();

    expect(api.joinWalk).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('joinWalk 报 CONFLICT —— errMsg 非空且不抛', async () => {
    const page = await open(detail());
    api.joinWalk.mockRejectedValue(apiError('CONFLICT', '已经申请过了'));

    page.onTapJoin();
    page.onPickDog({ currentTarget: { dataset: { id: 'md1' } } });
    await expect(page.onConfirmJoin()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
  });
});

describe('约遛详情 —— pending / approved(B12)', () => {
  test('pending —— 显示等待文案,取消申请走 leaveWalk', async () => {
    const page = await open(
      detail({ walk: summary({ myStatus: 'pending' }), members: [member({ isMe: true })] })
    );

    expect(page.data.canJoin).toBe(false);
    expect(page.data.canCancelJoin).toBe(true);
    expect(page.data.showMessages).toBe(false);
    expect(page.data.noticeText).not.toBe('');

    api.leaveWalk.mockResolvedValue({ left: true });
    api.getWalk.mockResolvedValue(detail({ walk: summary({ myStatus: 'left' }) }));
    await page.onLeave();

    expect(api.leaveWalk).toHaveBeenCalledWith('w1');
    expect(page.data.myStatus).toBe('left');
  });

  test('approved —— 有留言区,退出前先弹确认', async () => {
    const page = await open(
      detail({
        walk: summary({ myStatus: 'approved', dogCount: 2 }),
        members: [member({ status: 'approved', isMe: true })],
        messages: [message(), message({ messageId: 'g2', dogName: '豆豆', text: '马上到', isMe: true })],
      })
    );

    expect(page.data.showMessages).toBe(true);
    expect(page.data.canLeave).toBe(true);
    expect(page.data.messages).toHaveLength(2);
    expect(page.data.messages[1].isMe).toBe(true);
    expect(page.data.messages[0].timeText).toBe('09-16 18:35');
    expect(page.data.messageMax).toBe(LIMITS.MESSAGE_MAX);

    api.leaveWalk.mockResolvedValue({ left: true });
    api.getWalk.mockResolvedValue(detail({ walk: summary({ myStatus: 'left' }) }));
    await page.onLeave();

    expect(wxCalls(page, 'showModal')).toHaveLength(1);
    expect(api.leaveWalk).toHaveBeenCalledWith('w1');
  });

  test('退出弹窗点了取消 —— 不调 leaveWalk', async () => {
    const page = await open(
      detail({ walk: summary({ myStatus: 'approved' }), members: [member({ status: 'approved', isMe: true })] }),
      { wx: { showModal: (o) => o.success({ confirm: false, cancel: true }) } }
    );

    await page.onLeave();

    expect(api.leaveWalk).not.toHaveBeenCalled();
  });

  test('rejected —— 只读,一句提示,不给申请入口', async () => {
    const rejected = await open(detail({ walk: summary({ myStatus: 'rejected' }) }));
    expect(rejected.data.readonly).toBe(true);
    expect(rejected.data.canJoin).toBe(false);
    expect(rejected.data.noticeText).not.toBe('');
  });

  test('left —— 其余只读,但约遛没开始就能重新申请(与 walkOps 假设 7 一致)', async () => {
    const left = await open(detail({ walk: summary({ myStatus: 'left' }) }));
    expect(left.data.readonly).toBe(true);
    expect(left.data.canJoin).toBe(true);
    expect(left.data.canLeave).toBe(false);
    expect(left.data.canSend).toBe(false);
    expect(left.data.noticeText).toMatch(/重新申请/);
  });

  test('已经开始的约遛不给申请入口(none / left 都一样)', async () => {
    const past = { startAt: '2026-09-16T01:00:00.000Z' }; // 早于 NOW
    const none = await open(detail({ walk: summary(Object.assign({ myStatus: 'none' }, past)) }));
    expect(none.data.canJoin).toBe(false);
    expect(none.data.noticeText).toMatch(/已经开始/);

    const left = await open(detail({ walk: summary(Object.assign({ myStatus: 'left' }, past)) }));
    expect(left.data.canJoin).toBe(false);
    expect(left.data.noticeText).not.toMatch(/重新申请/);
  });

  test('申请时服务端回 CONFLICT walk closed:说约遛已开始,不说「已经申请过」', async () => {
    const page = await open(detail({ myDogs: [card({ dogId: 'mine1' })] }));
    page.onTapJoin();
    page.onPickDog({ currentTarget: { dataset: { id: 'mine1' } } });
    const err = new Error('walk closed');
    err.code = 'CONFLICT';
    api.joinWalk.mockRejectedValue(err);

    await page.onConfirmJoin();

    expect(page.data.errMsg).toMatch(/已经开始或取消/);
    expect(page.data.errMsg).not.toMatch(/已经申请过/);
  });
});

describe('约遛详情 —— 发起人视角(B12 ②)', () => {
  const HOST_DETAIL = () =>
    detail({
      walk: summary({ myStatus: 'host', isHost: true, hostDogs: [card({ name: '旺财' })] }),
      members: [
        member({ memberId: 'm1', status: 'pending' }),
        member({ memberId: 'm2', status: 'approved', dogs: [card({ dogId: 'd8', name: '可乐' })] }),
        member({ memberId: 'm3', status: 'rejected', dogs: [card({ dogId: 'd7', name: '小黑' })] }),
      ],
      messages: [message()],
    });

  test('host 看到 pending 成员', async () => {
    const page = await open(HOST_DETAIL());

    expect(page.data.myStatus).toBe('host');
    expect(page.data.isHost).toBe(true);
    expect(page.data.pendingMembers.map((m) => m.memberId)).toEqual(['m1']);
    expect(page.data.approvedMembers.map((m) => m.memberId)).toEqual(['m2']);
    expect(page.data.pendingMembers[0].statusText).toBe('待确认');
    expect(page.data.showMessages).toBe(true);
    expect(page.data.canCancelWalk).toBe(true);
    expect(page.data.canJoin).toBe(false);
  });

  test('同意 —— api.decideJoin 收到 (memberId, true) 并重拉', async () => {
    const page = await open(HOST_DETAIL());
    api.decideJoin.mockResolvedValue({ memberId: 'm1', status: 'approved' });

    await page.onDecide({ currentTarget: { dataset: { id: 'm1', approve: true } } });

    expect(api.decideJoin).toHaveBeenCalledTimes(1);
    expect(api.decideJoin).toHaveBeenCalledWith('m1', true);
    expect(api.getWalk).toHaveBeenCalledTimes(2);
  });

  test('婉拒 —— api.decideJoin 收到 (memberId, false)', async () => {
    const page = await open(HOST_DETAIL());
    api.decideJoin.mockResolvedValue({ memberId: 'm1', status: 'rejected' });

    await page.onDecide({ currentTarget: { dataset: { id: 'm1', approve: false } } });

    expect(api.decideJoin).toHaveBeenCalledWith('m1', false);
  });

  test('WALK_FULL —— 给人话提示,不抛', async () => {
    const page = await open(HOST_DETAIL());
    api.decideJoin.mockRejectedValue(apiError('WALK_FULL', 'WALK_FULL'));

    await expect(
      page.onDecide({ currentTarget: { dataset: { id: 'm1', approve: true } } })
    ).resolves.toBeUndefined();

    expect(page.data.errMsg).toContain('狗数已满');
    expect(page.data.errMsg).toContain('重新发起');
  });

  test('取消约遛 —— 先确认再调 cancelWalk,然后重拉', async () => {
    const page = await open(HOST_DETAIL());
    api.cancelWalk.mockResolvedValue({ cancelled: true });
    api.getWalk.mockResolvedValue(
      detail({ walk: summary({ myStatus: 'host', isHost: true, status: 'cancelled' }) })
    );

    await page.onCancelWalk();

    expect(wxCalls(page, 'showModal')).toHaveLength(1);
    expect(api.cancelWalk).toHaveBeenCalledWith('w1');
    expect(page.data.readonly).toBe(true);
  });

  test('host 不能 leave', async () => {
    const page = await open(HOST_DETAIL());

    expect(page.data.canLeave).toBe(false);
    expect(page.data.canCancelJoin).toBe(false);
  });
});

describe('约遛详情 —— 合拍度(B12 ③)', () => {
  test('fearsBig 的我方狗 + large 的 host 狗 —— compatHints 非空', async () => {
    const page = await open(
      detail({
        walk: summary({
          myStatus: 'approved',
          hostDogs: [card({ dogId: 'h1', name: '旺财', sizeClass: 'large', tags: [] })],
        }),
        members: [
          member({
            memberId: 'm1',
            status: 'approved',
            isMe: true,
            dogs: [card({ dogId: 'md1', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })],
          }),
        ],
        myDogs: [card({ dogId: 'md1', name: '豆豆', sizeClass: 'small', tags: ['fearsBig'] })],
      })
    );

    expect(page.data.compatHints.length).toBeGreaterThan(0);
    expect(page.data.compatHints.some((h) => h.level === 'warn')).toBe(true);
    expect(page.data.compatHints.some((h) => h.text.indexOf('豆豆') >= 0)).toBe(true);
    expect(page.data.hasWarnHint).toBe(true);
  });

  test('别人家已批准的狗也算进合拍度,自己那条不算两遍', async () => {
    const page = await open(
      detail({
        walk: summary({ myStatus: 'approved', hostDogs: [card({ dogId: 'h1', name: '安安', tags: ['calm'] })] }),
        members: [
          member({ memberId: 'm1', status: 'approved', isMe: true, dogs: [card({ dogId: 'md1', name: '闪电' })] }),
          member({
            memberId: 'm2',
            status: 'approved',
            isMe: false,
            dogs: [card({ dogId: 'd8', name: '可乐', tags: ['foodGuard'] })],
          }),
          member({
            memberId: 'm3',
            status: 'pending',
            isMe: false,
            dogs: [card({ dogId: 'd7', name: '小黑', tags: ['shy'] })],
          }),
        ],
        myDogs: [card({ dogId: 'md1', name: '闪电', tags: ['chaser'] })],
      })
    );

    const texts = page.data.compatHints.map((h) => h.text).join('|');
    expect(texts).toContain('可乐'); // approved 的别人家狗算
    expect(texts).toContain('安安'); // host 的狗算
    expect(texts).not.toContain('小黑'); // pending 的不算
  });

  test('双方都是没标签的同体型 —— compatHints 为空', async () => {
    const page = await open(
      detail({
        walk: summary({ myStatus: 'none', hostDogs: [card({ dogId: 'h1', name: '旺财', sizeClass: 'medium' })] }),
        myDogs: [card({ dogId: 'md1', name: '豆豆', sizeClass: 'medium' })],
      })
    );

    expect(page.data.compatHints).toEqual([]);
    expect(page.data.hasWarnHint).toBe(false);
  });
});

describe('约遛详情 —— 留言(B12)', () => {
  const APPROVED = () =>
    detail({
      walk: summary({ myStatus: 'approved' }),
      members: [member({ status: 'approved', isMe: true })],
      messages: [message()],
    });

  test('发送 —— postMessage 收到 (walkId, text),发完清空草稿并重拉', async () => {
    const page = await open(APPROVED());
    api.postMessage.mockResolvedValue({ messageId: 'g2' });

    page.onDraftInput({ detail: { value: '我带球了' } });
    await page.onSend();

    expect(api.postMessage).toHaveBeenCalledWith('w1', '我带球了');
    expect(page.data.draft).toBe('');
    expect(api.getWalk).toHaveBeenCalledTimes(2);
    expect(page.data.submitting).toBe(false);
  });

  test('空白草稿不发', async () => {
    const page = await open(APPROVED());

    page.onDraftInput({ detail: { value: '   ' } });
    await page.onSend();

    expect(api.postMessage).not.toHaveBeenCalled();
  });

  test('超过 MESSAGE_MAX 本地拦下', async () => {
    const page = await open(APPROVED());

    page.onDraftInput({ detail: { value: '汪'.repeat(LIMITS.MESSAGE_MAX + 1) } });
    await page.onSend();

    expect(api.postMessage).not.toHaveBeenCalled();
    expect(page.data.errMsg).not.toBe('');
  });

  test('postMessage 报 CONTENT_RISKY —— errMsg 非空且不抛', async () => {
    const page = await open(APPROVED());
    api.postMessage.mockRejectedValue(apiError('CONTENT_RISKY', 'text'));

    page.onDraftInput({ detail: { value: '试试' } });
    await expect(page.onSend()).resolves.toBeUndefined();

    expect(page.data.errMsg).not.toBe('');
  });

  test('非成员但已有留言(理论上取不到)—— 留言区仍按 messages 非空渲染', async () => {
    const page = await open(detail({ walk: summary({ myStatus: 'none' }), messages: [message()] }));

    expect(page.data.showMessages).toBe(true);
    expect(page.data.canSend).toBe(false);
  });
});

describe('约遛详情 —— 已取消(B12 ④)', () => {
  test('walk.status:cancelled —— data.readonly === true,所有操作关掉', async () => {
    const page = await open(
      detail({
        walk: summary({ status: 'cancelled', myStatus: 'approved' }),
        members: [member({ status: 'approved', isMe: true })],
        messages: [message()],
      })
    );

    expect(page.data.readonly).toBe(true);
    expect(page.data.cancelledText).not.toBe('');
    expect(page.data.canJoin).toBe(false);
    expect(page.data.canLeave).toBe(false);
    expect(page.data.canSend).toBe(false);
    expect(page.data.canCancelWalk).toBe(false);
    expect(page.data.canCancelJoin).toBe(false);
  });

  test('已取消时 host 也没有操作按钮', async () => {
    const page = await open(
      detail({ walk: summary({ status: 'cancelled', myStatus: 'host', isHost: true }), members: [member()] })
    );

    expect(page.data.readonly).toBe(true);
    expect(page.data.canCancelWalk).toBe(false);
    expect(page.data.canDecide).toBe(false);
  });

  test('已取消时点申请也不动 api', async () => {
    const page = await open(detail({ walk: summary({ status: 'cancelled', myStatus: 'none' }) }));

    page.onTapJoin();
    await page.onConfirmJoin();

    expect(api.joinWalk).not.toHaveBeenCalled();
  });
});
