/**
 * 订阅消息额度记账 —— owner: T3。纯逻辑:不碰 wx.*、不碰 db、无定时器。
 *
 * 口径来自 spec 3.2 的 users.subQuota(`{ [templateKey]: Number }`,自己记账)
 * 与 spec 3.4「订阅消息额度为 0 → 不报错,正常返回,notified 计数不含该用户」。
 *
 * 微信的一次性订阅是「授权一次攒一条」:用户每同意一次就 grant() 一条,
 * 后端每发出一条就 deduct() 一条。额度不够不是错误,是「这次不发」。
 *
 * templateKey 在这里刻意保持不透明 —— 三个模板(出门提醒 / 狗牌被扫 / 走失广播)
 * 的模板 ID 由总管在小程序后台申请(spec 8),本轮契约里没有,所以不写死任何 key。
 *
 * 记账函数就地修改传入的 subQuota,调用方负责写回 users 文档;
 * 需要不可变语义的调用方自己传副本。
 */

/**
 * 某个模板还剩几条。脏数据(缺失 / 非数字 / NaN / Infinity / 负数)一律当 0,
 * 小数向下取整。任何入参都不抛错。
 *
 * @param {object} subQuota    users.subQuota
 * @param {string} templateKey 订阅消息模板 key
 * @returns {number} 非负整数
 */
function remaining(subQuota, templateKey) {
  if (!subQuota || typeof subQuota !== 'object') return 0;
  if (typeof templateKey !== 'string' || templateKey === '') return 0;
  const n = subQuota[templateKey];
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * 这条订阅消息现在发得出去吗。
 *
 * @param {object} subQuota
 * @param {string} templateKey
 * @returns {boolean}
 */
function canSend(subQuota, templateKey) {
  return remaining(subQuota, templateKey) > 0;
}

/**
 * 扣 1 条额度(就地)。
 *
 * 额度为 0、templateKey 不存在、subQuota 整个缺失 —— 都当 0 处理:
 * 返回 false、不抛错、不改动 subQuota(也不会凭空建出一个 key)。
 *
 * @param {object} subQuota
 * @param {string} templateKey
 * @returns {boolean} 扣成功为 true
 */
function deduct(subQuota, templateKey) {
  const left = remaining(subQuota, templateKey);
  if (left <= 0) return false;
  subQuota[templateKey] = left - 1;
  return true;
}

/**
 * 发放额度(就地)。用户每授权一次调一次,默认 +1。
 * 非法入参不抛错:subQuota / templateKey 不可用时返回 0,count 非正数时原样返回余额。
 *
 * @param {object} subQuota
 * @param {string} templateKey
 * @param {number} [count=1] 发放条数,向下取整
 * @returns {number} 发放后的余额
 */
function grant(subQuota, templateKey, count) {
  if (!subQuota || typeof subQuota !== 'object') return 0;
  if (typeof templateKey !== 'string' || templateKey === '') return 0;
  const left = remaining(subQuota, templateKey);
  const add =
    count === undefined
      ? 1
      : typeof count === 'number' && Number.isFinite(count)
        ? Math.floor(count)
        : 0;
  if (add <= 0) return left;
  subQuota[templateKey] = left + add;
  return subQuota[templateKey];
}

module.exports = { remaining, canSend, deduct, grant };
