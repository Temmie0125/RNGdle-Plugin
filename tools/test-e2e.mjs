// 端到端回归测试：不启动完整 Yunzai，只模拟最小全局环境
// 用真实的 plugin 基类与真实渲染器跑一遍全部命令
// 用法：node --input-type=module tools/test-e2e.mjs （在 Yunzai 根目录下执行）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

global.logger = {
  mark: () => {}, info: () => {}, warn: console.warn, error: console.error,
  debug: () => {}, trace: () => {},
  green: s => s, yellow: s => s, red: s => s, blue: s => s,
}
global.Bot = { fsStat: async p => fs.existsSync(p), makeLog: () => {}, uin: 10000 }
global.segment = {
  image: buf => ({ type: 'image', buf }),
  button: rows => ({ type: 'button', rows }),
}
global.plugin = (await import(`file://${ROOT.replaceAll('\\', '/')}/lib/plugins/plugin.js`)).default

const { rngdle } = await import(`file://${ROOT.replaceAll('\\', '/')}/plugins/RNGdle-Plugin/index.js`)
const inst = new rngdle()
console.log('规则:', inst.rule.map(r => r.fnc).join(', '))

let pass = 0
const fail = []
async function run (desc, fnc, msg, uid, expect) {
  inst.e = {
    msg, user_id: uid, sender: { card: '回归测试' },
    reply: async (r) => { inst.e._r = r },
  }
  try {
    await inst[fnc]()
    const r = inst.e._r
    const type = Array.isArray(r) ? r.map(x => x.type).join('+') : r?.type
    const ok = expect ? expect(type, r) : true
    if (ok) { pass++; console.log(`✓ ${desc} → ${type}`) } else { fail.push(desc); console.log(`✗ ${desc} → ${type}`) }
    return r
  } catch (e) {
    fail.push(desc)
    console.log(`✗ ${desc} 异常: ${e.message}`)
  }
}

await run('掷数', 'roll', '#RNGdle', 900001, t => t?.includes('image'))
await run('重复掷数', 'roll', '#RNG', 900001, t => typeof inst.e._r === 'string')
await run('试掷(数字2)', 'testRoll', '#RNGdle试掷 2', 900001, t => t === 'image')
await run('统计', 'stats', '#RNGdle统计', 900001, t => t === 'image')
await run('日榜', 'dailyRank', '#RNGdle日榜', 900001, t => t === 'image')
await run('总榜', 'totalRank', '#RNGdle总榜', 900001, t => t === 'image')
await run('图鉴', 'dex', '#RNGdle徽章', 900001, t => t === 'image')
await run('帮助', 'help', '#RNGdle帮助', 900001, t => t === 'image')

// 清理回归测试产生的数据
const dbFile = path.join(ROOT, 'plugins/RNGdle-Plugin/data/db.json')
try {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
  delete db.users['900001']
  const today = new Date()
  const p = n => String(n).padStart(2, '0')
  const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  delete db.daily?.[day]
  fs.writeFileSync(dbFile, JSON.stringify(db))
} catch {}

console.log(`\n结果：${pass} 通过，${fail.length} 失败 ${fail.length ? fail.join('、') : ''}`)
process.exit(fail.length ? 1 : 0)
