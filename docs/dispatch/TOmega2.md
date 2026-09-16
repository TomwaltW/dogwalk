# TΩ2 — 集成与合流(第二轮)

## 1. 工作区命令

TΩ2 有自己的 worktree,claude-fleet 会把你直接扔进去。**不要在主仓 `~/Documents/dogwalk` 上直接合**
—— 总管的会话还占着那边,合坏了也没法整条丢弃。

| | |
|---|---|
| 路径 | `~/Documents/dogwalk/.worktrees/task-tomega2` |
| 分支 | `task-tomega2`(从 `357f9bc` = tag `baseline-r2` 起) |
| 要合的六条 | `task-t6` `task-t7` `task-t8` `task-t9` `task-t10` `task-t11`,总管确认都已完工、工作区干净后才会开你这一窗 |
| 依赖 | `node_modules` 已装好 |

开场自检(五条都对上再动手,对不上先停下报告):

```bash
pwd                     # 期望: /Users/shensikai/Documents/dogwalk/.worktrees/task-tomega2
git log --oneline -1    # 期望: 357f9bc G: 第二轮 T0' —— 冻结契约 v2(公园签到/约遛/寻回)与骨架
git status --short      # 期望: 无输出(工作区 clean)
npm test                # 期望末尾: Tests: 1 todo, 203 passed, 204 total   退出码 0
for b in task-t6 task-t7 task-t8 task-t9 task-t10 task-t11; do git log --oneline -1 $b; done   # 六条都在,且都不是 357f9bc(各轨至少提交过)
```

**合流顺序 T6 → T7 → T11 → T8 → T9 → T10(先后端后页面)。** 每合一条立刻跑一次 `npm test` + C2,
红了就停在那条上查,**不要往下合**。六条轨的可写范围两两不相交(`node scripts/check-dispatch.js` 验过),
理论上零冲突;真冲突了先怀疑是哪条轨越界改了文件(C3),退回那条轨,不要替它抹平。

## 2. 先读

`docs/dev-spec-2026-09-16.md`,**全文**。TΩ2 是唯一需要通读的任务。尤其:

- 第 0 节(第一轮遗留怎么处理)、3.2.4 过渡期保留(合流后由你删)
- 第 2 节验收标准(全节,A / B1-B13 / C1-C3 全都是你的)
- 3.5 归属表 —— 合流时用它判断谁碰了不该碰的文件
- 第 7 节「卡住了怎么办」、第 8 节「本轮之外」(里面的事**不要做**)

另外读六份派工包 `docs/dispatch/T{6,7,8,9,10,11}.md`,看每条轨被告知了什么,以及各轨回执里报的数字。

## 3. 目标

把 T6-T11 六条轨合进 `task-tomega2`,删掉过渡期常量,让 SPEC 第 2 节的 A / B / C 全部命令一次跑通,README 与实际一致。

## 4. 可写文件白名单

- `**`

TΩ2 是唯一可写全仓的任务。但契约文件**只允许做一件事**:删 `contracts.js` 里 3.2.4 的过渡期常量(见实现要点 4)。

## 5. 禁改清单

- **`docs/dev-spec-2026-09-16.md`** —— SPEC 冻结。发现它有错 → 停下来报告,不要改。
- `docs/dispatch/**` —— 派工包是 G 的产出,只读。
- 契约文件(`cloudfunctions/_shared/**`、`tests/fakes/**`、`tests/shared/**`、`miniprogram/api/`、`app.json` 等,C2 那一串)除实现要点 4 那一处外一行不许改。某条轨如果改了它们,是那条轨的失败,退回去让它改。
- 其余全仓可写,但只在「合流必需」的范围内动手:解冲突、补接线、修跨轨不一致。**不要顺手重构、不要顺手改别人的实现风格。**

## 6. 实现要点

1. **先验 C2 / C3 再验 B。** 每合进一条轨,立刻跑 `git diff --name-only baseline-r2 task-tN -- <C2 那串路径>`(应为空)和该轨派工包里的 C3 命令;契约文件被动过的话,后面所有 B 的结果都不可信。
2. **跨轨接缝是页面 mock 与真实现之间的形状。** 页面轨(T8 / T9 / T10)的测试全靠 mock api,后端轨(T6 / T7 / T11)按 spec 写返回。合完之后,对每个视图形状(`DogCard` / `DogPublic` / `ParkSummary` / `ParkBoard` / `WalkSummary` / `WalkDetail` / `FoundReport`)做一次人工对读:后端测试里钉的 key 列表 vs 页面测试里造的 mock 数据 vs spec 3.2.3。三处不一致 → 以 spec 为准,退回不一致的那轨(或者差异只是 mock 多造了一个字段,那就改 mock)。把对读结果写进回执。
3. **`tests/cloud/scanTag.test.js` 里那条 todo 应该已经被 T6 换掉**;合完 T6 后 `npm test` 末行不该再有 `todo`。还有就退回 T6。
4. **删过渡期常量(合完六条、全绿之后做):** `cloudfunctions/_shared/contracts.js` 删 `PLAY_STYLE` / `TEMPERAMENT` / `COLL_DEPRECATED` 三个导出及其注释块;然后
   `grep -rn "PLAY_STYLE\|TEMPERAMENT\|COLL_DEPRECATED\|ownerContact\|okWithSmallDogs\|socialOk\|followSpotIds\|resolveOwnerContact" cloudfunctions miniprogram tests --include=*.js` 必须为空。有残留说明某轨没清干净,退回那轨(页面 wxml 里也 grep 一遍)。这是 TΩ2 对契约文件唯一允许的改动,单独一个 `chore:` commit。
5. **`node scripts/deploy-shared.js`** 十二个函数都打出包,`dist/cloudfunctions/*/index.js` 与 `core.js` 里不再有 `'../_shared/'`(`grep -rn "\.\./_shared" dist/ ` 为空)。**不要部署**。
6. **README 对读:** `README.md` 「手动验证清单」里的页面路径、`initParks/seed.js` 的存在、订阅消息 `TEMPLATE_FIELDS` 常量的位置(`cloudfunctions/reportFound/core.js`)——逐条确认真实存在;不一致就改 README(README 是 G 的文件,但这一项授权你改)。
7. `miniprogram/app.json` 的十个页面四件套都齐(`js / wxml / wxss / json`),每个 wxml 末尾都有 `<privacy-popup id="privacy-popup" />`;`tests/fakes/fakes.test.js` 的「十个页面全部加载得起来」和「index.js 都是固定模板」两条必须绿。
8. 真机 UI、`<map>` 渲染、云环境联调、订阅消息真发一律**不在**验收范围(SPEC 第 1 节),由总管在你之后人工回归。

## 7. 逐条验收命令

下面每条的「期望」里,基线数字是总管实跑复现过的;合流后的总数由六条轨的回执相加而来,你要在回执里把各轨报的数和你合完的数摆在一起对。

### 能跑

| # | 命令 | 期望输出 |
|---|---|---|
| A1 | `npm install` | 退出码 0 |
| A2 | `npm run lint` | 退出码 0,输出中无 `error` |
| A3 | `npm test` | 退出码 0,末行 `Tests: N passed, N total`,**不含 todo** |

### 行为正确(全部 13 条,命令与覆盖要求原样抄 SPEC 2.2)

| # | 命令 |
|---|---|
| B1 | `npm test -- tests/cloud/dogCRUD.test.js` |
| B2 | `npm test -- tests/cloud/scanTag.test.js` |
| B3 | `npm test -- tests/cloud/reportFound.test.js` |
| B4 | `npm test -- tests/cloud/initParks.test.js` |
| B5 | `npm test -- tests/cloud/checkin.test.js` |
| B6 | `npm test -- tests/cloud/parkBoard.test.js` |
| B7 | `npm test -- tests/cloud/walkOps.test.js` |
| B8 | `npm test -- tests/pages/index.test.js` |
| B9 | `npm test -- tests/pages/checkin.test.js` |
| B10 | `npm test -- tests/pages/dog-profile.test.js` |
| B11 | `npm test -- tests/pages/dog-tag.test.js` |
| B12 | `npm test -- tests/pages/walk-detail.test.js` |
| B13 | `npm test -- tests/logic/compat.test.js` |

每条全绿,且 SPEC 2.2 里写的覆盖点能在用例名里看出来。

### 没弄坏已有

| # | 命令 | 期望输出 |
|---|---|---|
| C1 | `npm test` | 全绿;通过数 ≥ 六条轨回执里报的数之和 − 203(基线)的合理范围内,明显对不上就查是谁的测试被合没了 |
| C2-a | `for n in 6 7 8 9 10 11; do git diff --name-only baseline-r2 task-t$n -- docs/ cloudfunctions/_shared/ tests/fakes/ tests/shared/ miniprogram/api/ miniprogram/app.json miniprogram/app.js miniprogram/app.wxss miniprogram/config.js miniprogram/components/ miniprogram/logic/enums.js miniprogram/logic/host.js scripts/ database/ package.json jest.config.js .eslintrc.js project.config.json; done` | **输出为空**(六条轨谁都没碰契约文件;红了退回那条轨) |
| C2-b | `git diff --name-only baseline-r2 HEAD -- cloudfunctions/_shared/ tests/fakes/ tests/shared/ miniprogram/api/ miniprogram/app.json miniprogram/app.js miniprogram/app.wxss miniprogram/config.js miniprogram/components/ miniprogram/logic/enums.js miniprogram/logic/host.js scripts/ database/ package.json jest.config.js .eslintrc.js project.config.json` | 默认只该有 1 行:`cloudfunctions/_shared/contracts.js`(实现要点 4 那一刀)。**多出来的每一行都要在回执里逐行写明理由**,写不出理由的就是出事了 |
| C3 | 六份派工包各自的 C3 命令,把 `baseline-r2` 换成 `baseline-r2 task-tN` 逐轨跑 | 全部为空 |
| C4 | `git grep -n "PLAY_STYLE\|TEMPERAMENT\|COLL_DEPRECATED\|ownerContact\|okWithSmallDogs\|socialOk\|followSpotIds" -- cloudfunctions miniprogram tests ':!tests/shared/enums.test.js'` | 无匹配(退出码 1) |

### 派工包一致性 / 打包 / 文档

| # | 命令 | 期望输出 |
|---|---|---|
| D1 | `node scripts/check-dispatch.js` | 退出码 0,末行 `DISPATCH-CHECK pass tasks=7 conflicts=0` |
| D2 | `node scripts/deploy-shared.js && grep -rn "require('\.\./_shared" dist/cloudfunctions --include=*.js \| grep -vE ':[[:space:]]*(\*\|//)' \| wc -l` | 十二个函数都打出包;`wc -l` 为 0;**不要部署** |
| D3 | `node -e "const p=require('./miniprogram/app.json').pages;const fs=require('fs');p.forEach(x=>['js','wxml','wxss','json'].forEach(e=>fs.accessSync('miniprogram/'+x+'.'+e)));console.log(p.length)" && grep -L "privacy-popup" miniprogram/pages/*/*.wxml miniprogram/pages/*/*/*.wxml` | 打印 `10`,`grep -L` 无输出 |

二十四条全绿才算完(A 3 + B 13 + C 5 + D 3)。

> **判据勘误(2026-09-16,执行完之后改的)** —— C2-b / C4 / D2 三条原先写错了,不是活干错了。
> 改动本身是把判据改准,不是为了凑绿;三条修正版都实跑验证过,D2 还做了反向验证
> (故意注入一个真 `require('../_shared/...')`,判据抓得住;重打包后归零)。
>
> | 条目 | 原先怎么错的 | 怎么改的 |
> |---|---|---|
> | C2-b | 路径表里带了 `docs/`,而 `baseline-r2` 打在 T0'(`357f9bc`)、七份派工包是下一个 commit(`7179173`)才加的 —— 派单天然落在 tag 之后,必然被算成「改了契约」 | 路径表去掉 `docs/`;期望从「恰好 1 行」改成「默认 1 行,多出来的逐行说明理由」。**根因修法在下轮:把 baseline tag 打在派工包提交之后**,就不会有这个偏差 |
> | C4 | 按常量名 grep 会命中 `tests/shared/enums.test.js` 里 `expect(enums.PLAY_STYLE).toBeUndefined()` —— 那正是断言常量**不存在**的用例。只要这条(正确的)测试还在,判据永远不可能为空 | 换成 `git grep` 并用 pathspec `':!tests/shared/enums.test.js'` 排除那一个契约自测文件。注意 T6 的 C4、T9 的 T9-c 没有这个毛病(它们各自限定了扫描范围),不用改 |
> | D2 | `grep "\.\./_shared"` 连注释一起匹配:`_shared/runtime.js` 第 8 行的 JSDoc 里印着 index.js 模板原文,各文件头注释也写了这条约定 —— 37 行全是注释,一个真 require 都没有 | 只匹配 `require('../_shared`,再滤掉行首是 `*` 或 `//` 的注释行 |

## 8. 回执格式

最后一行严格按这个格式:

```
RECEIPT TOmega2 status=<done|blocked> commit=<短hash> checks=<通过数>/24 files=<改动文件数>
```

回执正文必须含:上面每条命令的**实际输出**(不是「通过了」,是真实输出)、`git log --oneline baseline-r2..HEAD` 的完整合流历史、`git show --stat HEAD` 的文件树、实现要点 2 的形状对读结果。任何一条轨被退回重做的,写清楚是哪条、因为什么。

## 9. 提交方式

每条轨先 merge 进来单独一个 commit(前缀 `merge:`),接线和修复再单独提交(前缀 `fix:`),删过渡常量单独一个(前缀 `chore:`),README 对读修改单独一个(前缀 `docs:`)。**不要把六条轨压成一个大 commit** —— 出问题没法二分。中途断了从上一个 commit 续,不要重开 worktree。

## 10. 完成后

**不要自己把 main 指过去。** 你在 `task-tomega2` 分支上,验收全绿之后停在那里,把回执贴回给总管,由总管决定什么时候 `git merge task-tomega2`。六个 `task-t*` worktree 也**不要删**,等总管确认后统一清。

真机回归、云环境配置、订阅消息模板申请、身份牌印刷都是 SPEC 第 8 节里总管自己的活,**不要碰**。

卡住了按 SPEC 第 7 节处理。合流阶段最常见的两种卡点:
① 页面轨的 mock 形状与后端轨的返回形状不一致 → 以 SPEC 3.2.3 为准,退回不一致的那轨;
② 某条轨的验收本身写错了 → 以 SPEC 第 2 / 6 节为准,退回那条轨改。
