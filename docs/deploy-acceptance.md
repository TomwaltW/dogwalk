# 部署验收清单(上云之后逐条过)

用途:云函数部署 + 数据库初始化做完之后,用这份清单判断「到底做成了没有」。
上云的失败模式大多是**静默的**(openapi 权限漏了不报错、安全规则粘错不报错),所以每一条都写明「怎么看」和「看到什么算过」,**不许拿「没报错」当通过**。

分四块:

- (0) 上传前离线自检 —— `node scripts/check-deploy-ready.js`
- (A) 云侧 —— 云开发控制台里逐条核对
- (B) 客户端冒烟 —— 开发者工具里走一遍,**需要两个测试账号**
- (C) 静默失败专项 —— 整份清单的重点

---

## (0) 上传前:离线自检

```
npm run deploy:shared            # 先重打 dist/,别信旧产物
node scripts/check-deploy-ready.js
```

期望:七行全 `OK`,末行 `SUMMARY ok=7 fail=0`,exit 0。七项分别是 `env-id` / `subscribe-template` / `appid`(三个 `<<` 占位符已填)、`dist-functions`(`dist/cloudfunctions/` 12 个目录齐)、`openapi-permissions`(4 个函数的 openapi 声明原样进了 `dist/`)、`rules-vs-coll`(安全规则文件与集合名对得上)、`no-inplace-shared`(源码没被 `--in-place` 污染)。

⚠️ **这个脚本只读本地文件。** 它全绿只能证明「声明被 `deploy-shared` 带进了 `dist/`」,**不能证明云端把权限应用上了** —— 那只能靠 (C) 的两条正面证据。别拿脚本的绿当云侧的绿。

⚠️ **dist 新鲜度会漂。** `dist/` 被 gitignore,新鲜度只能看 mtime(写这份文档时 `dist/cloudfunctions/` 12 个目录、mtime 2026-09-21 08:09)。任何上传前都先 `npm run deploy:shared` 重打一遍,不要信这个读数。**不要**用 `node scripts/deploy-shared.js --in-place`,它会就地改写源码。

---

## (A) 云侧

| # | 检查项 | 怎么看 | 看到什么算过 |
|---|---|---|---|
| A1 | 12 个云函数都在**新环境**上 | 云开发控制台 → 选中新环境 → 云函数列表 | 恰好这 12 个且状态正常:`checkin`、`checkinCancel`、`dogCRUD`、`foundReports`、`genTagCode`、`initParks`、`login`、`parkBoard`、`reportFound`、`scanTag`、`subscribeGrant`、`walkOps`(= `cloudfunctions/` 下除 `_shared` 外的目录)。注意别看成旧的作废环境 |
| A2 | 9 个集合齐 | 控制台 → 数据库 → 集合列表 | 恰好有 `users`、`dogs`、`parks`、`checkins`、`walks`、`walk_members`、`messages`、`found_reports`、`scanLogs`(以 `cloudfunctions/_shared/contracts.js` 的 `COLL` 为准;`scanLogs` 是驼峰,`walk_members` / `found_reports` 是下划线) |
| A3 | `dogs.tagCode` 唯一索引 | 控制台 → `dogs` → 索引管理 | 有一条 `tagCode` 升序索引,且**唯一 = 是**(出处 `database/indexes.md`:扫牌查狗,唯一索引兜住短码并发撞码)。非唯一不算过 |
| A4 | 9 个集合的安全规则与仓库**逐字一致** | 控制台 → 每个集合 → 数据权限 → 自定义安全规则 → 全选复制,存成临时文件,跟仓库文件 diff(见下) | 9 次 diff 都无输出。**不要靠眼看** |
| A5 | `parks` 正好 3 条 | 控制台 → `parks` 集合 | 正好 3 条,`_id` 为 `park_liulang`(西湖·柳浪闻莺)、`park_yangtai`(钱江新城·城市阳台)、`park_xixi`(西溪湿地·福堤),与 `cloudfunctions/initParks/seed.js` 一致 |

**A4 的 diff 做法**:集合名与规则文件一一对应,`database/rules/<集合名>.json`(`scanLogs.json` 是驼峰,别写成 `scan_logs.json`)。对每个集合:

```
pbpaste > /tmp/rule-<集合名>.json        # 先在控制台里全选复制该集合的规则
diff <(python3 -m json.tool database/rules/<集合名>.json) <(python3 -m json.tool /tmp/rule-<集合名>.json) && echo SAME
```

(用 `json.tool` 归一化,只抹掉空白差异;键名、值、结构有任何不同都会显出来。)

**A5 怎么种这 3 条**:`initParks` **用 CLI 调不动** —— 它需要 openid,上一轮用 CLI 调实测返回 `AUTH_REQUIRED`。唯一正路:在开发者工具里打开小程序首页,`parks` 为空时前端会自动调一次 `initParks`;然后回云开发控制台确认 `parks` 有 3 条。集合非空时 `initParks` 不会再写。
`README.md:96` 写的「控制台 → 云函数 → `initParks` → 云端测试直接跑」大概率同样返回 `AUTH_REQUIRED`(云端测试不带用户 openid),别走这条。

(`users.unionid` 索引本轮不列:暂不绑微信开放平台,没绑之前这个字段全是空串,建了也没用。改主意绑了再回来加。)

---

## (B) 客户端冒烟(需要两个测试账号)

步骤照 `README.md` 的「手动验证清单(开发者工具 + 两个测试账号)」那 7 步走,**以 README 原文为准**,这里只列要点方便打勾:

- [ ] 1. 登录建档:「我的」→ 登录 → 加一只狗(名字、体型、性格标签、照片)→ 保存
- [ ] 2. 身份牌:狗卡片 →「身份牌」→ 生成小程序码 → 保存到相册(同时是 (C) 正面证据 1)
- [ ] 3. 编译模式扫牌:编译模式打开 `pages/dog/profile/profile` + `scene=<tagCode>` → 寻回页留言 → 身份牌页看到留言
- [ ] 4. 走失模式 + 订阅:开「走失模式」→ 同意订阅 → 寻回页顶部有「我走丢了」
- [ ] 5. 公园签到:围栏**外**一次(提示不在范围内、带距离)、围栏**内**一次(签到成功、公园页看到自己的狗、标记数量 +1)
- [ ] 6. 约遛:账号一发起 → 账号二申请加入 → 账号一同意 → 双方都能留言
- [ ] 7. 抓 `parkBoard` / `walkOps` 的返回:里面没有 `openid` / `nickname` / 坐标

---

## (C) 静默失败专项(重点)

`dogCRUD` / `genTagCode` / `reportFound` / `walkOps` 这 4 个函数各自带 `config.json` 声明 openapi 权限。⚠️ **四份声明各不相同,逐个对,不要当成同一份:**

| 函数 | `permissions.openapi` 实际声明 |
|---|---|
| `dogCRUD` | `security.msgSecCheck`、`security.imgSecCheck` |
| `genTagCode` | `wxacode.getUnlimited` —— **只有这一条**,没有任何 `security.*` |
| `reportFound` | `subscribeMessage.send`、`security.msgSecCheck` |
| `walkOps` | `security.msgSecCheck` |

CLI 部署会不会真把这份声明应用到云端,**没人验证过**。漏了的表现是身份牌二维码空白、订阅消息发不出去,**而且不报错**。所以必须拿到下面两条**正面证据**,不许靠「没报错」推断成功:

- [ ] **C1. 生成一次身份牌二维码。** 狗卡片 →「身份牌」页,真的拿到一张**能扫**的小程序码图片(用另一台手机扫一下)。
  空白 / 加载失败 = `genTagCode` 的 `wxacode.getUnlimited` 没上去。
- [ ] **C2. 触发一次寻回留言,并确认收到订阅消息。** 主人账号先开走失模式并同意订阅;用第二个账号走寻回页留言;主人账号的微信「服务通知」里**真的看到那条消息**。
  收不到 = `reportFound` 的 `subscribeMessage.send` 没上去(也可能是模板 ID / 字段 key 不对,见下)。

`security.msgSecCheck`(dogCRUD / reportFound / walkOps)与 `security.imgSecCheck`(**仅** dogCRUD)是内容安全那一类,按 README「隐私与权限」一节的既有说明:接口明确判违规才拒绝,接口本身调用失败时放行并记 error 日志。它们失效的表现是「违规内容没拦住」,**不是**二维码空白,**不要拿它们当 C1 / C2 的依据**。

### 待模板 ID 到手后回头做

- [ ] 订阅消息模板字段 key 核对。模板在小程序后台申请下来之后,看后台模板详情里的字段 key 是否与 `cloudfunctions/reportFound/core.js` 的
  `TEMPLATE_FIELDS = { name: 'thing1', message: 'thing2', time: 'time3' }` 对得上。对不上时云函数代码只改这一行(下面的 send 调用不用动),但**以下几处要一起改**,否则测试会红、文档会过期:
  - `tests/cloud/reportFound.test.js:164-166` 钉了 `thing1` / `thing2` / `time3` 三个 key,`:176` 读 `data.thing2.value`;
  - `README.md:67-71`「订阅消息模板字段」那张字段表。
  **现在做不了**(模板还没申请)。
