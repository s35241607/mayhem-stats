import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, type Column } from "@/components/DataTable"
import { useCube } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, type CubeFilter } from "@/lib/cube"
import { round0, round1, type PageProps } from "./shared"

const COLUMNS: Column[] = [
  { key: "teammates.player", title: "玩家", kind: "dimension" },
  { key: "teammates.games", title: "同場次數", kind: "metric", format: round0 },
  { key: "teammates.wins", title: "我方勝場", kind: "metric", format: round0 },
  { key: "teammates.winrate", title: "我的勝率", kind: "metric", format: round1, suffix: "%" },
]

function relationFilters(queueId: string | null, relation: string): CubeFilter[] {
  const filters: CubeFilter[] = [
    { member: "teammates.relation", operator: "equals", values: [relation] },
  ]
  if (queueId) {
    filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  }
  return filters
}

function PlayerTable({
  title,
  hint,
  queueId,
  relation,
}: {
  title: string
  hint: string
  queueId: string | null
  relation: string
}) {
  const { rows, loading, error } = useCube({
    measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
    dimensions: ["teammates.player"],
    filters: relationFilters(queueId, relation),
    order: { "teammates.games": "desc" },
    limit: 40,
  })

  // 這個 cube 沒有 participants.games，DataTable 的淡化判斷用不到，
  // 因此改由查詢本身限制筆數，避免整頁都是只遇過一次的路人。
  const meaningful = rows.filter((r) => Number(r["teammates.games"]) >= 2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataTable
          columns={COLUMNS}
          rows={meaningful}
          loading={loading}
          error={error}
          emptyHint="還沒有同場 2 次以上的對象。"
        />
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

export function Players({ filters }: PageProps) {
  const queueId = filters.queueId ?? MAYHEM_QUEUE_ID

  return (
    <div className="space-y-4">
      <PlayerTable
        title="同隊隊友"
        hint="勝率 = 和這個人同隊時，你的勝率。同隊次數特別高的就是你的固定車隊。"
        queueId={queueId}
        relation="teammate"
      />
      <PlayerTable
        title="對手"
        hint="勝率 = 對上這個人時，你的勝率。Riot 不提供「誰跟誰一起排隊」的欄位，這些是從同場紀錄推出來的。"
        queueId={queueId}
        relation="opponent"
      />
    </div>
  )
}
