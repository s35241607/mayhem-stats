import { useState } from "react"
import { Table2, BarChart3, LineChart, Grid3x3, Code2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel, EmptyState } from "@/components/primitives"
import { DataTable, type Column } from "@/components/DataTable"
import { BarChart, Heatmap, TrendChart, type HeatCell } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"
import { round0, round1, round2 } from "./shared"

/** 可選項目直接對應 Cube 模型的成員名稱；前端不自己拼 SQL。 */
const DIMENSIONS = [
  { key: "champions.name", title: "英雄", icon: "champions.icon_path" },
  { key: "augments.name", title: "增幅裝置", icon: "augments.icon_path", rarity: "augments.rarity" },
  { key: "augments.rarity", title: "增幅稀有度" },
  { key: "items.name", title: "裝備", icon: "items.icon_path" },
  { key: "matches.patch", title: "遊戲版本" },
  { key: "matches.weekday", title: "星期" },
  { key: "matches.hour_of_day", title: "時段" },
  { key: "matches.duration_bucket", title: "對局長度" },
  { key: "matches.game_mode", title: "遊戲模式" },
  { key: "participants.result", title: "勝負" },
  { key: "participants.team_side", title: "隊伍" },
  { key: "teammates.player", title: "同場玩家" },
  { key: "teammates.relation", title: "隊友或對手" },
]

const METRICS = [
  { key: "participants.games", title: "場次", format: round0 },
  { key: "participants.wins", title: "勝場", format: round0 },
  { key: "participants.losses", title: "敗場", format: round0 },
  { key: "participants.winrate", title: "勝率", format: round1, suffix: "%" },
  { key: "participants.kda", title: "KDA", format: round2 },
  { key: "participants.avg_kills", title: "平均擊殺", format: round1 },
  { key: "participants.avg_deaths", title: "平均死亡", format: round1 },
  { key: "participants.avg_assists", title: "平均助攻", format: round1 },
  { key: "participants.dpm", title: "每分鐘傷害", format: round0 },
  { key: "participants.gpm", title: "每分鐘經濟", format: round0 },
  { key: "participants.damage_share", title: "傷害佔比", format: round1, suffix: "%" },
  { key: "participants.kill_participation", title: "參團率", format: round1, suffix: "%" },
  { key: "participants.avg_damage", title: "平均傷害", format: round0 },
  { key: "participants.avg_taken", title: "平均承受", format: round0 },
  { key: "participants.avg_gold", title: "平均經濟", format: round0 },
  { key: "participants.avg_cs", title: "平均補兵", format: round1 },
  { key: "participants.multikills", title: "多殺次數", format: round0 },
  { key: "participants.pentas", title: "五殺次數", format: round0 },
  { key: "teammates.games", title: "同場次數", format: round0 },
  { key: "teammates.winrate", title: "同場勝率", format: round1, suffix: "%" },
]

const VIZ = [
  { value: "table", label: "表格", icon: Table2 },
  { value: "bar", label: "長條", icon: BarChart3 },
  { value: "line", label: "折線", icon: LineChart },
  { value: "heatmap", label: "熱力圖", icon: Grid3x3 },
] as const

type Viz = (typeof VIZ)[number]["value"]

function PickerList<T extends { key: string; title: string }>({
  items,
  selected,
  onToggle,
}: {
  items: T[]
  selected: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = selected.includes(item.key)
        return (
          <button
            key={item.key}
            onClick={() => onToggle(item.key)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition",
              on
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {item.title}
          </button>
        )
      })}
    </div>
  )
}

export function Explore() {
  const { apply } = useFilters()
  const [dims, setDims] = useState<string[]>(["champions.name"])
  const [metrics, setMetrics] = useState<string[]>([
    "participants.games",
    "participants.winrate",
  ])
  const [viz, setViz] = useState<Viz>("table")
  const [byDay, setByDay] = useState(false)
  const [limit, setLimit] = useState("100")
  const [showQuery, setShowQuery] = useState(false)

  const toggle = (list: string[], set: (v: string[]) => void) => (key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

  const activeMetrics = metrics.length ? metrics : ["participants.games"]

  // 帶圖示或稀有度的維度要一併取回對應欄位，表格才顯示得出來
  const extraDims = dims.flatMap((key) => {
    const dim = DIMENSIONS.find((d) => d.key === key)
    return [dim?.icon, dim?.rarity].filter(Boolean) as string[]
  })

  const query = apply({
    measures: activeMetrics,
    dimensions: [...dims, ...extraDims],
    ...(byDay
      ? { timeDimensions: [{ dimension: "matches.played_at", granularity: "day" }] }
      : {}),
    order: { [activeMetrics[0]]: "desc" },
    limit: Number(limit),
  })

  const { rows, loading, error } = useCube(query)

  const columns: Column[] = [
    ...(byDay
      ? [{ key: "matches.played_at.day", title: "日期", kind: "dimension" as const }]
      : []),
    ...dims.map((key) => {
      const dim = DIMENSIONS.find((d) => d.key === key)!
      return {
        key,
        title: dim.title,
        kind: "dimension" as const,
        iconKey: dim.icon,
        rarityKey: dim.rarity,
      }
    }),
    ...activeMetrics.map((key) => {
      const m = METRICS.find((x) => x.key === key)!
      return { key, title: m.title, kind: "metric" as const, format: m.format, suffix: m.suffix }
    }),
  ]

  const firstMetric = METRICS.find((m) => m.key === activeMetrics[0])!

  function renderViz() {
    if (loading) return <Skeleton className="h-[320px] w-full" />
    if (error) return <div className="text-sm text-destructive">{error}</div>
    if (!rows.length) return <EmptyState>這個條件下沒有資料。</EmptyState>

    if (viz === "bar") {
      if (dims.length !== 1) {
        return <EmptyState>長條圖需要剛好一個分組維度（目前 {dims.length} 個）。</EmptyState>
      }
      return (
        <BarChart
          data={rows.slice(0, 20).map((r) => ({
            label: String(r[dims[0]] ?? "—"),
            value: num(r[activeMetrics[0]]) ?? 0,
            games: num(r["participants.games"]) ?? num(r["teammates.games"]) ?? 0,
          }))}
          suffix={firstMetric.suffix ?? ""}
          colorBy={activeMetrics[0].endsWith("winrate") ? "value" : "flat"}
        />
      )
    }

    if (viz === "line") {
      if (!byDay) {
        return <EmptyState>折線圖需要開啟「按日期分組」。</EmptyState>
      }
      return (
        <TrendChart
          points={rows.map((r) => ({
            date: String(r["matches.played_at.day"] ?? "").slice(0, 10),
            games: num(r["participants.games"]) ?? 0,
            winrate: num(r[activeMetrics[0]]),
          }))}
        />
      )
    }

    if (viz === "heatmap") {
      const ok = dims.includes("matches.weekday") && dims.includes("matches.hour_of_day")
      if (!ok) {
        return <EmptyState>熱力圖需要同時選「星期」和「時段」兩個維度。</EmptyState>
      }
      const cells: HeatCell[] = rows.map((r) => ({
        weekday: Number(r["matches.weekday"]),
        hour: Number(r["matches.hour_of_day"]),
        games: num(r["participants.games"]) ?? 0,
        winrate: num(r[activeMetrics[0]]),
      }))
      return <Heatmap cells={cells} />
    }

    return <DataTable columns={columns} rows={rows} />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="分組維度" caption="選越多切得越細">
          <PickerList items={DIMENSIONS} selected={dims} onToggle={toggle(dims, setDims)} />
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={byDay}
              onChange={(e) => setByDay(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            另外按日期分組（折線圖需要）
          </label>
        </Panel>

        <Panel title="指標" caption="第一個指標會用來排序與畫圖">
          <ScrollArea className="max-h-[280px]">
            <PickerList items={METRICS} selected={metrics} onToggle={toggle(metrics, setMetrics)} />
          </ScrollArea>
        </Panel>

        <Panel title="筆數上限">
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["20", "50", "100", "500", "2000"].map((n) => (
                <SelectItem key={n} value={n}>
                  {n} 筆
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <Panel
          title="結果"
          caption={loading ? "查詢中…" : `${rows.length} 列`}
          action={
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={viz}
                onValueChange={(v) => v && setViz(v as Viz)}
              >
                {VIZ.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} aria-label={item.label}>
                    <item.icon className="size-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowQuery((v) => !v)}
                title="看送給 Cube 的查詢"
              >
                <Code2 className="size-3.5" />
              </Button>
            </div>
          }
        >
          {!dims.length && !byDay ? (
            <EmptyState>至少選一個分組維度，或開啟「按日期分組」。</EmptyState>
          ) : (
            renderViz()
          )}
        </Panel>

        {showQuery && (
          <Panel
            title="送給 Cube 的查詢"
            caption="前端只送維度與指標名稱，SQL 由 Cube 依模型產生"
          >
            <pre className="overflow-x-auto rounded-md bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(query, null, 2)}
            </pre>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeMetrics.map((m) => (
                <Badge key={m} variant="secondary" className="font-mono text-[10px]">
                  {m}
                </Badge>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
