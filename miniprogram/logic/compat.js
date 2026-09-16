/**
 * 合拍度提示 —— spec 3.3.6,owner: T10。
 *
 * 为什么单独一个文件:规则是产品口径,改得最勤(加一条「别带球」、把某条从 info 提成 warn)。
 * 规则表 RULES 导出成数组,以后改规则只动这里,约遛详情页一行都不用碰。
 *
 * 纯函数:不 require 页面、不碰 wx、不看时间。入参是两组 DogCard(spec 3.2.3),
 * 只读 name / sizeClass / tags 三个字段,脏数据(缺 tags、元素是 null)不许抛。
 *
 * 文案口径:我方的狗前面加「你的」,对方的狗直呼其名 —— 一句话里两只狗都点名,
 * 主人才知道说的是谁。
 */

/** @typedef {{dogId?:string, name?:string, sizeClass?:string, tags?:string[]}} DogCard */

/** 只留下像 DogCard 的元素,null / 字符串一律滤掉 */
function listOf(v) {
  return Array.isArray(v) ? v.filter((d) => d && typeof d === 'object') : [];
}

function nameOf(d) {
  return (d && d.name) || '它';
}

/** 我方的狗叫「你的旺财」,对方的狗叫「旺财」 */
function who(d, isMine) {
  return (isMine ? '你的' : '') + nameOf(d);
}

function hasTag(d, tag) {
  return !!d && Array.isArray(d.tags) && d.tags.indexOf(tag) >= 0;
}

function firstWithTag(dogs, tag) {
  for (let i = 0; i < dogs.length; i += 1) {
    if (hasTag(dogs[i], tag)) return dogs[i];
  }
  return null;
}

function firstOfSize(dogs, size) {
  for (let i = 0; i < dogs.length; i += 1) {
    if (dogs[i] && dogs[i].sizeClass === size) return dogs[i];
  }
  return null;
}

/**
 * 在两组里找「a 组带某标签的狗 × b 组带另一标签的狗」,找不到返回 null。
 * 返回值带 aMine,调用处据此决定「你的」前缀往哪只狗上加。
 */
function crossTag(mine, other, tagA, tagB) {
  let a = firstWithTag(mine, tagA);
  let b = firstWithTag(other, tagB);
  if (a && b) return { a, b, aMine: true };
  a = firstWithTag(other, tagA);
  b = firstWithTag(mine, tagB);
  if (a && b) return { a, b, aMine: false };
  return null;
}

/** 同上,但一边按标签找、一边按体型找 */
function tagVsSize(mine, other, tag, size) {
  let a = firstWithTag(mine, tag);
  let b = firstOfSize(other, size);
  if (a && b) return { a, b, aMine: true };
  a = firstWithTag(other, tag);
  b = firstOfSize(mine, size);
  if (a && b) return { a, b, aMine: false };
  return null;
}

/** 两边按体型配对 */
function sizeVsSize(mine, other, sizeA, sizeB) {
  let a = firstOfSize(mine, sizeA);
  let b = firstOfSize(other, sizeB);
  if (a && b) return { a, b, aMine: true };
  a = firstOfSize(other, sizeA);
  b = firstOfSize(mine, sizeB);
  if (a && b) return { a, b, aMine: false };
  return null;
}

/** 哪一边有这个标签都算,优先点名对方的狗(提醒我注意对方) */
function eitherTag(mine, other, tag) {
  const o = firstWithTag(other, tag);
  if (o) return { dog: o, isMine: false };
  const m = firstWithTag(mine, tag);
  if (m) return { dog: m, isMine: true };
  return null;
}

/**
 * 规则表 —— 每条 { id, level, when(mine, other), text(mine, other) }。
 * when 为真才调 text;两个函数都只读入参,不改。
 * @type {Array<{id:string, level:'warn'|'info', when:Function, text:Function}>}
 */
const RULES = [
  {
    // 唯一一条 warn:小型犬怕大狗时真的可能出事,不是「注意一下」的级别
    id: 'fearsBig-vs-large',
    level: 'warn',
    when: (mine, other) => !!tagVsSize(mine, other, 'fearsBig', 'large'),
    text: (mine, other) => {
      const p = tagVsSize(mine, other, 'fearsBig', 'large');
      if (!p) return '';
      return who(p.a, p.aMine) + '怕大狗,而' + who(p.b, !p.aMine) + '是大型犬,先隔远一点熟悉';
    },
  },
  {
    id: 'size-gap',
    level: 'info',
    when: (mine, other) => !!sizeVsSize(mine, other, 'small', 'large'),
    text: (mine, other) => {
      const p = sizeVsSize(mine, other, 'small', 'large');
      if (!p) return '';
      return who(p.a, p.aMine) + '和' + who(p.b, !p.aMine) + '体型差得多,一开始别让大的扑上去';
    },
  },
  {
    id: 'foodGuard',
    level: 'info',
    when: (mine, other) => !!eitherTag(mine, other, 'foodGuard'),
    text: (mine, other) => {
      const p = eitherTag(mine, other, 'foodGuard');
      if (!p) return '';
      return who(p.dog, p.isMine) + '有点护食,别带零食,也别把两边的吃的摆一起';
    },
  },
  {
    id: 'shy',
    level: 'info',
    when: (mine, other) => !!eitherTag(mine, other, 'shy'),
    text: (mine, other) => {
      const p = eitherTag(mine, other, 'shy');
      if (!p) return '';
      return who(p.dog, p.isMine) + '怕生,先牵着绳慢慢熟悉,别一上来就放开';
    },
  },
  {
    id: 'chaser-vs-calm',
    level: 'info',
    when: (mine, other) => !!crossTag(mine, other, 'chaser', 'calm'),
    text: (mine, other) => {
      const p = crossTag(mine, other, 'chaser', 'calm');
      if (!p) return '';
      return who(p.a, p.aMine) + '爱追跑,' + who(p.b, !p.aMine) + '安静,追急了容易把对方吓着';
    },
  },
];

/**
 * 算出这次约遛的合拍度提示。
 *
 * @param {DogCard[]} myDogs    我带去的狗
 * @param {DogCard[]} otherDogs 对方(发起人 + 已批准成员)的狗
 * @returns {Array<{level:'warn'|'info', text:string}>} 没提示就 []
 */
function compatHints(myDogs, otherDogs) {
  const mine = listOf(myDogs);
  const other = listOf(otherDogs);
  // 有一边还没狗就没什么可比的 —— 比如游客看详情、或者我还没建档
  if (!mine.length || !other.length) return [];

  const hints = [];
  RULES.forEach((rule) => {
    let hit = false;
    let text = '';
    // 规则是会被改的,一条写坏了不该把整页拖白 —— 单条出错就跳过这条
    try {
      hit = !!rule.when(mine, other);
      if (hit) text = String(rule.text(mine, other) || '');
    } catch (e) {
      hit = false;
      text = '';
    }
    if (hit && text) hints.push({ level: rule.level, text });
  });
  return hints;
}

module.exports = { compatHints, RULES };
