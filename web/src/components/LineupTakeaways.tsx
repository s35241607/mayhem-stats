import { useMemo } from "react"
import { useCube } from "@/hooks/useCube"
import type { CubeRow } from "@/lib/cube"
import { useWhoScope } from "@/lib/who"
import { STRENGTH_CLASS, gapOf, strengthOf, zFor } from "@/lib/gap"
import { cn } from "@/lib/utils"
import { EmptyState, Panel } from "@/components/primitives"
import { Skeleton } from "@/components/ui/skeleton"

/** 陣容頁最上面的重點：哪些陣容看得出強或弱、哪些對陣有相剋。
 *
 *  一支查詢（所有隊伍、隊伍粒度）把每一隊的陣容條件與對面的條件一起撈回來，下面兩份清單都從它算，
 *  資料變多結論會自己更新，不會像寫死的數字一樣過時（docs 裡 2026-10 的「前排重 42%」到 11 月已經是 49.5%）。
 *  條件全部用語意層的維度（前排數、輸出組成、輔助、原型）；法師、刺客、射手、坦克、鬥士的人數是數「五人組成」那五個字，
 *  不另外定義誰算前排、誰算輸出。
 *  同時比很多種，判定門檻依比較的數量放寬（zFor）：一次比二十幾種，總有一兩種只是運氣好。 */

const GAMES = "participants.team_games"
const WINS = "participants.team_wins"
const D = {
  tf: "comp_context.team_frontline",
  tm: "comp_context.team_damage_mix",
  ts: "comp_context.team_support",
  ta: "comp_context.team_archetype",
  tl: "comp_context.team_lineup",
  ef: "comp_context.enemy_frontline",
  em: "comp_context.enemy_damage_mix",
  es: "comp_context.enemy_support",
  ea: "comp_context.enemy_archetype",
  el: "comp_context.enemy_lineup",
} as const

type Team = { tf: string; tm: string; ts: string; ta: string; tl: string; ef: string; em: string; es: string; ea: string; el: string; games: number; wins: number }
const count = (lineup: string, ch: string) => lineup.split(ch).length - 1

const FRONTS = ["0 個", "1 個", "2 個", "3 個以上"] as const
const MIXES = ["物理為主", "混合", "魔法為主"] as const
const frontName = (f: string) => (f === "0 個" ? "沒有前排" : `${f.replace(" 個", " 個前排").replace("前排以上", "以上前排")}`)

/** 一隊自己的陣容條件 */
const SOLO: { label: string; test: (t: Team) => boolean }[] = [
  ...FRONTS.map((f) => ({ label: frontName(f), test: (t: Team) => t.tf === f })),
  ...FRONTS.flatMap((f) => MIXES.map((m) => ({ label: `${frontName(f)}＋${m}`, test: (t: Team) => t.tf === f && t.tm === m }))),
  { label: "4 個以上法師", test: (t) => count(t.tl, "法") >= 4 },
  { label: "3 個法師", test: (t) => count(t.tl, "法") === 3 },
  { label: "2 個以上坦克", test: (t) => count(t.tl, "坦") >= 2 },
  { label: "沒有鬥士", test: (t) => count(t.tl, "鬥") === 0 },
  { label: "2 個以上射手", test: (t) => count(t.tl, "射") >= 2 },
  { label: "2 個以上刺客", test: (t) => count(t.tl, "刺") >= 2 },
  { label: "有輔助", test: (t) => t.ts === "有輔助" },
]

/** 對陣：我方是 a 時，敵方是不是 b 會差多少 */
const VERSUS: { a: string; b: string; mine: (t: Team) => boolean; theirs: (t: Team) => boolean }[] = [
  { a: "有刺客", b: "輸出多的隊伍（脆皮多）", mine: (t) => count(t.tl, "刺") >= 1, theirs: (t) => t.ea === "輸出多" },
  { a: "有刺客", b: "2 個以上坦克", mine: (t) => count(t.tl, "刺") >= 1, theirs: (t) => count(t.el, "坦") >= 2 },
  { a: "前排重", b: "有輔助的隊伍", mine: (t) => t.ta === "前排重", theirs: (t) => t.es === "有輔助" },
  { a: "前排重", b: "輸出多的隊伍", mine: (t) => t.ta === "前排重", theirs: (t) => t.ea === "輸出多" },
  { a: "前排重", b: "有射手的隊伍", mine: (t) => t.ta === "前排重", theirs: (t) => count(t.el, "射") >= 1 },
  { a: "輸出多", b: "有刺客的隊伍", mine: (t) => t.ta === "輸出多", theirs: (t) => count(t.el, "刺") >= 1 },
  { a: "3 個以上法師", b: "有刺客的隊伍", mine: (t) => count(t.tl, "法") >= 3, theirs: (t) => count(t.el, "刺") >= 1 },
  { a: "沒有前排", b: "有刺客的隊伍", mine: (t) => t.tf === "0 個", theirs: (t) => count(t.el, "刺") >= 1 },
  { a: "2 個以上射手", b: "前排重的隊伍", mine: (t) => count(t.tl, "射") >= 2, theirs: (t) => t.ea === "前排重" },
  { a: "2 個以上坦克", b: "魔法為主的隊伍", mine: (t) => count(t.tl, "坦") >= 2, theirs: (t) => t.em === "魔法為主" },
  { a: "魔法為主", b: "2 個以上坦克", mine: (t) => t.tm === "魔法為主", theirs: (t) => count(t.el, "坦") >= 2 },
  { a: "物理為主", b: "2 個以上坦克", mine: (t) => t.tm === "物理為主", theirs: (t) => count(t.el, "坦") >= 2 },
]

/** 列進清單至少要幾隊：太少的連方向都不可信 */
const MIN_TEAMS = 40
const MIN_SIDE = 30

export function LineupTakeaways() {
  // 判定一律看所有隊伍（每場兩隊都算，資料量最大），和下面「陣容強弱」同一個範圍；模式、期間、版本照樣套用
  const { q } = useWhoScope("all")
  const res = useCube(q({ measures: [GAMES, WINS], dimensions: Object.values(D), limit: 50000 }))
  const teams = useMemo<Team[]>(
    () =>
      res.rows.map((r: CubeRow) => ({
        ...(Object.fromEntries(Object.entries(D).map(([k, member]) => [k, String(r[member] ?? "")])) as Omit<Team, "games" | "wins">),
        games: Number(r[GAMES]) || 0,
        wins: Number(r[WINS]) || 0,
      })),
    [res.rows],
  )

  const { solo, versus, total } = useMemo(() => {
    const total = teams.reduce((a, t) => a + t.games, 0)
    const zs = zFor(SOLO.length)
    const solo = SOLO.map((c) => {
      const hit = teams.filter(c.test)
      const row = { key: c.label, label: c.label, games: hit.reduce((a, t) => a + t.games, 0), wins: hit.reduce((a, t) => a + t.wins, 0) }
      const g = gapOf(row, 50, zs)
      return { ...row, g, verdict: strengthOf(g) }
    }).filter((x) => x.games >= MIN_TEAMS && x.verdict !== "看不出")
    const zv = zFor(VERSUS.length)
    const versus = VERSUS.map((c) => {
      const mine = teams.filter(c.mine)
      const sum = (list: Team[]) => ({ n: list.reduce((a, t) => a + t.games, 0), w: list.reduce((a, t) => a + t.wins, 0) })
      const yes = sum(mine.filter(c.theirs))
      const no = sum(mine.filter((t) => !c.theirs(t)))
      if (yes.n < MIN_SIDE || no.n < MIN_SIDE) return null
      const p1 = yes.w / yes.n
      const p0 = no.w / no.n
      const se = Math.sqrt((p1 * (1 - p1)) / yes.n + (p0 * (1 - p0)) / no.n)
      const z = se ? (p1 - p0) / se : 0
      return { ...c, yes, no, p1: p1 * 100, p0: p0 * 100, diff: (p1 - p0) * 100, z, clear: Math.abs(z) >= zv }
    })
      .filter((x): x is NonNullable<typeof x> => !!x && Math.abs(x.z) >= 1.96)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    return { solo, versus, total }
  }, [teams])

  const strong = solo.filter((x) => x.g.diff > 0).sort((a, b) => b.g.diff - a.g.diff).slice(0, 4)
  const weak = solo.filter((x) => x.g.diff < 0).sort((a, b) => a.g.diff - b.g.diff).slice(0, 4)
  const chip = "shrink-0 rounded border px-1.5 py-0.5 text-[11px]"

  const soloList = (title: string, items: typeof solo, tone: "win" | "loss") => (
    <div>
      <h3 className={cn("mb-1.5 text-[13px] font-semibold", tone === "win" ? "text-win" : "text-loss")}>{title}</h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((x) => (
            <li key={x.key} className="flex items-center gap-2 text-sm" data-testid="lineup-takeaway" data-games={x.games} data-wins={x.wins}>
              <span className="min-w-0 flex-1 truncate">{x.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{x.games} 隊</span>
              <b className={cn("w-11 shrink-0 text-right font-mono tabular-nums", tone === "win" ? "text-win" : "text-loss")}>{x.g.winrate.toFixed(0)}%</b>
              <span className={cn(chip, STRENGTH_CLASS[x.verdict])}>{x.g.clear ? "看得出" : "有傾向"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">沒有差到 3 個百分點以上的。</p>
      )}
    </div>
  )

  return (
    <Panel
      title="重點：哪些陣容強、哪些相剋"
      caption="從所有隊伍即時算；資料變多會自己更新"
      hint={
        `比了 ${SOLO.length} 種陣容與 ${VERSUS.length} 種對陣。「看得出」＝依同時比較的數量放寬後，區間仍整段在 50% 的同一邊；` +
        `「有傾向」＝差 3 個百分點以上但還在誤差內（對陣是單獨看達 95%、放寬後還不夠）。\n` +
        `每場兩隊都算，所以整體勝率必然是 50%。定位看終場出裝，是打完的結果：輸的一方可能是被逼著出坦裝，不一定是選了這個陣容才輸。\n` +
        `至少 ${MIN_TEAMS} 隊才列；對陣兩邊各至少 ${MIN_SIDE} 隊。`
      }
      refreshing={res.refreshing}
    >
      {res.error ? (
        <div className="text-sm text-destructive">{res.error}</div>
      ) : res.loading ? (
        <Skeleton className="h-[220px] w-full" />
      ) : !total ? (
        <EmptyState>這個條件下還沒有對局。</EmptyState>
      ) : (
        <div className="reveal space-y-4">
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {soloList("比較會贏", strong, "win")}
            {soloList("比較會輸", weak, "loss")}
          </div>
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">相剋</h3>
            {versus.length ? (
              <ul className="space-y-1.5">
                {versus.slice(0, 5).map((v) => (
                  <li key={`${v.a}|${v.b}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm" data-testid="lineup-versus" data-yes={`${v.yes.w}/${v.yes.n}`} data-no={`${v.no.w}/${v.no.n}`}>
                    <span>
                      <b>{v.a}</b>
                      {v.diff > 0 ? " 好打 " : " 怕 "}
                      <b>{v.b}</b>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      遇到時 <b className={v.diff > 0 ? "text-win" : "text-loss"}>{v.p1.toFixed(0)}%</b>（{v.yes.n} 隊）・其他時候 {v.p0.toFixed(0)}%（{v.no.n} 隊）
                    </span>
                    <span className={cn(chip, v.clear ? STRENGTH_CLASS[v.diff > 0 ? "強勢" : "不強勢"] : STRENGTH_CLASS[v.diff > 0 ? "偏強" : "偏弱"])}>{v.clear ? "看得出" : "有傾向"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">檢查的 {VERSUS.length} 種對陣裡，沒有哪一種的差距大到看得出來。</p>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}
