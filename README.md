# RNGdle-Plugin

复刻 [rngdle.com](https://www.rngdle.com/) 的每日随机数游戏，并完成中文本地化。

每天一次机会掷出 `0 ~ 1,000,000` 的随机数，数字会被分析出各种趣味性质（回文、质数、顺子、
梗数、连击……），每种性质对应一枚徽章，徽章分值（EP 熵点）相加得到本次总分，
再通过源站预计算的百分位表换算成全服评级。

## 命令（不区分大小写）

| 命令 | 说明 |
| --- | --- |
| `#RNGdle` / `#RNG` | 掷出今天的随机数（每日 0 点重置） |
| `#RNGdle统计` | 个人累计 EP、最佳纪录与徽章收集 |
| `#RNGdle日榜` | 今日最佳数字与当日玩家抽取排行 |
| `#RNGdle总榜` | 全服累计 EP 排行 |
| `#RNGdle徽章` | 全部 233 枚徽章图鉴与收集进度 |
| `#RNGdle帮助` | 帮助 |
| `#RNGdle试掷 <数字>` | 仅 master：预览指定数字的结果，不消耗次数、不计入数据 |

## 判定逻辑与源站的一致性

- 掷数：`Math.floor(random × 1000001)`，与源站 `rollRandomNumber` 一致
- 徽章判定：`lib/badges.js` 内嵌源站客户端的 **233 个原版 check 函数**（仅剥离打包器封装），
  2210 条源站自带单元测试全部通过
- 计分规则：与源站 `analyzeNumber` 一致——同 family 徽章只取最高分计入 EP，其余显示「已收集」
- 评级：徽章稀有度按单枚分数划分（<1千 普通 … ≥1千万 神话）；总评级按预计算百分位划分
  （<1% 废铁 … ≥99% 神话），阈值与源站一致
- 数据校验指纹：数字 `2` 的 EP = 119,610,065，与源站玩家资料卡完全一致

## 目录结构

```
RNGdle-Plugin/
├── index.js            # 插件入口：命令与游戏流程
├── guoba.support.js    # Guoba 面板配置支持
├── lib/
│   ├── math-utils.js   # 源站数学工具函数（质数/回文/等差拆分等，原样移植）
│   ├── badges.js       # 233 枚徽章定义 + 分数表 + 概率表（由 tools/gen.cjs 生成）
│   ├── badges-zh.js    # 徽章中文本地化 + 稀有度文案 + 评语
│   ├── analyze.js      # 分析引擎（编排判定、计分、评级）
│   ├── config.js       # 配置读写（rankLimit / keepDays）
│   └── percentiles.json# EP 总分 → 全服百分位对照表（60,392 条）
├── resources/html/     # 渲染模板（结果卡/帮助/统计/日榜/总榜/图鉴）
├── config/config.json  # 用户配置（运行时/Guoba 生成）
├── data/db.json        # 玩家数据（运行时生成）
└── tools/              # 维护工具：再提取 + 生成 + 回归测试
    ├── extract-modules.cjs  # 从站点 chunk 切出模块源码
    ├── gen.cjs              # 重新生成 lib/ 数据文件（自带指纹校验）
    ├── test-e2e.mjs         # 不启动机器人的端到端回归测试
    └── vendor/              # 源站模块源码存档
```

## 回归测试

不启动 Yunzai 即可验证完整命令链路（真实 plugin 基类 + 真实渲染器）：

```bash
node plugins/RNGdle-Plugin/tools/test-e2e.mjs
```

## 源站更新后如何同步

当 rngdle.com 新增/调整徽章时：

1. 从浏览器或 `curl` 拉取站点首屏 JS chunk（`/_next/static/chunks/*.js`），
   找到包含 `createBadgeId` 定义的 chunk；
2. 用 `tools/extract-modules.cjs` 从 chunk 中切出模块源码（依赖模块 `847558`、目录 `510584`、
   定义 `167711`），放入 `tools/vendor/`；
3. 运行 `node tools/gen.cjs` 重新生成 `lib/` 下的三个文件；
4. 在 `lib/badges-zh.js` 补充新徽章的中文翻译；
5. 跑一遍校验：`node -e "import('file://.../lib/analyze.js').then(m => console.log(m.composeResult(2).totalScore))"`
   应输出 `119610065`。

## 配置

通过 **Guoba 面板**配置（或直接改 `config/config.json`）：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `dailyRolls` | 1 | 每日可抽次数（1~20）；多次抽取全部计入统计，每日排行取当天最高 EP 的一次 |
| `rankLimit` | 10 | 日榜/总榜显示人数上限（1~50） |
| `keepDays` | 30 | 每日记录保留天数（1~30，1 即次日清理）；每天 4 点自动清理 |

## 致谢

游戏机制与全部数值设计来自 [rngdle.com](https://www.rngdle.com/)（About / Discord）。
本插件仅作个人学习与本地化移植用途。
