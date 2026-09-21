# 派单 — dogwalk 上云(第二版):在**微信侧**新环境上部署 + 初始化数据库

> 2026-09-21 15:58 重写。仓库 `~/Documents/Projects/Dogwalk`,基线 `main @ e415293`,远端 `TomwaltW/dogwalk`(私有)。
> 上一版派单作废:它让你在 `ferry-dev` 上干活,那条路已证实走不通(见 §1)。
> 权威说明:`README.md`「配置 / 部署云函数 / 初始化数据库」三节、`database/indexes.md`、`database/rules/*.json`。

## 0. 开场自检(先跑,对不上就停下报告)

```bash
cd ~/Documents/Projects/Dogwalk && git rev-parse --short HEAD && git status --short && npm test 2>&1 | tail -5
```

期望:`e415293` 或其后代;工作区最多只有 ` M miniprogram/app.json`(scope.userLocation 描述改写,无害,别管它);
`Tests: 535 passed, 535 total`,exit 0。

## 1. 先读:为什么换环境(别再回头去动 ferry-dev)

上一轮在腾讯云侧环境 `ferry-dev-d3gncerv075a25f53` 上部署了 12 个函数,**全部作废**,原因两条,各自都是死穴:

1. **`wx.cloud` 调不到腾讯云侧的独立 CloudBase 环境。** 本项目前端用 `wx.cloud.callFunction`、
   云函数用 `wx-server-sdk` + `cloud.getWXContext()`,这是「微信云开发」体系。官方迁移文档写得很清楚:
   要用独立环境就得换成 `@cloudbase/js-sdk` + 自定义登录 —— 那是把 12 个函数的鉴权模型全推倒重写,不干。
   (`tcb fn invoke initParks` 返回 `AUTH_REQUIRED` 就是这个原因:CLI 调用没有 openid。)
2. **那个环境没有文档型数据库,而且事后加不了。** `DescribeEnvs` 里 `Databases: []`,只有 PostgreSQL 实例;
   官方文档:文档型数据库只在**创建环境时**初始化。本项目九个集合全是文档库。

参考:
<https://docs.cloudbase.net/en/recipes/migrate-wxcloud-to-cloudbase>、
<https://docs.cloudbase.net/en/quick-start/env-overview>

**ferry-dev 不要动**(可能 Ferry 项目在用)。里面那 12 个 dogwalk 函数要不要删,由用户决定,别自己删。

## 2. 现状

| 项 | 状态 |
|---|---|
| 4 个云函数 `config.json`(openapi 云调用权限) | ✅ `454323e`,已在仓库里 |
| `ENV_ID` | ⬜ 已退回占位符(`e415293`),等新环境 ID |
| `appid` | ⬜ 占位符。上一轮填过的 `wxb2528997418bc43f` 是**测试号**,测试号不支持云开发,已撤回 |
| 12 个云函数 | ⬜ 只在作废的 ferry-dev 上部署过,新环境上没有 |
| 9 个集合 / 安全规则 / 索引 | ⬜ 全未做 |
| 订阅消息模板 ID | ⬜ 缺 |

## 3. 前置:两个值必须由用户给,拿不到就停

用户正在注册**正式**小程序账号(个人主体即可,测试号不行),然后在微信开发者工具 → 云开发 → 开通里
新建环境(约定名 `dogwalk-dev`)。开工前必须拿到:

1. **AppID** —— 必须来自正式注册的小程序账号。若用户给的又是测试号(账号名带「测试号」/后台没有「云开发」入口),
   **停下来告诉他**,不要往下做。
2. **云开发环境 ID** —— 必须是在**微信开发者工具里新建**的环境;
   `ferry-dev-*` 开头的一律不收,那是上面说的作废环境。

两个值任缺一个:把还缺什么写清楚,停在这一步,别编占位值(上一轮写 `dogwalk-dev-pending`
把 `isPlaceholder()` 骗过去了,页面会去连一个不存在的环境,报一堆看不懂的错)。

## 4. 填配置并 commit

- `project.config.json` → `appid`
- `miniprogram/config.js` → `ENV_ID`(订阅模板 ID 等用户给了再填,没给就保持 `<<` 占位符)

`npm test` 仍须 535 passed,然后单独 commit(中文 message)。

## 5. 让 CLI 连上这个微信侧环境

微信云开发环境默认只在微信侧可见。让 CLI 能管它的办法:重新登录到**小程序对应的腾讯云账号**——

```bash
env -u HTTP_PROXY -u HTTPS_PROXY tcb logout
env -u HTTP_PROXY -u HTTPS_PROXY tcb login      # 浏览器里选「小程序/公众号」登录方式,让用户用小程序管理员微信扫码
env -u HTTP_PROXY -u HTTPS_PROXY tcb env list   # 能列出 dogwalk-dev 的环境 ID 才算成功
```

**列不出来就不要硬试第二种登录**(上一轮有个 `tcb login` 挂了 3 小时没人管)。
直接转 §6 的「退回手工」路线,并在回执里写明 CLI 路线为什么不通。

本机 shell 带 `HTTPS_PROXY=http://127.0.0.1:7897`,访问腾讯云一律按上面的 `env -u ...` 去掉代理。
本机没有 `python`(用 `python3`),也没有 `timeout`。

## 6. 部署 12 个云函数

```bash
npm run deploy:shared     # 产出 dist/cloudfunctions/<fn>/,含 _shared 和 4 份 config.json
ls dist/cloudfunctions/*/config.json   # 必须是 dogCRUD / genTagCode / reportFound / walkOps 四份
```

- **CLI 路线**(§5 通了):逐个 `tcb fn deploy`,`--dir` 指向 `dist/cloudfunctions/<fn>`,`-e <新环境ID>`,
  运行时 Node.js ≥16,云端安装依赖。十二个:
  `login dogCRUD genTagCode scanTag reportFound foundReports subscribeGrant initParks checkin checkinCancel parkBoard walkOps`。
  完了 `tcb fn list -e <新环境ID>` 确认 12 个都在。
- **退回手工**(§5 不通):把「微信开发者工具里右键 `dist/cloudfunctions/<fn>` → 上传并部署:云端安装依赖」
  这 12 条列成清单交给用户,按上面的顺序列,让他照着点。

**不管走哪条路线**,那 4 个用到云调用的函数(`dogCRUD` / `genTagCode` / `reportFound` / `walkOps`)
最后都建议让用户在开发者工具里再「上传并部署」一次兜底 —— CLI 是否会应用 `config.json` 里的
openapi 权限没确认过,漏了的话二维码会空白、订阅消息发不出去,而且**不报错**。

## 7. 初始化数据库(文档型数据库)

1. 九个集合:`users dogs parks checkins walks walk_members messages found_reports scanLogs`
2. 每个集合 → 权限设置 → 自定义安全规则,内容原样取 `database/rules/<集合名>.json`
3. 按 `database/indexes.md` 建索引,**`dogs.tagCode` 唯一索引必须建**;`users.unionid` 那条可跳过

优先可脚本化、可复跑的做法(`tcb` CLI 的 db 子命令,或 `@cloudbase/manager-node` 一次性脚本);
**密钥不许进仓库**,临时脚本放仓库外或用完删掉。CLI / SDK 做不到的(常见是安全规则),
把菜单路径 + 要粘的 JSON 列清楚交给用户手点,不要硬猜 API。

## 8. 公园种子数据

`initParks` 要 openid,**CLI 调不动**(上一轮已验证返回 `AUTH_REQUIRED`)。
正确做法:让用户在开发者工具里打开小程序首页,`parks` 为空时前端会自动调一次;
之后在云开发控制台确认 `parks` 有 3 条杭州公园文档。

## 9. 验收(逐条给证据,只认命令输出,不认自述)

- [ ] `npm test`:535 passed,exit 0
- [ ] `config.js` 的 `ENV_ID` = 用户给的新环境 ID;`project.config.json` 的 `appid` = 正式小程序 AppID
- [ ] `tcb env list` 能列出新环境(走手工路线则写明 CLI 不通的原因)
- [ ] 12 个云函数在新环境上都在(`tcb fn list` 输出,或用户在开发者工具里确认的回话)
- [ ] 9 个集合存在;`dogs.tagCode` 唯一索引已建
- [ ] 各集合安全规则与 `database/rules/*.json` 一致(做不了的列清单给用户)
- [ ] `parks` 有 3 条(用户开一次首页之后)
- [ ] `git status` 干净,无密钥、无临时脚本入库;`cloudfunctions/` 未被 `--in-place` 改写

## 10. 回执格式

```
完成项:…(每项附命令 + 关键输出行)
需用户手动完成:…(菜单路径 / 要点的按钮 / 要粘的内容)
还缺用户提供:…
新增 commit:<sha> <message>
```

## 不要做

- 不要在 `ferry-dev-d3gncerv075a25f53` 上再做任何部署 / 建库 / 删除。
- 不要编造 `ENV_ID` / `appid` 占位值,不要用测试号 AppID。
- 不要用 `node scripts/deploy-shared.js --in-place`(会改写仓库源码)。
- 不要改 `cloudfunctions/**/core.js` 业务逻辑(`TEMPLATE_FIELDS` 除外)、不要改测试期望。
- 不要 push;不要动别的仓库(尤其 `~/Documents/Projects/Ferry`)。
