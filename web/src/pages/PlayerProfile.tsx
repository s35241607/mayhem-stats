import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { DataTable, type Column } from "@/components/DataTable"
import { useCube } from "@/hooks/useCube"
import { num, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { round0, round1, round2 } from "./shared"

const COLUMNS: Column[] = [
  { key: "champions.name", title: "英雄", kind: "dimension", iconKey: "champions.icon_path" },
  { key: "participants.games", title: "場次", kind: "metric", format: round0 },
  { key: "participants.wins", title: "勝場", kind: "metric", format: round0 },
  { key: "participants.winrate", title: "勝率", kind: "metric", format: round1, suffix: "%" },
  { key: "participants.kda", title: "KDA", kind: "metric", format: round2 },
  { key: "participants.dpm", title: "每分鐘傷害", kind: "metric", format: round0 },
  { key: "participants.damage_share", title: "傷害佔比", kind: "metric", format: round1, suffix: "%" },
]

export function PlayerProfile() {
  const { queueId } = useFilters()
  const [player, setPlayer] = useState<string>("")

  const queueFilter: CubeFilter[] = queueId
    ? [{ member: "matches.queue_id", operator: "equals", values: [queueId] }]
    : []

  // 刻意不套 is_me：這一頁的重點就是看「別人」。
  const people = useCube({
    measures: ["participants.games"],
    dimensions: ["participants.riot_id"],
    filters: queueFilter,
    order: { "participants.games": "desc" },
    limit: 120,
  })

  const champions = useCube(
    player
      ? {
          measures: [
            "participants.games",
            "participants.wins",
            "participants.winrate",
            "participants.kda",
            "participants.dpm",
            "participants.damage_share",
          ],
          dimensions: ["champions.name", "champions.icon_path"],
          filters: [
            ...queueFilter,
            { member: "participants.riot_id", operator: "equals", values: [player] },
          ],
          order: { "participants.games": "desc" },
          limit: 100,
        }
      : null,
  )

  const totals = useCube(
    player
      ? {
          measures: [
            "participants.games",
            "participants.wins",
            "participants.winrate",
            "participants.kda",
            "participants.dpm",
          ],
          filters: [
            ...queueFilter,
            { member: "participants.riot_id", operator: "equals", values: [player] },
          ],
        }
      : null,
  )

  // 和我同隊 vs 對上我，兩邊分開看
  const relation = useCube(
    player
      ? {
          measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
          dimensions: ["teammates.relation"],
          filters: [
            ...(queueId
              ? [{ member: "matches.queue_id", operator: "equals", values: [queueId] }]
              : []),
            { member: "teammates.player", operator: "equals", values: [player] },
          ],
          limit: 5,
        }
      : null,
  )

  const row = totals.rows[0] ?? {}
  const metric = (key: string, fmt: (n: number) => string, suffix = "") => {
    const v = num(row[key])
    return v === null ? "—" : `${fmt(v)}${suffix}`
  }

  const asTeammate = relation.rows.find((r) => r["teammates.relation"] === "teammate")
  const asOpponent = relation.rows.find((r) => r["teammates.relation"] === "opponent")

  return (
    <div className="space-y-4">
      <Panel
        title="選一位玩家"
        caption="清單依同場次數排序。次數多的通常是你的固定車隊，數字才有意義。"
      >
        {people.loading ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <Select value={player} onValueChange={setPlayer}>
            <SelectTrigger className="w-80">
              <SelectValue placeholder="選擇玩家…" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {people.rows.map((r) => (
                <SelectItem
                  key={String(r["participants.riot_id"])}
                  value={String(r["participants.riot_id"])}
                >
                  {String(r["participants.riot_id"])}（{num(r["participants.games"])} 場）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Panel>

      {player && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="同場場次" value={metric("participants.games", round0)} loading={totals.loading} />
            <Kpi
              label="他的勝率"
              value={metric("participants.winrate", round1, "%")}
              hint={`${metric("participants.wins", round0)} 勝`}
              loading={totals.loading}
            />
            <Kpi label="他的 KDA" value={metric("participants.kda", round2)} loading={totals.loading} />
            <Kpi
              label="和你同隊"
              value={
                asTeammate
                  ? `${Number(asTeammate["teammates.winrate"]).toFixed(1)}%`
                  : "—"
              }
              hint={asTeammate ? `${asTeammate["teammates.games"]} 場，你的勝率` : "沒有同隊過"}
              loading={relation.loading}
            />
            <Kpi
              label="對上你"
              value={
                asOpponent
                  ? `${Number(asOpponent["teammates.winrate"]).toFixed(1)}%`
                  : "—"
              }
              hint={asOpponent ? `${asOpponent["teammates.games"]} 場，你的勝率` : "沒有對上過"}
              loading={relation.loading}
            />
          </div>

          <Panel
            title={`${player} 的英雄表現`}
            caption="這是他在「有你的對局」裡的紀錄，不是他的整體戰績——資料庫裡只有你打過的場次"
          >
            {champions.loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : champions.rows.length ? (
              <DataTable columns={COLUMNS} rows={champions.rows} />
            ) : (
              <EmptyState>沒有這位玩家的資料。</EmptyState>
            )}
          </Panel>
        </>
      )}

      {!player && <EmptyState>先選一位玩家。</EmptyState>}
    </div>
  )
}
