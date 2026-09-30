import type { RecapData } from "../../web/src/recap/types.ts"

/** Remotion Studio 預覽用的示範資料（全部是虛構的，名稱也不是真實帳號）。實際渲染由 scripts/recap.mjs 從本機服務取真資料。 */
export const RECAP_SAMPLE: RecapData = {
  player: "示範玩家#0000",
  from: "2026-08-28",
  to: "2026-09-28",
  games: 245,
  wins: 120,
  hours: 67.6,
  kills: 2464,
  deaths: 2688,
  assists: 6099,
  multikills: 515,
  pentas: 4,
  longestWinStreak: 7,
  longestLossStreak: 8,
  champions: [
    { name: "英雄甲", icon: null, games: 13, winrate: 53.8 },
    { name: "英雄乙", icon: null, games: 11, winrate: 63.6 },
    { name: "英雄丙", icon: null, games: 8, winrate: 75 },
  ],
  augmentMostPicked: { name: "增幅甲", icon: null, games: 31, winrate: 58.1 },
  augmentBest: { name: "增幅乙", icon: null, games: 8, winrate: 87.5 },
  weekdays: [
    { games: 79, wins: 40 }, { games: 14, wins: 6 }, { games: 0, wins: 0 }, { games: 0, wins: 0 },
    { games: 7, wins: 4 }, { games: 41, wins: 20 }, { games: 104, wins: 50 },
  ],
  peak: { weekday: 0, block: "下午", games: 72, wins: 37 },
  bestBlock: { block: "晚上", games: 104, wins: 52 },
  partner: { name: "隊友甲", games: 230, wins: 113 },
}
