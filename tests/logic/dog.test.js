/**
 * tests/logic/dog.test.js —— owner: T6(第二轮改到契约 v2)
 *
 * 测的是 miniprogram/logic/dog.js:小程序端的本地校验与纯展示逻辑。
 * 前端拦截只为省一次往返,**不是**安全边界 —— 云端 dogCRUD 照样全量校验一遍。
 *
 * 枚举本轮统一从 miniprogram/logic/enums.js 取(T0' 提供的契约镜像,
 * tests/shared/enums.test.js 已钉死它与 contracts.js 一致),这里再顺手比一次 TAGS。
 *
 * 派工包 T6-c 要求覆盖:validateDog 拒绝非法 tag;formatAge('', now) === ''。
 */

const { fixedClock } = require('../fakes/clock');
const dog = require('../../miniprogram/logic/dog');
const contracts = require('../../cloudfunctions/_shared/contracts');

const now = fixedClock('2026-09-16T10:00:00+08:00');

/** 一只各字段都合法的狗(契约 v2);传 patch 覆盖其中几项 */
function makeDog(patch) {
  return Object.assign(
    {
      name: '旺财',
      breed: '柯基',
      sizeClass: 'medium',
      birthMonth: '2024-03',
      gender: 'male',
      neutered: true,
      vaccinated: true,
      licenseNo: 'HZ-2024-0001',
      tags: ['ball', 'calm'],
      avatarFileID: '',
    },
    patch || {}
  );
}

describe('logic/dog: 年龄', () => {
  test('生日为空串时年龄返回 null,formatAge 返回空串', () => {
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

describe('logic/dog: validateDog 本地校验(契约 v2)', () => {
  test('各字段合法时返回 null', () => {
    expect(dog.validateDog(makeDog())).toBeNull();
  });

  test('validateDog 拒绝非法 tag', () => {
    expect(dog.validateDog(makeDog({ tags: ['ball', 'bite'] }))).toBe('tags');
    expect(dog.validateDog(makeDog({ tags: 'ball' }))).toBe('tags');
    expect(dog.validateDog(makeDog({ tags: [] }))).toBeNull();
    expect(dog.validateDog(makeDog({ tags: contracts.TAGS.slice() }))).toBeNull();
  });

  test('sizeClass 非法值被拒', () => {
    expect(dog.validateDog(makeDog({ sizeClass: 'huge' }))).toBe('sizeClass');
    expect(dog.validateDog(makeDog({ sizeClass: '' }))).toBe('sizeClass');
    expect(dog.validateDog(makeDog({ sizeClass: undefined }))).toBe('sizeClass');
  });

  test('名字按码位数算 1-12:12 个 emoji 合法,13 个被拒,空白也被拒', () => {
    expect(dog.validateDog(makeDog({ name: '🐶'.repeat(12) }))).toBeNull();
    expect(dog.validateDog(makeDog({ name: '🐶'.repeat(13) }))).toBe('name');
    expect(dog.validateDog(makeDog({ name: '一二三四五六七八九十十一十二' }))).toBe('name');
    expect(dog.validateDog(makeDog({ name: '   ' }))).toBe('name');
    expect(dog.validateDog(makeDog({ name: '一二三四五六七八九十十一' }))).toBeNull();
  });

  test('breed ≤ 20 / licenseNo ≤ 32 / lostNote ≤ 50', () => {
    const { LIMITS } = contracts;
    expect(dog.validateDog(makeDog({ breed: '字'.repeat(LIMITS.BREED_MAX) }))).toBeNull();
    expect(dog.validateDog(makeDog({ breed: '字'.repeat(LIMITS.BREED_MAX + 1) }))).toBe('breed');
    expect(dog.validateDog(makeDog({ licenseNo: 'x'.repeat(LIMITS.LICENSE_MAX) }))).toBeNull();
    expect(dog.validateDog(makeDog({ licenseNo: 'x'.repeat(LIMITS.LICENSE_MAX + 1) }))).toBe(
      'licenseNo'
    );
    expect(dog.validateDog(makeDog({ lostNote: '字'.repeat(LIMITS.LOST_NOTE_MAX) }))).toBeNull();
    expect(dog.validateDog(makeDog({ lostNote: '字'.repeat(LIMITS.LOST_NOTE_MAX + 1) }))).toBe(
      'lostNote'
    );
  });

  test('gender / birthMonth / 布尔字段各自报自己的字段名', () => {
    expect(dog.validateDog(makeDog({ gender: 'unknown' }))).toBe('gender');
    expect(dog.validateDog(makeDog({ birthMonth: '2024/03' }))).toBe('birthMonth');
    expect(dog.validateDog(makeDog({ birthMonth: '' }))).toBeNull();
    expect(dog.validateDog(makeDog({ neutered: 'yes' }))).toBe('neutered');
    expect(dog.validateDog(makeDog({ vaccinated: 1 }))).toBe('vaccinated');
    expect(dog.validateDog(makeDog({ lostMode: 'on' }))).toBe('lostMode');
  });

  test('partial 模式下缺字段不算错,但给了就得合法', () => {
    expect(dog.validateDog({ name: '旺财' }, { partial: true })).toBeNull();
    expect(dog.validateDog({}, { partial: true })).toBeNull();
    expect(dog.validateDog({ sizeClass: 'huge' }, { partial: true })).toBe('sizeClass');
    expect(dog.validateDog({ tags: ['bite'] }, { partial: true })).toBe('tags');
  });

  test('全量模式下必填的只有 name / sizeClass / gender', () => {
    expect(dog.validateDog({ name: '旺财', sizeClass: 'small', gender: 'female' })).toBeNull();
    expect(dog.validateDog({ sizeClass: 'small', gender: 'female' })).toBe('name');
    expect(dog.validateDog({ name: '旺财', gender: 'female' })).toBe('sizeClass');
    expect(dog.validateDog({ name: '旺财', sizeClass: 'small' })).toBe('gender');
  });

  test('传进来的不是对象时报 dog', () => {
    expect(dog.validateDog(null)).toBe('dog');
    expect(dog.validateDog('旺财')).toBe('dog');
  });

  test('emptyDog() 是空表单:枚举已填好,名字待填所以不过校验', () => {
    const blank = dog.emptyDog();
    expect(contracts.SIZE_CLASS).toContain(blank.sizeClass);
    expect(contracts.GENDER).toContain(blank.gender);
    expect(blank.tags).toEqual([]);
    expect(blank.vaccinated).toBe(false);
    expect(blank.licenseNo).toBe('');
    expect(dog.validateDog(blank)).toBe('name');
    expect(dog.validateDog(Object.assign(blank, { name: '旺财' }))).toBeNull();
  });

  test('emptyDog() 不带 lostMode / lostNote —— 走失开关在身份牌页,不该被档案表单顺手覆盖', () => {
    const blank = dog.emptyDog();
    expect(blank).not.toHaveProperty('lostMode');
    expect(blank).not.toHaveProperty('lostNote');
  });

  test('emptyDog() 的字段恰好是档案表单要填的那些,第一轮的字段一个不留', () => {
    expect(Object.keys(dog.emptyDog()).sort()).toEqual(
      [
        'name',
        'breed',
        'sizeClass',
        'birthMonth',
        'gender',
        'neutered',
        'vaccinated',
        'licenseNo',
        'tags',
        'avatarFileID',
      ].sort()
    );
  });
});

describe('logic/dog: 枚举与冻结契约一致', () => {
  test('SIZE_CLASS / GENDER / TAGS 与 contracts.js 逐项相同', () => {
    expect(dog.SIZE_CLASS).toEqual(contracts.SIZE_CLASS);
    expect(dog.GENDER).toEqual(contracts.GENDER);
    expect(dog.TAGS).toEqual(contracts.TAGS);
  });

  test('模块对外只导出这些,第一轮的枚举副本已经不在了', () => {
    expect(Object.keys(dog).sort()).toEqual(
      [
        'SIZE_CLASS',
        'GENDER',
        'TAGS',
        'LIMITS',
        'NAME_MAX',
        'emptyDog',
        'validateDog',
        'ageMonths',
        'formatAge',
      ].sort()
    );
  });
});
