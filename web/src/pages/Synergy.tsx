import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Panel, EmptyState } from "@/components/primitives"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"

const MIN_ON_CHAMPION = 2

const RARITY: Record<string, string> = {
  kPrismatic: "bg-prismatic/15 text-prismatic border-prismatic/30",
  kGold: "bg-gold/15 text-gold border-gold/30",
  kSilver: "bg-silver/15 text-silver border-silver/30",
}

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
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs uppercase">增幅裝置</TableHead>
                    <TableHead className="text-right text-xs uppercase">這隻英雄</TableHead>
                    <TableHead className="text-right text-xs uppercase">該英雄勝率</TableHead>
                    <TableHead className="text-right text-xs uppercase">整體勝率</TableHead>
                    <TableHead className="text-right text-xs uppercase">加成</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.name} className={cn(r.games < 3 && "opacity-60")}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <img
                            src={iconUrl(r.icon)}
                            alt=""
                            className="size-7 shrink-0 rounded-md bg-secondary"
                          />
                          <span className="font-medium">{r.name}</span>
                          {r.rarity && (
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", RARITY[r.rarity])}
                            >
                              {r.rarity.replace("k", "")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.wins} / {r.games}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          r.wr >= 50 ? "text-win" : "text-loss",
                        )}
                      >
                        {r.wr.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.baseWr === null ? "—" : `${r.baseWr.toFixed(1)}%`}
                        <span className="ml-1 text-[11px]">({r.baseGames})</span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-bold tabular-nums",
                          r.lift === null ? "" : r.lift > 0 ? "text-win" : "text-loss",
                        )}
                      >
                        {r.lift === null
                          ? "—"
                          : `${r.lift > 0 ? "+" : ""}${r.lift.toFixed(1)}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
