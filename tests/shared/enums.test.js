/** 前端枚举镜像 miniprogram/logic/enums.js 必须与 _shared/contracts.js 逐项一致 —— T0' owner。 */
const enums = require('../../miniprogram/logic/enums');
const contracts = require('../../cloudfunctions/_shared/contracts');

describe('enums 与 contracts 一致', () => {
  test.each([
    'SIZE_CLASS', 'GENDER', 'TAGS', 'TAG_LABEL', 'CHECKIN_STATUS', 'WALK_STATUS', 'MEMBER_STATUS',
    'CHECKIN_DURATION_MS', 'TAG_CODE_LENGTH', 'TEMPLATE_KEYS', 'LIMITS',
  ])('%s', (key) => {
    expect(enums[key]).toEqual(contracts[key]);
  });

  test('前端不镜像过渡期的旧常量', () => {
    expect(enums.PLAY_STYLE).toBeUndefined();
    expect(enums.TEMPERAMENT).toBeUndefined();
  });
});

describe('enums 的文案工具', () => {
  test('labelOf / labelsOfTags / optionsOf', () => {
    expect(enums.labelOf(enums.SIZE_LABEL, 'large')).toBe('大型犬');
    expect(enums.labelOf(enums.SIZE_LABEL, 'huge')).toBe('huge');
    expect(enums.labelsOfTags(['ball', 'shy'])).toBe('爱玩球 / 怕生');
    expect(enums.labelsOfTags([])).toBe('');
    expect(enums.optionsOf(enums.GENDER, enums.GENDER_LABEL)).toEqual([
      { value: 'male', label: '公' },
      { value: 'female', label: '母' },
    ]);
  });

  test('charLength 按码位数', () => {
    expect(enums.charLength('🐶a')).toBe(2);
    expect(enums.charLength('')).toBe(0);
    expect(enums.charLength(null)).toBe(0);
  });
});
