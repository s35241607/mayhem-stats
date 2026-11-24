import { Lightbulb } from "lucide-react"
import { Hint } from "@/components/TipLayer"
import { CONFIDENCE_HINT, judge } from "@/lib/confidence"
import type { CubeRow } from "@/lib/cube"

/** 結論先講：表格上方一句話，只列「看得出」和基準不同的項目（lib/confidence 的同一套判定）。
 *  數字直接從表格已載入的列算，不另外查詢——和表格上的 ▲▼ 必定一致。 */
export function Insight({
  rows,
  nameKey,
  gamesKey = "participants.games",
  winsKey = "participants.wins",
  baseline,
  baselineLabel,
  noun,
}: {
  rows: CubeRow[]
  nameKey: string
  gamesKey?: string
  winsKey?: string
  baseline: number | null
  baselineLabel: string
  /** 「英雄」「增幅」…… */
  noun: string
}) {
  if (baseline === null || !rows.length) return null
  const judged = rows
    .map((r) => {
      const games = Number(r[gamesKey]) || 0
      const wins = Number(r[winsKey]) || 0
      return { name: String(r[nameKey] ?? "—"), games, wins, rate: games ? (wins / games) * 100 : 0, verdict: judge(wins, games, baseline) }
    })
    .filter((x) => x.verdict)
  const high = judged.filter((x) => x.verdict === "high").sort((a, b) => b.games - a.games).slice(0, 3)
  const low = judged.filter((x) => x.verdict === "low").sort((a, b) => b.games - a.games).slice(0, 3)
  const fmt = (xs: typeof high) => xs.map((x) => `${x.name}（${x.games} 場 ${Math.round(x.rate)}%）`).join("、")

  return (
    <p className="rise flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0">
        {!high.length && !low.length ? (
          <>沒有哪個{noun}的勝率和{baselineLabel}（{baseline.toFixed(1)}%）差到看得出來，差距都還在誤差內。</>
        ) : (
          <>
            {high.length > 0 && (
              <>
                看得出比{baselineLabel}高：<b className="text-win">{fmt(high)}</b>。
              </>
            )}
            {low.length > 0 && (
              <>
                {" "}看得出低：<b className="text-loss">{fmt(low)}</b>。
              </>
            )}
          </>
        )}
        <Hint text={CONFIDENCE_HINT} className="ml-1" />
      </span>
    </p>
  )
}
