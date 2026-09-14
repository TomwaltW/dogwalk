# TΩ — 集成与合流

## 1. 工作区命令

TΩ 在主干上做,**不开新 worktree**(T1-T5 的五个 worktree 已经建好,你要合的就是它们):

```bash
cd ~/dogwalk && git checkout main && npm install
```

本仓没有 remote,不用 pull。

开场自检(四条都对上再动手,对不上先停下报告):

```bash
git worktree list       # 期望: 主仓 + .worktrees/task-t1 .. task-t5 共 6 行
git log --oneline -1    # 期望: 主干在 G 的提交上(派工包与校验脚本)
npm test                # 期望末尾: Tests: 29 passed, 29 total(合流前的起点)
node scripts/check-dispatch.js   # 期望末行: DISPATCH-CHECK pass tasks=6 conflicts=0
```

五条轨各自的分支名就是 `task-t1` .. `task-t5`,基线都钉在 `00e2c96`(= tag `baseline`)。

合流顺序建议按依赖从浅到深:T1 → T2 → T3 → T4 → T5。每合一条立刻跑一次 `npm test`,
**红了就地解决,不要攒到最后**。

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
4. T3 的 B5 有一个**契约缺口**(`ownerContact` 在 3.2 的 users / dogs 字段表里没有来源字段)。
   如果总管还没补契约,B5 的 `lostMode` 分支会是 blocked —— 这时 TΩ 的「全部 B」也过不了,
   **照实报 blocked,不要自己给 `ownerContact` 编一个来源把测试刷绿**。
5. 云函数的 `_shared` 路径差异由 `scripts/deploy-shared.js` 负责(默认产出到 `dist/`,不改仓库源文件)。
   合流后跑一次 `node scripts/deploy-shared.js` 确认八个函数都能打出包,**但不要部署**
   —— 云环境联调不在本轮范围(SPEC 第 1 节)。
6. 真机 UI、WXML 渲染、云环境联调一律**不在**验收范围(SPEC 第 1 节),由总管在 TΩ 之后人工回归。

## 7. 逐条验收命令

### 能跑

| # | 命令 | 期望输出 |
|---|---|---|
| A1 | `npm install` | 退出码 0 |
| A2 | `npm run lint` | 退出码 0,输出中无 `error` |
| A3 | `npm test` | 退出码 0,末行形如 `Tests: N passed, N total` |

### 行为正确

| # | 命令 | 期望输出 |
|---|---|---|
| B1 | `npm test -- tests/cloud/login.test.js` | 全绿:首次调用创建 users 文档;二次调用不重复创建、返回同一 `_openid`;未带 openid 时返回 `{ok:false, code:'AUTH_REQUIRED'}` |
| B2 | `npm test -- tests/cloud/dogCRUD.test.js` | 全绿:create 返回带 `_id` 的 dog;update 他人的狗返回 `code:'FORBIDDEN'`;`sizeClass` 非法值返回 `code:'INVALID_PARAM'` |
| B3 | `npm test -- tests/cloud/checkin.test.js` | 全绿:`expireAt - startAt === 90*60*1000`;同点位重复广播返回 `code:'CONFLICT'` |
| B4 | `npm test -- tests/cloud/spotBoard.test.js` | 全绿:只返回 `expireAt > now` 且 `status==='active'` 的广播;过期的不出现;无广播返回空数组 |
| B5 | `npm test -- tests/cloud/scanTag.test.js` | 全绿:非走失返回公开档案不含联系方式;`lostMode:true` 时含 `ownerContact`;写入一条 scanLogs。**见实现要点第 4 条** |
| B6 | `npm test -- tests/pages/index.test.js` | 全绿:`onLoad` 后 `data.spots` 长度等于 mock 返回数;api 抛错时 `data.errMsg` 非空且不抛异常 |
| B7 | `npm test -- tests/pages/dog-profile.test.js` | 全绿:游客态正常渲染,`data.dog` 有值,不跳转登录 |
| B8 | `npm test -- tests/logic/presence.test.js` | 全绿:`aggregateBoard()` 合并同一用户多只狗;`isActive()` 对恰好等于 `expireAt` 返回 `false` |

### 没弄坏已有

| # | 命令 | 期望输出 |
|---|---|---|
| C1 | `npm test` | 通过数 ≥ 29,且 ≥ 五条轨各自回执里报的通过数之和减去重复计数 |
| C2 | `git diff --name-only baseline -- docs/ cloudfunctions/_shared/ tests/fakes/ miniprogram/api/ miniprogram/app.json` | 输出为空 |

### 派工包一致性

| # | 命令 | 期望输出 |
|---|---|---|
| D1 | `node scripts/check-dispatch.js` | 退出码 0,末行 `DISPATCH-CHECK pass tasks=6 conflicts=0` |

十四条全绿才算完。

## 8. 回执格式

最后一行严格按这个格式:

```
RECEIPT TOmega status=<done|blocked> commit=<短hash> checks=<通过数>/14 files=<改动文件数>
```

回执正文必须含:上面十四条命令的**实际输出**(不是「通过了」,是真实输出)、
`git log --oneline baseline..HEAD` 的完整合流历史、`git show --stat HEAD` 的文件树。
任何一条轨被退回重做的,在正文里写清楚是哪条、因为什么。

## 9. 提交方式

先写测试并提交一次(commit message 前缀 `test:`),再写实现提交一次(前缀 `feat:`)。中途断了从上一个 commit 续,不要重开 worktree。

合流场景下这条的落法:每条轨先 merge 进来单独一个 commit(前缀 `merge:`),
接线和修复再单独提交(前缀 `fix:`),**不要把五条轨压成一个大 commit** —— 出问题没法二分。

## 10. 完成后

把回执贴回给总管。真机回归、云环境联调、订阅消息模板申请、狗牌印刷都是 SPEC 第 8 节里
总管自己的活,**不要碰**。

卡住了按 SPEC 第 7 节处理。合流阶段最常见的两种卡点:
① 两条轨对同一个契约字段理解不一致 → 以 SPEC 第 3 节为准,都不对就停下来报告;
② 某条轨的验收本身写错了 → 以 SPEC 第 2 / 6 节为准,退回那条轨改。
