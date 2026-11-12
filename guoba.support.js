// Guoba 配置面板支持：#RNGdle 日榜/总榜 显示上限、每日记录保留天数
import { getConfig, setConfig } from './lib/config.js'

export function supportGuoba () {
  return {
    pluginInfo: {
      name: 'RNGdle-Plugin',
      title: 'RNGdle 每日随机数',
      description: '复刻 rngdle.com 的每日随机数游戏：每天一掷，收集徽章与 EP',
      author: ['Temmie0125'],
      authorLink: ['https://github.com/Temmie0125'],
      isV3: true,
      isV2: false,
      showInMenu: 'auto',
      icon: 'mdi:dice-multiple',
      iconColor: '#fbbf24',
    },

    configInfo: {
      schemas: [
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '抽取设置',
        },
        {
          field: 'dailyRolls',
          label: '每日可抽次数',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 20,
            step: 1,
            addonAfter: '次',
          },
          defaultValue: 1,
          bottomHelpMessage: '每人每天可抽取的次数（1~20），默认 1 次。多次抽取全部计入个人统计，每日排行取当天最高 EP 的一次。',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '榜单设置',
        },
        {
          field: 'rankLimit',
          label: '榜单显示上限',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 50,
            step: 1,
            addonAfter: '人',
          },
          defaultValue: 10,
          bottomHelpMessage: '日榜、总榜最多显示的人数（1~50），默认前 10。',
        },
        {
          field: 'keepDays',
          label: '每日记录保留天数',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 30,
            step: 1,
            addonAfter: '天',
          },
          defaultValue: 30,
          bottomHelpMessage: '每日抽取记录保留的天数（1~30）。填 1 表示只保留当天，次日清理时删除；每天 4 点自动清理过期记录。',
        },
      ],

      getConfigData () {
        return { ...getConfig() }
      },

      setConfigData (data, { Result }) {
        try {
          setConfig(data)
          return Result.ok({}, '配置已保存')
        } catch (err) {
          return Result.error({}, `配置保存失败：${err.message}`)
        }
      },
    },
  }
}
