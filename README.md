# dogwalk —— 遛狗社交微信小程序 v1

给狗建档 → 生成身份牌 → 到公园签到 → 看到公园里有哪些狗 → 约其他狗主人一起遛。
原生微信小程序 + 微信云开发(云函数 / 云数据库 / 云存储),JavaScript。

权威规格:`docs/dev-spec-2026-09-16.md`(契约、集合、云函数、页面、验收全在里面)。

## 目录结构

```
miniprogram/            小程序前端
  app.js / app.json / app.wxss   入口、路由 + tabBar + 隐私声明、主题变量
  config.js             ★ 你要填的配置(环境 ID、订阅消息模板 ID)
  api/index.js          云函数调用封装,页面只调这里
  logic/                纯逻辑:enums(枚举文案)、host(取 wx)、compat(合拍度规则)
                        狗档案的本地校验在 pages/dog/dog-meta.js;订阅额度记账在服务端 subscribeGrant
  components/privacy-popup   隐私保护指引弹层
  pages/
    index/              首页地图(tab)        park/          公园详情       checkin/       签到 / 签退
    dog/edit/           狗档案编辑           dog/tag/       身份牌         dog/profile/   寻回页(扫码落地)
    walk/list/          约遛列表(tab)        walk/create/   发起约遛       walk/detail/   约遛详情
    me/                 我的(tab)
cloudfunctions/         云函数,每个一个目录;_shared/ 是公共代码,部署时复制进每个函数
  login dogCRUD genTagCode scanTag reportFound foundReports subscribeGrant
  initParks checkin checkinCancel parkBoard walkOps
database/               安全规则(rules/*.json)与索引说明(indexes.md)
tests/                  jest 测试:cloud/(云函数)、pages/(页面)、logic/、shared/、fakes/(替身)
scripts/                deploy-shared.js(打包云函数)、check-dispatch.js(派工包校验)
docs/                   规格与派工包
```

## 本地开发

```bash
npm install
npm test          # 纯 Node,不需要开发者工具 / 云环境 / 网络
npm run lint
```

## 配置(一共三处)

| 要填的 | 在哪 | 怎么拿 |
|---|---|---|
| 小程序 AppID | `project.config.json` → `"appid"` | 小程序后台 → 开发管理 → 开发设置 |
| 云开发环境 ID | `miniprogram/config.js` → `ENV_ID` | 云开发控制台 → 设置 → 环境 ID。不填则用账号下的默认环境 |
| 「寻回留言」订阅消息模板 ID | `miniprogram/config.js` → `SUBSCRIBE_TEMPLATES.foundReport` | 小程序后台 → 订阅消息 → 公共模板库,选一个含「宠物名称 / 留言内容 / 时间」三个字段的 |

占位符都以 `<<` 开头,没填时页面会提示。云函数不需要任何配置(用 `DYNAMIC_CURRENT_ENV`,自动跟当前环境走)。

### 订阅消息模板字段

`reportFound` 云函数发消息时带的字段(见 `cloudfunctions/reportFound/core.js` 顶部 `TEMPLATE_FIELDS`):

| 字段 key | 内容 | 例 |
|---|---|---|
| `thing1` | 狗名 | 豆豆 |
| `thing2` | 留言前 20 字 | 在西湖边看到它了 |
| `time3` | 留言时间 | 2026-09-16 18:30 |

申请到的模板字段 key 不一样(比如是 `thing2` / `thing3` / `time4`)就改 `TEMPLATE_FIELDS`,其他不用动。
用户是在「身份牌」页开走失模式时授权的,一次授权攒一条额度;模板 id 随授权一起记在用户文档上,服务端发消息时读那里。

## 部署云函数

`_shared/` 是公共代码,微信不允许云函数引用包外文件,所以要先打包:

```bash
npm run deploy:shared        # 产出 dist/cloudfunctions/<fn>/,每个函数里都塞了一份 _shared
```

然后在微信开发者工具里(`project.config.json` 已把 `cloudfunctionRoot` 指向 `dist/cloudfunctions/`):
右键某个云函数目录 → **上传并部署:云端安装依赖**。十二个函数都要传一遍;首次部署后改了哪个传哪个。

不想走 dist 也可以 `node scripts/deploy-shared.js --in-place`,它会就地改写 `cloudfunctions/*/{core,index}.js`,
上传完记得 `git checkout cloudfunctions/` 还原。

## 初始化数据库

1. 云开发控制台 → 数据库 → 新建 9 个集合:`users` `dogs` `parks` `checkins` `walks` `walk_members` `messages` `found_reports` `scanLogs`。
2. 每个集合 → 权限设置 → 自定义安全规则,粘 `database/rules/<集合名>.json` 的内容。
3. 按 `database/indexes.md` 建索引,至少把 `dogs.tagCode` 的唯一索引建上。
4. 公园数据:首页第一次打开发现 `parks` 为空会自动调一次 `initParks` 写入 3 个杭州示例公园;
   也可以在控制台 → 云函数 → `initParks` → 云端测试直接跑。改坐标 / 半径直接改 `cloudfunctions/initParks/seed.js` 再重新部署,
   或者在控制台里改文档(集合非空时 `initParks` 不会再写)。

## 隐私与权限

- `app.json` 已声明 `requiredPrivateInfos: ["getLocation"]` 与 `scope.userLocation` 的说明文案,并开了 `__usePrivacyCheck__`。
- 小程序后台 → 设置 → 服务内容声明 → 用户隐私保护指引,要勾:**位置信息**(签到围栏、路人附带发现位置)、**相册(仅写入)**(保存身份牌)、**照片**(狗头像)。
- 页面调隐私接口时 `app.js` 会弹 `components/privacy-popup`,用户点「同意并继续」后才继续。
- 签到坐标只在 `checkin` 云函数里做一次距离校验,不写库;地图 / 公园页的任何返回值都不含主人昵称、头像、openid。
- 用户输入的文本走 `security.msgSecCheck`,上传的图片走 `security.imgSecCheck`(`cloudfunctions/_shared/security.js`);
  接口明确判违规才拒绝,接口本身调用失败时放行并记 error 日志。

## 手动验证清单(开发者工具 + 两个测试账号)

1. 「我的」→ 登录 → 加一只狗(填名字、体型、性格标签,传一张照片)→ 保存。
2. 狗卡片 → 「身份牌」→ 生成小程序码 → 保存到相册。
3. 开发者工具 → 编译模式 → 添加编译模式:页面 `pages/dog/profile/profile`,启动参数 `scene=<tagCode>`(tagCode 在身份牌页上)→ 能看到寻回页,留言一条;回身份牌页能看到留言记录。
4. 身份牌页开「走失模式」→ 同意订阅 → 再用编译模式打开寻回页,顶部有「我走丢了」提示。
5. 「公园」tab → 地图上有 3 个公园标记 → 点一个 → 「签到」→ 选狗 → 提交。
   - 模拟器 → 位置 → 自定义坐标设在公园外:提示不在范围内(带距离);设在公园内:签到成功,公园页能看到自己的狗,标记上的数量 +1。
6. 「约遛」tab → 发起约遛(选公园、时间、狗)→ 切换到第二个测试账号 → 约遛详情 → 申请加入 → 切回第一个账号 → 同意 → 双方都能留言。
7. 抓一下 `parkBoard` / `walkOps` 的返回(开发者工具 → 调试器 → Network / 云函数日志):里面没有 `openid` / `nickname` / 坐标。

## 测试与派工

- `npm test` 覆盖所有云函数 core、页面逻辑、纯函数;云函数用 `tests/fakes/fake-db.js` 内存库,页面用 `tests/fakes/mini-runtime.js` 加载。
- 并行开发按 `docs/dev-spec-2026-09-16.md` 的文件归属表切轨,派工包在 `docs/dispatch/`,`node scripts/check-dispatch.js` 校验它们不互相打架。
