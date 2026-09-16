/**
 * 地理计算 —— spec 3.3.2 checkin 的围栏判定用,纯函数,T0' 提供。
 *
 * 云开发数据库有地理查询,但 fake-db 不支持(spec 3.3.5),而围栏判定只需要
 * 「一个点到一个圆心的距离」,球面 haversine 足够,误差远小于公园半径。
 */

const EARTH_RADIUS_M = 6371000;

/**
 * 坐标是否合法:都是有限数,且在 ±90 / ±180 内。
 * @param {*} lat
 * @param {*} lng
 * @returns {boolean}
 */
function isLatLng(lat, lng) {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180
  );
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * 两点球面距离(米),haversine。
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} 任一坐标非法时返回 NaN
 */
function distanceM(lat1, lng1, lat2, lng2) {
  if (!isLatLng(lat1, lng1) || !isLatLng(lat2, lng2)) return NaN;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = { EARTH_RADIUS_M, isLatLng, distanceM };
