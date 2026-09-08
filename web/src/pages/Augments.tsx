import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable, SHAKY_SAMPLE, type Column } from "@/components/DataTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { allFilters, round0, round1, round2, type PageProps } from "./shared"

const COLUMNS: Column[] = [
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

export function Augments({ filters }: PageProps) {
  const { rows, loading, error } = useCube({
    measures: [
      "participants.games",
      "participants.wins",
      "participants.winrate",
      "participants.kda",
      "participants.dpm",
    ],
    dimensions: ["augments.name", "augments.rarity", "augments.icon_path"],
    filters: allFilters(filters),
    order: { "participants.games": "desc" },
    limit: 300,
  })

  // 只拿樣本夠的前幾名進圖表，否則圖上全是 1 場 100% 的雜訊
  const top: BarDatum[] = rows
    .filter((r) => (num(r["participants.games"]) ?? 0) >= SHAKY_SAMPLE)
    .slice(0, 12)
    .map((r) => ({
      label: String(r["augments.name"] ?? "—"),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            勝率排行（僅計入 {SHAKY_SAMPLE} 場以上的增幅）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : top.length ? (
            <BarChart data={top} suffix="%" />
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              還沒有任何增幅累積到 {SHAKY_SAMPLE} 場，再多打幾場就會出現。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <DataTable
            columns={COLUMNS}
            rows={rows}
            loading={loading}
            error={error}
            onRowClick={(row) =>
              filters.addDrill({
                member: "augments.name",
                operator: "equals",
                values: [String(row["augments.name"])],
                label: `增幅：${row["augments.name"]}`,
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            這份資料只有你自己拿得到——Riot 對 Mayhem 封鎖了公開 API，任何第三方網站都算不出增幅勝率。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
