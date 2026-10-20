// 从 rngdle.com 的 Next.js chunk 中切出 turbopack 模块源码
// 用法：node extract-modules.cjs <chunk文件> [输出目录]
// chunk 获取方式：打开 https://www.rngdle.com/ ，在 network 里找 /_next/static/chunks/*.js，
// 含徽章定义的 chunk 可用 `grep -l createBadgeId *.js` 筛出
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('用法：node extract-modules.cjs <chunk文件.js> [输出目录]');
  process.exit(1);
}
const outDir = process.argv[3] || path.dirname(file);

const src = fs.readFileSync(file, 'utf8');
// turbopack 模块数组形如 [path, id1, fn1, id2, fn2, ...]，fn 形如 e=>{...}
const heads = [];
const re = /,(\d+),e=>\{/g;
let m;
while ((m = re.exec(src))) heads.push({ id: m[1], bodyStart: re.lastIndex - 1 });

function extractFn (s, openIdx) {
  let depth = 0; let i = openIdx; let inStr = null;
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

let count = 0;
for (const h of heads) {
  const end = extractFn(src, h.bodyStart);
  if (end < 0) continue;
  fs.writeFileSync(path.join(outDir, `${h.id}.js`), src.slice(h.bodyStart, end + 1));
  count++;
}
console.log(`提取完成：${count} 个模块 → ${outDir}`);
console.log('关键模块：847558(数学工具) 510584(目录+百分位表) 167711(徽章定义)');
