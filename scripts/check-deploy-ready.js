#!/usr/bin/env node
/**
 * 上云前离线自检 —— 纯本地读文件,判断「现在去部署,本地这一侧准备好了没有」。
 *
 * 七项检查,每项输出一行 `OK   <name>` 或 `FAIL <name> <说明>`,末行 `SUMMARY ok=<n> fail=<m>`。
 * 全过 exit 0,有 FAIL exit 1。
 *
 *   env-id               miniprogram/config.js 的 ENV_ID 已填(非空、不以 << 开头)
 *   subscribe-template   同文件 SUBSCRIBE_TEMPLATES.foundReport 已填
 *   appid                project.config.json 的 appid 已填
 *   dist-functions       dist/cloudfunctions/ 下正好 12 个目录,且与 cloudfunctions/ 去掉 _shared 一致
 *   openapi-permissions  dogCRUD / genTagCode / reportFound / walkOps 的 openapi 声明被原样带进 dist/
 *   rules-vs-coll        database/rules/*.json 的文件名集合 = contracts.js 的 COLL 值集合
 *   no-inplace-shared    cloudfunctions/*\/_shared 一个都不存在(没被 deploy-shared --in-place 污染)
 *
 * 注意:这里全绿只说明本地产物齐了,**不说明云端把 openapi 权限应用上了**。
 * 云端是否生效只能靠 docs/deploy-acceptance.md 里的两条正面证据判断。
 *
 * 不联网、不跑 tcb / cloudbase、不写任何文件。无第三方依赖。
 * 用法: node scripts/check-deploy-ready.js [--root <目录> | --root=<目录>]   (缺省 = 仓库根;其它参数 exit 2)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 带 openapi 权限声明的云函数 */
const OPENAPI_FUNCS = ['dogCRUD', 'genTagCode', 'reportFound', 'walkOps'];
/** 只钉这两条:分别决定身份牌二维码空不空白、寻回订阅消息发不发得出 */
const REQUIRED_OPENAPI = {
  genTagCode: 'wxacode.getUnlimited',
  reportFound: 'subscribeMessage.send',
};
const EXPECTED_FUNC_COUNT = 12;

function usageExit(msg) {
  console.error(`${msg}\n用法: node scripts/check-deploy-ready.js [--root <目录> | --root=<目录>]`);
  process.exit(2);
}

/** 只认 --root <目录> 与 --root=<目录>;其余参数一律 exit 2,免得打错参数静默转去查真仓库 */
function parseArgs(argv) {
  let root = ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') {
      if (!argv[i + 1]) usageExit('--root 后面要跟一个目录');
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else if (a.startsWith('--root=')) {
      const v = a.slice('--root='.length);
      if (!v) usageExit('--root= 后面要跟一个目录');
      root = path.resolve(v);
    } else {
      usageExit(`未识别的参数: ${a}`);
    }
  }
  return root;
}

/** 错误说明只留第一行,Node 的 Require stack 等多行内容不带出来,保住「一检查一行」 */
function firstLine(e) {
  return String(e && e.message).split('\n')[0];
}

function listDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function sameSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** 占位符判法与 miniprogram/config.js 的 isPlaceholder() 一致 */
function placeholderReason(v) {
  if (typeof v !== 'string') return `不是字符串(${JSON.stringify(v)})`;
  if (v === '') return '是空串';
  if (v.indexOf('<<') === 0) return `仍是占位符 ${v}`;
  return null;
}

// ------------------------------------------------------------- 各项检查
// 每个检查返回 null(通过)或一段说明(失败)

function checkConfigValue(root, pick, label) {
  let cfg;
  try {
    cfg = require(path.resolve(root, 'miniprogram', 'config.js'));
  } catch (e) {
    return `读不了 miniprogram/config.js: ${firstLine(e)}`;
  }
  const reason = placeholderReason(pick(cfg));
  return reason && `${label} ${reason}`;
}

function checkAppid(root) {
  const file = path.join(root, 'project.config.json');
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return `读不了 project.config.json: ${firstLine(e)}`;
  }
  const reason = placeholderReason(json.appid);
  return reason && `project.config.json appid ${reason}`;
}

function checkDistFunctions(root) {
  const srcDir = path.join(root, 'cloudfunctions');
  const distDir = path.join(root, 'dist', 'cloudfunctions');
  if (!fs.existsSync(distDir)) return 'dist/cloudfunctions/ 不存在,先跑 npm run deploy:shared';
  const src = listDirs(srcDir).filter((n) => n !== '_shared');
  const dist = listDirs(distDir);
  const problems = [];
  if (dist.length !== EXPECTED_FUNC_COUNT) problems.push(`dist 下有 ${dist.length} 个目录,应为 ${EXPECTED_FUNC_COUNT}`);
  if (!sameSet(src, dist)) {
    const missing = src.filter((n) => !dist.includes(n));
    const extra = dist.filter((n) => !src.includes(n));
    problems.push(`与 cloudfunctions/ 不一致: dist 缺 [${missing.join(',')}] 多 [${extra.join(',')}]`);
  }
  return problems.length ? problems.join('; ') : null;
}

function readOpenapi(file) {
  if (!fs.existsSync(file)) return { err: '不存在' };
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { err: `JSON 解析失败(${firstLine(e)})` };
  }
  const list = json && json.permissions && json.permissions.openapi;
  if (!Array.isArray(list) || list.length === 0) return { err: 'permissions.openapi 不是非空数组' };
  return { list };
}

function checkOpenapi(root) {
  const problems = [];
  for (const fn of OPENAPI_FUNCS) {
    const src = readOpenapi(path.join(root, 'cloudfunctions', fn, 'config.json'));
    const dist = readOpenapi(path.join(root, 'dist', 'cloudfunctions', fn, 'config.json'));
    if (src.err || dist.err) {
      if (src.err) problems.push(`${fn}: src config.json ${src.err}`);
      if (dist.err) problems.push(`${fn}: dist config.json ${dist.err}`);
      continue;
    }
    const s = JSON.stringify(src.list);
    const d = JSON.stringify(dist.list);
    if (s !== d) {
      problems.push(`${fn}: src 与 dist 的 openapi 不一致 src=${s} dist=${d}`);
      continue;
    }
    const need = REQUIRED_OPENAPI[fn];
    if (need && !src.list.includes(need)) problems.push(`${fn}: openapi 缺 ${need},现为 ${s}`);
  }
  return problems.length ? problems.join('; ') : null;
}

function checkRulesVsColl(root) {
  let COLL;
  try {
    ({ COLL } = require(path.resolve(root, 'cloudfunctions', '_shared', 'contracts.js')));
  } catch (e) {
    return `读不了 cloudfunctions/_shared/contracts.js: ${firstLine(e)}`;
  }
  const colls = Object.values(COLL).sort();
  const rulesDir = path.join(root, 'database', 'rules');
  if (!fs.existsSync(rulesDir)) return 'database/rules/ 不存在';
  const rules = fs
    .readdirSync(rulesDir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -'.json'.length))
    .sort();
  if (sameSet(rules, colls)) return null;
  const missing = colls.filter((n) => !rules.includes(n));
  const extra = rules.filter((n) => !colls.includes(n));
  return `rules 缺 [${missing.join(',')}] 多 [${extra.join(',')}](COLL 共 ${colls.length} 个,rules 共 ${rules.length} 个)`;
}

function checkNoInplaceShared(root) {
  const srcDir = path.join(root, 'cloudfunctions');
  const dirty = listDirs(srcDir).filter(
    (n) => n !== '_shared' && fs.existsSync(path.join(srcDir, n, '_shared')),
  );
  return dirty.length
    ? `这些函数目录下有 _shared(被 --in-place 污染过): ${dirty.join(',')}`
    : null;
}

// ------------------------------------------------------------- main

function main() {
  const root = parseArgs(process.argv.slice(2));
  const checks = [
    ['env-id', () => checkConfigValue(root, (c) => c.ENV_ID, 'config.js ENV_ID')],
    [
      'subscribe-template',
      () =>
        checkConfigValue(
          root,
          (c) => c.SUBSCRIBE_TEMPLATES && c.SUBSCRIBE_TEMPLATES.foundReport,
          'config.js SUBSCRIBE_TEMPLATES.foundReport',
        ),
    ],
    ['appid', () => checkAppid(root)],
    ['dist-functions', () => checkDistFunctions(root)],
    ['openapi-permissions', () => checkOpenapi(root)],
    ['rules-vs-coll', () => checkRulesVsColl(root)],
    ['no-inplace-shared', () => checkNoInplaceShared(root)],
  ];

  let ok = 0;
  let fail = 0;
  for (const [name, run] of checks) {
    let msg;
    try {
      msg = run();
    } catch (e) {
      msg = `检查本身出错: ${firstLine(e)}`;
    }
    if (msg) {
      fail += 1;
      console.log(`FAIL ${name} ${msg}`);
    } else {
      ok += 1;
      console.log(`OK   ${name}`);
    }
  }
  console.log(`SUMMARY ok=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

main();
