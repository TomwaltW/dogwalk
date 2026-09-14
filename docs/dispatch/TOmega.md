# TΩ — 集成与合流

## 1. 工作区命令

TΩ 有自己的 worktree,claude-fleet 会把你直接扔进去。**不要在主仓 `~/dogwalk` 上直接合**
—— 总管的会话还占着那边,合坏了也没法整条丢弃。

| | |
|---|---|
| 路径 | `~/dogwalk/.worktrees/task-tomega` |
| 分支 | `task-tomega`(从主干 `51731a3` 起) |
| 要合的五条 | `task-t1` `task-t2` `task-t3` `task-t4` `task-t5`,都已完工、工作区干净 |
| 依赖 | `node_modules` 已装好 |

开场自检(四条都对上再动手,对不上先停下报告):

```bash
pwd                     # 期望: /Users/shensikai/dogwalk/.worktrees/task-tomega
git log --oneline -1    # 期望: 51731a3 fix(T0): fakes 自测别把「此刻是空骨架」写成永久断言
git status --short      # 期望: 无输出(工作区 clean)
npm test                # 期望末尾: Tests: 29 passed, 29 total   退出码 0
```

**合流顺序 T1 → T2 → T3 → T4 → T5,总管已经完整探路跑过一遍,五轨零冲突。**
每合一条立刻跑一次 `npm test`,实测的落点是:

| 合入 | `npm test` 期望 |
|---|---|
| task-t1 | `Tests: 80 passed, 80 total` |
| task-t2 | `Tests: 152 passed, 152 total` |
| task-t3 | `Tests: 1 todo, 196 passed, 197 total` |
| task-t4 | `Tests: 1 todo, 229 passed, 230 total` |
| task-t5 | `Tests: 1 todo, 281 passed, 282 total` |

对不上就停下来查,**不要往下合**。这五个数是探路时实跑复现的,不是估的。

## 2. 先读

`docs/dev-spec-2026-09-14.md`,**全文**。TΩ 是唯一需要通读的任务。尤其:

- 第 2 节验收标准(全节,A1-A3 / B1-B8 / C1-C2 全都是你的)
- 3.5 归属表 —— 合流时用它判断谁碰了不该碰的文件
- 第 7 节「卡住了怎么办」
- 第 8 节「本轮之外」—— 里面的事**不要做**,那是总管自己的活

另外读五份派工包 `docs/dispatch/T{1,2,3,4,5}.md`,看每条轨被告知了什么,
特别是 T3.md 实现要点第 1 条那个契约缺口的结论。

## 3. 目标

把 T1-T5 五条轨合进 main,让 SPEC 第 2 节的 A / B / C 全部命令一次跑通。

## 4. 可写文件白名单

- `**`

TΩ 是唯一可写全仓的任务。但**契约文件仍然一行不许改** —— 见下面禁改清单第一条,
C2 是 TΩ 自己也要过的验收。

## 5. 禁改清单

- **`docs/dev-spec-2026-09-14.md`** —— SPEC 冻结。发现它有错 → 停下来报告,不要改。
- **C2 覆盖的五个路径:`docs/`、`cloudfunctions/_shared/`、`tests/fakes/`、`miniprogram/api/`、`miniprogram/app.json`** —— 合流后 `git diff baseline` 对这五个路径必须为空。某条轨如果改了它们,是那条轨的失败,退回去让它改,**不要在合流时替它抹平**。
- `docs/dispatch/**` —— 派工包是 G 的产出,只读。
- 其余全仓可写,但只在「合流必需」的范围内动手:解冲突、补接线、修跨轨不一致。
  **不要顺手重构、不要顺手改别人的实现风格。**

## 6. 实现要点

1. **先验 C2 再验 B。** 每合进一条轨,立刻跑一次 C2;契约文件被动过的话,后面所有 B 的结果都不可信。
2. **C1 的基准是 29**(baseline 上 `tests/fakes/fakes.test.js` 的通过数)。合流后总数只能涨不能跌;
   跌了说明有轨把别人的测试改红了或删了。
3. `tests/pages/checkin.test.js`(T4)和 `tests/cloud/checkin.test.js`(T2)是两个不同文件,
   合流时别被文件名骗了合成一个。
4. **`ownerContact` 的契约缺口已经从 T3 的范围里切出去了,你会在合流后看到两处痕迹:**
   `cloudfunctions/scanTag/core.js` 里一个 `resolveOwnerContact()` 返回 `null` 的接缝函数,
   和 `tests/cloud/scanTag.test.js` 里一条 `test.todo('lostMode 时 ownerContact 的取值 ...')`。
   这是**预期状态,不是 T3 没做完** —— 门控逻辑(`lostMode ? resolve(...) : null`)是测过的,
   缺的只是来源字段。所以:`npm test` 的末行会带一条 `todo`(形如 `Tests: 1 todo, N passed, M total`),
   退出码仍是 0,**这不算 A3 失败**。
   **不要删掉那条 todo 刷绿,不要自己给 `ownerContact` 编一个来源。**
   总管补完契约后,改 `resolveOwnerContact` 一个函数体 + 把 todo 换成真用例即可。
5. **C2 的原命令现在会有输出,但那不是五条轨干的 —— 别退回给它们。**
   `git diff --name-only baseline -- docs/ ...` 会列出 7 个文件:`docs/dispatch/*.md` 六份
   (总管 G 轨加的派工包,C2 扫的是整个 `docs/`)和 `tests/fakes/fakes.test.js`
   (总管修的,见下一条)。**五条轨各自相对 baseline 的契约 diff 全是空的,已逐轨验过。**
   所以 C2 按第 7 节拆成 C2-a / C2-b 两条验,别照原命令一把梭。
6. **`tests/fakes/fakes.test.js` 已经由总管修过一次,那个修复就在你的 base 里,不要再动它。**
   T0 原先写了两条把「此刻还是空骨架」固化成永久断言的用例(`core` 必须 reject
   `NOT_IMPLEMENTED`、首页 `data` 必须 `toEqual({})`),T1-T4 一实现就必然红,而它们
   无权改 `tests/fakes/**`。现已改成与实现进度无关的形式。合流后这两条应该是绿的;
   要是还红,说明合流出了别的问题,查合流不要改这个文件。
7. 云函数的 `_shared` 路径差异由 `scripts/deploy-shared.js` 负责(默认产出到 `dist/`,不改仓库源文件)。
   合流后跑一次 `node scripts/deploy-shared.js` 确认八个函数都能打出包,**但不要部署**
   —— 云环境联调不在本轮范围(SPEC 第 1 节)。
8. 真机 UI、WXML 渲染、云环境联调一律**不在**验收范围(SPEC 第 1 节),由总管在 TΩ 之后人工回归。

## 7. 逐条验收命令

下面每条的「期望」都是总管探路时**实跑复现过**的数字,不是估的。对不上就是合流出了问题。

### 能跑

| # | 命令 | 期望输出 |
|---|---|---|
| A1 | `npm install` | 退出码 0 |
| A2 | `npm run lint` | 退出码 0,输出中无 `error` |
| A3 | `npm test` | 退出码 0,末行 `Tests: 1 todo, 281 passed, 282 total`;那一条 `todo` 是预期的,见实现要点第 4 条 |

### 行为正确

| # | 命令 | 期望输出 |
|---|---|---|
| B1 | `npm test -- tests/cloud/login.test.js` | `Tests: 13 passed, 13 total`。覆盖:首次调用创建 users 文档;二次调用不重复创建、返回同一 `_openid`;未带 openid 返回 `{ok:false, code:'AUTH_REQUIRED'}` |
| B2 | `npm test -- tests/cloud/dogCRUD.test.js` | `Tests: 23 passed, 23 total`。覆盖:create 返回带 `_id` 的 dog;update 他人的狗返回 `code:'FORBIDDEN'`;`sizeClass` 非法值返回 `code:'INVALID_PARAM'` |
| B3 | `npm test -- tests/cloud/checkin.test.js` | `Tests: 27 passed, 27 total`。覆盖:`expireAt - startAt === 90*60*1000`;同点位重复广播返回 `code:'CONFLICT'` |
| B4 | `npm test -- tests/cloud/spotBoard.test.js` | `Tests: 19 passed, 19 total`。覆盖:只返回 `expireAt > now` 且 `status==='active'` 的广播;过期的不出现;无广播返回空数组 |
| B5 | `npm test -- tests/cloud/scanTag.test.js` | `Tests: 1 todo, 10 passed, 11 total`。覆盖:非走失 `ownerContact` 为 `null`;走失态走到门控分支;写入一条 scanLogs;游客态 `scannerOpenid` 为 `''`。那条 todo 见实现要点第 4 条 |
| B6 | `npm test -- tests/pages/index.test.js` | `Tests: 8 passed, 8 total`。覆盖:`onLoad` 后 `data.spots` 长度等于 mock 返回数;api 抛错时 `data.errMsg` 非空且不抛异常 |
| B7 | `npm test -- tests/pages/dog-profile.test.js` | `Tests: 15 passed, 15 total`。覆盖:游客态正常渲染,`data.dog` 有值,不跳转登录 |
| B8 | `npm test -- tests/logic/presence.test.js` | `Tests: 16 passed, 16 total`。覆盖:`aggregateBoard()` 合并同一用户多只狗;`isActive()` 对恰好等于 `expireAt` 返回 `false` |

### 没弄坏已有

| # | 命令 | 期望输出 |
|---|---|---|
| C1 | `npm test` | 通过数 281 ≥ 29(基线值),且不低于五条轨各自回执里报的数 |
| C2-a | `for n in 1 2 3 4 5; do git diff --name-only baseline task-t$n -- docs/ cloudfunctions/_shared/ tests/fakes/ miniprogram/api/ miniprogram/app.json; done` | **输出为空**。这是 C2 的本意 —— 五条轨谁都没碰契约文件。红了就是那条轨的失败,退回去让它改,**不要在合流时替它抹平** |
| C2-b | `git diff --name-only baseline -- docs/ cloudfunctions/_shared/ tests/fakes/ miniprogram/api/ miniprogram/app.json` | 恰好 7 行,且只能是 `docs/dispatch/` 下六份派工包 + `tests/fakes/fakes.test.js`。**出现 `cloudfunctions/_shared/`、`miniprogram/api/`、`miniprogram/app.json` 里任何一个就是出事了**,见实现要点第 5、6 条 |

### 派工包一致性 / 打包

| # | 命令 | 期望输出 |
|---|---|---|
| D1 | `node scripts/check-dispatch.js` | 退出码 0,末行 `DISPATCH-CHECK pass tasks=6 conflicts=0` |
| D2 | `node scripts/deploy-shared.js` | 退出码 0,八个云函数都打出包到 `dist/cloudfunctions/`;**不要部署** |

十六条全绿才算完。

## 8. 回执格式

最后一行严格按这个格式:

```
RECEIPT TOmega status=<done|blocked> commit=<短hash> checks=<通过数>/16 files=<改动文件数>
```

回执正文必须含:上面十六条命令的**实际输出**(不是「通过了」,是真实输出)、
`git log --oneline baseline..HEAD` 的完整合流历史、`git show --stat HEAD` 的文件树。
任何一条轨被退回重做的,在正文里写清楚是哪条、因为什么。

## 9. 提交方式

先写测试并提交一次(commit message 前缀 `test:`),再写实现提交一次(前缀 `feat:`)。中途断了从上一个 commit 续,不要重开 worktree。

合流场景下这条的落法:每条轨先 merge 进来单独一个 commit(前缀 `merge:`),
接线和修复再单独提交(前缀 `fix:`),**不要把五条轨压成一个大 commit** —— 出问题没法二分。

## 10. 完成后

**不要自己把 main 指过去。** 你在 `task-tomega` 分支上,验收全绿之后停在那里,
把回执贴回给总管,由总管决定什么时候 `git checkout main && git merge --ff-only task-tomega`。
五个 `task-t*` worktree 也**不要删**,等总管确认后统一清。

把回执贴回给总管。真机回归、云环境联调、订阅消息模板申请、狗牌印刷都是 SPEC 第 8 节里
总管自己的活,**不要碰**。

卡住了按 SPEC 第 7 节处理。合流阶段最常见的两种卡点:
① 两条轨对同一个契约字段理解不一致 → 以 SPEC 第 3 节为准,都不对就停下来报告;
② 某条轨的验收本身写错了 → 以 SPEC 第 2 / 6 节为准,退回那条轨改。
