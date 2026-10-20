// 从 tools/vendor/ 的源站模块源码生成 lib/ 数据文件
// 前置：用 extract-modules.cjs 切出的 847558.js / 510584.js / 167711.js 放入 tools/vendor/
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, 'vendor');
const OUT = path.join(__dirname, '..', 'lib');
for (const f of ['847558.js', '510584.js', '167711.js']) {
  if (!fs.existsSync(path.join(VENDOR, f))) {
    console.error(`缺少 ${VENDOR}/${f}，请先用 extract-modules.cjs 提取`);
    process.exit(1);
  }
}
fs.mkdirSync(OUT, { recursive: true });

// ---------- lib/math-utils.js（模块 847558） ----------
const u = fs.readFileSync(path.join(VENDOR, '847558.js'), 'utf8');
const uBody = u.slice(1, u.lastIndexOf('}'));
const uCut = uBody.indexOf('e.s([');
const uCode = uBody.slice(0, uCut).replace(/;\s*$/, ';');
const uExports = {
  areDigitsContiguous: 'g', findArithmeticSplit: 'S', findConsecutiveNAdjacent: 'O',
  findConsecutivePairAdjacent: 'T', findConsecutivePairExact: 'E', findConsecutivePairNearby: 'j',
  findConsecutiveQuadExact: 'C', findConsecutiveTripleExact: 'x', findEquation: 'w',
  findGeometricSplit: 'A', getDigitCounts: 'l', hasEvenSpacing: 'm', hasSequence: 'a',
  isBinaryOnly: 'u', isCube: 's', isFibonacci: 'c', isHarshad: 'b', isOrderedSequence: 'I',
  isPalindrome: 'r', isPerfectPower: 'o', isPrime: 't', isPronic: 'd', isScrambledSequence: 'N',
  isSquare: 'n', productDigits: 'p', sumDigits: 'i',
};
let mu = '/* eslint-disable */\n'
  + '// 本文件由 RNGdle-Plugin 生成脚本产出：判定函数原样取自 rngdle.com 客户端代码（模块 847558），\n'
  + '// 仅剥离打包器封装并追加导出别名，算法逻辑未做任何改动，以保证判定结果与源站一致。\n\n'
  + `${uCode}\n\nexport {\n`;
mu += Object.entries(uExports).map(([name, v]) => `  ${v} as ${name},`).join('\n');
mu += '\n}\n';
fs.writeFileSync(path.join(OUT, 'math-utils.js'), mu);

// ---------- 读取 510584 的目录与百分位表 ----------
const registry = {};
function loadModule (id, source) {
  registry[id] = { exports: {} };
  const e = {
    i: dep => registry[dep].exports,
    s: (defs) => {
      const exp = registry[id].exports;
      for (let k = 0; k < defs.length;) {
        const name = defs[k++];
        const getter = defs[k++];
        if (getter === 0) Object.defineProperty(exp, name, { value: defs[k++], enumerable: true });
        else Object.defineProperty(exp, name, { get: () => getter(), enumerable: true, configurable: true });
      }
    },
  };
  new Function('e', source)(e);
}
loadModule('882713', `{"use strict";var t,i=((t={}).PAIRS="PAIRS",t);e.s(["Family",()=>i,"createBadgeId",0,e=>e])}`);
loadModule('510584', fs.readFileSync(path.join(VENDOR, '510584.js'), 'utf8'));
const { SCORED_BADGES, SCORE_PERCENTILES } = registry['510584'].exports;

// ---------- lib/badges.js（模块 167711 + 分数表） ----------
const b = fs.readFileSync(path.join(VENDOR, '167711.js'), 'utf8');
const bBody = b.slice(1, b.lastIndexOf('}'))
  .replace(/^"use strict";var t=e\.i\(847558\),i=e\.i\(882713\);/, '');
const bCut = bBody.lastIndexOf(';e.s([');
const bCode = bBody.slice(0, bCut).replace(/;\s*$/, ';');

const scoreEntries = SCORED_BADGES.map(x => `  ${x.id}: ${x.score},`).join('\n');
const probEntries = SCORED_BADGES.map(x => `  ${x.id}: ${JSON.stringify(x.probability)},`).join('\n');

const bd = '/* eslint-disable */\n'
  + '// 本文件由 RNGdle-Plugin 生成脚本产出：徽章定义原样取自 rngdle.com 客户端代码（模块 167711），\n'
  + '// check/test/contributor 函数未做任何改动；t 与 i 以兼容 shim 注入，保证判定行为与源站一致。\n\n'
  + 'import * as U from "./math-utils.js"\n\n'
  + 'const t = U\n'
  + 'const i = {\n'
  + '  createBadgeId: (id) => id,\n'
  + '  Family: new Proxy({}, { get: (_o, p) => String(p) }),\n'
  + '}\n\n'
  + `${bCode}\n\n`
  + 'export const BADGE_DEFINITIONS = T\n\n'
  + `export const SCORES = {\n${scoreEntries}\n}\n\n`
  + `export const PROBABILITY = {\n${probEntries}\n}\n`;
fs.writeFileSync(path.join(OUT, 'badges.js'), bd);

// ---------- lib/percentiles.json ----------
fs.writeFileSync(path.join(OUT, 'percentiles.json'), JSON.stringify(SCORE_PERCENTILES));

// 校验指纹：数字 2 的 EP（子进程以 ESM 加载生成的插件模块）
const { execFileSync } = require('child_process');
const check = `
  const m = await import('file:///${OUT.replaceAll('\\', '/')}/badges.js');
  const defs = m.BADGE_DEFINITIONS;
  const scoreMap = new Map(defs.map(x => [x.id, m.SCORES[x.id] ?? 0]));
  const totalOf = (num) => {
    const str = String(num);
    const earned = defs.filter(x => x.check(num, str));
    const byFamily = new Map(); const rest = [];
    for (const x of earned) {
      if (x.family) {
        const cur = byFamily.get(x.family);
        if (!cur || scoreMap.get(x.id) > scoreMap.get(cur.id)) byFamily.set(x.family, x);
      } else rest.push(x);
    }
    return [...rest, ...byFamily.values()].reduce((s, x) => s + scoreMap.get(x.id), 0);
  };
  console.log(JSON.stringify({ count: defs.length, fp: totalOf(2) }));
`;
const { count, fp } = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', check], { encoding: 'utf8' }).trim(),
);
console.log(`生成完成：BADGES ${count} 枚，指纹校验 EP(2) = ${fp} ${fp === 119610065 ? '✓ 与源站一致' : '✗ 与源站不一致！'}`);
