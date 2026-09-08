import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Heatmap, type HeatCell } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { allFilters, type PageProps } from "./shared"

export function TimeAnalysis({ filters }: PageProps) {
  const { rows, loading, error } = useCube({
    measures: ["participants.games", "participants.winrate"],
    dimensions: ["matches.weekday", "matches.hour_of_day"],
    filters: allFilters(filters),
    limit: 400,
  })

  const cells: HeatCell[] = rows.map((r) => ({
    weekday: Number(r["matches.weekday"]),
    hour: Number(r["matches.hour_of_day"]),
    games: num(r["participants.games"]) ?? 0,
    winrate: num(r["participants.winrate"]),
  }))

  const totalGames = cells.reduce((sum, c) => sum + c.games, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          星期 × 時段的勝率
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !cells.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            這個條件下還沒有資料。
          </div>
        ) : (
          <Heatmap cells={cells} />
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          格子裡的數字是場次，顏色代表勝率高低。
          <b className="text-foreground">
            　注意：同一格是「所有週日的 15 點」加總
          </b>
          ，不是單一天——共 {totalGames} 場攤在這 168 格裡，單格場次少的時候勝率別當真。
        </p>
      </CardContent>
    </Card>
  )
}
