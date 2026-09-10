import { Skeleton } from "@/components/ui/skeleton"
import { Panel } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { useCube } from "@/hooks/useCube"
import { useFilters } from "@/lib/filters"
import { round0, round1, round2 } from "./shared"

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

  return (
    <Panel
      title="英雄表現"
      caption="點任一列可下鑽該英雄，再到其他頁就只看這隻英雄；場次低於 5 的列會淡化，樣本太小的勝率是雜訊"
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
  )
}
