#!/usr/bin/env node
/**
 * 把 cloudfunctions/_shared/ 发到每个云函数目录,并处理 spec 3.3.1 那条路径差异。
 *
 * 路径差异是这样来的:
 *   仓库里   cloudfunctions/<fn>/core.js 写 require('../_shared/errors')  —— 本地测试能 resolve
 *   部署后   函数包的根就是 <fn>/ 本身,'../' 已经在包外  —— 必须改成 './_shared/errors'
 * 约定(spec 3.3.1):core.js / index.js 一律写 '../_shared/xxx',由本脚本负责重写;
 * _shared 的 require 只许出现在这两个文件里。
 *
 * 两种模式:
 *   默认(--dist)      产出到 dist/cloudfunctions/<fn>/,仓库源文件一行不动。
 *                     并行开发期间用这个 —— 不会碰到任何人的 owner 文件。
 *   --in-place        就地把 _shared 复制进 cloudfunctions/<fn>/ 并重写其中的 core.js。
 *                     只在要用微信开发者工具直接右键上传源目录时用。
 *                     它会改写 T1-T3 owner 的 core.js,跑完记得 git checkout 还原。
 *
 * 用法:
 *   npm run deploy:shared
 *   node scripts/deploy-shared.js --in-place
 *   node scripts/deploy-shared.js --only login,dogCRUD
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF_DIR = path.join(ROOT, 'cloudfunctions');
const SHARED = path.join(CF_DIR, '_shared');
const DIST = path.join(ROOT, 'dist', 'cloudfunctions');

function parseArgs(argv) {
  const out = { inPlace: false, only: null };
  argv.forEach((a, i) => {
    if (a === '--in-place') out.inPlace = true;
    else if (a === '--dist') out.inPlace = false;
    else if (a === '--only') out.only = (argv[i + 1] || '').split(',').filter(Boolean);
  });
  return out;
}

/** cloudfunctions/ 下除 _shared 外、含 index.js 的目录 */
function listFunctions() {
  return fs
    .readdirSync(CF_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(CF_DIR, n, 'index.js')))
    .sort();
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '_shared') continue;
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/** require('../_shared/x') / require("../_shared/x") → './_shared/x' */
function rewriteSharedRequire(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    /require\((['"])\.\.\/_shared\//g,
    (m, q) => 'require(' + q + './_shared/'
  );
  if (after !== before) {
    fs.writeFileSync(file, after);
    return true;
  }
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(SHARED)) {
    console.error('找不到 ' + path.relative(ROOT, SHARED));
    process.exit(1);
  }

  let fns = listFunctions();
  if (args.only) {
    const missing = args.only.filter((n) => !fns.includes(n));
    if (missing.length) {
      console.error('这些云函数不存在: ' + missing.join(', '));
      process.exit(1);
    }
    fns = args.only;
  }
  if (!fns.length) {
    console.error('cloudfunctions/ 下没有找到任何云函数');
    process.exit(1);
  }

  const mode = args.inPlace ? 'in-place' : 'dist';
  console.log('模式: ' + mode + ',云函数 ' + fns.length + ' 个');

  fns.forEach((fn) => {
    const target = args.inPlace ? path.join(CF_DIR, fn) : path.join(DIST, fn);

    if (!args.inPlace) {
      fs.rmSync(target, { recursive: true, force: true });
      copyDir(path.join(CF_DIR, fn), target);
    }

    copyDir(SHARED, path.join(target, '_shared'));

    // 只重写 core.js 与 index.js 两个文件(spec 3.3.1):_shared 的 require 只许出现在这两处
    const rewritten = ['core.js', 'index.js'].filter((f) => {
      const file = path.join(target, f);
      return fs.existsSync(file) && rewriteSharedRequire(file);
    });

    console.log(
      '  ' +
        fn +
        ' -> ' +
        path.relative(ROOT, target) +
        (rewritten.length ? '  (' + rewritten.join(' / ') + ' 路径已重写)' : '')
    );
  });

  if (args.inPlace) {
    console.log('\n注意: --in-place 改写了 cloudfunctions/*/{core,index}.js,上传完请 git checkout 还原。');
  } else {
    console.log('\n上传时把 ' + path.relative(ROOT, DIST) + '/<fn> 当作云函数根目录。');
  }
}

main();
