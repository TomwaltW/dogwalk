/**
 * tests/logic/dog.test.js —— owner: T1
 *
 * 测的是 miniprogram/logic/dog.js:小程序端的本地校验与纯展示逻辑。
 * 它跟 cloudfunctions/_shared/schema.js 是两个东西 —— 后者是云端契约签名,
 * 本轮仍是 NOT_IMPLEMENTED,这里一行都不碰。
 *
 * 前端不能跨根 require cloudfunctions/(真机打包只含 miniprogram/),
 * 所以枚举在 logic/dog.js 里另有一份副本;这里顺带钉死它与契约一致。
 */

const { fixedClock } = require('../fakes/clock');
const dog = require('../../miniprogram/logic/dog');
const contracts = require('../../cloudfunctions/_shared/contracts');

const now = fixedClock('2026-09-14T19:30:00+08:00');

/** 一只各字段都合法的狗;传 patch 覆盖其中几项 */
function makeDog(patch) {
  return Object.assign(
    {
      name: '旺财',
      breed: '柯基',
      sizeClass: 'medium',
      birthMonth: '2024-03',
      gender: 'male',
      neutered: true,
      avatarFileID: '',
      playStyle: ['chase'],
      temperament: ['friendly'],
      okWithSmallDogs: true,
      socialOk: true,
    },
    patch || {}
  );
}

describe('logic/dog: 年龄', () => {
  test('生日为空串时年龄返回 null', () => {
    expect(dog.ageMonths('', now())).toBeNull();
    expect(dog.formatAge('', now())).toBe('');
  });

  test('生日缺失或格式非法时年龄返回 null', () => {
    expect(dog.ageMonths(undefined, now())).toBeNull();
    expect(dog.ageMonths('2024-3', now())).toBeNull();
    expect(dog.ageMonths('2024-13', now())).toBeNull();
    expect(dog.ageMonths('not-a-month', now())).toBeNull();
  });

  test('按月差算年龄,2024-03 的狗在 2026-09 是 30 个月', () => {
    expect(dog.ageMonths('2024-03', now())).toBe(30);
    expect(dog.formatAge('2024-03', now())).toBe('2岁6个月');
  });

  test('不满一岁按月说,整岁不带零头', () => {
    expect(dog.formatAge('2026-04', now())).toBe('5个月');
    expect(dog.formatAge('2026-09', now())).toBe('不满1个月');
    expect(dog.formatAge('2025-09', now())).toBe('1岁');
  });

  test('生日在未来算不出年龄,返回 null 而不是负数', () => {
    expect(dog.ageMonths('2027-01', now())).toBeNull();
  });

  test('now 不是合法 Date 时返回 null,不抛异常', () => {
    expect(dog.ageMonths('2024-03', undefined)).toBeNull();
    expect(dog.ageMonths('2024-03', new Date('nope'))).toBeNull();
  });
});

describe('logic/dog: validateDog 本地校验', () => {
  test('各字段合法时返回 null', () => {
    expect(dog.validateDog(makeDog())).toBeNull();
  });

  test('sizeClass 非法值被 validateDog 拒绝', () => {
    expect(dog.validateDog(makeDog({ sizeClass: 'huge' }))).toBe('sizeClass');
    expect(dog.validateDog(makeDog({ sizeClass: '' }))).toBe('sizeClass');
    expect(dog.validateDog(makeDog({ sizeClass: undefined }))).toBe('sizeClass');
  });

  test('名字超 12 字符被拒,空名字也被拒', () => {
    expect(dog.validateDog(makeDog({ name: '一二三四五六七八九十十一十二' }))).toBe('name');
    expect(dog.validateDog(makeDog({ name: '   ' }))).toBe('name');
    expect(dog.validateDog(makeDog({ name: '一二三四五六七八九十十一' }))).toBeNull();
  });

  test('gender / birthMonth / 布尔字段各自报自己的字段名', () => {
    expect(dog.validateDog(makeDog({ gender: 'unknown' }))).toBe('gender');
    expect(dog.validateDog(makeDog({ birthMonth: '2024/03' }))).toBe('birthMonth');
    expect(dog.validateDog(makeDog({ birthMonth: '' }))).toBeNull();
    expect(dog.validateDog(makeDog({ neutered: 'yes' }))).toBe('neutered');
    expect(dog.validateDog(makeDog({ socialOk: 1 }))).toBe('socialOk');
  });

  test('playStyle / temperament 必须是枚举子集', () => {
    expect(dog.validateDog(makeDog({ playStyle: ['chase', 'bite'] }))).toBe('playStyle');
    expect(dog.validateDog(makeDog({ temperament: 'friendly' }))).toBe('temperament');
    expect(dog.validateDog(makeDog({ playStyle: [] }))).toBeNull();
  });

  test('partial 模式下缺字段不算错,但给了就得合法', () => {
    expect(dog.validateDog({ name: '旺财' }, { partial: true })).toBeNull();
    expect(dog.validateDog({}, { partial: true })).toBeNull();
    expect(dog.validateDog({ sizeClass: 'huge' }, { partial: true })).toBe('sizeClass');
  });

  test('传进来的不是对象时报 dog', () => {
    expect(dog.validateDog(null)).toBe('dog');
    expect(dog.validateDog('旺财')).toBe('dog');
  });

  test('emptyDog() 是空表单:枚举已填好,名字待填所以不过校验', () => {
    const blank = dog.emptyDog();
    expect(contracts.SIZE_CLASS).toContain(blank.sizeClass);
    expect(blank.playStyle).toEqual([]);
    expect(dog.validateDog(blank)).toBe('name');
    expect(dog.validateDog(Object.assign(blank, { name: '旺财' }))).toBeNull();
  });
});

describe('logic/dog: 枚举副本与冻结契约一致', () => {
  test('SIZE_CLASS / PLAY_STYLE / TEMPERAMENT 与 contracts.js 逐项相同', () => {
    expect(dog.SIZE_CLASS).toEqual(contracts.SIZE_CLASS);
    expect(dog.PLAY_STYLE).toEqual(contracts.PLAY_STYLE);
    expect(dog.TEMPERAMENT).toEqual(contracts.TEMPERAMENT);
  });
});
