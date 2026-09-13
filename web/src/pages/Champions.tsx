import { useState } from "react"
import { Filter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { MatchList } from "@/components/MatchList"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"
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

/** 點了某隻英雄之後：摘要 + 這隻英雄的每一場（和對局紀錄頁同樣的卡片）。 */
function ChampionPanel({ row, onClose }: { row: CubeRow; onClose: () => void }) {
  const { matchParams, account, addDrill, drills } = useFilters()
  const name = String(row["champions.name"])
  const metric = (key: string, fmt: (n: number) => string, suffix = "") => {
    const n = num(row[key])
    return n === null ? "—" : `${fmt(n)}${suffix}`
  }
  const winrate = num(row["participants.winrate"])
  const drilled = drills.some((d) => d.member === "champions.name" && d.values[0] === name)
  // 逐場列表查的是 SQLite，只認得帳號、模式、期間；增幅之類的下鑽條件套不上去
  const otherDrills = drills.filter((d) => d.member !== "champions.name")

  return (
    <Panel
      title={`${name} 的每一場`}
      action={
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={drilled}
            onClick={() =>
              addDrill({ member: "champions.name", operator: "equals", values: [name], label: `英雄：${name}` })
            }
          >
            <Filter className="size-3.5" />
            {drilled ? "其他頁已只看這隻" : "其他頁也只看這隻"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
            收起
          </Button>
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            label="勝率"
            value={metric("participants.winrate", round1, "%")}
            hint={`${metric("participants.wins", round0)} 勝 ${metric("participants.losses", round0)} 敗`}
            tone={winrate === null ? undefined : winrate >= 50 ? "win" : "loss"}
          />
          <Kpi label="KDA" value={metric("participants.kda", round2)} />
          <Kpi label="每分鐘傷害" value={metric("participants.dpm", round0)} />
          <Kpi label="每分鐘經濟" value={metric("participants.gpm", round0)} />
          <Kpi label="傷害佔比" value={metric("participants.damage_share", round1, "%")} />
        </div>
        {otherDrills.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            注意：上方的「{otherDrills.map((d) => d.label).join("、")}」篩選只套用在統計數字，下面的逐場列表不受影響。
          </p>
        )}
        <MatchList params={{ ...matchParams(), champion: name }} puuid={account?.puuid} />
      </div>
    </Panel>
  )
}

export function Champions() {
  const { apply } = useFilters()
  const [picked, setPicked] = useState<string | null>(null)
  const { rows, loading, error } = useCube(
    apply({
      measures: COLUMNS.filter((c) => c.kind === "metric").map((c) => c.key),
      dimensions: ["champions.name", "champions.icon_path"],
      order: { "participants.games": "desc" },
      limit: 200,
    }),
  )
  const pickedRow = picked ? rows.find((r) => r["champions.name"] === picked) : undefined

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

  const table = (
    <Panel
      title="英雄表現"
      caption={`點英雄看這隻英雄的每一場；場次不到 ${MIN_GAMES} 的列會淡化，樣本太小的勝率是雜訊`}
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
          drillOn="click"
          onDrill={(_col, value) => {
            setPicked(value)
            window.scrollTo({ top: 0, behavior: "smooth" })
          }}
        />
      )}
    </Panel>
  )

  return (
    <div className="space-y-4">
      {pickedRow && <ChampionPanel key={picked} row={pickedRow} onClose={() => setPicked(null)} />}

      <Panel title="勝率排行" caption={`僅計入 ${MIN_GAMES} 場以上的英雄，點長條也能看那隻英雄的每一場`}>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart
            data={top}
            suffix="%"
            onPick={(label) => {
              setPicked(label)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }}
          />
        ) : (
          <EmptyState>還沒有英雄累積到 {MIN_GAMES} 場。</EmptyState>
        )}
      </Panel>

      {table}
    </div>
  )
}
