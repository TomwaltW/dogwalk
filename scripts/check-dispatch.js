#!/usr/bin/env node
/**
 * 派工包一致性校验 —— 机械验证 docs/dispatch/*.md 这批派工包不会互相打架。
 *
 * 做四件事,任一失败 exit 1:
 *   1. 解析每份派工包的「可写文件白名单」
 *   2. 两两求交集,任何非空交集 = 报错并打印是哪两个任务抢哪个路径
 *   3. 每个白名单路径必须能在 SPEC 3.5 节里找到,且 owner 与文件名一致
 *   4. 每份派工包必须含八个字段的小节标题,缺一个报错并指出缺哪个
 *
 * TΩ 豁免第 2、3 条(它的可写范围是全仓)。
 *
 * 无第三方依赖。用法: node scripts/check-dispatch.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 第二轮的派工包直接放 docs/dispatch/,第一轮的归档在 docs/dispatch/round1/(子目录不参与校验)
const DISPATCH_DIR = path.join(ROOT, 'docs', 'dispatch');
const SPEC = path.join(ROOT, 'docs', 'dev-spec-2026-09-16.md');

/** 文件名 -> SPEC 3.5 表里的 owner 写法。TΩ2 的文件名写成 TOmega2(文件系统友好) */
const TASK_OF_FILE = {
  T6: 'T6', T7: 'T7', T8: 'T8', T9: 'T9', T10: 'T10', T11: 'T11', TOmega2: 'TΩ2',
};
/** 可写范围是全仓、豁免检查 2/3 的任务 */
const EXEMPT = new Set(['TOmega2']);

/** 八个必须存在的小节标题 */
const REQUIRED_SECTIONS = [
  '1. 工作区命令',
  '2. 先读',
  '3. 目标',
  '4. 可写文件白名单',
  '5. 禁改清单',
  '6. 实现要点',
  '7. 逐条验收命令',
  '8. 回执格式',
];

/** 仓库的顶层目录;判断一个路径是不是已经写全了 */
const ROOTS = ['cloudfunctions', 'miniprogram', 'tests', 'docs', 'scripts', 'database', 'review'];

// ------------------------------------------------------------- 路径工具

function segs(p) {
  return p.split('/').filter(Boolean);
}

/** 路径是否已经是从仓库根写起的完整路径 */
function isCanonical(p) {
  return ROOTS.includes(segs(p)[0]);
}

/**
 * SPEC 3.5 的表格里同一行会缩写后续路径,缩写的深度还不统一:
 *   `cloudfunctions/checkin/**`、`checkinCancel/**`      -> 省掉 cloudfunctions/
 *   `miniprogram/pages/index/**`、`pages/spot/**`        -> 省掉 miniprogram/,但保留了 pages/
 *   `tests/pages/index.test.js`、`spot.test.js`          -> 省掉 tests/pages/
 * 统一成完整路径:拿本行第一个路径的「兄弟目录」当前缀,再把前缀尾部和
 * 待补路径头部重叠的段合并掉。
 */
function expand(p, first) {
  if (isCanonical(p)) return p;
  const base = first.replace(/\/\*\*$/, '');
  const prefix = segs(base).slice(0, -1);
  if (!prefix.length) return p;
  const tail = segs(p);
  let overlap = 0;
  const max = Math.min(prefix.length, tail.length);
  for (let n = max; n >= 1; n -= 1) {
    if (prefix.slice(prefix.length - n).join('/') === tail.slice(0, n).join('/')) {
      overlap = n;
      break;
    }
  }
  return prefix.concat(tail.slice(overlap)).join('/');
}

/** 两个路径(可能带 /** 通配)是否有重叠 */
function overlaps(a, b) {
  const ga = a.endsWith('/**');
  const gb = b.endsWith('/**');
  const pa = a.replace(/\/\*\*$/, '');
  const pb = b.replace(/\/\*\*$/, '');
  if (a === '**' || b === '**') return true;
  const under = (child, parent) => {
    const c = segs(child);
    const q = segs(parent);
    return q.length <= c.length && q.every((s, i) => s === c[i]);
  };
  if (ga && gb) return under(pa, pb) || under(pb, pa);
  if (ga) return under(pb, pa);
  if (gb) return under(pa, pb);
  return pa === pb;
}

// --------------------------------------------------------------- 解析

/** 解析 SPEC 3.5 归属表 -> [{ path, owner }],路径已展开成完整形式 */
function parseSpecOwnership(text) {
  const start = text.indexOf('### 3.5 文件归属表');
  if (start < 0) throw new Error('SPEC 里找不到「### 3.5 文件归属表」');
  const rest = text.slice(start);
  const end = rest.indexOf('\n---');
  const block = end < 0 ? rest : rest.slice(0, end);

  const out = [];
  for (const line of block.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
    // | 路径 | owner | 其他任务 |  -> cols = ['', 路径, owner, 其他, '']
    if (cols.length < 4) continue;
    const paths = (cols[1].match(/`([^`]+)`/g) || []).map((s) => s.slice(1, -1));
    const owner = cols[2];
    if (!paths.length || !owner || owner === 'owner') continue;
    const first = paths[0];
    paths.forEach((p) => out.push({ path: expand(p, first), owner }));
  }
  if (!out.length) throw new Error('SPEC 3.5 表解析出 0 行');
  return out;
}

/** 解析一份派工包 -> { writable: [], sections: Set } */
function parseDispatch(text) {
  const sections = new Set();
  for (const m of text.matchAll(/^##\s+(.+?)\s*$/gm)) sections.add(m[1]);

  // 「4. 可写文件白名单」小节里以 - `path` 开头的行
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+4\.\s*可写文件白名单/.test(l));
  const writable = [];
  if (startIdx >= 0) {
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) break;
      const m = lines[i].match(/^-\s+`([^`]+)`/);
      if (m) writable.push(m[1]);
    }
  }
  return { writable, sections };
}

// --------------------------------------------------------------- 主流程

function main() {
  let specText;
  try {
    specText = fs.readFileSync(SPEC, 'utf8');
  } catch (e) {
    console.error('FAIL - 读不到 SPEC: ' + SPEC);
    process.exit(1);
  }

  const ownership = parseSpecOwnership(specText);
  /** 完整路径 -> owner */
  const ownerOf = new Map(ownership.map((r) => [r.path, r.owner]));

  const files = fs
    .readdirSync(DISPATCH_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const tasks = [];
  const failures = [];

  for (const file of files) {
    const name = path.basename(file, '.md');
    const expectedOwner = TASK_OF_FILE[name];
    const text = fs.readFileSync(path.join(DISPATCH_DIR, file), 'utf8');
    const { writable, sections } = parseDispatch(text);
    const reasons = [];
    let checksRun = 0;

    if (!expectedOwner) {
      reasons.push(`文件名 ${file} 不在已知任务表里(T6-T11 / TOmega2)`);
    }

    // --- 检查 1: 白名单解析得出来
    checksRun += 1;
    if (!writable.length) {
      reasons.push('「4. 可写文件白名单」小节里解析不到任何 `- `path`` 条目');
    }

    // --- 检查 4: 八个小节标题
    checksRun += 1;
    const missing = REQUIRED_SECTIONS.filter((s) => !sections.has(s));
    if (missing.length) {
      reasons.push('缺小节: ' + missing.join(' / '));
    }

    // --- 检查 3: 每个白名单路径在 SPEC 3.5 里找得到且 owner 一致
    const exempt = EXEMPT.has(name);
    if (!exempt) {
      checksRun += 1;
      for (const p of writable) {
        if (!ownerOf.has(p)) {
          reasons.push(`白名单路径 \`${p}\` 在 SPEC 3.5 表里找不到`);
        } else if (ownerOf.get(p) !== expectedOwner) {
          reasons.push(
            `白名单路径 \`${p}\` 在 SPEC 3.5 里 owner 是 ${ownerOf.get(p)},与文件名 ${name} 不符`
          );
        }
      }
    }

    tasks.push({ name, file, writable, reasons, checksRun, exempt });
    if (reasons.length) failures.push(name);
  }

  // --- 检查 2: 两两求交集
  let conflicts = 0;
  const conflictOf = new Map();
  const cmp = tasks.filter((t) => !t.exempt);
  for (let i = 0; i < cmp.length; i += 1) {
    for (let j = i + 1; j < cmp.length; j += 1) {
      const a = cmp[i];
      const b = cmp[j];
      for (const pa of a.writable) {
        for (const pb of b.writable) {
          if (overlaps(pa, pb)) {
            conflicts += 1;
            const msg =
              `可写范围与 ${b.name} 相撞: \`${pa}\` ∩ \`${pb}\``;
            conflictOf.set(a.name, (conflictOf.get(a.name) || []).concat(msg));
            conflictOf.set(
              b.name,
              (conflictOf.get(b.name) || []).concat(
                `可写范围与 ${a.name} 相撞: \`${pb}\` ∩ \`${pa}\``
              )
            );
          }
        }
      }
    }
  }
  for (const t of tasks) {
    if (!t.exempt) t.checksRun += 1;
    const c = conflictOf.get(t.name);
    if (c) {
      t.reasons = t.reasons.concat(c);
      if (!failures.includes(t.name)) failures.push(t.name);
    }
  }

  // --- 输出
  for (const t of tasks) {
    if (t.reasons.length) {
      for (const r of t.reasons) console.log(`FAIL ${t.name} ${r}`);
    } else {
      console.log(
        `OK   ${t.name} writable=${t.writable.length} checks=${t.checksRun}`
      );
    }
  }

  const pass = failures.length === 0 && conflicts === 0;
  console.log(
    `DISPATCH-CHECK ${pass ? 'pass' : 'fail'} tasks=${tasks.length} conflicts=${conflicts}`
  );
  process.exit(pass ? 0 : 1);
}

main();
