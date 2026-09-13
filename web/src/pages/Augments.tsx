import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { MIN_GAMES, round0, round1, round2 } from "./shared"

const ALL = "__all__"
/** 選了英雄時，在這隻英雄上只出現 1 次的增幅不列：加成排序最上面會整排是
 *  「1 場 1 勝 → +50pp」這種雜訊（沿用原本契合度頁的規則）。 */
const MIN_ON_CHAMPION = 2

const BASE_COLUMNS: GridColumn[] = [
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

// 選了英雄之後多出來的三欄，原本是獨立的「增幅契合度」頁
const SYNERGY_COLUMNS: GridColumn[] = [
  { key: "baseWr", title: "所有英雄勝率", kind: "metric", format: round1, suffix: "%" },
  { key: "baseGames", title: "所有英雄場次", kind: "metric", format: round0 },
  {
    key: "lift",
    title: "加成",
    kind: "metric",
    format: (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`,
    suffix: "pp",
    tone: (n) => (Math.abs(n) < 1 ? null : n > 0 ? "good" : "bad"),
  },
]

export function Augments() {
  const { apply, addDrill, drills } = useFilters()
  const [picked, setPicked] = useState<string>(ALL)

  // 已經從別頁下鑽到某隻英雄的話，就以那隻為準，選單鎖住，免得兩個條件打架
  const drilled = drills.find((d) => d.member === "champions.name")?.values[0] ?? null
  const champion = drilled ?? (picked === ALL ? null : picked)

  const champions = useCube(
    apply({
      measures: ["participants.games"],
      dimensions: ["champions.name"],
      order: { "participants.games": "desc" },
      limit: 200,
    }),
  )

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
      filters:
        champion && !drilled
          ? [{ member: "champions.name", operator: "equals", values: [champion] }]
          : [],
      order: { "participants.games": "desc" },
      limit: 300,
    }),
  )

  // 基準線：同一個增幅在「所有英雄」上的勝率。套用其他全域條件，但拿掉英雄這一個。
  const baselineQuery = apply({
    measures: ["participants.games", "participants.winrate"],
    dimensions: ["augments.name"],
    limit: 500,
  })
  const baseline = useCube(
    champion
      ? { ...baselineQuery, filters: (baselineQuery.filters ?? []).filter((f) => f.member !== "champions.name") }
      : null,
  )

  const baseMap = new Map(
    baseline.rows.map((r) => [
      String(r["augments.name"]),
      { wr: num(r["participants.winrate"]), games: num(r["participants.games"]) ?? 0 },
    ]),
  )

  const tableRows = champion
    ? rows
        .filter((r) => (num(r["participants.games"]) ?? 0) >= MIN_ON_CHAMPION)
        .map((r) => {
          const base = baseMap.get(String(r["augments.name"]))
          const wr = num(r["participants.winrate"])
          return {
            ...r,
            baseWr: base?.wr ?? null,
            baseGames: base?.games ?? null,
            lift: wr !== null && base?.wr != null ? wr - base.wr : null,
          }
        })
        .sort((a, b) => (b.lift ?? -999) - (a.lift ?? -999))
    : rows

  // 圖表只放樣本夠的，否則整張圖都是 1 場 100% 的雜訊
  const top: BarDatum[] = rows
    .filter((r) => (num(r["participants.games"]) ?? 0) >= MIN_GAMES)
    .slice(0, 14)
    .map((r) => ({
      label: String(r["augments.name"] ?? "—"),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-4">
      <Panel
        title="看某隻英雄上的表現"
        caption="選一隻英雄，表格會多出「所有英雄勝率」與「加成」：同一個增幅在這隻英雄上比它的平均好多少，就是契合度"
      >
        {champions.loading ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Select value={drilled ?? picked} onValueChange={setPicked} disabled={!!drilled}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部英雄</SelectItem>
                {champions.rows.map((r) => (
                  <SelectItem key={String(r["champions.name"])} value={String(r["champions.name"])}>
                    {String(r["champions.name"])}（{num(r["participants.games"])} 場）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {drilled && (
              <span className="text-xs text-muted-foreground">
                已從其他頁下鑽到「{drilled}」，要換英雄請先移除上方的篩選標籤。
              </span>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title={champion ? `${champion} 的增幅勝率排行` : "勝率排行"}
        caption={`僅計入 ${MIN_GAMES} 場以上的增幅`}
      >
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart data={top} suffix="%" />
        ) : (
          <EmptyState>
            還沒有任何增幅累積到 {MIN_GAMES} 場
            {champion ? "——單一英雄的樣本通常很少，下面的表格仍然列得出來。" : "，再多打幾場就會出現。"}
          </EmptyState>
        )}
      </Panel>

      <Panel
        title={champion ? `${champion} 的增幅契合度` : "全部增幅"}
        caption={
          champion
            ? `依加成排序，只列出在這隻英雄上出現 ${MIN_ON_CHAMPION} 次以上的增幅。用加成而不是絕對勝率，是因為有些增幅本來就強、在誰身上都好——加成才看得出「特別適合這隻英雄」。場次不到 ${MIN_GAMES} 的列會淡化，那是線索不是結論。`
            : `這份資料只有你自己拿得到——Riot 對 Mayhem 封鎖了公開 API，任何第三方網站都算不出增幅勝率。場次不到 ${MIN_GAMES} 的列會淡化。`
        }
      >
        {loading || (champion && baseline.loading) ? (
          <Skeleton className="h-[480px] w-full" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <AgTable
            columns={champion ? [...BASE_COLUMNS, ...SYNERGY_COLUMNS] : BASE_COLUMNS}
            rows={tableRows}
            emptyHint={`這隻英雄還沒有任何增幅出現 ${MIN_ON_CHAMPION} 次以上。`}
            height={520}
            sampleKey="participants.games"
            fileName={champion ? `augments-${champion}` : "augments"}
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
