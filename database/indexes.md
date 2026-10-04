# 数据库:集合、安全规则、索引

## 集合(9 个)

`users` `dogs` `parks` `checkins` `walks` `walk_members` `messages` `found_reports` `scanLogs`
—— 字段定义见 `docs/dev-spec-2026-09-16.md` 3.2.2。在云开发控制台「数据库」里逐个新建。

## 安全规则

`database/rules/<集合名>.json` 一集合一份,原样粘进控制台「权限设置 → 自定义安全规则」。

口径:**客户端直连数据库一律不许写**,最多只读自己那几行(users / dogs / checkins / walks / walk_members / messages),
有些集合完全不可读。所有写操作都走云函数 —— 云函数以管理员身份访问,不受这些规则约束,
在云函数里做归属比对(`ownerOpenid` / `hostOpenid` 与调用者 openid,spec 3.4 FORBIDDEN)、字段白名单、内容安全。

users / dogs 曾经放开过「改自己的」,后来收回:前端从不直连写库,而放开写等于绕过 dogCRUD 的
字段白名单与内容安全(可以直接改 `tagCode` / `avatarFileID`),也能自己改 users 的 `subQuota` / `unionid`。

## 建议索引(控制台 → 集合 → 索引管理)

| 集合 | 字段 | 唯一 | 用途 |
|---|---|---|---|
| users | `unionid` 升序 | 否 | 将来 App 版按 unionid 反查用户(见规格第 11 节)。绑微信开放平台之后再建也不迟;没绑之前这个字段全是空串,建了也没用 |
| dogs | `tagCode` 升序 | **是** | 扫牌查狗;唯一索引兜住短码并发撞码。`dogCRUD` 建狗时就发码,所以不会有一批狗都是 `''` 去撞这条索引 |
| dogs | `ownerOpenid` 升序 | 否 | 我的狗列表 |
| checkins | `parkId` 升序 + `status` 升序 + `expireAt` 降序 | 否 | 公园在场看板 |
| checkins | `openid` 升序 + `status` 升序 | 否 | 我当前的签到 |
| walks | `status` 升序 + `startAt` 升序 | 否 | 约遛列表 |
| walks | `hostOpenid` 升序 | 否 | 我发起的 |
| walk_members | `walkId` 升序 + `status` 升序 | 否 | 约遛成员 |
| walk_members | `openid` 升序 | 否 | 我参加的 |
| messages | `walkId` 升序 + `createdAt` 升序 | 否 | 留言区 |
| found_reports | `dogId` 升序 + `createdAt` 降序 | 否 | 主人看寻回留言 |
