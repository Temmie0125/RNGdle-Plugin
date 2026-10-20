// RNGdle-Plugin：每日随机数游戏（复刻 rngdle.com 逻辑并本地化）
// 每天 1 次机会掷出 0 ~ 1,000,000 的随机数，按数字性质获得徽章与 EP（熵点）
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import plugin from '../../lib/plugins/plugin.js'
import puppeteer from '../../lib/puppeteer/puppeteer.js'
import { composeResult, rollRandomNumber, MAX_ROLL, tierInfo, BADGES } from './lib/analyze.js'
import { TIER_FLAVOR } from './lib/badges-zh.js'

const _dirname = path.dirname(fileURLToPath(import.meta.url))
const TPL_DIR = path.join(_dirname, 'resources', 'html')
const DATA_DIR = path.join(_dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

fs.mkdirSync(DATA_DIR, { recursive: true })

// ---------- 数据层 ----------
let db = { users: {}, daily: {} }
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
} catch (e) {
  logger.error(`[RNGdle] 读取数据文件失败，使用空数据库：${e.message}`)
  db = { users: {}, daily: {} }
}

let saveTimer = null
function saveDb () {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db))
    } catch (e) {
      logger.error(`[RNGdle] 保存数据失败：${e.message}`)
    }
  }, 200)
}

function todayKey (d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 距离午夜（每日重置）的剩余毫秒 */
function msUntilMidnight (d = new Date()) {
  const next = new Date(d)
  next.setHours(24, 0, 0, 0)
  return next - d
}

function formatCountdown (ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h} 小时 ${m} 分钟` : m > 0 ? `${m} 分钟 ${s} 秒` : `${s} 秒`
}

function getUser (uid, name = '') {
  let u = db.users[uid]
  if (!u) {
    u = db.users[uid] = {
      name: String(name || '').slice(0, 30),
      rolls: 0,
      lifetimeEP: 0,
      best: null, // { number, ep, date }
      lastDate: '',
      lastNumber: null,
      badges: {}, // badgeId -> 次数
    }
  }
  if (name && u.name !== name) u.name = String(name).slice(0, 30)
  return u
}

function recordRoll (uid, name, result) {
  const u = getUser(uid, name)
  const day = todayKey()
  u.rolls += 1
  u.lifetimeEP += result.totalScore
  u.lastDate = day
  u.lastNumber = result.number
  for (const b of result.badges) u.badges[b.id] = (u.badges[b.id] || 0) + 1
  if (!u.best || result.totalScore > u.best.ep) {
    u.best = { number: result.number, ep: result.totalScore, date: day }
  }
  const daily = db.daily[day] = db.daily[day] || { count: 0, best: null }
  daily.count += 1
  if (!daily.best || result.totalScore > daily.best.ep) {
    daily.best = { uid: String(uid), name: u.name, number: result.number, ep: result.totalScore }
  }
  // 只保留最近 30 天的每日记录
  const keys = Object.keys(db.daily).sort()
  while (keys.length > 30) delete db.daily[keys.shift()]
  saveDb()
  return u
}

// ---------- 渲染层 ----------
let renderSeq = 0
async function renderTpl (tpl, data = {}) {
  renderSeq += 1
  return puppeteer.screenshot('rngdle', {
    tplFile: path.join(TPL_DIR, tpl),
    saveId: `${path.basename(tpl, '.html')}_${renderSeq}`,
    imgType: 'jpeg',
    quality: 92,
    ...data,
  })
}

// 徽章展示行预处理：贡献位高亮、文案格式化
function badgeRows (result) {
  return result.badges.map(b => {
    let digits = null
    const c = b.contributors
    if (c) {
      const hi = new Set()
      if (c.type === 'whole') String(result.number).split('').forEach((_, i) => hi.add(i))
      else if (c.type === 'indices') (c.indices || []).forEach(i => hi.add(i))
      else if (c.type === 'range') {
        for (let i = c.start; i <= c.end; i++) hi.add(i)
      } else if (c.type === 'groups') {
        for (const g of c.groups || []) for (const i of g) hi.add(i)
      }
      if (hi.size) {
        digits = String(result.number).split('').map((d, i) => ({ d, hi: hi.has(i) }))
      }
    }
    return {
      emoji: b.emoji,
      name: b.zhName,
      desc: b.zhDesc,
      rarity: b.rarity,
      rarityZh: tierInfo(b.rarity).name,
      score: b.isScoring ? b.score.toLocaleString('en-US') : '',
      ep: b.isScoring ? `+${b.score.toLocaleString('en-US')} EP` : '已收集',
      isScoring: b.isScoring,
      digits,
    }
  })
}

function pickFlavor (tier, number) {
  const list = TIER_FLAVOR[tier] || TIER_FLAVOR.common
  let h = 0
  for (const ch of String(number)) h = (h * 31 + ch.charCodeAt(0)) % 997
  return list[h % list.length]
}

function fmtNum (n) {
  return Number(n || 0).toLocaleString('en-US')
}

async function renderResult (result, user, extra = {}) {
  const tier = tierInfo(result.tier)
  return renderTpl('result.html', {
    _plugin: 'RNGdle',
    title: 'RNGdle · 每日随机数',
    digits: result.digits,
    tierName: tier.name,
    tierPill: tier.pill,
    tierEmoji: tier.emoji,
    topText: result.topText,
    flavor: extra.flavor || '',
    totalScore: fmtNum(result.totalScore),
    badges: badgeRows(result),
    earnedCount: result.earnedCount,
    scoringCount: result.scoringCount,
    lifetimeEP: fmtNum(user.lifetimeEP),
    rolls: user.rolls,
    countdown: extra.countdown || '',
    todayCount: extra.todayCount || 0,
    maxRoll: fmtNum(MAX_ROLL),
    isReroll: !!extra.isReroll,
  })
}

function buildButtons () {
  try {
    return segment.button([
      [
        { text: '📊 我的统计', callback: '#RNGdle统计' },
        { text: '🏆 排行榜', callback: '#RNGdle排行' },
        { text: '📜 帮助', callback: '#RNGdle帮助' },
      ],
    ])
  } catch {
    return null
  }
}

// ---------- 插件本体 ----------
export class rngdle extends plugin {
  constructor () {
    super({
      name: 'RNGdle 每日随机数',
      dsc: '每天一次机会，掷出你的专属数字并收集徽章',
      event: 'message',
      priority: 500,
      task: [
        {
          name: 'RNGdle 每日数据清理',
          fnc: 'cleanDaily',
          cron: '0 4 * * *',
        },
      ],
      rule: [
        { reg: /^#rng(dle)?$/i, fnc: 'roll', log: true },
        { reg: /^#rng(dle)?(帮助|说明|help)$/i, fnc: 'help', log: false },
        { reg: /^#rng(dle)?(统计|我的|资料)$/i, fnc: 'stats', log: false },
        { reg: /^#rng(dle)?(排行|排行榜|榜)$/i, fnc: 'rank', log: false },
        { reg: /^#rng(dle)?(徽章|图鉴|收集)$/i, fnc: 'dex', log: false },
        { reg: /^#rng(dle)?试掷\s*(\d{1,7})$/i, fnc: 'testRoll', log: true, permission: 'master' },
      ],
    })
  }

  async cleanDaily () {
    const keys = Object.keys(db.daily).sort()
    while (keys.length > 30) delete db.daily[keys.shift()]
    saveDb()
    return true
  }

  async roll () {
    const uid = this.e.user_id
    const name = this.e.sender?.card || this.e.sender?.nickname || ''
    const day = todayKey()
    const u = getUser(uid, name)
    if (u.lastDate === day) {
      const last = u.lastNumber != null ? composeResult(u.lastNumber) : null
      await this.e.reply(
        `今天已经掷过啦～你的数字是 ${u.lastNumber}（${fmtNum(last ? last.totalScore : 0)} EP）\n` +
        `距离明日重置还有 ${formatCountdown(msUntilMidnight())}，明天再来吧！`,
      )
      return true
    }
    const number = rollRandomNumber()
    const result = composeResult(number)
    const user = recordRoll(uid, name, result)
    const daily = db.daily[day]
    const img = await renderResult(result, user, {
      flavor: pickFlavor(result.tier, number),
      countdown: formatCountdown(msUntilMidnight()),
      todayCount: daily ? daily.count : 0,
    })
    if (!img) {
      await this.e.reply(`🎲 你掷出了 ${number}！+${fmtNum(result.totalScore)} EP（${result.earnedCount} 枚徽章）\n（图片渲染失败）`)
      return true
    }
    const btn = buildButtons()
    if (btn) {
      try {
        await this.e.reply([img, btn])
      } catch {
        await this.e.reply(img)
      }
    } else {
      await this.e.reply(img)
    }
    return true
  }

  async testRoll () {
    const number = Math.max(0, Math.min(MAX_ROLL, parseInt(this.e.msg.match(/\d{1,7}$/)[0], 10)))
    const result = composeResult(number)
    const uid = this.e.user_id
    const name = this.e.sender?.card || this.e.sender?.nickname || ''
    const img = await renderResult(result, getUser(uid, name), {
      flavor: pickFlavor(result.tier, number),
      isReroll: true,
    })
    await this.e.reply(img || `🎲 试掷 ${number}：${fmtNum(result.totalScore)} EP（${result.earnedCount} 枚徽章）`)
    return true
  }

  async help () {
    const img = await renderTpl('help.html', {
      _plugin: 'RNGdle',
      maxRoll: fmtNum(MAX_ROLL),
    })
    await this.e.reply(img || 'RNGdle 帮助图渲染失败')
    return true
  }

  async stats () {
    const uid = this.e.user_id
    const name = this.e.sender?.card || this.e.sender?.nickname || ''
    const u = db.users[uid]
    if (!u || !u.rolls) {
      await this.e.reply('你还没有掷过数～发送 #RNGdle 开始今天的掷数！')
      return true
    }
    const collected = Object.keys(u.badges).length
    const last = u.lastNumber != null ? composeResult(u.lastNumber) : null
    // 拥有次数最多的徽章
    const topBadges = Object.entries(u.badges)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id, count]) => {
        const b = BADGES.find(x => x.id === id)
        return b
          ? {
              emoji: b.emoji,
              name: b.zhName,
              count,
              rarity: b.rarity || 'common',
              rarityZh: tierInfo(b.rarity || 'common').name,
            }
          : null
      })
      .filter(Boolean)
    const tier = last ? tierInfo(last.tier) : null
    const img = await renderTpl('stats.html', {
      _plugin: 'RNGdle',
      name: u.name || String(uid),
      rolls: u.rolls,
      lifetimeEP: fmtNum(u.lifetimeEP),
      best: u.best ? { number: u.best.number, ep: fmtNum(u.best.ep), date: u.best.date } : null,
      last: last
        ? {
            number: last.number,
            ep: fmtNum(last.totalScore),
            tierName: tier.name,
            tierEmoji: tier.emoji,
            tierPill: tier.pill,
            topText: last.topText,
          }
        : null,
      collected,
      totalBadges: BADGES.length,
      collectedPercent: Math.round((collected / BADGES.length) * 100),
      topBadges,
    })
    await this.e.reply(img || '统计图渲染失败')
    return true
  }

  async rank () {
    const day = todayKey()
    const daily = db.daily[day]
    const users = Object.entries(db.users)
      .filter(([, u]) => u.rolls > 0)
      .map(([uid, u]) => ({
        uid,
        name: u.name || uid,
        ep: u.lifetimeEP,
        rolls: u.rolls,
        best: u.best,
      }))
      .sort((a, b) => b.ep - a.ep)
      .slice(0, 10)
    const img = await renderTpl('rank.html', {
      _plugin: 'RNGdle',
      todayBest: daily?.best
        ? { name: daily.best.name, number: daily.best.number, ep: fmtNum(daily.best.ep) }
        : null,
      todayCount: daily ? daily.count : 0,
      totalPlayers: users.length ? Object.keys(db.users).length : 0,
      users: users.map((u, i) => ({
        rank: i + 1,
        name: u.name,
        ep: fmtNum(u.ep),
        rolls: u.rolls,
        bestNumber: u.best ? u.best.number : '-',
      })),
    })
    await this.e.reply(img || '排行图渲染失败')
    return true
  }

  async dex () {
    const uid = this.e.user_id
    const u = db.users[uid]
    const mine = u ? u.badges : {}
    const order = { mythic: 0, anomaly: 1, epic: 2, rare: 3, uncommon: 4, common: 5 }
    const groups = {}
    for (const b of BADGES) {
      const tier = b.rarity || 'common'
      ;(groups[tier] = groups[tier] || []).push({
        emoji: b.emoji,
        name: b.zhName,
        score: fmtNum(b.score),
        owned: mine[b.id] || 0,
        probability: b.probability,
      })
    }
    const tiers = Object.keys(groups).sort((a, b) => order[a] - order[b])
    const collected = Object.keys(mine).length
    const img = await renderTpl('badges.html', {
      _plugin: 'RNGdle',
      tiers: tiers.map(t => ({ tier: t, tierName: tierInfo(t).name, tierPill: tierInfo(t).pill, badges: groups[t] })),
      collected,
      totalBadges: BADGES.length,
      collectedPercent: Math.round((collected / BADGES.length) * 100),
    })
    await this.e.reply(img || '徽章图鉴渲染失败')
    return true
  }
}
