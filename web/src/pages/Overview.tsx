import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendChart, type TrendPoint } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { allFilters, round0, round1, round2, type PageProps } from "./shared"

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

export function Overview({ filters }: PageProps) {
  const cubeFilters = allFilters(filters)

  const totals = useCube({
    measures: [
      "participants.games",
      "participants.wins",
      "participants.losses",
      "participants.winrate",
      "participants.kda",
      "participants.dpm",
      "participants.gpm",
      "participants.kill_participation",
    ],
    filters: cubeFilters,
  })

  const daily = useCube({
    measures: ["participants.games", "participants.winrate"],
    timeDimensions: [{ dimension: "matches.played_at", granularity: "day" }],
    filters: cubeFilters,
    limit: 400,
  })

  const row = totals.rows[0] ?? {}
  const value = (key: string, fmt: (n: number) => string, suffix = "") => {
    const parsed = num(row[key])
    return parsed === null ? "—" : `${fmt(parsed)}${suffix}`
  }

  const points: TrendPoint[] = daily.rows
    .map((r) => ({
      date: String(r["matches.played_at.day"] ?? r["matches.played_at"] ?? "").slice(0, 10),
      games: num(r["participants.games"]) ?? 0,
      winrate: num(r["participants.winrate"]),
    }))
    .filter((p) => p.date)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          {totals.loading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-[70px]" />
              ))}
            </div>
          ) : totals.error ? (
            <div className="text-sm text-destructive">{totals.error}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              <Tile label="總場次" value={value("participants.games", round0)} />
              <Tile
                label="勝 / 敗"
                value={`${value("participants.wins", round0)} / ${value("participants.losses", round0)}`}
              />
              <Tile label="勝率" value={value("participants.winrate", round1, "%")} />
              <Tile label="KDA" value={value("participants.kda", round2)} />
              <Tile label="每分鐘傷害" value={value("participants.dpm", round0)} />
              <Tile label="每分鐘經濟" value={value("participants.gpm", round0)} />
              <Tile label="參團率" value={value("participants.kill_participation", round1, "%")} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            每日勝率趨勢
          </CardTitle>
        </CardHeader>
        <CardContent>
          {daily.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : points.length < 2 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              資料還不夠畫趨勢（至少要兩天）。
            </div>
          ) : (
            <TrendChart points={points} />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            虛線 = 50% 勝率基準線 · 橫軸依實際日期，沒打的日子會留白 ·
            圓點大小代表當天場次，點小的那天樣本少、勝率別當真。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
