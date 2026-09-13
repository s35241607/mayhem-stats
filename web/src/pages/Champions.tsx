import { Skeleton } from "@/components/ui/skeleton"
import { Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { MIN_GAMES, round0, round1, round2 } from "./shared"

const COLUMNS: GridColumn[] = [
  { key: "champions.name", title: "英雄", kind: "dimension", iconKey: "champions.icon_path" },
  { key: "participants.games", title: "場次", kind: "metric", format: round0 },
  { key: "participants.wins", title: "勝場", kind: "metric", format: round0 },
  { key: "participants.losses", title: "敗場", kind: "metric", format: round0 },
  { key: "participants.winrate", title: "勝率", kind: "metric", format: round1, suffix: "%" },
  { key: "participants.kda", title: "KDA", kind: "metric", format: round2 },
  { key: "participants.dpm", title: "每分鐘傷害", kind: "metric", format: round0 },
  { key: "participants.gpm", title: "每分鐘經濟", kind: "metric", format: round0 },
  { key: "participants.kill_participation", title: "參團率", kind: "metric", format: round1, suffix: "%" },
  { key: "participants.damage_share", title: "傷害佔比", kind: "metric", format: round1, suffix: "%" },
]

export function Champions() {
  const { apply, addDrill } = useFilters()
  const { rows, loading, error } = useCube(
    apply({
      measures: COLUMNS.filter((c) => c.kind === "metric").map((c) => c.key),
      dimensions: ["champions.name", "champions.icon_path"],
      order: { "participants.games": "desc" },
      limit: 200,
    }),
  )

  // 和增幅頁同一個結構：上面是樣本夠的勝率排行，下面是完整表格
  const top: BarDatum[] = rows
    .filter((r) => (num(r["participants.games"]) ?? 0) >= MIN_GAMES)
    .slice(0, 14)
    .map((r) => ({
      label: String(r["champions.name"] ?? "—"),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-4">
      <Panel title="勝率排行" caption={`僅計入 ${MIN_GAMES} 場以上的英雄`}>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart data={top} suffix="%" />
        ) : (
          <EmptyState>還沒有英雄累積到 {MIN_GAMES} 場。</EmptyState>
        )}
      </Panel>

      <Panel
        title="英雄表現"
        caption={`雙擊英雄可下鑽，再到其他頁就只看這隻英雄；場次不到 ${MIN_GAMES} 的列會淡化，樣本太小的勝率是雜訊`}
      >
        {loading ? (
          <Skeleton className="h-[520px] w-full" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <AgTable
            columns={COLUMNS}
            rows={rows}
            height={560}
            sampleKey="participants.games"
            fileName="champions"
            onDrill={(_col, value) =>
              addDrill({
                member: "champions.name",
                operator: "equals",
                values: [value],
                label: `英雄：${value}`,
              })
            }
          />
        )}
      </Panel>
    </div>
  )
}
