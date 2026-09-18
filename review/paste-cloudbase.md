# 派单 — dogwalk 上云:云开发环境配置 + 云函数部署 + 数据库初始化

> 生成于 2026-09-18,**19:00 刷新**。仓库 `~/Documents/Projects/Dogwalk`(已从 `~/Documents/dogwalk` 搬过来),
> 基线 `main @ 9aaa6ee`。GitHub 远端 `TomwaltW/dogwalk`(私有)。
> 云开发环境名字叫 `ferry-dev`(只是名字,和 Ferry 项目无关,就是给 dogwalk 用的),
> 环境 ID `ferry-dev-d3gncerv075a25f53`。
> 权威说明:`README.md`「配置 / 部署云函数 / 初始化数据库」三节,`database/indexes.md`,`database/rules/*.json`。

## 进度(19:00 实查)

| 步骤 | 状态 | 证据 |
|---|---|---|
| §2 补 4 个云函数 `config.json` | ✅ 已完成 | commit `454323e`;`dist/` 15:36 已重打包,4 个 `config.json` 都在 dist 里 |
| §3 `ENV_ID` | ✅ 已完成 | commit `9aaa6ee` |
| §3 AppID、订阅模板 ID | ❌ 未做 | `project.config.json` / `config.js` 仍是 `<<` 占位符 |
| §4 `tcb login` | ❌ 卡住 | 上一轮 15:37 起的 `tcb login` 进程一直在等授权没完成;`tcb env list` 报 `No valid identity information` |
| §4 部署 12 个云函数 | ❌ 未做 | CLI 从未登录成功,不可能部署过 |
| §5 数据库初始化 | ❓ 未验证 | 登录后先查,别假设 |

## 0. 开场自检(先跑,对不上就停下报告)

```bash
cd ~/Documents/Projects/Dogwalk && git rev-parse --short HEAD && git status --short && npm test 2>&1 | tail -5
```

期望:`9aaa6ee` 或其后代、工作区干净、`Tests: 535 passed, 535 total`、exit 0。

## 1. 网络坑(必读)

本机 shell 带了 `HTTPS_PROXY=http://127.0.0.1:7897`(Clash),**走代理访问腾讯云会超时**,直连 0.06s 通。
所有访问腾讯云的命令都要去掉代理,例如:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy <命令>
```

`tcb login` 会开浏览器授权页;授权页打不开也是同一个原因 —— 让用户把 Clash 切到「规则」模式再试。
本机没有 `python` 命令,要用就写 `python3`;也没有 `timeout` 命令。

## 2. 云调用权限 `config.json` —— ✅ 已完成(`454323e`),只需复核

`genTagCode`(`wxacode.getUnlimited`)、`reportFound`(`subscribeMessage.send` + `security.msgSecCheck`)、
`dogCRUD`(`security.msgSecCheck` + `security.imgSecCheck`)、`walkOps`(`security.msgSecCheck`)四个都已加。
部署前确认 `ls dist/cloudfunctions/*/config.json` 仍是这 4 个;若改过 `cloudfunctions/` 就先重跑 `npm run deploy:shared`。

## 3. 需要用户亲手给的东西

1. ~~环境 ID~~ ✅ `ferry-dev-d3gncerv075a25f53`,已填。
2. **小程序 AppID**:小程序后台 → 开发管理 → 开发设置。只能问用户。
3. **订阅消息模板 ID**:小程序后台 → 订阅消息 → 公共模板库,选含「宠物名称 / 留言内容 / 时间」的。只能问用户。
   申请到的字段 key 若不是 `thing1 / thing2 / time3`,改 `cloudfunctions/reportFound/core.js` 顶部 `TEMPLATE_FIELDS`。

拿到后填:`miniprogram/config.js` 的 `SUBSCRIBE_TEMPLATES.foundReport`;`project.config.json` 的 `appid`。单独 commit。
拿不到就先做 §4 / §5,最后统一向用户要。

## 4. 部署 12 个云函数(用 CloudBase CLI,不要去开发者工具里点 12 次)

先处理上一轮卡住的登录:`pgrep -fl "tcb login"` 有残留就先结束它,再重新登录。

```bash
env -u HTTP_PROXY -u HTTPS_PROXY tcb login   # 会弹浏览器让用户扫码/确认授权 —— 明确告诉用户去点,等用户说好了再往下
env -u HTTP_PROXY -u HTTPS_PROXY tcb env list  # 能列出 ferry-dev-d3gncerv075a25f53 才算登录成功
npm run deploy:shared                           # 产出 dist/cloudfunctions/<fn>/(含 _shared 和 config.json)
```

然后对 `dist/cloudfunctions/` 下每个函数部署,运行时 Node.js(≥16),云端安装依赖:
`login dogCRUD genTagCode scanTag reportFound foundReports subscribeGrant initParks checkin checkinCancel parkBoard walkOps`。
具体参数以 `tcb fn deploy --help` 为准(注意 `--dir` 指向 dist 下的目录、`-e ferry-dev-d3gncerv075a25f53`);
全部部署完用 `tcb fn list -e ferry-dev-d3gncerv075a25f53` 确认 12 个都在。

**注意**:微信小程序 `wx.cloud` 要能调到这个环境,环境必须已关联到该小程序的 AppID。
如果部署后小程序里调用报"环境不存在/无权限",让用户在微信开发者工具 → 云开发 里确认该环境出现在环境列表里。
CLI 部署是否会应用 `config.json` 里的 openapi 权限,以实际为准:不确定就在回执里写明,让用户在开发者工具里对那 4 个函数再「上传并部署」一次兜底。

## 5. 初始化数据库(文档型数据库,不是控制台侧栏的「SQL 型数据库」)

先查现状(可能用户已经手点过一部分),缺什么补什么:

1. 建 9 个集合:`users dogs parks checkins walks walk_members messages found_reports scanLogs`。
2. 每个集合的安全规则设为「自定义安全规则」,内容原样取 `database/rules/<集合名>.json`。
3. 按 `database/indexes.md` 的表建索引。**`dogs.tagCode` 唯一索引必须建**;`users.unionid` 那条可以跳过。

实现方式自选,优先可脚本化、可复跑的:`tcb` CLI 的 db 子命令,或写个一次性 Node 脚本用
`@cloudbase/manager-node`(登录态/密钥向用户要,**密钥不要写进仓库、不要 commit**,脚本放仓库外或用完删掉)。
CLI / SDK 做不到的某一项(常见是安全规则),就把要点的菜单路径 + 要粘的 JSON 列清楚交给用户手点,不要硬猜 API。

4. 公园种子数据:部署完后调一次 `initParks`(`tcb fn invoke initParks -e ferry-dev-d3gncerv075a25f53`),
   然后确认 `parks` 集合里有 3 条杭州公园文档。

## 6. 验收(逐条给证据,只认命令输出,不认自述)

- [ ] `npm test`:535 passed,exit 0(或更多,若你补了测试)
- [x] 4 个 `config.json` 已 commit(`454323e`);`dist/cloudfunctions/genTagCode/config.json` 存在
- [ ] `tcb env list` 能列出 `ferry-dev-d3gncerv075a25f53`(登录成功)
- [ ] `tcb fn list` 输出里 12 个函数全在、状态正常
- [ ] 9 个集合存在;`dogs` 上有 `tagCode` 唯一索引
- [ ] 每个集合的安全规则与 `database/rules/*.json` 一致(做不了的列出来给用户)
- [ ] `initParks` 调用返回成功,`parks` 有 3 条
- [ ] `config.js` / `project.config.json` 无 `<<` 占位符(拿不到的项明确列出还缺哪个)
- [ ] `git status` 干净,没有任何密钥 / 临时脚本进仓库;`cloudfunctions/` 未被 `--in-place` 改写

## 7. 回执格式

```
完成项:…(每项附命令 + 关键输出行)
需用户手动完成:…(菜单路径 + 要粘的内容)
还缺用户提供:AppID / 模板 ID / …
新增 commit:<sha> <message>
```

## 不要做

- 不要用 `node scripts/deploy-shared.js --in-place`(会改写仓库源码)。
- 不要改 `cloudfunctions/**/core.js` 业务逻辑(`TEMPLATE_FIELDS` 除外)、不要改测试期望。
- 不要 push,不要动别的仓库(尤其 `~/Documents/Projects/Ferry`)。
