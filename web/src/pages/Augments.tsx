import { Skeleton } from "@/components/ui/skeleton"
import { Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { round0, round1, round2 } from "./shared"

const SHAKY_SAMPLE = 5

const COLUMNS: GridColumn[] = [
  {
    key: "augments.name",
    title: "增幅裝置",
    kind: "dimension",
    iconKey: "augments.icon_path",
    rarityKey: "augments.rarity",
  },
  { key: "participants.games", title: "場次", kind: "metric", format: round0 },
  { key: "participants.wins", title: "勝場", kind: "metric", format: round0 },
  { key: "participants.winrate", title: "勝率", kind: "metric", format: round1, suffix: "%" },
  { key: "participants.kda", title: "KDA", kind: "metric", format: round2 },
  { key: "participants.dpm", title: "每分鐘傷害", kind: "metric", format: round0 },
]

export function Augments() {
  const { apply, addDrill } = useFilters()
  const { rows, loading, error } = useCube(
    apply({
      measures: [
        "participants.games",
        "participants.wins",
        "participants.winrate",
        "participants.kda",
        "participants.dpm",
      ],
      dimensions: ["augments.name", "augments.rarity", "augments.icon_path"],
      order: { "participants.games": "desc" },
      limit: 300,
    }),
  )

  // 圖表只放樣本夠的，否則整張圖都是 1 場 100% 的雜訊
  const top: BarDatum[] = rows
    .filter((r) => (num(r["participants.games"]) ?? 0) >= SHAKY_SAMPLE)
    .slice(0, 14)
    .map((r) => ({
      label: String(r["augments.name"] ?? "—"),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-4">
      <Panel title="勝率排行" caption={`僅計入 ${SHAKY_SAMPLE} 場以上的增幅`}>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart data={top} suffix="%" />
        ) : (
          <EmptyState>還沒有任何增幅累積到 {SHAKY_SAMPLE} 場，再多打幾場就會出現。</EmptyState>
        )}
      </Panel>

      <Panel
        title="全部增幅"
        caption="這份資料只有你自己拿得到——Riot 對 Mayhem 封鎖了公開 API，任何第三方網站都算不出增幅勝率"
      >
        {loading ? (
          <Skeleton className="h-[480px] w-full" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <AgTable
            columns={COLUMNS}
            rows={rows}
            height={520}
            fileName="augments"
            onDrill={(_col, value) =>
              addDrill({
                member: "augments.name",
                operator: "equals",
                values: [value],
                label: `增幅：${value}`,
              })
            }
          />
        )}
      </Panel>
    </div>
  )
}
