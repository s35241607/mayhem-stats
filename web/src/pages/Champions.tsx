import { Card, CardContent } from "@/components/ui/card"
import { DataTable, type Column } from "@/components/DataTable"
import { useCube } from "@/hooks/useCube"
import { allFilters, round0, round1, round2, type PageProps } from "./shared"

const COLUMNS: Column[] = [
  { key: "champions.name", title: "英雄", kind: "dimension", iconKey: "champions.icon_path" },
  { key: "participants.games", title: "場次", kind: "metric", format: round0 },
  { key: "participants.wins", title: "勝場", kind: "metric", format: round0 },
  { key: "participants.losses", title: "敗場", kind: "metric", format: round0 },
  { key: "participants.winrate", title: "勝率", kind: "metric", format: round1, suffix: "%" },
  { key: "participants.kda", title: "KDA", kind: "metric", format: round2 },
  { key: "participants.dpm", title: "每分鐘傷害", kind: "metric", format: round0 },
  { key: "participants.gpm", title: "每分鐘經濟", kind: "metric", format: round0 },
  {
    key: "participants.kill_participation",
    title: "參團率",
    kind: "metric",
    format: round1,
    suffix: "%",
  },
  {
    key: "participants.damage_share",
    title: "傷害佔比",
    kind: "metric",
    format: round1,
    suffix: "%",
  },
]

export function Champions({ filters }: PageProps) {
  const { rows, loading, error } = useCube({
    measures: COLUMNS.filter((c) => c.kind === "metric").map((c) => c.key),
    dimensions: ["champions.name", "champions.icon_path"],
    filters: allFilters(filters),
    order: { "participants.games": "desc" },
    limit: 200,
  })

  return (
    <Card>
      <CardContent className="space-y-3">
        <DataTable
          columns={COLUMNS}
          rows={rows}
          loading={loading}
          error={error}
          onRowClick={(row) =>
            filters.addDrill({
              member: "champions.name",
              operator: "equals",
              values: [String(row["champions.name"])],
              label: `英雄：${row["champions.name"]}`,
            })
          }
        />
        <p className="text-xs text-muted-foreground">
          點任一列可下鑽該英雄，再切到「增幅裝置」分頁就只看這隻英雄的增幅表現。
          場次低於 5 的列會淡化顯示——樣本太小的勝率是雜訊。
        </p>
      </CardContent>
    </Card>
  )
}
