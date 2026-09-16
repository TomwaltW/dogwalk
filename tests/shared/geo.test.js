/** _shared/geo.js 的自测 —— T0' owner。围栏判定全靠它,数字要钉死。 */
const { distanceM, isLatLng, EARTH_RADIUS_M } = require('../../cloudfunctions/_shared/geo');

describe('geo.isLatLng', () => {
  test('合法坐标', () => {
    expect(isLatLng(30.27, 120.15)).toBe(true);
    expect(isLatLng(-90, 180)).toBe(true);
    expect(isLatLng(0, 0)).toBe(true);
  });
  test('非法坐标:超界 / 非数 / NaN / 字符串', () => {
    expect(isLatLng(90.1, 0)).toBe(false);
    expect(isLatLng(0, -180.5)).toBe(false);
    expect(isLatLng(NaN, 0)).toBe(false);
    expect(isLatLng('30', 120)).toBe(false);
    expect(isLatLng(null, 120)).toBe(false);
    expect(isLatLng(Infinity, 0)).toBe(false);
  });
});

describe('geo.distanceM', () => {
  test('同一点为 0', () => {
    expect(distanceM(30.2741, 120.1551, 30.2741, 120.1551)).toBe(0);
  });
  test('杭州纬度上经度差 0.01° 约 961 米', () => {
    const d = distanceM(30.2741, 120.1551, 30.2741, 120.1651);
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(975);
  });
  test('纬度差 0.01° 约 1112 米,与经度无关', () => {
    const d = distanceM(30, 120, 30.01, 120);
    expect(d).toBeGreaterThan(1105);
    expect(d).toBeLessThan(1120);
  });
  test('对称', () => {
    expect(distanceM(30, 120, 31, 121)).toBeCloseTo(distanceM(31, 121, 30, 120), 6);
  });
  test('任一坐标非法返回 NaN,不抛', () => {
    expect(Number.isNaN(distanceM(NaN, 120, 30, 120))).toBe(true);
    expect(Number.isNaN(distanceM(30, 120, 30, 181))).toBe(true);
  });
  test('地球半径常量', () => {
    expect(EARTH_RADIUS_M).toBe(6371000);
  });
});
