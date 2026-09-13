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
import { num, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { MIN_GAMES, round0, round1, round2 } from "./shared"

const ALL = "__all__"

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

  // 單一英雄的樣本通常只有個位數，所以選了英雄時什麼都不藏，全部列出來、場次少的淡化。
  // 排序用場次而不是加成：依加成排的話，最上面會整排是「1 場 1 勝 → +50pp」這種雜訊。
  // 想看加成排行點欄位標題就能換。
  const tableRows = champion
    ? rows
        .map((r): CubeRow => {
          const base = baseMap.get(String(r["augments.name"]))
          const wr = num(r["participants.winrate"])
          return {
            ...r,
            baseWr: base?.wr ?? null,
            baseGames: base?.games ?? null,
            lift: wr !== null && base?.wr != null ? wr - base.wr : null,
          }
        })
        .sort(
          (a, b) =>
            (num(b["participants.games"]) ?? 0) - (num(a["participants.games"]) ?? 0) ||
            (num(b.lift) ?? -999) - (num(a.lift) ?? -999),
        )
    : rows

  // 全部英雄時圖表只放樣本夠的，否則整張圖都是 1 場 100% 的雜訊。
  // 單一英雄時幾乎沒有增幅到得了門檻，圖會永遠是空的——改成畫最常選的幾個，
  // 長條顏色本來就會依場次往平均收斂，1 場全勝不會被畫成深綠。
  const chartMin = champion ? 1 : MIN_GAMES
  const top: BarDatum[] = rows
    .filter((r) => (num(r["participants.games"]) ?? 0) >= chartMin)
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
        title={champion ? `${champion} 最常選的增幅` : "勝率排行"}
        caption={
          champion
            ? "這隻英雄上選過最多次的 14 個增幅，依勝率排列。樣本多半只有一兩場，長條顏色已依場次往平均收斂——滑過長條看場次"
            : `僅計入 ${MIN_GAMES} 場以上的增幅`
        }
      >
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart data={top} suffix="%" />
        ) : (
          <EmptyState>
            {champion ? "這個條件下這隻英雄還沒有增幅紀錄。" : `還沒有任何增幅累積到 ${MIN_GAMES} 場，再多打幾場就會出現。`}
          </EmptyState>
        )}
      </Panel>

      <Panel
        title={champion ? `${champion} 的增幅契合度` : "全部增幅"}
        caption={
          champion
            ? `這隻英雄選過的全部增幅，依場次排序（點「加成」標題可改依加成排）。加成 = 在這隻英雄上的勝率 − 在所有英雄上的勝率：有些增幅本來就強、在誰身上都好，加成才看得出「特別適合這隻英雄」。場次不到 ${MIN_GAMES} 的列會淡化，那是線索不是結論。`
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
            emptyHint={champion ? "這個條件下這隻英雄還沒有增幅紀錄。" : undefined}
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
