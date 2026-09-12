import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, num, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { round0, round1 } from "./shared"

const COLUMNS: GridColumn[] = [
  { key: "teammates.player", title: "玩家", kind: "dimension" },
  { key: "teammates.games", title: "同場次數", kind: "metric", format: round0 },
  { key: "teammates.wins", title: "我方勝場", kind: "metric", format: round0 },
  { key: "teammates.winrate", title: "我的勝率", kind: "metric", format: round1, suffix: "%" },
]

const CHAMP_COLUMNS = (whoseKey: string, iconKey: string): GridColumn[] => [
  { key: whoseKey, title: "英雄", kind: "dimension", iconKey },
  { key: "teammates.games", title: "場次", kind: "metric", format: round0 },
  { key: "teammates.wins", title: "勝場", kind: "metric", format: round0 },
  { key: "teammates.winrate", title: "勝率", kind: "metric", format: round1, suffix: "%" },
]

/** 英雄層級的樣本通常只有個位數，低於這個數就別單獨解讀。 */
const THIN_SAMPLE = 4

/** 和某個人同場時的細部拆解。 */
function TogetherPanel({
  player,
  relation,
  subject,
  queueId,
  dateRange,
  myWinrate,
  onClose,
}: {
  player: string
  relation: string
  subject: CubeFilter[]
  queueId: string | null
  dateRange: string
  myWinrate: number | null
  onClose: () => void
}) {
  const [side, setSide] = useState<"mine" | "theirs">("mine")

  const filters: CubeFilter[] = [
    ...subject,
    { member: "teammates.relation", operator: "equals", values: [relation] },
    { member: "teammates.player", operator: "equals", values: [player] },
  ]
  if (queueId) filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  const time = dateRange !== "all" ? { timeDimensions: [{ dimension: "matches.played_at", dateRange }] } : {}

  const totals = useCube({ measures: ["teammates.games", "teammates.wins", "teammates.winrate"], filters, ...time })
  const roles = useCube({
    measures: ["teammates.games", "teammates.winrate"],
    dimensions: ["champion_roles.name"],
    filters,
    order: { "teammates.games": "desc" },
    limit: 10,
    ...time,
  })
  const champs = useCube({
    measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
    dimensions:
      side === "mine"
        ? ["teammates.my_champion", "teammates.my_champion_icon"]
        : ["teammates.other_champion", "teammates.other_champion_icon"],
    filters,
    order: { "teammates.games": "desc" },
    limit: 200,
    ...time,
  })

  const games = num(totals.rows[0]?.["teammates.games"]) ?? 0
  const winrate = num(totals.rows[0]?.["teammates.winrate"])
  const diff = winrate !== null && myWinrate !== null ? winrate - myWinrate : null

  const roleBars: BarDatum[] = roles.rows.map((r) => ({
    label: String(r["champion_roles.name"] ?? "—"),
    value: num(r["teammates.winrate"]) ?? 0,
    games: num(r["teammates.games"]) ?? 0,
  }))

  const champRows = champs.rows
  const thin = champRows.filter((r) => (num(r["teammates.games"]) ?? 0) < THIN_SAMPLE).length

  return (
    <Panel
      title={`和 ${player} ${relation === "teammate" ? "同隊" : "對上"}時`}
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="size-3.5" />
          收起
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="同場次數" value={String(games)} loading={totals.loading} />
          <Kpi
            label="我的勝率"
            value={winrate === null ? "—" : `${winrate.toFixed(1)}%`}
            loading={totals.loading}
          />
          <Kpi
            label="對比我的整體"
            value={diff === null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp`}
            hint={myWinrate === null ? undefined : `整體 ${myWinrate.toFixed(1)}%`}
            loading={totals.loading}
          />
        </div>

        <div>
          <div className="mb-1 text-xs font-medium">我玩哪類英雄比較會贏</div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            英雄層級一隻通常只有一兩場，看不出東西；併成六類之後每類才有十幾到五十場。
          </p>
          {roles.loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : roleBars.length ? (
            <BarChart data={roleBars} suffix="%" />
          ) : (
            <EmptyState>沒有資料。</EmptyState>
          )}
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium">逐隻英雄</div>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={side}
              onValueChange={(v) => v && setSide(v as "mine" | "theirs")}
            >
              <ToggleGroupItem value="mine">我的英雄</ToggleGroupItem>
              <ToggleGroupItem value="theirs">{player} 的英雄</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {champs.loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : champRows.length ? (
            <>
              <AgTable
                columns={
                  side === "mine"
                    ? CHAMP_COLUMNS("teammates.my_champion", "teammates.my_champion_icon")
                    : CHAMP_COLUMNS("teammates.other_champion", "teammates.other_champion_icon")
                }
                rows={champRows}
                height={360}
                fileName={`together-${player}-${side}`}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {champRows.length} 隻英雄裡有 {thin} 隻不到 {THIN_SAMPLE} 場——那幾列的勝率只是
                「還沒輸過」或「還沒贏過」，別當結論。上面的定位分組才是這個資料量問得出答案的粒度。
              </p>
            </>
          ) : (
            <EmptyState>沒有資料。</EmptyState>
          )}
        </div>
      </div>
    </Panel>
  )
}

function PlayerTable({
  title,
  caption,
  queueId,
  dateRange,
  relation,
  subject,
  onPick,
}: {
  title: string
  caption: string
  queueId: string | null
  dateRange: string
  relation: string
  subject: CubeFilter[]
  onPick: (player: string) => void
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
      {loading ? (
        <Skeleton className="h-[380px] w-full" />
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : (
        <>
          <AgTable
            columns={COLUMNS}
            rows={meaningful}
            height={420}
            fileName={`players-${relation}`}
            emptyHint="還沒有同場 2 次以上的對象。"
            onDrill={(_col, value) => onPick(value)}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">雙擊玩家名字，看和這個人同場時的細部拆解。</p>
        </>
      )}
    </Panel>
  )
}

export function Players() {
  const { queueId, dateRange, subjectFilter, isMe, account, apply } = useFilters()
  const queue = queueId ?? MAYHEM_QUEUE_ID
  const subject = subjectFilter("teammates.subject_puuid")
  const who = isMe ? "你" : (account?.riot_id ?? "他")
  const [picked, setPicked] = useState<{ player: string; relation: string } | null>(null)

  // 拿來當基準線：和某人同隊的勝率要跟自己的整體比才有意義
  const overall = useCube(apply({ measures: ["participants.winrate"] }))
  const myWinrate = num(overall.rows[0]?.["participants.winrate"])

  return (
    <div className="space-y-4">
      {picked && (
        <TogetherPanel
          player={picked.player}
          relation={picked.relation}
          subject={subject}
          queueId={queue}
          dateRange={dateRange}
          myWinrate={myWinrate}
          onClose={() => setPicked(null)}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <PlayerTable
          title="同隊隊友"
          caption={`勝率 = 和這個人同隊時${who}的勝率。同隊次數特別高的就是固定車隊。`}
          queueId={queue}
          dateRange={dateRange}
          relation="teammate"
          subject={subject}
          onPick={(player) => setPicked({ player, relation: "teammate" })}
        />
        <PlayerTable
          title="對手"
          caption={`勝率 = 對上這個人時${who}的勝率。Riot 不提供組隊欄位，這是從同場紀錄推出來的。`}
          queueId={queue}
          dateRange={dateRange}
          relation="opponent"
          subject={subject}
          onPick={(player) => setPicked({ player, relation: "opponent" })}
        />
      </div>
    </div>
  )
}
