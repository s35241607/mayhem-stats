import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { Panel, EmptyState } from "@/components/primitives"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"

const MIN_ON_CHAMPION = 2

const SYNERGY_COLUMNS: GridColumn[] = [
  { key: "name", title: "增幅裝置", kind: "dimension", iconKey: "icon", rarityKey: "rarity" },
  { key: "games", title: "這隻英雄場次", kind: "metric", format: (n) => String(Math.round(n)) },
  { key: "wins", title: "勝場", kind: "metric", format: (n) => String(Math.round(n)) },
  { key: "wr", title: "該英雄勝率", kind: "metric", format: (n) => n.toFixed(1), suffix: "%" },
  { key: "baseWr", title: "整體勝率", kind: "metric", format: (n) => n.toFixed(1), suffix: "%" },
  { key: "baseGames", title: "整體樣本", kind: "metric", format: (n) => String(Math.round(n)) },
  { key: "lift", title: "加成", kind: "metric", format: (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}` },
]

export function Synergy() {
  const { apply } = useFilters()
  const [champion, setChampion] = useState<string>("")

  const champions = useCube(
    apply({
      measures: ["participants.games"],
      dimensions: ["champions.name"],
      order: { "participants.games": "desc" },
      limit: 100,
    }),
  )

  // 基準線：每個增幅在所有英雄上的整體勝率
  const baseline = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["augments.name"],
      limit: 500,
    }),
  )

  // 選定英雄上的增幅表現
  const onChampion = useCube(
    champion
      ? apply({
          measures: ["participants.games", "participants.wins", "participants.winrate"],
          dimensions: ["augments.name", "augments.rarity", "augments.icon_path"],
          filters: [
            { member: "champions.name", operator: "equals", values: [champion] },
          ],
          limit: 500,
        })
      : null,
  )

  const baseMap = new Map(
    baseline.rows.map((r) => [
      String(r["augments.name"]),
      { wr: num(r["participants.winrate"]) ?? 0, games: num(r["participants.games"]) ?? 0 },
    ]),
  )

  const rows = onChampion.rows
    .map((r) => {
      const name = String(r["augments.name"] ?? "—")
      const games = num(r["participants.games"]) ?? 0
      const wr = num(r["participants.winrate"]) ?? 0
      const base = baseMap.get(name)
      return {
        name,
        rarity: r["augments.rarity"] as string | null,
        icon: r["augments.icon_path"] as string | null,
        games,
        wins: num(r["participants.wins"]) ?? 0,
        wr,
        baseWr: base?.wr ?? null,
        baseGames: base?.games ?? 0,
        lift: base ? wr - base.wr : null,
      }
    })
    .filter((r) => r.games >= MIN_ON_CHAMPION)
    .sort((a, b) => (b.lift ?? -999) - (a.lift ?? -999))

  return (
    <div className="space-y-4">
      <Panel
        title="選一隻英雄"
        caption="比較「某增幅在這隻英雄上的勝率」與「該增幅的整體勝率」，差值就是契合度加成"
      >
        {champions.loading ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <Select value={champion} onValueChange={setChampion}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="選擇英雄…" />
            </SelectTrigger>
            <SelectContent>
              {champions.rows.map((r) => (
                <SelectItem key={String(r["champions.name"])} value={String(r["champions.name"])}>
                  {String(r["champions.name"])}（{num(r["participants.games"])} 場）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Panel>

      <Panel
        title={champion ? `${champion} 的增幅契合度` : "增幅契合度"}
        caption={`只列出在這隻英雄上出現 ${MIN_ON_CHAMPION} 次以上的增幅。加成為正代表這個增幅在這隻英雄身上表現優於它的平均水準。`}
      >
        {!champion ? (
          <EmptyState>先選一隻英雄。</EmptyState>
        ) : onChampion.loading || baseline.loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : !rows.length ? (
          <EmptyState>
            這隻英雄還沒有任何增幅累積到 {MIN_ON_CHAMPION} 場。多打幾場再回來看。
          </EmptyState>
        ) : (
          <>
            <AgTable
              columns={SYNERGY_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              height={460}
              fileName={`synergy-${champion}`}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              用「加成」而不是絕對勝率，是因為有些增幅本來就強、在誰身上都好——
              加成才看得出「特別適合這隻英雄」。不過在目前的資料量下，
              單一英雄的樣本通常只有個位數，這裡的數字是線索而不是結論。
            </p>
          </>
        )}
      </Panel>
    </div>
  )
}
