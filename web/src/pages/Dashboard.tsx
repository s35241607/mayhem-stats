import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { BarChart, Heatmap, TrendChart, type BarDatum, type HeatCell, type TrendPoint } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { round0, round1, round2 } from "./shared"

const SHAKY = 5

export function Dashboard() {
  const { apply, addDrill } = useFilters()

  const totals = useCube(
    apply({
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
    }),
  )

  const daily = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      timeDimensions: [{ dimension: "matches.played_at", granularity: "day" }],
      limit: 400,
    }),
  )

  const champions = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["champions.name", "champions.icon_path"],
      order: { "participants.games": "desc" },
      limit: 40,
    }),
  )

  const augments = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["augments.name"],
      order: { "participants.games": "desc" },
      limit: 60,
    }),
  )

  const heat = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.weekday", "matches.hour_of_day"],
      limit: 400,
    }),
  )

  const row = totals.rows[0] ?? {}
  const metric = (key: string, fmt: (n: number) => string, suffix = "") => {
    const parsed = num(row[key])
    return parsed === null ? "—" : `${fmt(parsed)}${suffix}`
  }
  const winrate = num(row["participants.winrate"])
  const games = num(row["participants.games"]) ?? 0

  const points: TrendPoint[] = daily.rows
    .map((r) => ({
      date: String(r["matches.played_at.day"] ?? r["matches.played_at"] ?? "").slice(0, 10),
      games: num(r["participants.games"]) ?? 0,
      winrate: num(r["participants.winrate"]),
    }))
    .filter((p) => p.date)

  const toBars = (rows: typeof champions.rows, nameKey: string): BarDatum[] =>
    rows
      .filter((r) => (num(r["participants.games"]) ?? 0) >= SHAKY)
      .slice(0, 8)
      .map((r) => ({
        label: String(r[nameKey] ?? "—"),
        value: num(r["participants.winrate"]) ?? 0,
        games: num(r["participants.games"]) ?? 0,
      }))
      .sort((a, b) => b.value - a.value)

  const cells: HeatCell[] = heat.rows.map((r) => ({
    weekday: Number(r["matches.weekday"]),
    hour: Number(r["matches.hour_of_day"]),
    games: num(r["participants.games"]) ?? 0,
    winrate: num(r["participants.winrate"]),
  }))

  const topChampions = champions.rows.slice(0, 8)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi label="總場次" value={metric("participants.games", round0)} loading={totals.loading} />
        <Kpi
          label="勝率"
          value={metric("participants.winrate", round1, "%")}
          tone={winrate === null ? undefined : winrate >= 50 ? "win" : "loss"}
          hint={`${metric("participants.wins", round0)} 勝 ${metric("participants.losses", round0)} 敗`}
          loading={totals.loading}
        />
        <Kpi label="KDA" value={metric("participants.kda", round2)} loading={totals.loading} />
        <Kpi label="每分鐘傷害" value={metric("participants.dpm", round0)} loading={totals.loading} />
        <Kpi label="每分鐘經濟" value={metric("participants.gpm", round0)} loading={totals.loading} />
        <Kpi
          label="參團率"
          value={metric("participants.kill_participation", round1, "%")}
          loading={totals.loading}
        />
        <Kpi
          label="用過的英雄"
          value={champions.loading ? "—" : String(champions.rows.length)}
          hint={`共 ${games} 場`}
          loading={champions.loading}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="每日勝率趨勢"
          caption="橫軸依實際日期，沒打的日子留白；圓點大小代表當天場次"
        >
          {daily.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : points.length < 2 ? (
            <EmptyState>資料還不夠畫趨勢（至少要兩天）。</EmptyState>
          ) : (
            <TrendChart points={points} />
          )}
        </Panel>

        <Panel title="最常用英雄" caption="點一列可下鑽">
          {champions.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : !topChampions.length ? (
            <EmptyState>還沒有資料。</EmptyState>
          ) : (
            <div className="space-y-1">
              {topChampions.map((r) => {
                const wr = num(r["participants.winrate"]) ?? 0
                const n = num(r["participants.games"]) ?? 0
                return (
                  <button
                    key={String(r["champions.name"])}
                    onClick={() =>
                      addDrill({
                        member: "champions.name",
                        operator: "equals",
                        values: [String(r["champions.name"])],
                        label: `英雄：${r["champions.name"]}`,
                      })
                    }
                    className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-accent"
                  >
                    <img
                      src={iconUrl(r["champions.icon_path"] as string)}
                      alt=""
                      className="size-7 shrink-0 rounded-md bg-secondary"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {String(r["champions.name"])}
                    </span>
                    <span className="text-xs text-muted-foreground">{n} 場</span>
                    <Badge
                      variant="outline"
                      className={
                        n < SHAKY
                          ? "w-[62px] justify-center text-muted-foreground"
                          : wr >= 50
                            ? "w-[62px] justify-center border-win/30 bg-win/10 text-win"
                            : "w-[62px] justify-center border-loss/30 bg-loss/10 text-loss"
                      }
                    >
                      {wr.toFixed(1)}%
                    </Badge>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="英雄勝率" caption={`僅計入 ${SHAKY} 場以上`}>
          {champions.loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : toBars(champions.rows, "champions.name").length ? (
            <BarChart data={toBars(champions.rows, "champions.name")} suffix="%" />
          ) : (
            <EmptyState>還沒有英雄累積到 {SHAKY} 場。</EmptyState>
          )}
        </Panel>

        <Panel title="增幅裝置勝率" caption={`僅計入 ${SHAKY} 場以上`}>
          {augments.loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : toBars(augments.rows, "augments.name").length ? (
            <BarChart data={toBars(augments.rows, "augments.name")} suffix="%" />
          ) : (
            <EmptyState>還沒有增幅累積到 {SHAKY} 場。</EmptyState>
          )}
        </Panel>
      </div>

      <Panel
        title="星期 × 時段"
        caption="同一格是所有週日的同一時段加總，不是單一天"
      >
        {heat.loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : cells.length ? (
          <Heatmap cells={cells} />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>
    </div>
  )
}
