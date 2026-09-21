# 派单 — dogwalk 收尾轮(提交 app.json + 写部署验收清单)

仓库 `/Users/shensikai/Documents/Projects/Dogwalk`(主 checkout，无 worktree 隔离) · 当前 HEAD `fa72ed8` · 派单写成于 **2026-09-21 18:22** · **2026-09-21 18:41 修订过一次(见下)** · **本派单里所有期望值都是在这台机器上实跑取的；开场自检任一条对不上就停下来报告，不要硬跑。**

> **2026-09-21 18:41 修订记录** —— 复核发现 §2B `openapi-permissions` 那条判据写错了事实(把四个函数当成同一套权限，实际四份声明各不相同)，导致 §2 绿路径的期望值永远达不到、§2 反向验证破坏 A 变成恒真判据。本次改的是**判据本身**，不是期望值。受影响并已重取实跑读数的是：§2A(C) 的权限清单、§2B 七项表里 `openapi-permissions` 那一行判据、§2 反向验证(新增 diff 闸门与破坏 A2)。另修了 §1 的提交命令(裸 commit 会卷进别人的暂存区)、§2 引用 README 的行号、§1 的旧文案 grep 读数、「为什么这一轮只有这么点活」那段的分支条数算术。§0、§1 其余期望值与 §3 的读数**未变**，仍是 18:18-18:22 那批，18:41 已逐条复跑确认仍然成立。

## 为什么这一轮只有这么点活

代码这一层已经全做完了：第一、二轮共 13 条 `task-*` 分支(`task-t1`-`task-t11` + `task-tomega` + `task-tomega2`)全部合入 main(`git branch --no-merged main` 输出 0 行)，规格 `docs/dev-spec-2026-09-16.md` 的任务表没有未落地的轨。整个项目卡在**上云**，而上云卡在**只有用户本人能做的微信侧浏览器操作**(注册正式小程序账号拿 AppID、在开发者工具里新建云开发环境拿 ENV_ID)。上云那份派单 `review/paste-cloudbase.md` 已经派给 Codex 了，**不归你**。

所以这一轮只有两件真活(§1 §2)加一件可选清理(§3)。**不要硬凑第四件**，不要去抢 Codex 的活。

⚠️ **Codex 可能正在同一个 checkout 里干活。** 它的第一步就是填 `miniprogram/config.js` 和 `project.config.json`。§0 会检查这两个文件；一旦发现它们变脏或占位符已被填上，说明 Codex 已经开跑 —— **停下来报告，不要 stash、不要 checkout、不要改它们**，那是别人的在制品。

---

## §0 开场自检

逐条跑，**任一条对不上 → 停下来报告，不许继续**。

### 0.1 守卫(本仓无守卫)

```
ls -a /Users/shensikai/Documents/Projects/Dogwalk | grep -E '^(\.claude|CLAUDE\.md)$' ; echo "GUARD_GREP_EXIT=$?"
```

期望：**没有任何输出行**，`GUARD_GREP_EXIT=1`。

**本仓没有任何守卫** —— 没有 `CLAUDE.md`，没有 `.claude/` 目录，没有 hook。全局 `~/.claude/settings.json` 的 deny 只有 `.env*` / `~/.ssh` / `~/.aws` / `git push --force` 四条，defaultMode 是 `bypassPermissions`。也就是说 §X 那些红线**没有任何机器强制，全靠自觉** —— 跑命令前自己对一遍红线。`node scripts/check-dispatch.js` 不是守卫，它只校验 `docs/dispatch/*.md` 那批历史派工包的白名单不互相打架。

### 0.2 HEAD 与工作区

```
cd /Users/shensikai/Documents/Projects/Dogwalk && git log --oneline -1 && git status --porcelain && echo "(status end)" && git worktree list && git stash list | wc -l
```

期望逐字：

- 第一行 `fa72ed8 G: 上云派单第二版 —— 改在微信侧新环境部署,基线 e415293`
- `git status --porcelain` **恰好两行**：
  - ` M miniprogram/app.json`
  - `?? review/paste-0921.md`  ←(就是你正在读的这份派单，它还没入库)
- `git worktree list` 只有一行 `/Users/shensikai/Documents/Projects/Dogwalk  fa72ed8 [main]`
- stash 条数 `0`

**出现第三行脏文件、或 `miniprogram/config.js` / `project.config.json` 出现在列表里 → 停下来报告。**

**这一条会漂 —— 下面这种情况不算对不上：** 如果用户在开你这个窗口之前，已经把本派单单独 `G:` commit 掉了(这个仓库一直是这个习惯，`fa72ed8 G: 上云派单第二版 …` 就是这么来的)，那么 HEAD 不再是 `fa72ed8` 而是它的**直接子代**、message 以 `G:` 开头，`git status --porcelain` 也只剩 ` M miniprogram/app.json` 一行，§1 做完后 `git rev-list --count origin/main..main` 读 **2** 而不是 1。用

```
cd /Users/shensikai/Documents/Projects/Dogwalk && git merge-base --is-ancestor fa72ed8431afcd1e49a4965f6178d173b5d3a8c1 HEAD && echo DESCENDANT_OK
```

确认(期望打印 `DESCENDANT_OK`)。**除此之外的任何偏差都要停下来报告。**

### 0.3 占位符仍未填(确认 Codex 没抢跑)

```
cd /Users/shensikai/Documents/Projects/Dogwalk && grep -c ": '<<" miniprogram/config.js ; grep -c '"<<' project.config.json
```

期望打印 `2` 和 `1`(2026-09-21 18:25 实跑)。

- 模式里的 `: '<<` 是**故意收窄的**：裸 `'<<` 会连 `miniprogram/config.js:29` 的 `v.indexOf('<<')` 一起算进去，打印 `3` 不是 `2` —— 别把模式改回去。收窄后命中的正是第 12 行 `ENV_ID: '<<填云开发环境ID>>',` 和第 20 行 `foundReport: '<<填「寻回留言」订阅消息模板ID>>',`。
- **看打印出来的数字，不要看退出码** —— `grep -c` 在 0 条时 exit 1，拿退出码判会得到反向结论。
- 第一个数字 **< 2**、或第二个数字 **< 1** = Codex 已经填了(哪怕只填了一个)= 停下来报告。

### 0.4 测试实跑(今天的真实读数)

```
cd /Users/shensikai/Documents/Projects/Dogwalk && npm test > /tmp/dw-test.txt 2>&1; echo "TEST_EXIT=$?"; tail -6 /tmp/dw-test.txt
```

期望：`TEST_EXIT=0`，尾部含 `Test Suites: 28 passed, 28 total` 与 `Tests:       535 passed, 535 total`。(耗时约 0.7s，纯 Node，不需要开发者工具 / 云环境 / 网络。)

### 0.5 lint 与派工包校验

```
cd /Users/shensikai/Documents/Projects/Dogwalk && npm run lint > /tmp/dw-lint.txt 2>&1; echo "LINT_EXIT=$?"; cat /tmp/dw-lint.txt; node scripts/check-dispatch.js > /tmp/dw-cd.txt 2>&1; echo "DISPATCH_EXIT=$?"; tail -1 /tmp/dw-cd.txt
```

期望：`LINT_EXIT=0`，`/tmp/dw-lint.txt` 里除 npm 自己那两三行 `>` 开头的前言外**没有 eslint 报错**；`DISPATCH_EXIT=0`，最后一行 `DISPATCH-CHECK pass tasks=7 conflicts=0`。

> 退出码写法：本派单一律 `cmd > /tmp/xxx.txt 2>&1; echo "EXIT=$?"; tail -N /tmp/xxx.txt`。**不要写 `cmd | tail` 再取 `$?`** —— 那取到的是 tail 的退出码，恒为 0。

---

## §1 提交 miniprogram/app.json 那一行改动

**为什么现在做**：这是工作区里唯一一个脏的已跟踪文件，也是本仓当下唯一一件不依赖任何用户浏览器操作就能闭环的代码活；留着不提交，下一个会话会把它当成来历不明的残留而误丢。

### 做什么

用户已拍板：**授权提交**。单独一条**中文** chore commit，**只这一个文件**。

改动内容(`git diff miniprogram/app.json` 已核实)：`permission."scope.userLocation".desc` 从 34 字的「用于校验你是否在公园范围内完成签到,以及路人自愿附带走失狗的发现位置」压到 22 字的「用于公园签到范围校验及自愿提供走失狗发现位置」。微信对 `permission.*.desc` 限 30 字，原文案超限会在开发者工具里拦上传 —— 这是真修复，不是调试残留。两个用途(签到围栏校验、路人自愿提供发现位置)都保住了；**除本派单自身外全仓 0 命中**旧文案，**不需要同步改任何文档**。要复核就跑这条完整命令(2026-09-21 18:41 实跑)：

```
cd /Users/shensikai/Documents/Projects/Dogwalk && grep -rn "校验你是否在公园范围内" --exclude-dir=node_modules --exclude-dir=.git --exclude=paste-0921.md . ; echo "GREP_EXIT=$?"
```

期望：**没有任何输出行**，`GREP_EXIT=1`。**不加 `--exclude=paste-0921.md` 会打印 1 行、`GREP_EXIT=0`**，唯一命中在 `review/paste-0921.md` 自己身上(就是上面这段引用旧文案原文的那一行) —— 那是派单引用自己，不是残留，别当回归报警。判据按「加了 exclude 之后 0 行」来判，别去对派单自身的行号，它会随改动漂。

命令(**必须是带 pathspec 的一条 `git commit`，不许 `git add` + 裸 `git commit`，更不许 `git add -a` / `git add .`**)：

```
cd /Users/shensikai/Documents/Projects/Dogwalk
git diff --cached --name-only
[ -z "$(git diff --cached --name-only)" ] && echo CACHED_CLEAN || echo CACHED_DIRTY
git commit -m "chore: 定位授权说明压到 30 字以内(微信对 permission.desc 限长)" -- miniprogram/app.json
```

**为什么必须带 `-- miniprogram/app.json`**：裸 `git commit` 提交的是**整个暂存区**，不是你刚 `add` 的那一个文件。`git help commit` 的 `<pathspec>` 条目原文：「When \<pathspec\> is given on the command line, commit the contents of the files that match the pathspec **without recording the changes already added to the index**.」(git 2.50.1, Apple Git-155) —— 反过来说，**不给 pathspec 时索引里已有的改动一律进 commit**。本派单开头那条 ⚠️(「Codex 可能正在同一个 checkout 里干活」)已经写明它第一步就是填 `miniprogram/config.js` 和 `project.config.json`；它只要在这个时间窗里 `git add` 过而还没 commit，裸 commit 就会把它的在制品一起卷进你这条 chore commit。而 §X 把 `git reset` 列进了禁令，你事后撤不掉，只能停在一个错的 commit 上。带 pathspec 的写法不管索引里有什么都只提交这一个文件。

上面那条 `git diff --cached --name-only` 是**动手前的确认**：2026-09-21 18:47 实跑**没有任何输出行**、打印 `CACHED_CLEAN`，所以这个风险目前是潜伏的而不是已发生的。**打印 `CACHED_DIRTY` = Codex 的东西已经在索引里了 → 停下来报告**，别自己 `git reset`(禁令)。

(判干净用 `[ -z "$(...)" ]`，别用 `git diff --cached --name-only | wc -l` 去对「0」—— BSD `wc -l` 会把数字**前面补空格**，实际打印的是 `       0` 而不是 `0`，逐字对期望值会假红。同理见下面验收段里 `TRACKED_CLEAN` 那条注。)

**不许 `git push`。** 用户说的是「提交」，不是「推送」。

### 可写文件白名单

- `/Users/shensikai/Documents/Projects/Dogwalk/miniprogram/app.json`(只是提交它，内容一个字符都不要再动)

### 验收命令

```
cd /Users/shensikai/Documents/Projects/Dogwalk
git show --stat --format='%h %s' HEAD > /tmp/dw-show.txt 2>&1; echo "SHOW_EXIT=$?"; cat /tmp/dw-show.txt
[ -z "$(git status --porcelain --untracked-files=no)" ] && echo TRACKED_CLEAN || echo TRACKED_DIRTY
git status --porcelain; echo "(status end)"
git rev-list --count origin/main..main
```

### 期望输出

- `SHOW_EXIT=0`；`git show --stat` 的标题行是新的中文 chore commit，stat 部分**只有 `miniprogram/app.json` 一个文件**，`1 file changed, 1 insertion(+), 1 deletion(-)`。
- `TRACKED_CLEAN`。(注意：**不要用裸 `git status --porcelain` 判干净** —— 它有没有输出都 exit 0，判不出来；上面这条 `[ -z "$(...)" ]` 才判得出。)
- `git status --porcelain` 只剩未跟踪行：`?? review/paste-0921.md`(做完 §2 之后还会多 `?? docs/deploy-acceptance.md`、`?? scripts/check-deploy-ready.js` 和 ` M README.md`)。
- `git rev-list --count origin/main..main` 打印 `1`。

### 会漂的读数

**这一步做完，HEAD 就不再是 `fa72ed8`**，`main` 比 `origin/main` 领先 1 条。§0.2 的 HEAD 期望值从此作废 —— 后面再自检时按「HEAD 是 fa72ed8 的直接后代」判，别再对 `fa72ed8` 这个 sha。

---

## §2 写 `docs/deploy-acceptance.md` + `scripts/check-deploy-ready.js`

**为什么现在做**：Codex 那一轮上云干完之后，用户手上**没有任何东西**能判它到底做成了没有 —— 而失败模式恰好是静默的(openapi 权限漏了不报错、安全规则粘错不报错)。这份清单和脚本在用户去注册小程序账号之前就能写完跑完。

### 仓库现状(已核实)

- `scripts/` 下只有 `check-dispatch.js`、`deploy-shared.js`、`make-marker.js` —— **没有任何部署后验收脚本**。
- `docs/` 下只有规格和派工包 —— **没有任何验收清单**。
- `tests/` 全是纯 Node 单测，一条都不碰云。
- 现存最接近的两处都不够用：`README.md:108-117` 的「手动验证清单」是 7 步人工点操作、只覆盖客户端，且写在云函数部署方案定稿之前；`review/paste-cloudbase.md` 的 §9 是给 Codex 的回执自检，不是给用户验收 Codex 的。

### 2A. `docs/deploy-acceptance.md` —— 三块清单

**(A) 云侧**(逐条给「怎么看」和「看到什么算过」)

- 12 个云函数在新环境上都在。名单(= `cloudfunctions/` 下除 `_shared` 外的 12 个目录)：`checkin`、`checkinCancel`、`dogCRUD`、`foundReports`、`genTagCode`、`initParks`、`login`、`parkBoard`、`reportFound`、`scanTag`、`subscribeGrant`、`walkOps`。
- 9 个集合齐。名单以 `cloudfunctions/_shared/contracts.js:9-19` 的 `COLL` 为准：`users`、`dogs`、`parks`、`checkins`、`walks`、`walk_members`、`messages`、`found_reports`、`scanLogs`。
- `dogs.tagCode` **唯一索引**已建(出处 `database/indexes.md:21`：「dogs | `tagCode` 升序 | **是** | 扫牌查狗;唯一索引兜住短码并发撞码」)。
- 各集合安全规则与 `database/rules/*.json` **逐字一致** —— 9 个文件名与上面 9 个集合一一对应(`scanLogs.json` 是驼峰，别写成 `scan_logs`)。清单里要求把控制台里的规则复制回来跟仓库文件 diff，不要靠眼看。
- `parks` **正好 3 条**，且 `_id` 对得上 `cloudfunctions/initParks/seed.js:13-15`：`park_liulang`(西湖·柳浪闻莺)、`park_yangtai`(钱江新城·城市阳台)、`park_xixi`(西溪湿地·福堤)。
- 并写清：`initParks` **用 CLI 调不动**(需要 openid，上一轮实测返回 `AUTH_REQUIRED`)。种这 3 条的唯一正路是在开发者工具里打开小程序首页、`parks` 为空时前端自动调一次，再去云开发控制台确认有 3 条。

**(B) 客户端冒烟** —— 照搬 `README.md:108-117` 那 7 步(登录建档 → 身份牌小程序码 → 编译模式扫牌留言 → 走失模式+订阅 → 公园签到围栏内外各一次 → 约遛两账号互动 → 抓 `parkBoard`/`walkOps` 返回确认无 openid/nickname/坐标)，并在标题里写明**需要两个测试账号**。**不要修改 README 里那 7 步的原文**，在验收文档里引用即可。

**(C) 静默失败专项**(这一节是整份文档的重点)

`dogCRUD` / `genTagCode` / `reportFound` / `walkOps` 这 4 个函数各自带 `config.json` 声明了 openapi 权限。⚠️ **四份声明各不相同，不要当成同一份抄**(2026-09-21 18:41 逐个 `cat` 过 src 与 dist 共 8 份，两侧逐字一致)：

| 函数 | `permissions.openapi` 实际声明 |
|---|---|
| `dogCRUD` | `security.msgSecCheck`、`security.imgSecCheck` |
| `genTagCode` | `wxacode.getUnlimited` —— **只有这一条**，没有任何 `security.*` |
| `reportFound` | `subscribeMessage.send`、`security.msgSecCheck` |
| `walkOps` | `security.msgSecCheck` |

写进 `docs/deploy-acceptance.md` 的必须是**上面这张表**，不是一份统一的声明 —— 这份文档的用途正是让用户拿去对着云开发控制台逐条核验，抄错了用户会去 `genTagCode` 上找根本不存在的 `imgSecCheck`，却漏掉真正决定成败的那两条。

CLI 部署会不会真把这份声明应用上去，**没人验证过**。漏了的表现是：身份牌二维码空白、订阅消息发不出去，**而且不报错**。所以清单里必须写死两条**正面证据**，不许靠「没报错」推断成功 —— 每条都点名它真正依赖的那个权限：

1. **生成一次身份牌二维码** —— 在狗卡片 →「身份牌」页真的拿到一张能扫的小程序码图片(空白 / 加载失败 = `genTagCode` 的 `wxacode.getUnlimited` 没上去)。
2. **触发一次寻回留言并确认收到订阅消息** —— 用第二个账号走寻回页留言，主人账号的微信服务通知里**真的看到那条消息**(收不到 = `reportFound` 的 `subscribeMessage.send` 没上去)。

`security.msgSecCheck`(dogCRUD / reportFound / walkOps)与 `security.imgSecCheck`(**仅** dogCRUD)属于内容安全那一类，走 `README.md:105-106` 那条既有说明，**不要拿它们当上面两条正面证据的依据** —— 它们失效时的表现是「违规内容没拦住」，不是二维码空白。

⚠️ **文档里要把这两件事分清，别让用户拿脚本的绿当成云侧的绿**：§2B 那个离线脚本读的是本地文件，它只能证明「声明被 `deploy-shared` 带进了 `dist/`」；**云端到底有没有把权限应用上，只有上面这两条正面证据能证明**。

并提醒：订阅消息模板字段 key 对不上时只改 `cloudfunctions/reportFound/core.js:21` 的 `TEMPLATE_FIELDS = { name: 'thing1', message: 'thing2', time: 'time3' }` 这一行，别的都不动；改完要看 `tests/cloud/reportFound.test.js` 有没有把 key 钉死。**这一条现在做不了**(模板还没申请)，在文档里标成「待模板 ID 到手后回头做」。

另外在文档里标一句 **dist 新鲜度会漂**：`dist/` 被 gitignore，新鲜度只能看 mtime(当前 `dist/cloudfunctions/` 12 个目录、mtime 2026-09-21 08:09)，任何上传前都该先 `npm run deploy:shared` 重打一遍，别信这个读数。

### 2B. `scripts/check-deploy-ready.js` —— 纯离线检查器

硬要求：**纯本地、不联网、不跑任何 `tcb` / `cloudbase` 命令、不写任何文件**。无第三方依赖。风格照抄 `scripts/check-dispatch.js`(顶上 `#!/usr/bin/env node` + 中文 JSDoc，`const ROOT = path.resolve(__dirname, '..')`)。

**用法**：`node scripts/check-deploy-ready.js [--root <目录>]`，`--root` 缺省 = 仓库根(`path.resolve(__dirname, '..')`)。**必须支持 `--root`** —— 绿路径就靠它去跑 `/tmp` 上的副本。

**stdout 契约(逐行、机器可读)**：每项检查一行 `OK   <name>` 或 `FAIL <name> <说明>`，最后一行 `SUMMARY ok=<n> fail=<m>`。全过 exit 0，有 FAIL exit 1。

七项检查，`name` 就用这七个：

| name | 判什么 |
|---|---|
| `env-id` | `<root>/miniprogram/config.js` 的 `ENV_ID` 非空且**不以 `<<` 开头** |
| `subscribe-template` | 同文件 `SUBSCRIBE_TEMPLATES.foundReport` 同上 |
| `appid` | `<root>/project.config.json` 的 `appid` 同上 |
| `dist-functions` | `<root>/dist/cloudfunctions/` 下正好 12 个目录，且目录名集合 **等于** `<root>/cloudfunctions/` 下的目录名去掉 `_shared` |
| `openapi-permissions` | `dogCRUD`/`genTagCode`/`reportFound`/`walkOps` 四个函数，**逐个**满足：① src 侧 `<root>/cloudfunctions/<fn>/config.json` 与 dist 侧 `<root>/dist/cloudfunctions/<fn>/config.json` 都存在且能 `JSON.parse`；② 两侧的 `permissions.openapi` 都是**非空数组**；③ 两侧**逐字一致**——判法钉死成 `JSON.stringify(src) === JSON.stringify(dist)`(元素与顺序都要相同)，**不许用集合比较**，否则两个会话写出来的 FAIL 文案会不一样；④ `genTagCode` 必须含 `wxacode.getUnlimited`、`reportFound` 必须含 `subscribeMessage.send`(别的函数不额外钉具体权限)。FAIL 时说明里要点名是哪个函数、哪一臂不过 |
| `rules-vs-coll` | `<root>/database/rules/` 下 9 个 `*.json` 的文件名(去掉 `.json`)集合，等于 `<root>/cloudfunctions/_shared/contracts.js` 里 `COLL` 的 9 个值 |
| `no-inplace-shared` | `<root>/cloudfunctions/*/_shared` 一个都不存在(没被 `--in-place` 污染过) |

> **这一项判的是「`deploy-shared` 有没有把声明带进 `dist/`」，不是「四个函数都有同一套权限」。** 四份声明本来就各不相同(见 §2A(C) 那张表)，写成「都要同时含 `msgSecCheck` 与 `imgSecCheck`」的话只有 `dogCRUD` 满足，这条**永远红**、绿路径的 `ok=7 fail=0` 永远达不到。要钉具体权限就只钉真实存在的那两条：`genTagCode: wxacode.getUnlimited`(决定身份牌二维码空不空白)、`reportFound: subscribeMessage.send`(决定订阅消息发不发得出) —— 正是 §2A(C) 两条正面证据各自依赖的那个。

读 `config.js` / `contracts.js` 用 `require(path.resolve(...))` 即可(两者都是纯 CommonJS，不依赖 `wx` 全局，已核实)。

### 可写文件白名单(严格)

- `/Users/shensikai/Documents/Projects/Dogwalk/docs/deploy-acceptance.md`(新建)
- `/Users/shensikai/Documents/Projects/Dogwalk/scripts/check-deploy-ready.js`(新建)
- `/Users/shensikai/Documents/Projects/Dogwalk/README.md`(**只在文件末尾、第 122 行之后追加一行**指向 `docs/deploy-acceptance.md` 的指路；`README.md:108-117`(第 108 行标题 + 110-117 那 7 步)原文一个字都不要动)

以下全部**只读**，你需要读它们取事实，但**一个字节都不许改**：`cloudfunctions/**`(含 `cloudfunctions/_shared/contracts.js`)、`database/**`、`miniprogram/**`、`project.config.json`、`review/paste-cloudbase.md`、`dist/**`。

### 验收命令 —— **必须双向**

只验红路径 = 让你自己给自己打分(一个 `console.log(三行); process.exit(1)` 的空壳就能骗过去，何况脚本不存在时 `node` 本身也是 exit 1)。所以**红绿两条都要跑**。

**红路径**(当前仓库状态，占位符还没填)：

```
cd /Users/shensikai/Documents/Projects/Dogwalk
node scripts/check-deploy-ready.js > /tmp/dw-ready-red.txt 2>&1; echo "RED_EXIT=$?"; cat /tmp/dw-ready-red.txt
```

**绿路径**(把仓库拷到 `/tmp` 副本、**只在副本里**把三个占位符填上)：

```
rm -rf /tmp/dogwalk-green && mkdir -p /tmp/dogwalk-green
rsync -a --exclude node_modules --exclude .git /Users/shensikai/Documents/Projects/Dogwalk/ /tmp/dogwalk-green/
/usr/bin/sed -i '' "s/ENV_ID: '<<.*>>'/ENV_ID: 'dogwalk-dev-0fake0test'/" /tmp/dogwalk-green/miniprogram/config.js
/usr/bin/sed -i '' "s/foundReport: '<<.*>>'/foundReport: 'FAKE_TEMPLATE_ID_FOR_TEST'/" /tmp/dogwalk-green/miniprogram/config.js
/usr/bin/sed -i '' 's/"appid": "<<.*>>"/"appid": "wxfakeappid0000000"/' /tmp/dogwalk-green/project.config.json
grep -n "ENV_ID\|foundReport" /tmp/dogwalk-green/miniprogram/config.js; grep -n '"appid"' /tmp/dogwalk-green/project.config.json
node /Users/shensikai/Documents/Projects/Dogwalk/scripts/check-deploy-ready.js --root /tmp/dogwalk-green > /tmp/dw-ready-green.txt 2>&1; echo "GREEN_EXIT=$?"; cat /tmp/dw-ready-green.txt
```

(上面这段 rsync + 三条 BSD `sed -i ''` + 两条 `grep -n` 已于 2026-09-21 18:26 在本机整段实跑验证过：`RSYNC_EXIT=0`、三条 sed 全 `=0`、副本里 12 个 dist 目录都在、`grep -n` 回读到填好的值、仓库工作区一个字节没变。照抄即可。)

⚠️ **这三个 sed 只作用于 `/tmp/dogwalk-green/`。仓库里的 `miniprogram/config.js` 和 `project.config.json` 一个字符都不许动** —— 见 §X 红线「不许给 `<<` 占位符编值」。填完先用上面那两条 `grep -n` 肉眼确认副本里真的填上了(而且填的不是 `<<` 开头)，再跑脚本。

**回归**：

```
cd /Users/shensikai/Documents/Projects/Dogwalk
npm test > /tmp/dw-test2.txt 2>&1; echo "TEST_EXIT=$?"; tail -6 /tmp/dw-test2.txt
npm run lint > /tmp/dw-lint2.txt 2>&1; echo "LINT_EXIT=$?"; cat /tmp/dw-lint2.txt
node scripts/check-dispatch.js > /tmp/dw-cd2.txt 2>&1; echo "DISPATCH_EXIT=$?"; tail -1 /tmp/dw-cd2.txt
```

### 期望输出

**红路径**：`RED_EXIT=1`。7 行检查 + 1 行 SUMMARY，其中：

```
FAIL env-id            (说明里要引到 <<填云开发环境ID>>)
FAIL subscribe-template(说明里要引到 <<填「寻回留言」订阅消息模板ID>>)
FAIL appid             (说明里要引到 <<填小程序AppID>>)
OK   dist-functions
OK   openapi-permissions
OK   rules-vs-coll
OK   no-inplace-shared
SUMMARY ok=4 fail=3
```

(行的顺序你自己定，但七个 name 一个不少。)

**绿路径**：`GREEN_EXIT=0`，七行全 `OK`，末行 `SUMMARY ok=7 fail=0`。

**回归**：`TEST_EXIT=0` 且 `Tests:       535 passed, 535 total`(§2 不新增 jest 测试，条数**不应该变**，变了就是你多写了东西)；`LINT_EXIT=0` 且无 eslint 报错(新脚本要过 `prefer-const` / `no-var` / `eqeqeq: smart`)；`DISPATCH_EXIT=0` 且 `DISPATCH-CHECK pass tasks=7 conflicts=0`。

### 会漂的读数

- **红路径的 `ok=4 fail=3` 取决于 Codex 有没有抢跑。** 如果它已经把 `ENV_ID` / `appid` 填上了，FAIL 条数会少。这时**不要把脚本改成硬红** —— 照实把当时的 SUMMARY 抄进回执，并注明「§0.3 打印的是 X 不是 2/1」。
- `dist-functions` 那条依赖 `dist/` 这个未入库的构建产物在不在。现在在(12 个目录，mtime 2026-09-21 08:09)。哪天 `dist/` 被清了，这条会红 —— 那是**对的**，重跑 `npm run deploy:shared` 即可，**不要**为了让它绿而放宽判据。

### 反向验证(必做，做在 `/tmp` 副本上)

新写的判据必须证明它抓得住该抓的东西。在**绿**的副本上依次破坏、确认变红、再恢复：

**破坏 A** —— 删掉一份 dist 侧的 openapi 声明(测判据的「dist 侧存在性」这一臂)：

```
rm /tmp/dogwalk-green/dist/cloudfunctions/walkOps/config.json
node /Users/shensikai/Documents/Projects/Dogwalk/scripts/check-deploy-ready.js --root /tmp/dogwalk-green > /tmp/dw-break-a.txt 2>&1; echo "BREAK_A_EXIT=$?"; cat /tmp/dw-break-a.txt
diff /tmp/dw-ready-green.txt /tmp/dw-break-a.txt; echo "DIFF_A_EXIT=$?"
```

期望：`BREAK_A_EXIT=1`，`FAIL openapi-permissions`(说明里点名 `walkOps`)，`SUMMARY ok=6 fail=1`。

⚠️ **`DIFF_A_EXIT` 必须是 `1`** —— diff 发现差异时 exit 1，**这里的 1 是好事**；而且打印出来的差异里**必须包含 `SUMMARY` 那一行**(`ok=7 fail=0` → `ok=6 fail=1`)。**`DIFF_A_EXIT=0` = 破坏前后输出一模一样 = 这条反向验证一个字节也没验到 → 停下来报告，不许当它通过。**

这道 diff 闸门是专门用来挡**恒真判据**的：判据要是写成永远红(比如钉了一个根本不存在的权限)，破坏前后的输出会完全相同，而「`BREAK_A_EXIT=1` + `FAIL openapi-permissions` + `ok=6 fail=1`」这组期望值照样能逐字满足 —— 等于给自己发一张假的合格证。diff 一跑就现形。**破坏 B 同理，虽然它本来就有判别力，也顺手对一眼 `SUMMARY` 行有没有变。**

**破坏 B** —— 伪造一次 `--in-place` 污染：

```
mkdir -p /tmp/dogwalk-green/cloudfunctions/login/_shared
node /Users/shensikai/Documents/Projects/Dogwalk/scripts/check-deploy-ready.js --root /tmp/dogwalk-green > /tmp/dw-break-b.txt 2>&1; echo "BREAK_B_EXIT=$?"; cat /tmp/dw-break-b.txt
```

期望：`BREAK_B_EXIT=1`，输出里有 `FAIL no-inplace-shared`(点名 `login`)。注意**破坏 A 还没恢复**，所以这一跑是两条同时红，`SUMMARY ok=5 fail=2` —— 只对 `FAIL no-inplace-shared` 这一行，别去对 `fail=1`。

**恢复** —— 重跑上面「绿路径」那一整段(`rm -rf` + `rsync` + 三条 sed)，再确认 `GREEN_EXIT=0` / `SUMMARY ok=7 fail=0`。

**破坏 A2**(做在刚恢复好的绿副本上) —— 改一份 dist 侧的声明让它和 src 对不上。破坏 A 只测到了「dist 侧文件在不在」，**A2 测的才是这条判据的核心：src 与 dist 逐字一致**(也就是「`deploy-shared` 有没有把最新声明带进 `dist/`」这个真问题)：

```
/usr/bin/sed -i '' 's/"wxacode.getUnlimited"/"security.msgSecCheck"/' /tmp/dogwalk-green/dist/cloudfunctions/genTagCode/config.json
cat /tmp/dogwalk-green/dist/cloudfunctions/genTagCode/config.json
node /Users/shensikai/Documents/Projects/Dogwalk/scripts/check-deploy-ready.js --root /tmp/dogwalk-green > /tmp/dw-break-a2.txt 2>&1; echo "BREAK_A2_EXIT=$?"; cat /tmp/dw-break-a2.txt
diff /tmp/dw-ready-green.txt /tmp/dw-break-a2.txt; echo "DIFF_A2_EXIT=$?"
```

期望：`BREAK_A2_EXIT=1`；`SUMMARY ok=6 fail=1`；`DIFF_A2_EXIT=1`(同破坏 A，`0` = 没验到 → 停下来报告)；`FAIL openapi-permissions` 那一行的说明里**同时出现 `genTagCode`、`wxacode.getUnlimited`、`security.msgSecCheck` 这三个字符串**(只说「不一致」而不说是哪个函数、哪两个值，排查时没用)。

(按这三个字符串判，不按「src X / dist Y」的句式判 —— 判据四臂谁先谁后由你的实现决定：先判臂③会得到「src 与 dist 不一致」，先判臂④会得到「缺 wxacode.getUnlimited」，两种说明都合格，只要三个字符串都在。)

**再恢复一次** —— 又重跑「绿路径」那一整段，确认 `GREEN_EXIT=0` / `SUMMARY ok=7 fail=0`，收工时把副本停在绿上。

⚠️ **恢复只能靠重跑 rsync，不能靠 `git checkout`** —— 破坏 A 删的是 `dist/` 下的文件，`dist/` 被 gitignore、根本不在版本控制里，`git checkout` 恢复不回来；何况这里破坏的是 `/tmp` 副本，跟仓库无关。**整个反向验证过程一次都不许碰 `/Users/shensikai/Documents/Projects/Dogwalk/` 下的文件。**

---

## §3(可选，低风险)清理 13 条已完全合入 main 的本地 task-* 分支

**为什么现在做**：13 条分支全部已合入、`.worktrees/` 是空的，留着只会让下一轮 `git worktree add -b task-tN` 撞名。做不做都行，不做也不影响 §1 §2 的回执。

### 做什么

13 条：`task-t1` `task-t2` `task-t3` `task-t4` `task-t5` `task-t6` `task-t7` `task-t8` `task-t9` `task-t10` `task-t11` `task-tomega` `task-tomega2`。

删之前**自己重跑一遍**合入确认(别信本派单里的读数)：

```
cd /Users/shensikai/Documents/Projects/Dogwalk
for b in task-t1 task-t2 task-t3 task-t4 task-t5 task-t6 task-t7 task-t8 task-t9 task-t10 task-t11 task-tomega task-tomega2; do echo "$b $(git rev-list --count main..$b)"; done
```

**13 行必须全是 `<分支名> 0`。任何一行不是 0 → 一条都不要删，停下来报告。**

全是 0 再删(**必须用小写 `-d`**，它会拒绝未合并的分支；`-D` 强删是绕过这层保护，禁用)：

```
cd /Users/shensikai/Documents/Projects/Dogwalk
git branch -d task-t1 task-t2 task-t3 task-t4 task-t5 task-t6 task-t7 task-t8 task-t9 task-t10 task-t11 task-tomega task-tomega2
```

**远端同名的 13 条 `origin/task-*` 一条都不动**(删远端要 push，禁；见 §X)。

新开轨从 **t12** 往后编号，别复用 t1-t11 / tomega / tomega2。

### 可写文件白名单

无(这一节不写任何文件，只动本地分支引用)。

### 验收命令

```
cd /Users/shensikai/Documents/Projects/Dogwalk
git branch --list 'task-*' | wc -l
git branch -r --list 'origin/task-*' | wc -l
git log --oneline -1
[ -z "$(git status --porcelain --untracked-files=no)" ] && echo TRACKED_CLEAN || echo TRACKED_DIRTY
```

### 期望输出

- 本地 `task-*` 分支数 `0`
- 远端 `origin/task-*` 分支数 **`13`**(一条都没动 —— 这是「没有误删远端」的正面证据)
- `git log --oneline -1` 是 §1 那条 chore commit(删分支不动 HEAD)
- `TRACKED_CLEAN`

### 会漂的读数

`git rev-list --count main..<分支>` 在 §1 提交之后仍然是 0(main 只会往前走，祖先关系不变)。远端那个 `13` 只要不 push 就不会变。

---

## §4 等你一句话(默认不动，不要自己拍板)

这两件**不是任务**，不要动手。整理成简报等用户一句话：

### 4.1 作废环境 `ferry-dev-d3gncerv075a25f53` 里那 12 个孤儿云函数，删不删？

- 出处：`review/paste-cloudbase.md:31` 逐字写着「**ferry-dev 不要动**(可能 Ferry 项目在用)。里面那 12 个 dogwalk 函数要不要删,由用户决定,别自己删。」
- 背景：上一轮在腾讯云侧独立环境上部署的 12 个函数全部作废(`wx.cloud` 调不到那种环境；那个环境没有文档型数据库且事后加不了)。
- **建议：先留着不动。** 那批函数没流量、不花钱，而 ferry-dev 可能是 Ferry 项目在用的环境，误删的代价远大于留着。等新环境 `dogwalk-dev` 跑通、确认 Ferry 侧无依赖之后再统一清理。
- 只有用户本人能做(要么进云开发控制台手删，要么授权某个会话跑 tcb —— 而 tcb 登录本身还没解决)。

### 4.2 微信开放平台这次绑不绑？

- 出处：`README.md:50-61`「### 还有一件不用填、但建议早点做的:绑微信开放平台」；`docs/dev-spec-2026-09-16.md:657`「### 2026-09-17 —— 跨端身份:users 加 `unionid`」。
- 跟着它走的那条索引，真实出处是 `database/indexes.md:20`：「| users | `unionid` 升序 | 否 | 将来 App 版按 unionid 反查用户(见规格第 11 节)。绑微信开放平台之后再建也不迟;没绑之前这个字段全是空串,建了也没用 |」。
- **建议：先不绑。** 主键始终是 `openid`，README 和规格都写明**绑定当天不需要任何数据迁移**，绑之前注册的老用户回来登录一次就自动补上 `unionid`。现在绑只会给上云这条路再加一层账号手续和费用。
- 只有用户本人能做(注册开放平台账号要钱要时间)。

**决定「不绑」→ `users.unionid` 索引永远不建，`docs/deploy-acceptance.md` 的云侧清单里也不列这一项。** 本轮按「不绑」写，用户若改主意再回头加。

---

## §X 红线

**本仓没有任何守卫，下面每一条都没有机器强制，全靠你自己。**

**不许跑的命令**

- 任何 `tcb` / `cloudbase` 上云命令(部署、建库、建索引、删函数，一概不跑)。
- `node scripts/deploy-shared.js --in-place` —— 它会**就地改写** `cloudfunctions/*/{core,index}.js` 的 require 路径，把仓库源码弄脏。现在 `ls -d cloudfunctions/*/_shared` 为空 = 干净，保持这样。要打包走 `npm run deploy:shared`(打进 `dist/`)。
- `git push`(含 `git push --force`，全局 deny 里只挡了 `--force` 这一条，普通 push 挡不住，靠自觉)、`git checkout <文件>`、`git stash`、`git merge`、`git rebase`、`git reset`。§1 那一条 commit 是本轮**唯一**授权的 git 写操作。
- 删远端分支(`git push origin --delete ...`)。
- `git branch -D`(强删绕过合并检查)；§3 只许用小写 `-d`。

**不许碰的路径**

- `docs/dispatch/**` —— 已冻结的历史派工包，**只读**。里面「工作区命令」表写的 `~/Documents/dogwalk` 是**已失效的旧路径**(仓库搬到了 `/Users/shensikai/Documents/Projects/Dogwalk`)，但那是历史事实不是 bug，**不要去改它们**。
- `docs/dev-spec-2026-09-16.md` 第 1-10 节 —— 规格自称冻结，**只读**。(第 11 节的变更记录也不归本轮改。)
- `cloudfunctions/**` 和 `database/**` —— 本轮**一律只读**。包括 `cloudfunctions/_shared/contracts.js`：你要读它取 `COLL` 的 9 个值，但**不许改**。
- `miniprogram/**`(除 §1 里提交 `app.json` 之外)、`project.config.json`、`review/paste-cloudbase.md`、`package.json`、`.eslintrc.js` —— 只读。
- `~/Documents/Projects/Ferry` 及其它任何项目目录 —— 不读不写。

**不许编值**

- `miniprogram/config.js` 的 `ENV_ID`、`SUBSCRIBE_TEMPLATES.foundReport`，`project.config.json` 的 `appid` —— 这三个 `<<` 开头的占位符**一个都不许编**。`isPlaceholder()` 只看开头两个字符是不是 `<<`(`miniprogram/config.js:28-30`)，随便写个 `dogwalk-dev-pending` 就能骗过去 —— **上一轮就是这么翻车的**(页面去连一个不存在的环境，报一堆看不懂的错)。测试号 AppID 也不行(测试号不支持云开发，上一轮填的 `wxb2528997418bc43f` 已在 `e415293` 撤回)。
- §2 绿路径里的赋值**只发生在 `/tmp/dogwalk-green/` 副本上**，与这一条不冲突；仓库里那两个文件一个字符都不动。

**禁网**

- 本轮**不需要任何网络**：`npm test`、`npm run lint`、`node scripts/*.js` 全是纯本地。不要 `npm install`、不要 `git fetch` / `git pull`、不要访问腾讯云或微信后台。
- (供参考，本轮用不上：本机 shell 带 `HTTPS_PROXY=http://127.0.0.1:7897`，访问腾讯云要 `env -u HTTP_PROXY -u HTTPS_PROXY ...`。)

**本机约束**

- **没有 `python` 命令，一律 `python3`**(3.11)。写脚本 / 一次性命令都按这条。
- **没有 `timeout` 命令。**
- 本轮的脚本用 Node(仓库 `engines.node >= 18`)，不要引入 Python 或任何第三方依赖。
- 你在**主 checkout** 里，没有 worktree 隔离，且 **Codex 可能同时在这个目录里干活** —— 任何写操作之前先跑一次 `git status --porcelain` 看有没有冒出不属于你的脏文件。

---

## §Y 回执(收工时按这个格式贴)

```
## dogwalk 收尾轮回执 — <日期 时间>

### §0 开场自检
- 0.1 守卫: GUARD_GREP_EXIT=___ (期望 1,无输出) → 本仓无守卫,已确认
- 0.2 HEAD=___ / status 行数=___ / worktree=1 / stash=0
- 0.3 占位符计数: config.js=___ project.config.json=___ (期望 2 / 1,模式是 `: '<<` 与 `"<<`)
- 0.4 TEST_EXIT=___ Suites=___ Tests=___
- 0.5 LINT_EXIT=___ DISPATCH_EXIT=___ 末行=___

### §1 提交 app.json
- 提交前索引是否干净: CACHED_CLEAN / CACHED_DIRTY = ___ (期望 CACHED_CLEAN;DIRTY = Codex 的东西在索引里,停下来报告)
- commit: <短 sha> <中文 message> (用的是带 `-- miniprogram/app.json` 的 pathspec 写法: 是 / 否)
- stat: ___ file changed, ___ insertion(+), ___ deletion(-)
- TRACKED_CLEAN / TRACKED_DIRTY: ___
- git status --porcelain 剩余未跟踪行: ___
- origin/main..main = ___

### §2 验收清单 + 离线检查脚本
- 新增: docs/deploy-acceptance.md (___ 行) / scripts/check-deploy-ready.js (___ 行)
- README.md 追加指路行: 第 ___ 行,原 7 步未动
- 红路径: RED_EXIT=___ SUMMARY=___ (FAIL 的三项是: ___)
- 绿路径: GREEN_EXIT=___ SUMMARY=___
- 反向验证 A(删 dist/walkOps/config.json): BREAK_A_EXIT=___ FAIL 项=___ SUMMARY=___ / DIFF_A_EXIT=___ (期望 1,且差异里含 SUMMARY 行)
- 反向验证 B(造 cloudfunctions/login/_shared): BREAK_B_EXIT=___ FAIL 项=___ SUMMARY=___
- 恢复(重跑 rsync+sed): GREEN_EXIT=___ SUMMARY=___
- 反向验证 A2(改 dist/genTagCode/config.json 使其与 src 不一致): BREAK_A2_EXIT=___ FAIL 项=___ SUMMARY=___ / DIFF_A2_EXIT=___ (期望 1)
- 再恢复(重跑 rsync+sed): GREEN_EXIT=___ SUMMARY=___
- 回归: TEST_EXIT=___ Tests=___ / LINT_EXIT=___ / DISPATCH_EXIT=___
- 期间是否碰过仓库里的 config.js / project.config.json: 否 / 是(说明)

### §3 分支清理(可选,做没做)
- 做了 / 没做
- 13 条 rev-list --count 全为 0: 是 / 否
- 本地 task-* 剩 ___ 条 (期望 0)
- 远端 origin/task-* 剩 ___ 条 (期望 13,一条未动)

### §4 等用户一句话
- 4.1 ferry-dev 12 个孤儿函数: 未动,建议「先留着」
- 4.2 微信开放平台: 未动,建议「先不绑」→ users.unionid 索引本轮不列进验收清单

### 偏离与异常
- (任何与期望值对不上的地方、任何停下来报告的点,写在这里;没有就写「无」)
```
