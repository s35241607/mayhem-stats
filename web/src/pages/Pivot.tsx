import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type Column } from "@/components/DataTable"
import { useCube } from "@/hooks/useCube"
import { cn } from "@/lib/utils"
import { allFilters, round0, round1, round2, type PageProps } from "./shared"

/** 可選的維度與指標。名稱直接對應 Cube 模型的成員，前端不自己拼 SQL。 */
const DIMENSIONS = [
  { key: "champions.name", title: "英雄", icon: "champions.icon_path" },
  { key: "augments.name", title: "增幅裝置", icon: "augments.icon_path", rarity: "augments.rarity" },
  { key: "augments.rarity", title: "增幅稀有度" },
  { key: "items.name", title: "裝備", icon: "items.icon_path" },
  { key: "matches.patch", title: "版本" },
  { key: "matches.weekday", title: "星期" },
  { key: "matches.hour_of_day", title: "時段" },
  { key: "matches.duration_bucket", title: "對局長度" },
  { key: "participants.result", title: "勝負" },
  { key: "participants.team_side", title: "隊伍" },
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
  { key: "participants.avg_cs", title: "平均補兵", format: round1 },
  { key: "participants.avg_vision", title: "平均視野", format: round1 },
]

function Chips<T extends { key: string; title: string }>({
  items,
  selected,
  onToggle,
}: {
  items: T[]
  selected: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const on = selected.includes(item.key)
        return (
          <Badge
            key={item.key}
            variant={on ? "default" : "outline"}
            onClick={() => onToggle(item.key)}
            className={cn(
              "cursor-pointer select-none px-2.5 py-1 text-xs font-medium transition",
              !on && "hover:bg-secondary",
            )}
          >
            {item.title}
          </Badge>
        )
      })}
    </div>
  )
}

export function Pivot({ filters }: PageProps) {
  const [dims, setDims] = useState<string[]>(["champions.name"])
  const [metrics, setMetrics] = useState<string[]>([
    "participants.games",
    "participants.winrate",
    "participants.kda",
  ])

  const toggle = (list: string[], set: (v: string[]) => void) => (key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

  const activeMetrics = metrics.length ? metrics : ["participants.games"]

  // 有圖示或稀有度的維度，要把對應欄位一起取回來才能在表格顯示
  const extraDims = dims.flatMap((key) => {
    const dim = DIMENSIONS.find((d) => d.key === key)
    return [dim?.icon, dim?.rarity].filter(Boolean) as string[]
  })

  const { rows, loading, error } = useCube({
    measures: activeMetrics,
    dimensions: [...dims, ...extraDims],
    filters: allFilters(filters),
    order: { [activeMetrics[0]]: "desc" },
    limit: 500,
  })

  const columns: Column[] = [
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
      const metric = METRICS.find((m) => m.key === key)!
      return {
        key,
        title: metric.title,
        kind: "metric" as const,
        format: metric.format,
        suffix: metric.suffix,
      }
    }),
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            分組維度（可複選，多選會做交叉分析）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Chips items={DIMENSIONS} selected={dims} onToggle={toggle(dims, setDims)} />
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">指標（可複選）</div>
            <Chips items={METRICS} selected={metrics} onToggle={toggle(metrics, setMetrics)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            error={error}
            emptyHint={dims.length ? "這個條件下還沒有資料。" : "至少選一個分組維度。"}
          />
          <p className="text-xs text-muted-foreground">
            這裡送出的是維度與指標的名稱，SQL 由 Cube 依模型產生——
            所以「勝率」在每一頁的定義都保證一致。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
