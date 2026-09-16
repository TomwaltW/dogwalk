# 数据库:集合、安全规则、索引

## 集合(9 个)

`users` `dogs` `parks` `checkins` `walks` `walk_members` `messages` `found_reports` `scanLogs`
—— 字段定义见 `docs/dev-spec-2026-09-16.md` 3.2.2。在云开发控制台「数据库」里逐个新建。

## 安全规则

`database/rules/<集合名>.json` 一集合一份,原样粘进控制台「权限设置 → 自定义安全规则」。

口径:客户端直连数据库只允许**读自己的、改自己的**(users / dogs);其余集合客户端要么只读自己那几行、
要么完全不可读。所有涉及他人数据的写操作都走云函数 —— 云函数以管理员身份访问,不受这些规则约束,
而云函数里逐条比对 `ownerOpenid` / `hostOpenid` 与调用者 openid(spec 3.4 FORBIDDEN)。

## 建议索引(控制台 → 集合 → 索引管理)

| 集合 | 字段 | 唯一 | 用途 |
|---|---|---|---|
| dogs | `tagCode` 升序 | **是** | 扫牌查狗;唯一索引兜住短码并发撞码 |
| dogs | `ownerOpenid` 升序 | 否 | 我的狗列表 |
| checkins | `parkId` 升序 + `status` 升序 + `expireAt` 降序 | 否 | 公园在场看板 |
| checkins | `openid` 升序 + `status` 升序 | 否 | 我当前的签到 |
| walks | `status` 升序 + `startAt` 升序 | 否 | 约遛列表 |
| walks | `hostOpenid` 升序 | 否 | 我发起的 |
| walk_members | `walkId` 升序 + `status` 升序 | 否 | 约遛成员 |
| walk_members | `openid` 升序 | 否 | 我参加的 |
| messages | `walkId` 升序 + `createdAt` 升序 | 否 | 留言区 |
| found_reports | `dogId` 升序 + `createdAt` 降序 | 否 | 主人看寻回留言 |
