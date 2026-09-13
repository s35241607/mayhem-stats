import { useEffect, useMemo, useState } from "react"
import { RecordCell, num0, numOf } from "@/components/cells"
import { Check, Radar, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { MatchList } from "@/components/MatchList"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, num, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { MIN_GAMES, round0 } from "./shared"

/** 「我的戰績」複合格子：勝率 + 勝敗比例條，刻度線是比較基準（你的整體勝率，或和這個人同場的整體勝率）。 */
const recordColumn = (title: string, baseline: number | null, baselineLabel: string): GridColumn => ({
  key: "teammates.winrate",
  title,
  kind: "metric",
  flex: 1.6,
  minWidth: 170,
  cell: (r) => (
    <RecordCell
      winrate={numOf(r, "teammates.winrate")}
      wins={num0(r, "teammates.wins")}
      losses={num0(r, "teammates.games") - num0(r, "teammates.wins")}
      baseline={baseline}
      baselineLabel={baselineLabel}
    />
  ),
})

const playerColumns = (myWinrate: number | null): GridColumn[] => [
  { key: "teammates.player", title: "玩家", kind: "dimension", flex: 1.6, minWidth: 150 },
  { key: "teammates.games", title: "同場次數", kind: "metric", format: round0, flex: 0.6, minWidth: 88 },
  recordColumn("我的戰績", myWinrate, "你的整體勝率"),
  { key: "teammates.wins", title: "我方勝場", kind: "metric", hide: true },
]

const champColumns = (whoseKey: string, iconKey: string, baseline: number | null): GridColumn[] => [
  { key: whoseKey, title: "英雄", kind: "dimension", iconKey, flex: 1.6, minWidth: 150 },
  { key: "teammates.games", title: "場次", kind: "metric", format: round0, flex: 0.6, minWidth: 72 },
  recordColumn("戰績", baseline, "和這個人同場的整體勝率"),
  { key: "teammates.wins", title: "勝場", kind: "metric", hide: true },
]

type Picked = { player: string; puuid: string; relation: string }

/** 在下鑽面板裡直接追蹤這個人，不必切到「追蹤對象」頁再找一次。 */
function TrackButton({ puuid }: { puuid: string }) {
  const { account } = useFilters()
  // 狀態每次向後端問。不能用 FilterProvider 的 players：那份只在開頁時載入一次，
  // 這裡切換過之後收起再打開，會顯示成切換前的狀態。
  const [tracked, setTracked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d: { tracked: { puuid: string }[] }) => {
        if (!cancelled) setTracked(d.tracked.some((a) => a.puuid === puuid))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [puuid])

  // 只有在看自己的數據時才提供：追蹤名單是「我要一併採集誰」，不是別人的
  if (!account?.is_me || tracked === null) return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/accounts/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puuid, tracked: !tracked }),
      })
      const body = await res.json()
      if (body.error) setError(body.error)
      else setTracked(!tracked)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button size="sm" variant={tracked ? "secondary" : "outline"} onClick={toggle} disabled={busy}>
        {tracked ? <Check className="size-3.5" /> : <Radar className="size-3.5" />}
        {tracked ? "追蹤中" : "追蹤這個人"}
      </Button>
    </span>
  )
}

/** 和某個人同場時的細部拆解。 */
function TogetherPanel({
  picked,
  subject,
  queueId,
  myWinrate,
  onClose,
}: {
  picked: Picked
  subject: CubeFilter[]
  queueId: string | null
  myWinrate: number | null
  onClose: () => void
}) {
  const { player, puuid, relation } = picked
  const { timeFilter, matchParams, account } = useFilters()
  const [sideChoice, setSide] = useState<"mine" | "theirs">("mine")
  // 交叉篩選：點定位長條，下面的逐隻英雄只剩那個定位。定位是「我的英雄」的定位
  // （teammates 只和我這邊的英雄 join 定位），所以選了定位時固定看我的英雄。
  const [role, setRole] = useState<string | null>(null)
  const side = role ? "mine" : sideChoice
  useCrumb(20, role, () => setRole(null))
  const [view, setView] = useState<"breakdown" | "matches">("breakdown")

  const filters: CubeFilter[] = [
    ...subject,
    { member: "teammates.relation", operator: "equals", values: [relation] },
    { member: "teammates.puuid", operator: "equals", values: [puuid] },
  ]
  if (queueId) filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  const time = timeFilter("matches.played_at")

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
    filters: role ? [...filters, { member: "champion_roles.name", operator: "equals", values: [role] }] : filters,
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
  const champCols = useMemo(
    () =>
      side === "mine"
        ? champColumns("teammates.my_champion", "teammates.my_champion_icon", winrate)
        : champColumns("teammates.other_champion", "teammates.other_champion_icon", winrate),
    [side, winrate],
  )
  const thin = champRows.filter((r) => (num(r["teammates.games"]) ?? 0) < MIN_GAMES).length

  return (
    <Panel
      title={`和 ${player} ${relation === "teammate" ? "同隊" : "對上"}時`}
      action={
        <span className="flex items-center gap-1">
          <TrackButton puuid={puuid} />
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
            收起
          </Button>
        </span>
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

        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as "breakdown" | "matches")}
        >
          <ToggleGroupItem value="breakdown">英雄與定位拆解</ToggleGroupItem>
          <ToggleGroupItem value="matches">同場的每一場（{games}）</ToggleGroupItem>
        </ToggleGroup>

        {view === "matches" ? (
          <MatchList
            // 這頁在「全部模式」時仍固定看 Mayhem（見 Players），列表也要跟著，場次才對得上
            params={{ ...matchParams(), ...(queueId ? { queue: queueId } : {}), with_puuid: puuid, relation }}
            puuid={account?.puuid}
          />
        ) : (
          <>
            <div>
              <div className="mb-1 text-xs font-medium">我玩哪類英雄比較會贏</div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                英雄層級一隻通常只有一兩場，看不出東西；併成六類之後每類才有十幾到五十場。點一個定位，下面的逐隻英雄只列出那個定位。
              </p>
              {roles.loading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : roleBars.length ? (
                <BarChart
                  data={roleBars}
                  suffix="%"
                  selected={role}
                  onPick={(label) => setRole((cur) => (cur === label ? null : label))}
                />
              ) : (
                <EmptyState>沒有資料。</EmptyState>
              )}
            </div>

            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  逐隻英雄
                  {role && (
                    <button
                      onClick={() => setRole(null)}
                      className="slide-in flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary transition hover:bg-primary/20"
                    >
                      只看{role}
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={side}
                  onValueChange={(v) => v && setSide(v as "mine" | "theirs")}
                >
                  <ToggleGroupItem value="mine">我的英雄</ToggleGroupItem>
                  <ToggleGroupItem value="theirs" disabled={!!role} title={role ? "定位是依你的英雄算的，選了定位時只能看你的英雄" : undefined}>
                    {player} 的英雄
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {champs.loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : champRows.length ? (
                <>
                  <AgTable
                    columns={champCols}
                    rowHeight={54}
                    rows={champRows}
                    height={360}
                    sampleKey="teammates.games"
                    fileName={`together-${player}-${side}`}
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    戰績條上的刻度線是和這個人同場的整體勝率。{champRows.length} 隻英雄裡有 {thin} 隻不到 {MIN_GAMES} 場（已淡化）——那幾列的勝率只是
                    「還沒輸過」或「還沒贏過」，別當結論。上面的定位分組才是這個資料量問得出答案的粒度。
                  </p>
                </>
              ) : (
                <EmptyState>沒有資料。</EmptyState>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function PlayerTable({
  title,
  caption,
  queueId,
  relation,
  subject,
  myWinrate,
  onPick,
}: {
  title: string
  caption: string
  queueId: string | null
  relation: string
  subject: CubeFilter[]
  myWinrate: number | null
  onPick: (picked: Picked) => void
}) {
  const columns = useMemo(() => playerColumns(myWinrate), [myWinrate])
  const { timeFilter } = useFilters()
  // teammates 是自己的 cube，沒有 participants.is_me，所以不套 apply()。
  // subject 指定要以誰為視角——少了它，所有人的視角會混在一起。
  const filters: CubeFilter[] = [
    ...subject,
    { member: "teammates.relation", operator: "equals", values: [relation] },
  ]
  if (queueId) {
    filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  }

  // 一個人 = 一個 puuid，下鑽也是用 puuid 查。場次只按 puuid 分組——若連名字一起分組，
  // 改過名的人會拆成好幾列：點「舊名字 5 場」那列，面板卻顯示合計 15 場。
  // 也不能拆開後在前端相加：對手動輒上千人，limit 會把某人場次少的舊名字那列截掉而少算。
  const time = timeFilter("matches.played_at")
  const { rows: all, loading, error } = useCube({
    measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
    dimensions: ["teammates.puuid"],
    filters,
    ...time,
    order: { "teammates.games": "desc" },
    limit: 50,
  })
  // 「同場 2 次以上」不能寫成 Cube 的指標篩選：值以字串送進去，SQLite 的
  // COUNT(...) >= '2' 是整數比字串、永遠為假，整張表會變空。
  const rows = all.filter((r) => (num(r["teammates.games"]) ?? 0) >= 2)

  // 名字另外查，只查要顯示的這幾個人；改過名的取同場最多次的那個
  const ids = rows.map((r) => String(r["teammates.puuid"]))
  const names = useCube(
    ids.length
      ? {
          measures: ["teammates.games"],
          dimensions: ["teammates.puuid", "teammates.player"],
          filters: [...filters, { member: "teammates.puuid", operator: "equals", values: ids }],
          ...time,
          order: { "teammates.games": "desc" },
          limit: 500,
        }
      : null,
  )
  const nameOf = new Map<string, string>()
  for (const r of names.rows) {
    const id = String(r["teammates.puuid"])
    if (!nameOf.has(id)) nameOf.set(id, String(r["teammates.player"] ?? "—"))
  }
  const meaningful = rows.map((r) => ({
    ...r,
    "teammates.player": nameOf.get(String(r["teammates.puuid"])) ?? "…",
  }))

  return (
    <Panel title={title} caption={caption}>
      {loading || names.loading ? (
        <Skeleton className="h-[380px] w-full" />
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : (
        <>
          <AgTable
            columns={columns}
            rowHeight={54}
            rows={meaningful}
            height={420}
            fileName={`players-${relation}`}
            emptyHint="還沒有同場 2 次以上的對象。"
            onDrill={(_col, value, row) =>
              onPick({ player: value, puuid: String(row["teammates.puuid"]), relation })
            }
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            戰績條上的刻度線是你的整體勝率。雙擊玩家名字，看和這個人同場時的拆解、每一場的戰報，也可以直接加入追蹤。
          </p>
        </>
      )}
    </Panel>
  )
}

export function Players() {
  const { queueId, subjectFilter, isMe, account, apply } = useFilters()
  const queue = queueId ?? MAYHEM_QUEUE_ID
  const subject = subjectFilter("teammates.subject_puuid")
  const who = isMe ? "你" : (account?.riot_id ?? "他")
  const [picked, setPicked] = useState<Picked | null>(null)
  useCrumb(10, picked ? `${picked.relation === "teammate" ? "和" : "對上"} ${picked.player}` : null, () => setPicked(null))

  // 拿來當基準線：和某人同隊的勝率要跟自己的整體比才有意義
  const overall = useCube(apply({ measures: ["participants.winrate"] }))
  const myWinrate = num(overall.rows[0]?.["participants.winrate"])

  // 原本在敗因分析頁。和「隊友」問的是同一件事，放在這裡才找得到。
  const byParty = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["participants.party_size"],
      order: { "participants.party_size": "asc" },
      limit: 10,
    }),
  )
  const partyBars: BarDatum[] = byParty.rows.map((r) => ({
    label: `${r["participants.party_size"]} 人`,
    value: num(r["participants.winrate"]) ?? 0,
    games: num(r["participants.games"]) ?? 0,
  }))

  return (
    <div className="space-y-4">
      <Panel
        title="同隊朋友數與勝率"
        caption="我方隊伍裡有幾個追蹤中的朋友。這是開打前就決定的事，比賽中的數字沒辦法反過來影響它，所以這裡的關聯比「敗因分析」那張勝敗對照表可信。"
      >
        {byParty.loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : partyBars.length ? (
          <BarChart data={partyBars} suffix="%" />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>

      {picked && (
        <TogetherPanel
          key={`${picked.puuid}:${picked.relation}`}
          picked={picked}
          subject={subject}
          queueId={queue}
          myWinrate={myWinrate}
          onClose={() => setPicked(null)}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <PlayerTable
          title="同隊隊友"
          caption={`勝率 = 和這個人同隊時${who}的勝率。同隊次數特別高的就是固定車隊。`}
          queueId={queue}
          relation="teammate"
          subject={subject}
          myWinrate={myWinrate}
          onPick={setPicked}
        />
        <PlayerTable
          title="對手"
          caption={`勝率 = 對上這個人時${who}的勝率。Riot 不提供組隊欄位，這是從同場紀錄推出來的。`}
          queueId={queue}
          relation="opponent"
          subject={subject}
          myWinrate={myWinrate}
          onPick={setPicked}
        />
      </div>
    </div>
  )
}
