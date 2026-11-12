// RNGdle-Plugin 配置：默认值 + 读写（Guoba 面板通过 getConfigData/setConfigData 调用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'RNGdle'

// 配置文件固定存放在插件目录 config/ 下（与插件资源、数据文件放在一起）
const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

const defaultConfig = {
  /** 每日可抽次数（多次抽取全部计入统计，日榜取最高EP的一次） */
  dailyRolls: 1,
  /** 榜单显示人数上限（日榜/总榜通用） */
  rankLimit: 10,
  /** 每日记录保留天数（1~30，1 即次日清理） */
  keepDays: 30,
}

let config = { ...defaultConfig }

export function getConfig () {
  return { ...config }
}

export function getConfigSync () {
  return config
}

export function loadConfig () {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    for (const key of Object.keys(defaultConfig)) {
      if (saved[key] !== undefined) config[key] = saved[key]
    }
  } catch (e) {
    logger.warn(`[${PLUGIN_NAME}] 加载配置失败，使用默认配置：${e.message}`)
  }
}

export function setConfig (data) {
  for (const key of Object.keys(defaultConfig)) {
    if (data[key] !== undefined) config[key] = data[key]
  }
  // 合法性钳制
  config.dailyRolls = Math.max(1, Math.min(20, parseInt(config.dailyRolls) || 1))
  config.rankLimit = Math.max(1, Math.min(50, parseInt(config.rankLimit) || 10))
  config.keepDays = Math.max(1, Math.min(30, parseInt(config.keepDays) || 30))
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  return getConfig()
}

loadConfig()
