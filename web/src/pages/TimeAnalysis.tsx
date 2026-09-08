import { Skeleton } from "@/components/ui/skeleton"
import { Panel, EmptyState, Kpi } from "@/components/primitives"
import { Heatmap, BarChart, type HeatCell, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

export function TimeAnalysis() {
  const { apply } = useFilters()

  const heat = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.weekday", "matches.hour_of_day"],
      limit: 400,
    }),
  )

  const byWeekday = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.weekday"],
      limit: 10,
    }),
  )

  const byDuration = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.duration_bucket"],
      limit: 10,
    }),
  )

  const cells: HeatCell[] = heat.rows.map((r) => ({
    weekday: Number(r["matches.weekday"]),
    hour: Number(r["matches.hour_of_day"]),
    games: num(r["participants.games"]) ?? 0,
    winrate: num(r["participants.winrate"]),
  }))

  const totalGames = cells.reduce((sum, c) => sum + c.games, 0)
  const activeCells = cells.filter((c) => c.games > 0).length
  const busiest = [...cells].sort((a, b) => b.games - a.games)[0]

  const weekdayBars: BarDatum[] = byWeekday.rows
    .map((r) => ({
      label: WEEKDAYS[Number(r["matches.weekday"])] ?? "—",
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  const durationBars: BarDatum[] = byDuration.rows.map((r) => ({
    label: String(r["matches.duration_bucket"] ?? "—"),
    value: num(r["participants.winrate"]) ?? 0,
    games: num(r["participants.games"]) ?? 0,
  }))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="總場次" value={String(totalGames)} loading={heat.loading} />
        <Kpi
          label="有打過的時段"
          value={`${activeCells} / 168`}
          hint="星期 × 小時共 168 格"
          loading={heat.loading}
        />
        <Kpi
          label="最常打的時段"
          value={
            busiest
              ? `${WEEKDAYS[busiest.weekday]} ${String(busiest.hour).padStart(2, "0")}:00`
              : "—"
          }
          hint={busiest ? `${busiest.games} 場` : undefined}
          loading={heat.loading}
        />
      </div>

      <Panel
        title="星期 × 時段"
        caption={`同一格是所有週日的同一時段加總，不是單一天——共 ${totalGames} 場攤在 168 格裡，單格場次少時勝率別當真`}
      >
        {heat.loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : cells.length ? (
          <Heatmap cells={cells} />
        ) : (
          <EmptyState>這個條件下還沒有資料。</EmptyState>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="星期別勝率">
          {byWeekday.loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : weekdayBars.length ? (
            <BarChart data={weekdayBars} suffix="%" />
          ) : (
            <EmptyState>還沒有資料。</EmptyState>
          )}
        </Panel>

        <Panel title="對局長度與勝率" caption="打得快是不是比較容易贏？">
          {byDuration.loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : durationBars.length ? (
            <BarChart data={durationBars} suffix="%" />
          ) : (
            <EmptyState>還沒有資料。</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  )
}
