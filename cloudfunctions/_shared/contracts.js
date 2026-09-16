/**
 * 集合名与枚举常量 —— spec(docs/dev-spec-2026-09-16.md)3.2.1,冻结契约。
 * 集合名一律从这里导入,禁止在业务代码里硬编码字符串。
 *
 * 前端镜像在 miniprogram/logic/enums.js(小程序只打包 miniprogram/ 根内的文件,
 * 跨根 require 在真机上 resolve 不到),tests/shared/enums.test.js 钉死两边一致。
 */

const COLL = {
  USERS: 'users',
  DOGS: 'dogs',
  PARKS: 'parks',
  CHECKINS: 'checkins',
  WALKS: 'walks',
  WALK_MEMBERS: 'walk_members',
  MESSAGES: 'messages',
  FOUND_REPORTS: 'found_reports',
  SCAN_LOGS: 'scanLogs',
};

const CHECKIN_DURATION_MS = 2 * 60 * 60 * 1000; // 签到有效期 2 小时
const TAG_CODE_LENGTH = 6; // 身份牌短码长度([a-z0-9]),即小程序码 scene

const SIZE_CLASS = ['small', 'medium', 'large'];
const GENDER = ['male', 'female'];
const TAGS = ['ball', 'fearsBig', 'foodGuard', 'shy', 'chaser', 'calm'];
const TAG_LABEL = {
  ball: '爱玩球',
  fearsBig: '怕大狗',
  foodGuard: '护食',
  shy: '怕生',
  chaser: '爱追跑',
  calm: '安静',
};
const CHECKIN_STATUS = ['active', 'cancelled'];
const WALK_STATUS = ['open', 'cancelled'];
const MEMBER_STATUS = ['pending', 'approved', 'rejected', 'left'];

/** 订阅消息模板 key,本轮只有「寻回留言」这一个 */
const TEMPLATE_KEYS = { FOUND_REPORT: 'foundReport' };

const LIMITS = {
  NAME_MAX: 12,
  BREED_MAX: 20,
  LICENSE_MAX: 32,
  LOST_NOTE_MAX: 50,
  WALK_NOTE_MAX: 50,
  MESSAGE_MAX: 200,
  FOUND_MSG_MAX: 200,
  WALK_MAX_DOGS_DEFAULT: 3,
  WALK_MAX_DOGS_CAP: 10,
};

module.exports = {
  COLL,
  CHECKIN_DURATION_MS,
  TAG_CODE_LENGTH,
  SIZE_CLASS,
  GENDER,
  TAGS,
  TAG_LABEL,
  CHECKIN_STATUS,
  WALK_STATUS,
  MEMBER_STATUS,
  TEMPLATE_KEYS,
  LIMITS,
};
