import { Panel } from "@/components/primitives"
import { DataTable, type Column } from "@/components/DataTable"
import { useCube } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { round0, round1 } from "./shared"

const COLUMNS: Column[] = [
  { key: "teammates.player", title: "玩家", kind: "dimension" },
  { key: "teammates.games", title: "同場次數", kind: "metric", format: round0 },
  { key: "teammates.wins", title: "我方勝場", kind: "metric", format: round0 },
  { key: "teammates.winrate", title: "我的勝率", kind: "metric", format: round1, suffix: "%" },
]

function PlayerTable({
  title,
  caption,
  queueId,
  dateRange,
  relation,
}: {
  title: string
  caption: string
  queueId: string | null
  dateRange: string
  relation: string
}) {
  // teammates cube 已把「只看自己」寫死在它的 sql 裡，所以這裡不套 apply()，
  // 只補上模式與期間；participants.is_me 在這個 cube 上不存在。
  const filters: CubeFilter[] = [
    { member: "teammates.relation", operator: "equals", values: [relation] },
  ]
  if (queueId) {
    filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  }

  const { rows, loading, error } = useCube({
    measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
    dimensions: ["teammates.player"],
    filters,
    ...(dateRange !== "all"
      ? { timeDimensions: [{ dimension: "matches.played_at", dateRange }] }
      : {}),
    order: { "teammates.games": "desc" },
    limit: 50,
  })

  const meaningful = rows.filter((r) => Number(r["teammates.games"]) >= 2)

  return (
    <Panel title={title} caption={caption}>
      <DataTable
        columns={COLUMNS}
        rows={meaningful}
        loading={loading}
        error={error}
        emptyHint="還沒有同場 2 次以上的對象。"
      />
    </Panel>
  )
}

export function Players() {
  const { queueId, dateRange } = useFilters()
  const queue = queueId ?? MAYHEM_QUEUE_ID

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PlayerTable
        title="同隊隊友"
        caption="勝率 = 和這個人同隊時你的勝率。同隊次數特別高的就是固定車隊。"
        queueId={queue}
        dateRange={dateRange}
        relation="teammate"
      />
      <PlayerTable
        title="對手"
        caption="勝率 = 對上這個人時你的勝率。Riot 不提供組隊欄位，這是從同場紀錄推出來的。"
        queueId={queue}
        dateRange={dateRange}
        relation="opponent"
      />
    </div>
  )
}
