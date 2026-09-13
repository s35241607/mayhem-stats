import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Panel, EmptyState, Kpi } from "@/components/primitives"
import { MatchList } from "@/components/MatchList"
import {
  DailyChart,
  Heatmap,
  HOURS_24,
  BarChart,
  type DayDatum,
  type HeatCell,
  type BarDatum,
} from "@/components/charts"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { BLOCKS, WEEKDAYS, toBlocks } from "./shared"

type Grain = "hour" | "block"

/** 目前下鑽到哪一塊。date 是某一天，slot 是某個星期幾的某段時間。 */
type Slice =
  | { kind: "date"; date: string }
  | { kind: "slot"; weekday: number; from: number; to: number; label: string }

const sliceLabel = (s: Slice) =>
  s.kind === "date" ? s.date : `${WEEKDAYS[s.weekday]} ${s.label}`

const sliceParams = (s: Slice): Record<string, string> =>
  s.kind === "date"
    ? { date: s.date }
    : { weekday: String(s.weekday), hour_from: String(s.from), hour_to: String(s.to) }

export function TimeAnalysis() {
  const { apply, account, matchParams } = useFilters()
  const [slice, setSlice] = useState<Slice | null>(null)
  const [grain, setGrain] = useState<Grain>("block")

  const daily = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.local_date"],
      limit: 400,
    }),
  )

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


  const days: DayDatum[] = useMemo(
    () =>
      daily.rows
        .map((r) => ({
          date: String(r["matches.local_date"] ?? ""),
          games: num(r["participants.games"]) ?? 0,
          winrate: num(r["participants.winrate"]),
        }))
        .filter((d) => d.date)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [daily.rows],
  )

  /** 一列一個小時，之後依照粗細度再合併。 */
  const hourly = useMemo(
    () =>
      heat.rows.map((r) => ({
        weekday: Number(r["matches.weekday"]),
        hour: Number(r["matches.hour_of_day"]),
        games: num(r["participants.games"]) ?? 0,
        winrate: num(r["participants.winrate"]),
      })),
    [heat.rows],
  )

  const cells: HeatCell[] = useMemo(() => {
    if (grain === "hour") {
      return hourly.map((h) => ({ weekday: h.weekday, x: h.hour, games: h.games, winrate: h.winrate }))
    }
    return toBlocks(hourly).map((c) => ({ weekday: c.weekday, x: c.block, games: c.games, winrate: c.winrate }))
  }, [hourly, grain])

  const xLabels = grain === "hour" ? HOURS_24 : BLOCKS.map((b) => b.label)
  const totalGames = hourly.reduce((sum, c) => sum + c.games, 0)
  const activeCells = cells.filter((c) => c.games > 0).length
  const busiest = [...hourly].sort((a, b) => b.games - a.games)[0]

  const weekdayBars: BarDatum[] = byWeekday.rows
    .map((r) => ({
      label: WEEKDAYS[Number(r["matches.weekday"])] ?? "—",
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)


  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="總場次" value={String(totalGames)} loading={heat.loading} />
        <Kpi
          label="打過的日子"
          value={String(days.length)}
          hint={days.length ? `${days[0].date} 起` : undefined}
          loading={daily.loading}
        />
        <Kpi
          label="最常打的時段"
          value={
            busiest ? `${WEEKDAYS[busiest.weekday]} ${String(busiest.hour).padStart(2, "0")}:00` : "—"
          }
          hint={busiest ? `${busiest.games} 場・${activeCells} / ${7 * xLabels.length} 格有資料` : undefined}
          loading={heat.loading}
        />
      </div>

      <Panel title="每天的場次與勝率" caption="長條是場次，折線是勝率，虛線是你的整體水準。點任一天可以看那天的每一場">
        {daily.loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : days.length ? (
          <DailyChart
            days={days}
            selected={slice?.kind === "date" ? slice.date : null}
            onPick={(date) => setSlice({ kind: "date", date })}
          />
        ) : (
          <EmptyState>這個條件下還沒有資料。</EmptyState>
        )}
      </Panel>

      {slice && (
        <Panel
          title={`${sliceLabel(slice)} 的每一場`}
          action={
            <Button size="sm" variant="ghost" onClick={() => setSlice(null)}>
              <X className="size-3.5" />
              收起
            </Button>
          }
        >
          <MatchList
            params={{ ...matchParams(), ...sliceParams(slice) }}
            puuid={account?.puuid}
          />
        </Panel>
      )}

      <Panel
        title="星期 × 時段"
        caption={
          grain === "hour"
            ? `共 ${totalGames} 場攤在 ${7 * 24} 格裡，單格通常只有個位數——顏色已經依樣本多寡收斂，但這個粗細度主要是看「什麼時候在打」`
            : `共 ${totalGames} 場分成 ${7 * BLOCKS.length} 格，樣本比逐小時集中得多。點一下可以看那個時段的每一場`
        }
        action={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={grain}
            onValueChange={(v) => v && setGrain(v as Grain)}
          >
            <ToggleGroupItem value="block">四時段</ToggleGroupItem>
            <ToggleGroupItem value="hour">逐小時</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {heat.loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : cells.length ? (
          <Heatmap
            cells={cells}
            xLabels={xLabels}
            selected={
              slice?.kind === "slot"
                ? { weekday: slice.weekday, x: grain === "hour" ? slice.from : BLOCKS.findIndex((b) => b.from === slice.from) }
                : null
            }
            onPick={({ weekday, x }) =>
              setSlice(
                grain === "hour"
                  ? { kind: "slot", weekday, from: x, to: x, label: `${String(x).padStart(2, "0")}:00` }
                  : { kind: "slot", weekday, from: BLOCKS[x].from, to: BLOCKS[x].to, label: BLOCKS[x].label },
              )
            }
          />
        ) : (
          <EmptyState>這個條件下還沒有資料。</EmptyState>
        )}
      </Panel>

      <Panel title="星期別勝率">
        {byWeekday.loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : weekdayBars.length ? (
          <BarChart data={weekdayBars} suffix="%" />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>
    </div>
  )
}
