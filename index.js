// RNGdle-Plugin：每日随机数游戏（复刻 rngdle.com 逻辑并本地化）
// 每天 1 次机会掷出 0 ~ 1,000,000 的随机数，按数字性质获得徽章与 EP（熵点）
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import plugin from '../../lib/plugins/plugin.js'
import puppeteer from '../../lib/puppeteer/puppeteer.js'
import { composeResult, rollRandomNumber, MAX_ROLL, tierInfo, BADGES } from './lib/analyze.js'
import { TIER_FLAVOR } from './lib/badges-zh.js'
import { getConfig } from './lib/config.js'

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

/** 过滤无效昵称：空值、与uid相同、官Bot复合ID(botQQ:OpenID)样式都不算昵称 */
function pickName (n, uid = '') {
  if (!n) return ''
  n = String(n).trim()
  if (!n || n === String(uid) || /^\d+:[0-9A-F]{16,}$/i.test(n)) return ''
  return n
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

/** 每日可抽次数配置（1~20） */
function dailyRollLimit () {
  return Math.max(1, Math.min(20, parseInt(getConfig().dailyRolls) || 1))
}

/** 存量用户补记历史最低：未记录过最低值的用户从最近一次抽取开始统计，返回是否发生补记 */
function ensureWorst (u) {
  if (u.rolls > 0 && !u.worst && u.lastNumber != null) {
    const last = composeResult(u.lastNumber)
    u.worst = { number: u.lastNumber, ep: last.totalScore, date: u.lastDate || todayKey() }
    return true
  }
  return false
}

function recordRoll (uid, name, result) {
  const u = getUser(uid, name)
  const day = todayKey()
  u.rolls += 1
  u.lifetimeEP += result.totalScore
  // 每日已抽次数按天重置（多次抽取全部计入统计）
  if (u.lastDate !== day) u.todayRolls = 0
  u.todayRolls = (u.todayRolls || 0) + 1
  u.lastDate = day
  u.lastNumber = result.number
  for (const b of result.badges) u.badges[b.id] = (u.badges[b.id] || 0) + 1
  ensureWorst(u)
  if (!u.best || result.totalScore > u.best.ep) {
    u.best = { number: result.number, ep: result.totalScore, date: day }
  }
  if (!u.worst || result.totalScore < u.worst.ep) {
    u.worst = { number: result.number, ep: result.totalScore, date: day }
  }
  const daily = db.daily[day] = db.daily[day] || { count: 0, best: null, players: {} }
  daily.count += 1
  if (!daily.best || result.totalScore > daily.best.ep) {
    daily.best = { uid: String(uid), name: u.name, number: result.number, ep: result.totalScore }
  }
  // 每日玩家数据（用于日榜）：多次抽取取最高EP的一次计入排行
  daily.players = daily.players || {}
  const p = daily.players[uid] = daily.players[uid] || { name: u.name, rolls: 0, ep: -1, number: null }
  p.name = u.name
  p.rolls += 1
  if (result.totalScore > p.ep) {
    p.ep = result.totalScore
    p.number = result.number
  }
  pruneDaily()
  saveDb()
  return u
}

/** 按配置的保留天数清理过期每日记录（keepDays=1 即只保留当天） */
function pruneDaily () {
  const keep = Math.max(1, Math.min(30, parseInt(getConfig().keepDays) || 30))
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (keep - 1))
  const cut = todayKey(cutoff)
  let changed = false
  for (const k of Object.keys(db.daily)) {
    if (k < cut) {
      delete db.daily[k]
      changed = true
    }
  }
  if (changed) saveDb()
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

// 徽章展示树：计分徽章为主行（按 EP 降序），同族未计分的「已收集」徽章折叠为子行
function badgeRows (result) {
  const rows = []
  const familyRow = new Map()
  // 第一轮：计分徽章与无族徽章作为主行
  for (const b of result.badges) {
    if (!b.isScoring && b.family) continue
    let digits = null
    const c = b.contributors
    if (c) {
      const hi = new Set()
      if (c.type === 'whole') String(result.number).split('').forEach((_, i) => hi.add(i))
      else if (c.type === 'indices') (c.indices || []).forEach(i => hi.add(i))
      else if (c.type === 'range') {
        // end 为开区间（同 String.slice），如「42」命中时 start=2、end=4 → 只高亮第 2、3 位
        for (let i = c.start; i < c.end; i++) hi.add(i)
      } else if (c.type === 'groups') {
        for (const g of c.groups || []) for (const i of g) hi.add(i)
      }
      if (hi.size) {
        digits = String(result.number).split('').map((d, i) => ({ d, hi: hi.has(i) }))
      }
    }
    const row = {
      emoji: b.emoji,
      name: b.zhName,
      desc: b.zhDesc,
      rarity: b.rarity,
      rarityZh: tierInfo(b.rarity).name,
      ep: `+${b.score.toLocaleString('en-US')} EP`,
      digits,
      children: [],
    }
    rows.push(row)
    if (b.family) familyRow.set(b.family, row)
  }
  // 第二轮：同族未计分徽章折叠到族内最高分主行下
  for (const b of result.badges) {
    if (b.isScoring || !b.family) continue
    familyRow.get(b.family)?.children.push({ emoji: b.emoji, name: b.zhName })
  }
  return rows
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
    remaining: extra.remaining ?? 0,
    dailyRolls: extra.dailyRolls || 1,
    maxRoll: fmtNum(MAX_ROLL),
    isReroll: !!extra.isReroll,
  })
}

function buildButtons () {
  try {
    return segment.button([
      [
        { text: '📊 我的统计', callback: '#RNGdle统计' },
        { text: '📅 日榜', callback: '#RNGdle日榜' },
      ],
      [
        { text: '💎 总榜', callback: '#RNGdle总榜' },
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
        { reg: /^#rng(dle)?日榜$/i, fnc: 'dailyRank', log: false },
        { reg: /^#rng(dle)?(总榜|累计榜)$/i, fnc: 'totalRank', log: false },
        { reg: /^#rng(dle)?(徽章|图鉴|收集)$/i, fnc: 'dex', log: false },
        { reg: /^#rng(dle)?试掷\s*(\d{1,7})$/i, fnc: 'testRoll', log: true, permission: 'master' },
      ],
    })
  }

  async cleanDaily () {
    pruneDaily()
    saveDb()
    return true
  }

  /** 群聊回复开头@触发者：按钮回调触发的场景下，群里看不出结果是谁掷的 */
  async replyWithAt (content) {
    const msg = Array.isArray(content) ? content : [content]
    if (this.e.isGroup) {
      return this.e.reply([segment.at(this.e.user_id), ...msg])
    }
    return this.e.reply(msg)
  }

  /** 解析昵称：sender → 群成员缓存(gml) → 适配器用户资料缓存(users) → 官Bot群成员API兜底 */
  async resolveName (uid = this.e?.user_id, e = this.e) {
    if (!uid) return ''
    let name = pickName(e?.sender?.card, uid) || pickName(e?.sender?.nickname, uid) ||
      pickName(e?.member?.card, uid) || pickName(e?.member?.nickname, uid)
    const bot = Bot[e?.self_id]
    if (!name && bot?.gml?.get?.(e?.group_id)) {
      const m = bot.gml.get(e.group_id).get(uid)
      name = pickName(m?.card, uid) || pickName(m?.nickname, uid)
    }
    if (!name && bot?.users) {
      const u = bot.users.get(uid)
      name = pickName(u?.card, uid) || pickName(u?.nickname, uid)
    }
    if (!name && bot?.sdk?.getGroupMemberInfo && String(uid).includes(':')) {
      // 官Bot复合ID且各处缓存均无昵称：拉群成员API，结果回写users缓存供后续免API查询
      const group_id = String(e?.group_id || '').split(':').pop()
      const openid = String(uid).slice(String(uid).indexOf(':') + 1)
      if (group_id && openid) {
        try {
          const info = await bot.sdk.getGroupMemberInfo(group_id, openid)
          name = pickName(info?.nickname, uid)
          if (name) {
            await bot.users?.set(uid, { ...(bot.users?.get(uid) || {}), nickname: name, card: name, user_id: uid })
          }
        } catch {}
      }
    }
    return name
  }

  async roll () {
    const uid = this.e.user_id
    const name = await this.resolveName(uid)
    const day = todayKey()
    const u = getUser(uid, name)
    const limit = dailyRollLimit()
    const used = u.lastDate === day ? (u.todayRolls || 0) : 0
    if (used >= limit) {
      const last = u.lastNumber != null ? composeResult(u.lastNumber) : null
      // 多次抽取时提示今日单次最高成绩
      const p = db.daily[day]?.players?.[uid]
      const bestLine = limit > 1 && p && p.ep >= 0
        ? `今日最佳：${p.number}（${fmtNum(p.ep)} EP，共掷 ${p.rolls} 次）\n`
        : ''
      await this.replyWithAt(
        `今天的机会已经用完啦～你的数字是 ${u.lastNumber}（${fmtNum(last ? last.totalScore : 0)} EP）\n` +
        bestLine +
        `距离明日重置还有 ${formatCountdown(msUntilMidnight())}，明天再来吧！`,
      )
      return true
    }
    const number = rollRandomNumber()
    const result = composeResult(number)
    const user = recordRoll(uid, name, result)
    const daily = db.daily[day]
    const remaining = limit - (user.todayRolls || 0)
    const img = await renderResult(result, user, {
      flavor: pickFlavor(result.tier, number),
      countdown: remaining > 0 ? '' : formatCountdown(msUntilMidnight()),
      remaining,
      dailyRolls: limit,
      todayCount: daily ? daily.count : 0,
    })
    if (!img) {
      await this.replyWithAt(`🎲 你掷出了 ${number}！+${fmtNum(result.totalScore)} EP（${result.earnedCount} 枚徽章）\n（图片渲染失败）`)
      return true
    }
    const btn = buildButtons()
    if (btn) {
      try {
        await this.replyWithAt([img, btn])
      } catch {
        await this.replyWithAt(img)
      }
    } else {
      await this.replyWithAt(img)
    }
    return true
  }

  async testRoll () {
    const number = Math.max(0, Math.min(MAX_ROLL, parseInt(this.e.msg.match(/\d{1,7}$/)[0], 10)))
    const result = composeResult(number)
    const uid = this.e.user_id
    const name = await this.resolveName(uid)
    const img = await renderResult(result, getUser(uid, name), {
      flavor: pickFlavor(result.tier, number),
      isReroll: true,
    })
    await this.replyWithAt(img || `🎲 试掷 ${number}：${fmtNum(result.totalScore)} EP（${result.earnedCount} 枚徽章）`)
    return true
  }

  async help () {
    const img = await renderTpl('help.html', {
      _plugin: 'RNGdle',
      maxRoll: fmtNum(MAX_ROLL),
      dailyRolls: dailyRollLimit(),
    })
    await this.e.reply(img || 'RNGdle 帮助图渲染失败')
    return true
  }

  async stats () {
    const uid = this.e.user_id
    const u = db.users[uid]
    if (!u || !u.rolls) {
      await this.replyWithAt('你还没有掷过数～发送 #RNGdle 开始今天的掷数！')
      return true
    }
    if (!u.name) {
      const resolved = await this.resolveName(uid)
      if (resolved) {
        u.name = getUser(uid, resolved).name
        saveDb()
      }
    }
    if (ensureWorst(u)) saveDb()
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
      worst: u.worst ? { number: u.worst.number, ep: fmtNum(u.worst.ep), date: u.worst.date } : null,
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
    await this.replyWithAt(img || '统计图渲染失败')
    return true
  }

  /** 日榜：当日玩家的抽取与 EP */
  async dailyRank () {
    pruneDaily()
    const daily = db.daily[todayKey()]
    const limit = Math.max(1, Math.min(50, parseInt(getConfig().rankLimit) || 10))
    const players = Object.entries(daily?.players || {})
      .map(([uid, p]) => ({ uid, name: p.name || '', number: p.number ?? '-', ep: p.ep || 0 }))
      .sort((a, b) => b.ep - a.ep)
      .slice(0, limit)
    // 缺名用户（官Bot回调触发等场景）从缓存/API解析昵称并回填，避免榜单显示原始ID
    let dirty = false
    for (const p of players) {
      if (p.name) continue
      const resolved = await this.resolveName(p.uid)
      if (resolved) {
        const name = getUser(p.uid, resolved).name
        p.name = name
        if (daily?.players[p.uid]) daily.players[p.uid].name = name
        if (daily?.best?.uid === p.uid) daily.best.name = name
        dirty = true
      } else {
        p.name = p.uid
      }
    }
    if (dirty) saveDb()
    const bestName = daily?.best
      ? (daily.best.name || players.find(p => p.uid === daily.best.uid)?.name || daily.best.uid)
      : ''
    const img = await renderTpl('daily-rank.html', {
      _plugin: 'RNGdle',
      todayBest: daily?.best
        ? { name: bestName, number: daily.best.number, ep: fmtNum(daily.best.ep) }
        : null,
      todayTotal: daily?.players ? Object.keys(daily.players).length : 0,
      todayCount: daily ? daily.count : 0,
      limit,
      players: players.map((u, i) => ({
        rank: i + 1,
        name: u.name,
        number: u.number,
        ep: fmtNum(u.ep),
      })),
    })
    await this.e.reply(img || '日榜渲染失败')
    return true
  }

  /** 总榜：历史累计 EP */
  async totalRank () {
    const limit = Math.max(1, Math.min(50, parseInt(getConfig().rankLimit) || 10))
    const users = Object.entries(db.users)
      .filter(([, u]) => u.rolls > 0)
      .map(([uid, u]) => ({ uid, name: u.name || '', ep: u.lifetimeEP, rolls: u.rolls, best: u.best }))
      .sort((a, b) => b.ep - a.ep)
      .slice(0, limit)
    let dirty = false
    for (const u of users) {
      if (u.name) continue
      const resolved = await this.resolveName(u.uid)
      if (resolved) {
        u.name = getUser(u.uid, resolved).name
        dirty = true
      } else {
        u.name = u.uid
      }
    }
    if (dirty) saveDb()
    const img = await renderTpl('total-rank.html', {
      _plugin: 'RNGdle',
      totalPlayers: Object.keys(db.users).length,
      limit,
      users: users.map((u, i) => ({
        rank: i + 1,
        name: u.name,
        ep: fmtNum(u.ep),
        rolls: u.rolls,
        bestNumber: u.best ? u.best.number : '-',
      })),
    })
    await this.e.reply(img || '总榜渲染失败')
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
    await this.replyWithAt(img || '徽章图鉴渲染失败')
    return true
  }
}
