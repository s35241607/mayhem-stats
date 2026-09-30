import type { CubeFilter, CubeQuery, CubeRow } from "../lib/cube.ts"
import type { RecapData, RecapItem } from "./types.ts"

/** 賽季回顧要問的東西。全部走 Cube 語意層，這裡只做「問哪些」和「怎麼挑出亮點」。
 *
 *  不依賴 React 或瀏覽器：網頁用 `cubeQuery` 當 query，匯出影片的腳本用一個對本機服務 fetch 的版本。 */

export type RecapScope = {
  puuid: string
  /** 顯示用的名稱；沒有就不顯示 */
  player: string | null
  /** 只算哪個模式，null = 全部 */
  queueId: string | null
  /** 本地日期區間 [起, 迄]，null = 全部期間 */
  dateRange: [string, string] | null
}

export type RecapQuery = (query: CubeQuery) => Promise<CubeRow[]>

/** 增幅單獨比勝率，場次低於這個數不算（和各頁的 MIN_GAMES 同一個標準）。 */
const MIN_AUGMENT_GAMES = 5
/** 「勝率最高的時段」的最低場次：四個時段各自累積，門檻比增幅高 */
const MIN_BLOCK_GAMES = 10
/** 隊友要同隊至少幾場才算「固定搭檔」 */
const MIN_PARTNER_GAMES = 3

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0
  const x = typeof v === "number" ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

const rate = (wins: number, games: number) => (games ? (100 * wins) / games : null)

/** 兩個 cube 用的篩選條件不同（participants.puuid／teammates.subject_puuid），其餘一樣。 */
function scoped(scope: RecapScope, subject: string): Pick<CubeQuery, "filters" | "timeDimensions"> {
  const filters: CubeFilter[] = [{ member: subject, operator: "equals", values: [scope.puuid] }]
  if (scope.queueId) filters.push({ member: "matches.queue_id", operator: "equals", values: [scope.queueId] })
  return {
    filters,
    ...(scope.dateRange ? { timeDimensions: [{ dimension: "matches.played_at", dateRange: scope.dateRange }] } : {}),
  }
}

/** 依時間排序的連續 true 最長長度。 */
function longestRun(flags: boolean[], want: boolean): number {
  let best = 0
  let run = 0
  for (const f of flags) {
    run = f === want ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

function items(rows: CubeRow[], name: string, icon: string): RecapItem[] {
  return rows.map((r) => {
    const games = n(r["participants.games"])
    return {
      name: String(r[name] ?? "—"),
      icon: (r[icon] as string | null) || null,
      games,
      winrate: rate(n(r["participants.wins"]), games),
    }
  })
}

export async function loadRecap(query: RecapQuery, scope: RecapScope): Promise<RecapData | null> {
  const mine = scoped(scope, "participants.puuid")
  const withTeammate = scoped(scope, "teammates.subject_puuid")

  const [summary, champs, augments, timing, sequence, partners] = await Promise.all([
    query({
      ...mine,
      measures: [
        "participants.games", "participants.wins",
        "participants.avg_kills", "participants.avg_deaths", "participants.avg_assists",
        "participants.multikills", "participants.pentas",
        "matches.avg_duration",
      ],
    }),
    query({
      ...mine,
      measures: ["participants.games", "participants.wins"],
      dimensions: ["champions.name", "champions.icon_path"],
      order: { "participants.games": "desc", "participants.wins": "desc" },
      limit: 3,
    }),
    // 增幅是一場多列的維度：用 wins 和 games 兩個 count_distinct 自己除，不用 winrate（見 lib/cube.ts 的 splitWinrate）
    query({
      ...mine,
      measures: ["participants.games", "participants.wins"],
      dimensions: ["augments.name", "augments.icon_path"],
      limit: 50000,
    }),
    query({
      ...mine,
      measures: ["participants.games", "participants.wins"],
      dimensions: ["matches.weekday", "matches.time_block"],
    }),
    // 逐場的勝負與時間，算連勝連敗用。連勝不是語意層的維度，沒有第二份定義要對齊。
    query({
      ...mine,
      measures: ["participants.games"],
      dimensions: ["matches.game_id", "matches.played_at", "matches.local_date", "participants.result"],
      order: { "matches.played_at": "asc" },
      limit: 50000,
    }),
    query({
      ...withTeammate,
      filters: [...(withTeammate.filters ?? []), { member: "teammates.relation", operator: "equals", values: ["teammate"] }],
      measures: ["teammates.games", "teammates.wins"],
      dimensions: ["teammates.player"],
      order: { "teammates.games": "desc", "teammates.wins": "desc" },
      limit: 1,
    }),
  ])

  const s = summary[0]
  const games = n(s?.["participants.games"])
  if (!games || !sequence.length) return null

  const augmentRows = items(augments, "augments.name", "augments.icon_path")
  const byGames = [...augmentRows].sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0))
  const byRate = augmentRows
    .filter((a) => a.games >= MIN_AUGMENT_GAMES)
    .sort((a, b) => (b.winrate ?? 0) - (a.winrate ?? 0) || b.games - a.games)

  const weekdays = Array.from({ length: 7 }, () => ({ games: 0, wins: 0 }))
  const blocks = new Map<string, { games: number; wins: number }>()
  let peak: RecapData["peak"] = null
  for (const r of timing) {
    const weekday = n(r["matches.weekday"])
    const block = String(r["matches.time_block"])
    const g = n(r["participants.games"])
    const w = n(r["participants.wins"])
    weekdays[weekday].games += g
    weekdays[weekday].wins += w
    const b = blocks.get(block) ?? { games: 0, wins: 0 }
    b.games += g
    b.wins += w
    blocks.set(block, b)
    if (!peak || g > peak.games || (g === peak.games && w > peak.wins)) peak = { weekday, block, games: g, wins: w }
  }
  const bestBlock = [...blocks.entries()]
    .filter(([, b]) => b.games >= MIN_BLOCK_GAMES)
    .map(([block, b]) => ({ block, ...b }))
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)[0] ?? null

  const flags = sequence.map((r) => r["participants.result"] === "勝")
  const p = partners[0]
  const partnerGames = n(p?.["teammates.games"])

  return {
    player: scope.player,
    from: String(sequence[0]["matches.local_date"]),
    to: String(sequence[sequence.length - 1]["matches.local_date"]),
    games,
    wins: n(s["participants.wins"]),
    // 平均時長 × 場數：avg_duration 是分鐘，Cube 回的是未經四捨五入的雙精度
    hours: (n(s["matches.avg_duration"]) * games) / 60,
    kills: Math.round(n(s["participants.avg_kills"]) * games),
    deaths: Math.round(n(s["participants.avg_deaths"]) * games),
    assists: Math.round(n(s["participants.avg_assists"]) * games),
    multikills: n(s["participants.multikills"]),
    pentas: n(s["participants.pentas"]),
    longestWinStreak: longestRun(flags, true),
    longestLossStreak: longestRun(flags, false),
    champions: items(champs, "champions.name", "champions.icon_path"),
    augmentMostPicked: byGames[0] ?? null,
    augmentBest: byRate[0] ?? null,
    weekdays,
    peak,
    bestBlock,
    partner: p && partnerGames >= MIN_PARTNER_GAMES
      ? { name: String(p["teammates.player"]), games: partnerGames, wins: n(p["teammates.wins"]) }
      : null,
  }
}
