import { C } from "./theme"
import type { Feature } from "./scenes/Feature"
import TL from "./timeline.json"

/**
 * 七個功能場景。文字欄左右交替；停靠點的 at 是相對場景起點的幀（30 fps）。
 * regions 的名稱對應 scripts/capture.mjs 量出來的區域（public/shots/shots.json）。
 * 這裡的每一句都要對得上畫面上真的看得到的東西——改版後重拍截圖，再回來檢查。
 */
export const FEATURES: Feature[] = [
  {
    shot: "dashboard",
    title: "儀表板",
    tagline: "整體表現，一頁看完",
    accent: C.primary,
    side: "left",
    stops: [
      { at: TL.stopAt[0][0], regions: ["overall", "recent", "kpi"], bullet: "整體勝率與近況", sub: "最近 10 場、KDA、每分鐘傷害" },
      { at: TL.stopAt[0][1], regions: ["trend", "champs"], bullet: "每日趨勢", sub: "每天的勝率起伏、最常用英雄" },
      { at: TL.stopAt[0][2], regions: ["loadout", "augPicks", "when"], bullet: "一眼看懂習慣", sub: "出裝定位、常選增幅、常打時段" },
    ],
  },
  {
    shot: "champions",
    title: "英雄",
    tagline: "每隻英雄，打得怎麼樣",
    accent: C.data,
    side: "right",
    stops: [
      { at: TL.stopAt[1][0], regions: ["radar"], bullet: "出裝定位", sub: "雷達圖看你偏哪一型", maxS: 1.25 },
      { at: TL.stopAt[1][1], regions: ["table"], bullet: "英雄戰績表", sub: "場次、勝率、KDA、每分鐘傷害" },
    ],
  },
  {
    shot: "augments",
    title: "增幅裝置",
    tagline: "哪個增幅真的有用",
    accent: C.prismatic,
    side: "left",
    stops: [
      { at: TL.stopAt[2][0], regions: ["picker", "ranking"], bullet: "勝率排行", sub: "選一隻英雄，看契合度加成" },
      { at: TL.stopAt[2][1], regions: ["all"], bullet: "全部增幅明細", sub: "每個增幅的場次與勝率" },
    ],
  },
  {
    shot: "lineups",
    title: "陣容",
    tagline: "陣容對上陣容，誰佔便宜",
    accent: C.primary,
    side: "right",
    stops: [
      { at: TL.stopAt[3][0], regions: ["matrix"], bullet: "對陣勝率表", sub: "我方 × 敵方前排數，各贏多少" },
      { at: TL.stopAt[3][1], regions: ["mine", "enemy"], bullet: "陣容類型", sub: "各種組合的勝率一次比較" },
    ],
  },
  {
    shot: "time",
    title: "時段",
    tagline: "什麼時候打，什麼時候贏",
    accent: C.gold,
    side: "left",
    stops: [
      { at: TL.stopAt[4][0], regions: ["trend"], bullet: "每日場次與勝率", sub: "哪幾天打得多、贏得多" },
      { at: TL.stopAt[4][1], regions: ["heat"], bullet: "星期 × 時段熱力圖", sub: "點一格，列出那幾場" },
    ],
  },
  {
    shot: "losses",
    title: "敗因分析",
    tagline: "輸的時候，哪些數字不一樣",
    accent: C.loss,
    side: "right",
    stops: [
      { at: TL.stopAt[5][0], regions: ["verdict"], bullet: "打不動，還是被打爆？", sub: "我方輸出變少，還是敵方變多", maxS: 1.5 },
      { at: TL.stopAt[5][1], regions: ["table"], bullet: "勝局 vs 敗局", sub: "逐項比較，差多少一目了然" },
    ],
  },
  {
    shot: "explore",
    title: "自由探索",
    tagline: "自己組出想看的分析",
    accent: C.primary,
    side: "left",
    stops: [
      { at: TL.stopAt[6][0], regions: ["fields"], bullet: "拖曳組合", sub: "維度與指標，自己配" },
      { at: TL.stopAt[6][1], regions: ["result"], bullet: "換個圖表看", sub: "表格、長條、折線、散布、熱力圖" },
    ],
    swap: { shot: "explore-bar", at: TL.swapAt },
  },
]
