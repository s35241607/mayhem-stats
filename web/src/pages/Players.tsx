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
  subject,
}: {
  title: string
  caption: string
  queueId: string | null
  dateRange: string
  relation: string
  subject: CubeFilter[]
}) {
  // teammates 是自己的 cube，沒有 participants.is_me，所以不套 apply()。
  // subject 指定要以誰為視角——少了它，所有人的視角會混在一起。
  const filters: CubeFilter[] = [
    ...subject,
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
  const { queueId, dateRange, subjectFilter, isMe, account } = useFilters()
  const queue = queueId ?? MAYHEM_QUEUE_ID
  const subject = subjectFilter("teammates.subject_puuid")
  const who = isMe ? "你" : (account?.riot_id ?? "他")

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PlayerTable
        title="同隊隊友"
        caption={`勝率 = 和這個人同隊時${who}的勝率。同隊次數特別高的就是固定車隊。`}
        queueId={queue}
        dateRange={dateRange}
        relation="teammate"
        subject={subject}
      />
      <PlayerTable
        title="對手"
        caption={`勝率 = 對上這個人時${who}的勝率。Riot 不提供組隊欄位，這是從同場紀錄推出來的。`}
        queueId={queue}
        dateRange={dateRange}
        relation="opponent"
        subject={subject}
      />
    </div>
  )
}
