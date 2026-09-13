import type { CSSProperties } from "react"
import { ArrowRight } from "lucide-react"
import { CountUp } from "@/components/CountUp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { TrendChart, type TrendPoint } from "@/components/charts"
import type { PageId } from "@/components/AppShell"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num, type CubeRow } from "@/lib/cube"
import { useFilters, type Drill } from "@/lib/filters"
import { useNavigate } from "@/lib/nav"
import { BLOCKS, MIN_GAMES, NO_LIMIT, WEEKDAYS, round0, round1, round2, toBlocks } from "./shared"

/** 儀表板只放總覽。細節各有分頁，這裡的每張卡右上角都連過去——
 *  原本儀表板和分頁各畫一份一樣的熱力圖、每日趨勢、勝率長條。 */
function SeeAll({ page, label = "看全部" }: { page: PageId; label?: string }) {
  const go = useNavigate()
  return (
    <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => go(page)}>
      {label}
      <ArrowRight className="size-3.5" />
    </Button>
  )
}

/** 最常用的英雄／增幅：一列一個，點了就下鑽。 */
function TopList({
  rows,
  nameKey,
  iconKey,
  drill,
}: {
  rows: CubeRow[]
  nameKey: string
  iconKey: string
  drill: (name: string) => Drill
}) {
  const { addDrill } = useFilters()
  if (!rows.length) return <EmptyState>還沒有資料。</EmptyState>
  return (
    <div className="space-y-1">
      {rows.slice(0, 8).map((r, i) => {
        const name = String(r[nameKey] ?? "—")
        const wr = num(r["participants.winrate"]) ?? 0
        const n = num(r["participants.games"]) ?? 0
        return (
          <button
            key={name}
            onClick={() => addDrill(drill(name))}
            style={{ "--stagger": `${i * 40}ms` } as CSSProperties}
            className="slide-in flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-accent"
          >
            <img src={iconUrl(r[iconKey] as string)} alt="" className="size-7 shrink-0 rounded-md bg-icon-tile" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
            <CountUp text={`${n} 場`} className="text-xs text-muted-foreground" />
            <Badge
              variant="outline"
              className={
                n < MIN_GAMES
                  ? "w-[62px] justify-center text-muted-foreground"
                  : wr >= 50
                    ? "w-[62px] justify-center border-win/30 bg-win/10 text-win"
                    : "w-[62px] justify-center border-loss/30 bg-loss/10 text-loss"
              }
            >
              <CountUp text={`${wr.toFixed(1)}%`} />
            </Badge>
          </button>
        )
      })}
    </div>
  )
}

export function Dashboard() {
  const { apply } = useFilters()

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

  // 和時段頁同一個查詢（按採集時存好的本地日期分組），兩頁的每日數字保證一樣，快取也共用
  const daily = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.local_date"],
      limit: NO_LIMIT,
    }),
  )

  const champions = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["champions.name", "champions.icon_path"],
      order: { "participants.games": "desc" },
      limit: 200,
    }),
  )

  const augments = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["augments.name", "augments.icon_path"],
      order: { "participants.games": "desc" },
      limit: 8,
    }),
  )

  // 和時段頁的熱力圖同一個查詢，這裡只摘要成兩句話
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
      date: String(r["matches.local_date"] ?? ""),
      games: num(r["participants.games"]) ?? 0,
      winrate: num(r["participants.winrate"]),
    }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date))

  const blocks = toBlocks(
    heat.rows.map((r) => ({
      weekday: Number(r["matches.weekday"]),
      hour: Number(r["matches.hour_of_day"]),
      games: num(r["participants.games"]) ?? 0,
      winrate: num(r["participants.winrate"]),
    })),
  )
  const busiest = [...blocks].sort((a, b) => b.games - a.games)[0]
  const enough = blocks.filter((b) => b.games >= MIN_GAMES)
  const best = [...enough].sort((a, b) => (b.winrate ?? 0) - (a.winrate ?? 0))[0]
  const worst = [...enough].sort((a, b) => (a.winrate ?? 0) - (b.winrate ?? 0))[0]
  const slotName = (b: { weekday: number; block: number }) => `${WEEKDAYS[b.weekday]} ${BLOCKS[b.block].label}`

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi index={0} label="總場次" value={metric("participants.games", round0)} loading={totals.loading} />
        <Kpi index={1}
          label="勝率"
          value={metric("participants.winrate", round1, "%")}
          tone={winrate === null ? undefined : winrate >= 50 ? "win" : "loss"}
          hint={`${metric("participants.wins", round0)} 勝 ${metric("participants.losses", round0)} 敗`}
          loading={totals.loading}
        />
        <Kpi index={2} label="KDA" value={metric("participants.kda", round2)} loading={totals.loading} />
        <Kpi index={3} label="每分鐘傷害" value={metric("participants.dpm", round0)} loading={totals.loading} />
        <Kpi index={4} label="每分鐘經濟" value={metric("participants.gpm", round0)} loading={totals.loading} />
        <Kpi index={5}
          label="參團率"
          value={metric("participants.kill_participation", round1, "%")}
          loading={totals.loading}
        />
        <Kpi index={6}
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
          action={<SeeAll page="time" label="逐日下鑽" />}
        >
          {daily.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : points.length < 2 ? (
            <EmptyState>資料還不夠畫趨勢（至少要兩天）。</EmptyState>
          ) : (
            <TrendChart points={points} />
          )}
        </Panel>

        <Panel title="最常用英雄" caption="點一列可下鑽" action={<SeeAll page="champions" />}>
          {champions.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <TopList
              rows={champions.rows}
              nameKey="champions.name"
              iconKey="champions.icon_path"
              drill={(name) => ({ member: "champions.name", operator: "equals", values: [name], label: `英雄：${name}` })}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="最常選的增幅" caption="點一列可下鑽" action={<SeeAll page="augments" />}>
          {augments.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <TopList
              rows={augments.rows}
              nameKey="augments.name"
              iconKey="augments.icon_path"
              drill={(name) => ({ member: "augments.name", operator: "equals", values: [name], label: `增幅：${name}` })}
            />
          )}
        </Panel>

        <Panel
          title="什麼時候打"
          caption={`以星期 × 四時段分組；比較好壞只看 ${MIN_GAMES} 場以上的時段`}
          action={<SeeAll page="time" label="看熱力圖" />}
        >
          {heat.loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : !busiest ? (
            <EmptyState>還沒有資料。</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <Kpi label="最常打" value={slotName(busiest)} hint={`${busiest.games} 場`} />
              <Kpi
                label="表現最好"
                value={best ? slotName(best) : "—"}
                hint={best ? `勝率 ${best.winrate?.toFixed(1)}%・${best.games} 場` : `還沒有時段累積到 ${MIN_GAMES} 場`}
                tone={best ? "win" : undefined}
              />
              <Kpi
                label="表現最差"
                value={worst && worst !== best ? slotName(worst) : "—"}
                hint={worst && worst !== best ? `勝率 ${worst.winrate?.toFixed(1)}%・${worst.games} 場` : undefined}
                tone={worst && worst !== best ? "loss" : undefined}
              />
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
