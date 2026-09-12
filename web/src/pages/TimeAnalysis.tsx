import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Panel, EmptyState, Kpi } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
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
import { MatchDetail, type MatchRow } from "@/pages/Matches"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

/** 熱力圖的粗分組。
 *
 *  168 格攤 100 多場，單格最多只有個位數，顏色再怎麼校正也只是在看雜訊。
 *  切成 7×4 = 28 格之後，每格的樣本才有機會累積到看得出差異的量。 */
const BLOCKS = [
  { label: "深夜 0-5", from: 0, to: 5 },
  { label: "早上 6-11", from: 6, to: 11 },
  { label: "下午 12-17", from: 12, to: 17 },
  { label: "晚上 18-23", from: 18, to: 23 },
]

type Grain = "hour" | "block"

/** 目前下鑽到哪一塊。date 是某一天，slot 是某個星期幾的某段時間。 */
type Slice =
  | { kind: "date"; date: string }
  | { kind: "slot"; weekday: number; from: number; to: number; label: string }

const sliceLabel = (s: Slice) =>
  s.kind === "date" ? s.date : `${WEEKDAYS[s.weekday]} ${s.label}`

const sliceQuery = (s: Slice) =>
  s.kind === "date"
    ? `date=${s.date}`
    : `weekday=${s.weekday}&hour_from=${s.from}&hour_to=${s.to}`

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })

const MATCH_COLUMNS: GridColumn[] = [
  { key: "champion_name", title: "英雄", kind: "dimension", iconKey: "champion_icon" },
  { key: "when", title: "時間", kind: "dimension" },
  { key: "result", title: "結果", kind: "dimension" },
  { key: "kda_text", title: "K / D / A", kind: "dimension" },
  { key: "kda", title: "KDA", kind: "metric", format: (n) => n.toFixed(2) },
  { key: "dmg_to_champions", title: "對英雄傷害", kind: "metric", format: (n) => Math.round(n).toLocaleString() },
  { key: "gold_earned", title: "取得金錢", kind: "metric", format: (n) => Math.round(n).toLocaleString() },
  { key: "duration_min", title: "時長(分)", kind: "metric", format: (n) => n.toFixed(1) },
]

/** 下鑽面板：先列出這一塊的每一場，再點一場看完整戰報。 */
function SliceMatches({ slice, puuid, queueId }: { slice: Slice; puuid?: string; queueId: string | null }) {
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ platformId: string; gameId: number } | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    setPicked(null)
    const params = new URLSearchParams(sliceQuery(slice))
    params.set("limit", "200")
    if (puuid) params.set("puuid", puuid)
    if (queueId) params.set("queue", queueId)
    fetch(`/api/matches?${params}`)
      .then((r) => r.json())
      .then((d: { matches: MatchRow[] }) => setRows(d.matches))
      .catch((e: Error) => setError(e.message))
  }, [slice, puuid, queueId])

  if (picked) {
    return (
      <MatchDetail
        platformId={picked.platformId}
        gameId={picked.gameId}
        puuid={puuid}
        onBack={() => setPicked(null)}
      />
    )
  }

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!rows) return <Skeleton className="h-[260px] w-full" />
  if (!rows.length) return <EmptyState>這一塊沒有對局。</EmptyState>

  const table = rows.map((m) => {
    const deaths = m.deaths || 1
    return {
      ...m,
      when: fmtTime(m.game_creation),
      result: m.win ? "勝" : "敗",
      kda_text: `${m.kills} / ${m.deaths} / ${m.assists}`,
      kda: (m.kills + m.assists) / deaths,
      duration_min: m.game_duration / 60,
    }
  })

  return (
    <div className="space-y-2">
      <AgTable
        columns={MATCH_COLUMNS}
        rows={table as unknown as Record<string, unknown>[]}
        height={Math.min(460, 120 + rows.length * 38)}
        fileName={`matches-${sliceLabel(slice).replace(/[ :]/g, "")}`}
        onDrill={(_col, _value, row) =>
          setPicked({ platformId: String(row.platform_id), gameId: Number(row.game_id) })
        }
      />
      <p className="text-[11px] text-muted-foreground">雙擊「英雄」或「時間」那一格，看該場的完整戰報。</p>
    </div>
  )
}

export function TimeAnalysis() {
  const { apply, account, queueId } = useFilters()
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

  const byDuration = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.duration_bucket"],
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
    // 合併時要用勝場數相加，不能把勝率平均起來——那樣一場的格子會和二十場的一樣重
    const acc = new Map<string, { weekday: number; x: number; games: number; wins: number }>()
    for (const h of hourly) {
      const x = BLOCKS.findIndex((b) => h.hour >= b.from && h.hour <= b.to)
      if (x < 0) continue
      const key = `${h.weekday}:${x}`
      const prev = acc.get(key) ?? { weekday: h.weekday, x, games: 0, wins: 0 }
      prev.games += h.games
      prev.wins += (h.games * (h.winrate ?? 0)) / 100
      acc.set(key, prev)
    }
    return [...acc.values()].map((c) => ({
      weekday: c.weekday,
      x: c.x,
      games: c.games,
      winrate: c.games ? (c.wins / c.games) * 100 : null,
    }))
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
          <SliceMatches slice={slice} puuid={account?.puuid} queueId={queueId} />
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

        <Panel title="對局長度與勝率" caption="注意因果方向：贏的時候通常推得快，所以短局勝率高多半是結果、不是原因">
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
