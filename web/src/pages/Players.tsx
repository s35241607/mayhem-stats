import { useEffect, useMemo, useState } from "react"
import { RecordCell, num0, numOf } from "@/components/cells"
import { Check, Radar, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { MatchList } from "@/components/MatchList"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, num, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { MIN_GAMES, NO_LIMIT, round0 } from "./shared"

type Relation = "teammate" | "opponent"
const REL_LABEL: Record<Relation, string> = { teammate: "同隊", opponent: "敵對" }

/** 一個人一列：同隊、敵對各自的場次與戰績攤平在同一列。
 *  Cube 回的是「人 × 關係」兩列，前端併起來——同一場裡一個人只會是隊友或對手其中一種，所以合計直接相加。 */
type Person = {
  puuid: string
  player: string
  games: number
  wins: number
  mate_games: number
  mate_wins: number
  mate_winrate: number | null
  foe_games: number
  foe_wins: number
  foe_winrate: number | null
  /** 最近同場的本地日期（YYYY-MM-DD） */
  last_played: string | null
}

const winrateOf = (wins: number, games: number) => (games ? (wins / games) * 100 : null)

/** 同隊／敵對其中一邊的戰績格。沒遇過就寫「沒有」，不畫空的勝敗條。 */
const sideColumn = (rel: Relation, myWinrate: number | null): GridColumn => {
  const p = rel === "teammate" ? "mate" : "foe"
  return {
    key: `${p}_winrate`,
    title: `${REL_LABEL[rel]}時我的戰績`,
    kind: "metric",
    flex: 1.5,
    minWidth: 160,
    cell: (r) =>
      num0(r, `${p}_games`) ? (
        <RecordCell
          winrate={numOf(r, `${p}_winrate`)}
          wins={num0(r, `${p}_wins`)}
          losses={num0(r, `${p}_games`) - num0(r, `${p}_wins`)}
          baseline={myWinrate}
          baselineLabel="你的整體勝率"
        />
      ) : (
        <span className="text-xs text-muted-foreground">沒有{REL_LABEL[rel]}過</span>
      ),
  }
}

const peopleColumns = (myWinrate: number | null): GridColumn[] => [
  { key: "player", title: "玩家", kind: "dimension", flex: 1.5, minWidth: 150 },
  { key: "games", title: "同場", kind: "metric", format: round0, flex: 0.55, minWidth: 76 },
  { key: "mate_games", title: "同隊", kind: "metric", format: round0, flex: 0.55, minWidth: 76 },
  sideColumn("teammate", myWinrate),
  { key: "foe_games", title: "敵對", kind: "metric", format: round0, flex: 0.55, minWidth: 76 },
  sideColumn("opponent", myWinrate),
  {
    key: "last_played",
    title: "最近同場",
    kind: "dimension",
    flex: 0.75,
    minWidth: 104,
    cell: (r) => <span className="tabular-nums text-muted-foreground">{String(r.last_played ?? "—")}</span>,
  },
  { key: "wins", title: "同場我方勝場", kind: "metric", hide: true },
  { key: "mate_wins", title: "同隊勝場", kind: "metric", hide: true },
  { key: "foe_wins", title: "敵對時我方勝場", kind: "metric", hide: true },
]

/** 逐隻英雄的戰績格：勝率 + 勝敗比例條，刻度線是和這個人同場（目前選的關係）的整體勝率。 */
const champColumns = (whoseKey: string, iconKey: string, baseline: number | null): GridColumn[] => [
  { key: whoseKey, title: "英雄", kind: "dimension", iconKey, flex: 1.6, minWidth: 150 },
  { key: "teammates.games", title: "場次", kind: "metric", format: round0, flex: 0.6, minWidth: 72 },
  {
    key: "teammates.winrate",
    title: "戰績",
    kind: "metric",
    flex: 1.6,
    minWidth: 170,
    cell: (r) => (
      <RecordCell
        winrate={numOf(r, "teammates.winrate")}
        wins={num0(r, "teammates.wins")}
        losses={num0(r, "teammates.games") - num0(r, "teammates.wins")}
        baseline={baseline}
        baselineLabel="和這個人同場的整體勝率"
      />
    ),
  },
  { key: "teammates.wins", title: "勝場", kind: "metric", hide: true },
]

/** 在下鑽面板裡直接追蹤這個人，不必切到「追蹤對象」頁再找一次。 */
function TrackButton({ puuid }: { puuid: string }) {
  const { account, viewer } = useFilters()
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
  // 公開鏡像唯讀，而且那裡的「我」是登入的朋友，不是採集的帳號
  if (!account?.is_me || viewer?.public || tracked === null) return null

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

/** 點了某個人：右側抽屜。上面是同隊、敵對各自的戰績，下面是每一場（同隊、敵對可以一起列或分開看）與英雄拆解。
 *  表格留在原位、那一列保持選取，關掉就回到剛才的位置。 */
function PersonDrawer({
  person,
  subject,
  queueId,
  champion,
  myWinrate,
  onClose,
}: {
  person: Person | null
  subject: CubeFilter[]
  queueId: string
  /** 全域下鑽的英雄（已經放進 subject）；逐場列表另外用後端的 champion 參數套上 */
  champion?: string
  myWinrate: number | null
  onClose: () => void
}) {
  return (
    <DetailDrawer
      open={!!person}
      onClose={onClose}
      title={person?.player ?? ""}
      subtitle={
        person
          ? `同場 ${person.games} 場 · 同隊 ${person.mate_games} · 敵對 ${person.foe_games}${person.last_played ? ` · 最近 ${person.last_played}` : ""}`
          : undefined
      }
      actions={person && <TrackButton puuid={person.puuid} />}
    >
      {person && (
        <PersonDetail
          key={person.puuid}
          person={person}
          subject={subject}
          queueId={queueId}
          champion={champion}
          myWinrate={myWinrate}
        />
      )}
    </DetailDrawer>
  )
}

const sideHint = (wins: number, games: number, winrate: number | null, base: number | null, rel: Relation) => {
  if (!games) return `沒有${REL_LABEL[rel]}過`
  const record = `${wins} 勝 ${games - wins} 敗`
  if (winrate === null || base === null) return record
  const d = winrate - base
  return `${record} · 比整體 ${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`
}

function PersonDetail({
  person,
  subject,
  queueId,
  champion,
  myWinrate,
}: {
  person: Person
  subject: CubeFilter[]
  queueId: string
  champion?: string
  myWinrate: number | null
}) {
  const { puuid, player } = person
  const { timeFilter, matchParams, account } = useFilters()
  // 預設兩種一起列：要看的是「之前所有同場的對局」，卡片上會圈出他那場的英雄、在我方還是敵方那排
  const [rel, setRel] = useState<Relation | "all">("all")
  const [view, setView] = useState<"matches" | "breakdown">("matches")
  const [sideChoice, setSide] = useState<"mine" | "theirs">("mine")
  // 交叉篩選：點定位長條，下面的逐隻英雄只剩那個定位。定位是「我這一場」的出裝定位
  // （teammates 只和我這邊 join 出裝），所以選了定位時固定看我的英雄。
  const [role, setRole] = useState<string | null>(null)
  const side = role ? "mine" : sideChoice
  useCrumb(20, rel === "all" ? null : REL_LABEL[rel], () => {
    setRel("all")
    setRole(null)
  })
  useCrumb(30, role, () => setRole(null))
  // 逐場卡片等抽屜滑完才掛
  const settled = useDrawerSettled()

  const filters: CubeFilter[] = [
    ...subject,
    { member: "teammates.puuid", operator: "equals", values: [puuid] },
    { member: "matches.queue_id", operator: "equals", values: [queueId] },
    ...(rel === "all" ? [] : [{ member: "teammates.relation", operator: "equals", values: [rel] }]),
  ]
  const time = timeFilter("matches.played_at")
  const breakdown = view === "breakdown"

  const roles = useCube(
    breakdown
      ? {
          measures: ["teammates.games", "teammates.winrate"],
          dimensions: ["builds.build_role"],
          filters,
          order: { "teammates.games": "desc" },
          limit: 10,
          ...time,
        }
      : null,
  )
  const champs = useCube(
    breakdown
      ? {
          measures: ["teammates.games", "teammates.wins", "teammates.winrate"],
          dimensions:
            side === "mine"
              ? ["teammates.my_champion", "teammates.my_champion_icon"]
              : ["teammates.other_champion", "teammates.other_champion_icon"],
          filters: role ? [...filters, { member: "builds.build_role", operator: "equals", values: [role] }] : filters,
          order: { "teammates.games": "desc" },
          limit: NO_LIMIT,
          ...time,
        }
      : null,
  )

  const relGames = rel === "all" ? person.games : rel === "teammate" ? person.mate_games : person.foe_games
  const relWins = rel === "all" ? person.wins : rel === "teammate" ? person.mate_wins : person.foe_wins
  const relWinrate = winrateOf(relWins, relGames)

  const roleBars: BarDatum[] = roles.rows.map((r) => ({
    label: String(r["builds.build_role"] ?? "—"),
    value: num(r["teammates.winrate"]) ?? 0,
    games: num(r["teammates.games"]) ?? 0,
  }))
  const champRows = champs.rows
  const champCols = useMemo(
    () =>
      side === "mine"
        ? champColumns("teammates.my_champion", "teammates.my_champion_icon", relWinrate)
        : champColumns("teammates.other_champion", "teammates.other_champion_icon", relWinrate),
    [side, relWinrate],
  )
  const thin = champRows.filter((r) => (num(r["teammates.games"]) ?? 0) < MIN_GAMES).length
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi index={0} label="同場次數" value={String(person.games)} hint={`同隊 ${person.mate_games} 場 · 敵對 ${person.foe_games} 場`} />
        <Kpi
          index={1}
          label="同隊時我的勝率"
          value={pct(person.mate_winrate)}
          hint={sideHint(person.mate_wins, person.mate_games, person.mate_winrate, myWinrate, "teammate")}
        />
        <Kpi
          index={2}
          label="敵對時我的勝率"
          value={pct(person.foe_winrate)}
          hint={sideHint(person.foe_wins, person.foe_games, person.foe_winrate, myWinrate, "opponent")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={rel}
          onValueChange={(v) => {
            if (!v) return
            setRel(v as Relation | "all")
            setRole(null)
          }}
        >
          <ToggleGroupItem value="all">全部（{person.games}）</ToggleGroupItem>
          <ToggleGroupItem value="teammate" disabled={!person.mate_games}>
            同隊（{person.mate_games}）
          </ToggleGroupItem>
          <ToggleGroupItem value="opponent" disabled={!person.foe_games}>
            敵對（{person.foe_games}）
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          className="ml-auto"
          value={view}
          onValueChange={(v) => v && setView(v as "matches" | "breakdown")}
        >
          <ToggleGroupItem value="matches">每一場</ToggleGroupItem>
          <ToggleGroupItem value="breakdown">英雄與定位拆解</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "matches" ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            卡片右側的頭像裡，有外框的就是 {player} 那場用的英雄：在「我」那排是同隊、在「敵」那排是敵對。點一場看完整戰報。
          </p>
          {settled ? (
            <MatchList
              // 這頁在「全部模式」時仍固定看 Mayhem（見 Players），列表也要跟著，場次才對得上
              params={{
                ...matchParams(),
                queue: queueId,
                ...(champion ? { champion } : {}),
                with_puuid: puuid,
                ...(rel === "all" ? {} : { relation: rel }),
              }}
              puuid={account?.puuid}
            />
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <div className="mb-1 text-xs font-medium">我玩哪類英雄比較會贏</div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              英雄層級一隻通常只有一兩場，看不出東西；併成出裝定位（依終場出裝判斷，和其他頁一致）之後每類才有十幾到五十場。點一個定位，下面的逐隻英雄只列出那場出那種裝的。
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
              <Skeleton className="h-[360px] w-full" />
            ) : champRows.length ? (
              <>
                <AgTable columns={champCols} rowHeight={54} rows={champRows} height={360} fileName={`together-${player}-${rel}-${side}`} />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  戰績條上的刻度線是和這個人{rel === "all" ? "同場" : REL_LABEL[rel]}時的整體勝率。{champRows.length} 隻英雄裡有 {thin} 隻不到 {MIN_GAMES} 場——那幾列的勝率只是
                  「還沒輸過」或「還沒贏過」，別當結論。上面的定位分組才是這個資料量問得出答案的粒度。
                </p>
              </>
            ) : (
              <EmptyState>沒有資料。</EmptyState>
            )}
          </div>
        </>
      )}
    </>
  )
}

type Scope = "all" | "teammate" | "opponent" | "both"

const emptyPerson = (puuid: string, player: string): Person => ({
  puuid,
  player,
  games: 0,
  wins: 0,
  mate_games: 0,
  mate_wins: 0,
  mate_winrate: null,
  foe_games: 0,
  foe_wins: 0,
  foe_winrate: null,
  last_played: null,
})

function PeopleTable({
  queueId,
  subject,
  myWinrate,
  who,
  picked,
  onPick,
}: {
  queueId: string
  subject: CubeFilter[]
  myWinrate: number | null
  who: string
  picked: string | null
  onPick: (person: Person) => void
}) {
  const columns = useMemo(() => peopleColumns(myWinrate), [myWinrate])
  const { timeFilter } = useFilters()
  const [scope, setScope] = useState<Scope>("all")
  // teammates 是自己的 cube，沒有 participants.is_me，所以不套 apply()。
  // subject 指定要以誰為視角——少了它，所有人的視角會混在一起。
  const filters: CubeFilter[] = [...subject, { member: "matches.queue_id", operator: "equals", values: [queueId] }]
  const time = timeFilter("matches.played_at")

  // 一個人 = 一個 puuid，下鑽也是用 puuid 查。場次只按 puuid（與關係）分組——若連名字一起分組，
  // 改過名的人會拆成好幾列：點「舊名字 5 場」那列，抽屜卻顯示合計 15 場。
  // 全部列出（同場 1 次的也列）；AG Grid 只渲染看得到的列，幾千人捲動也不卡。
  const stats = useCube({
    measures: ["teammates.games", "teammates.wins", "teammates.last_played"],
    dimensions: ["teammates.puuid", "teammates.relation"],
    filters,
    ...time,
    order: { "teammates.games": "desc" },
    limit: NO_LIMIT,
  })
  // 名字另外查（同樣的條件、全部的人）；改過名的取同場最多次的那個。
  // 不用「puuid 在這些人裡面」的篩選：幾百個 puuid 塞進查詢字串會超過網址長度上限。
  const names = useCube({
    measures: ["teammates.games"],
    dimensions: ["teammates.puuid", "teammates.player"],
    filters,
    ...time,
    order: { "teammates.games": "desc" },
    limit: NO_LIMIT,
  })

  const people = useMemo(() => {
    const nameOf = new Map<string, string>()
    for (const r of names.rows) {
      const id = String(r["teammates.puuid"])
      if (!nameOf.has(id)) nameOf.set(id, String(r["teammates.player"] ?? "—"))
    }
    const byId = new Map<string, Person>()
    for (const r of stats.rows) {
      const id = String(r["teammates.puuid"])
      const p = byId.get(id) ?? emptyPerson(id, nameOf.get(id) ?? "…")
      const games = num(r["teammates.games"]) ?? 0
      const wins = num(r["teammates.wins"]) ?? 0
      if (r["teammates.relation"] === "teammate") {
        p.mate_games = games
        p.mate_wins = wins
      } else {
        p.foe_games = games
        p.foe_wins = wins
      }
      const last = r["teammates.last_played"] as string | null
      if (last && (!p.last_played || last > p.last_played)) p.last_played = last
      byId.set(id, p)
    }
    const list = [...byId.values()]
    for (const p of list) {
      p.games = p.mate_games + p.foe_games
      p.wins = p.mate_wins + p.foe_wins
      p.mate_winrate = winrateOf(p.mate_wins, p.mate_games)
      p.foe_winrate = winrateOf(p.foe_wins, p.foe_games)
    }
    return list.sort((a, b) => b.games - a.games)
  }, [stats.rows, names.rows])

  const count: Record<Scope, number> = {
    all: people.length,
    teammate: people.filter((p) => p.mate_games).length,
    opponent: people.filter((p) => p.foe_games).length,
    both: people.filter((p) => p.mate_games && p.foe_games).length,
  }
  const rows = useMemo(
    () =>
      people.filter((p) =>
        scope === "teammate"
          ? p.mate_games > 0
          : scope === "opponent"
            ? p.foe_games > 0
            : scope === "both"
              ? p.mate_games > 0 && p.foe_games > 0
              : true,
      ) as unknown as Record<string, unknown>[],
    [people, scope],
  )
  const highlight = useMemo(() => (picked ? { key: "puuid", value: picked } : null), [picked])

  return (
    <Panel
      title="同場過的人"
      caption={`一個人一列：同隊幾場、敵對幾場，以及各自的時候${who}的戰績。同隊次數特別高的就是固定車隊。Riot 不提供組隊欄位，這是從同場紀錄推出來的。`}
    >
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        className="mb-3 flex-wrap"
        value={scope}
        onValueChange={(v) => v && setScope(v as Scope)}
      >
        <ToggleGroupItem value="all">全部（{count.all}）</ToggleGroupItem>
        <ToggleGroupItem value="teammate">同隊過（{count.teammate}）</ToggleGroupItem>
        <ToggleGroupItem value="opponent">敵對過（{count.opponent}）</ToggleGroupItem>
        <ToggleGroupItem value="both">兩邊都遇過（{count.both}）</ToggleGroupItem>
      </ToggleGroup>
      {stats.loading || names.loading ? (
        <Skeleton className="h-[500px] w-full" />
      ) : stats.error ? (
        <div className="text-sm text-destructive">{stats.error}</div>
      ) : (
        <>
          <AgTable
            columns={columns}
            rowHeight={54}
            rows={rows}
            height={480}
            fileName={`players-${scope}`}
            emptyHint="這個條件下沒有同場過的人。"
            highlight={highlight}
            onRowClick={(row) => onPick(row as unknown as Person)}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            戰績條上的刻度線是你的整體勝率。點任一列，看和這個人同隊、敵對的每一場（含戰報）與英雄拆解，也可以直接加入追蹤。
          </p>
        </>
      )}
    </Panel>
  )
}

export function Players() {
  const { queueId, subjectFilter, isMe, account, apply, drills, timeFilter } = useFilters()
  const queue = queueId ?? MAYHEM_QUEUE_ID
  // teammates 和 participants 之間沒有 join，apply() 的全域下鑽套不上去。
  // 英雄這一種可以換成 teammates.my_champion（視角玩家那場用的英雄）；其他的列在畫面上，不默默忽略。
  const champDrill = drills.find((d) => d.member === "champions.name")
  const ignoredDrills = drills.filter((d) => d.member !== "champions.name")
  const subject: CubeFilter[] = [
    ...subjectFilter("teammates.subject_puuid"),
    ...(champDrill ? [{ member: "teammates.my_champion", operator: "equals", values: champDrill.values }] : []),
  ]
  const who = isMe ? "你" : (account?.riot_id ?? "這個帳號")
  const [picked, setPicked] = useState<Person | null>(null)
  useCrumb(10, picked ? picked.player : null, () => setPicked(null))

  // 拿來當基準線：和某人同隊的勝率要跟自己的整體比才有意義。
  // 母體要和表格一樣（固定 Mayhem、只套英雄下鑽），不能走 apply()——
  // 否則刻度線換成了某隻英雄的勝率，表格卻還是全部英雄。
  const overall = useCube({
    measures: ["participants.winrate"],
    filters: [
      ...subjectFilter("participants.puuid"),
      { member: "matches.queue_id", operator: "equals", values: [queue] },
      ...(champDrill ? [{ member: "champions.name", operator: "equals", values: champDrill.values }] : []),
    ],
    ...timeFilter("matches.played_at"),
  })
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

      {ignoredDrills.length > 0 && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
          下面的同場玩家表沒有套用「{ignoredDrills.map((d) => d.label).join("、")}」：同場關係的資料只連得到你那場用的英雄。
          上方的朋友數圖表有套用。
        </p>
      )}

      <PeopleTable queueId={queue} subject={subject} myWinrate={myWinrate} who={who} picked={picked?.puuid ?? null} onPick={setPicked} />

      <PersonDrawer
        person={picked}
        subject={subject}
        queueId={queue}
        champion={champDrill?.values[0]}
        myWinrate={myWinrate}
        onClose={() => setPicked(null)}
      />
    </div>
  )
}
