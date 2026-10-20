// RNGdle 分析引擎：复刻 rngdle.com 的掷数、徽章判定、EP 计分与稀有度分级
// 判定逻辑来自 lib/badges.js（源站原版 check 函数），本文件只做编排
import fs from 'node:fs'
import { BADGE_DEFINITIONS, SCORES, PROBABILITY } from './badges.js'
import { BADGES_ZH, TIER_ZH } from './badges-zh.js'

export const MAX_ROLL = 1000000

/** 掷一次：源站为 Math.floor(random * 1000001)，范围 0 ~ 1,000,000 */
export function rollRandomNumber () {
  return Math.floor((MAX_ROLL + 1) * Math.random())
}

// 徽章稀有度阈值（按单枚徽章分数划分，与源站一致）
const BADGE_TIER_THRESHOLDS = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 }

/** 徽章稀有度：common < 1e3 ≤ uncommon < 1e4 ≤ rare < 1e5 ≤ epic < 1e6 ≤ anomaly < 1e7 ≤ mythic */
export function getBadgeRarityTier (score) {
  if (score < BADGE_TIER_THRESHOLDS.common) return 'common'
  if (score < BADGE_TIER_THRESHOLDS.uncommon) return 'uncommon'
  if (score < BADGE_TIER_THRESHOLDS.rare) return 'rare'
  if (score < BADGE_TIER_THRESHOLDS.epic) return 'epic'
  if (score < BADGE_TIER_THRESHOLDS.anomaly) return 'anomaly'
  return 'mythic'
}

// 数字总评稀有度阈值（按百分位划分，与源站一致）
const CARD_TIER_THRESHOLDS = { trash: 1, common: 50, uncommon: 75, rare: 90, epic: 95, anomaly: 99 }

/** 数字总评稀有度：percentile < 1 trash … ≥ 99 mythic */
export function getCardRarityTier (percentile) {
  if (percentile < CARD_TIER_THRESHOLDS.trash) return 'trash'
  if (percentile < CARD_TIER_THRESHOLDS.common) return 'common'
  if (percentile < CARD_TIER_THRESHOLDS.uncommon) return 'uncommon'
  if (percentile < CARD_TIER_THRESHOLDS.rare) return 'rare'
  if (percentile < CARD_TIER_THRESHOLDS.epic) return 'epic'
  if (percentile < CARD_TIER_THRESHOLDS.anomaly) return 'anomaly'
  return 'mythic'
}

const percentiles = JSON.parse(
  fs.readFileSync(new URL('./percentiles.json', import.meta.url), 'utf8'),
)
let sortedKeys = null

/** EP 总分 → 百分位（超越了多少比例的数字） */
export function getPercentileForScore (score) {
  const exact = percentiles[String(score)]
  if (exact !== undefined) return exact
  if (!sortedKeys) sortedKeys = Object.keys(percentiles).map(Number).sort((a, b) => a - b)
  const keys = sortedKeys
  let lo = 0
  let hi = keys.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid] <= score) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found < 0 ? 0 : percentiles[String(keys[found])] ?? 0
}

// 组装完整徽章表：check + 分数 + 概率 + 稀有度 + 中文本地化
export const BADGES = BADGE_DEFINITIONS.map(b => {
  const zh = BADGES_ZH[b.id]
  const score = SCORES[b.id] ?? 0
  return {
    id: b.id,
    label: b.label,
    emoji: b.emoji,
    family: b.family || '',
    score,
    probability: PROBABILITY[b.id] ?? '',
    rarity: getBadgeRarityTier(score),
    check: b.check,
    getContributors: b.getContributors,
    zhName: zh ? zh[0] : b.label,
    zhDesc: zh ? zh[1] : b.description,
  }
})

const BADGE_BY_ID = new Map(BADGES.map(b => [b.id, b]))

/**
 * 分析一个数字：返回命中的全部徽章、计分徽章（同 family 只取最高分）与 EP 总分
 */
export function analyzeNumber (num) {
  const str = String(num)
  const earned = []
  for (const b of BADGES) {
    if (b.check(num, str)) earned.push(b)
  }
  // 同一 family 只保留分数最高的一个参与计分，其余标记为 earned（不计分）
  const byFamily = new Map()
  const noFamily = []
  for (const b of earned) {
    if (b.family) {
      const cur = byFamily.get(b.family)
      if (!cur || b.score > cur.score) byFamily.set(b.family, b)
    } else {
      noFamily.push(b)
    }
  }
  const scoring = [...noFamily, ...byFamily.values()]
  const totalScore = scoring.reduce((s, b) => s + b.score, 0)
  return { number: num, earned, scoring, totalScore }
}

/** 徽章贡献的高亮位置（用于结果图里的迷你数字高亮） */
export function getBadgeContributors (badgeId, num) {
  const b = BADGE_BY_ID.get(badgeId)
  if (!b || !b.getContributors) return null
  return b.getContributors(num, String(num))
}

/** 百分位 → 「前 X%」展示文案，与源站一致：≥1 取整，<1 保留小数 */
export function formatTopPercent (percentile) {
  const top = 100 - percentile
  if (top >= 1) return `前 ${Math.round(top)}%`
  if (top >= 0.01) {
    const s = top.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    return `前 ${s}%`
  }
  return '前 0.01%'
}

export function tierInfo (tier) {
  return TIER_ZH[tier] || TIER_ZH.common
}

/**
 * 结果的完整装饰数据：为每个徽章附上稀有度、是否计分、贡献高亮位
 */
export function composeResult (num) {
  const r = analyzeNumber(num)
  const scoringIds = new Set(r.scoring.map(b => b.id))
  const badges = r.earned
    .map(b => ({
      ...b,
      isScoring: scoringIds.has(b.id),
      rarity: getBadgeRarityTier(b.score),
      contributors: getBadgeContributors(b.id, num),
    }))
    .sort((a, b) => b.score - a.score)
  const percentile = getPercentileForScore(r.totalScore)
  return {
    number: num,
    digits: String(num).split(''),
    badges,
    earnedCount: badges.length,
    scoringCount: scoringIds.size,
    totalScore: r.totalScore,
    percentile,
    tier: getCardRarityTier(percentile),
    topText: formatTopPercent(percentile),
  }
}
