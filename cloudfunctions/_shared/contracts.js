/**
 * 集合名与枚举常量 —— spec 3.2,冻结契约。
 * 集合名一律从这里导入,禁止在业务代码里硬编码字符串。
 */

const COLL = {
  USERS: 'users',
  DOGS: 'dogs',
  SPOTS: 'spots',
  CHECKINS: 'checkins',
  ENCOUNTERS: 'encounters',
  SCAN_LOGS: 'scanLogs',
};

const CHECKIN_DURATION_MS = 90 * 60 * 1000; // 广播有效期,固定 90 分钟
const TAG_CODE_LENGTH = 6; // 狗牌短码长度,小程序码 scene 上限 32 字符

const SIZE_CLASS = ['small', 'medium', 'large'];
const PLAY_STYLE = ['chase', 'wrestle', 'solo'];
const TEMPERAMENT = ['friendly', 'shy', 'jumpy', 'antisocial'];
const CHECKIN_STATUS = ['active', 'cancelled'];

module.exports = {
  COLL,
  CHECKIN_DURATION_MS,
  TAG_CODE_LENGTH,
  SIZE_CLASS,
  PLAY_STYLE,
  TEMPERAMENT,
  CHECKIN_STATUS,
};
