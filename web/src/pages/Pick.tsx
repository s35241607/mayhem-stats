import { useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { EmptyState, Panel, QueryError } from "@/components/primitives"
import { RecordCell, num0, numOf } from "@/components/cells"
import { CountUp } from "@/components/CountUp"
import { ContribScore } from "@/components/Contribution"
import { useCube } from "@/hooks/useCube"
import { WORK, WORK_GAP } from "@/hooks/useContribution"
import { iconUrl, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { stringCodec, useUrlState } from "@/lib/urlState"
import { cn } from "@/lib/utils"
import { NO_LIMIT, round1, round2, splitRiotId } from "./shared"

// 選角助手：大亂鬥選角那 30 秒內在手機上看「這隻我打得怎樣、大家打得怎樣、拿什麼增幅、誰會玩」。
// 數字全部來自語意層現有的成員（participants、contribution、augments、items），不另寫 SQL。

const G = "participants.games"
const W = "participants.wins"
const WR = "participants.winrate"
const NAME = "champions.name"

/** 增幅清單只列選到至少這麼多場的：一隻英雄的某個增幅常常只有一兩場，那種勝率是 0% 或 100%，看了只會誤導 */
const AUG_MIN = 10

/** 增幅選取／終場裝備：勝敗之外的基本指標 */
const LIST_MEASURES = [G, W, WR]
const STAT_MEASURES = [G, W, "participants.losses", WR, "participants.kda", "participants.avg_kills", "participants.avg_deaths", "participants.avg_assists", WORK]

/** 沒有增幅的參賽者（left join 出來名稱空白的那列）不算一個增幅，理由見增幅頁 */
const HAS_AUGMENT: CubeFilter = { member: "augments.name", operator: "set", values: [] }
/** 第 7 格是飾品，每場都一樣，和英雄抽屜一樣排除 */
const NO_TRINKET: CubeFilter = { member: "items.slot", operator: "lt", values: ["6"] }

const onlyChamp = (name: string): CubeFilter => ({ member: NAME, operator: "equals", values: [name] })

/** Wilson 95% 區間（勝率，0～100）。樣本小時比常態近似保守，不會跑出 0～100 以外 */
function wilson(wins: number, games: number, z = 1.96): [number, number] | null {
  if (!games) return null
  const p = wins / games
  const z2 = z * z
  const denom = 1 + z2 / games
  const center = (p + z2 / (2 * games)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom
  return [100 * Math.max(0, center - half), 100 * Math.min(1, center + half)]
}

type Verdict = "high" | "low" | "noise"
const VERDICT_LABEL: Record<Verdict, string> = { high: "看得出高", low: "看得出低", noise: "還在誤差內" }
const VERDICT_CLASS: Record<Verdict, string> = {
  high: "border-win/40 bg-win/10 text-win",
  low: "border-loss/40 bg-loss/10 text-loss",
  noise: "border-border text-muted-foreground",
}

function verdictOf(interval: [number, number] | null, baseline: number | null): Verdict {
  if (!interval || baseline === null) return "noise"
  if (interval[0] > baseline) return "high"
  if (interval[1] < baseline) return "low"
  return "noise"
}

const stagger = (i: number) => ({ "--stagger": `${Math.min(i, 10) * 35}ms` }) as CSSProperties

export function Pick() {
  const { apply, account, isMe, players } = useFilters()
  // 選了哪隻放網址、用 push：上一頁就是回到挑英雄
  const [pick, setPick] = useUrlState<string | null>("c", null, stringCodec, "push")
  const [search, setSearch] = useState("")
  const [browsing, setBrowsing] = useState(false)
  useCrumb(10, pick, () => setPick(null))

  // 英雄清單：資料裡（全域條件下、所有人）出現過的英雄，目前帳號最常玩的排前面
  const pool = useCube(
    apply({ measures: [G], dimensions: [NAME, "champions.icon_path", "champions.alias"], limit: NO_LIMIT }, "all"),
  )
  const mineByChamp = useCube(apply({ measures: [G], dimensions: [NAME], limit: NO_LIMIT }))
  const champs = useMemo(() => {
    const mine = new Map(mineByChamp.rows.map((r) => [String(r[NAME]), num0(r, G)]))
    return pool.rows
      .map((r) => ({
        name: String(r[NAME] ?? ""),
        alias: String(r["champions.alias"] ?? ""),
        icon: iconUrl(r["champions.icon_path"] as string),
        mine: mine.get(String(r[NAME])) ?? 0,
        all: num0(r, G),
      }))
      .filter((c) => c.name)
      .sort((a, b) => b.mine - a.mine || b.all - a.all || a.name.localeCompare(b.name, "zh-Hant"))
  }, [pool.rows, mineByChamp.rows])

  const term = search.trim().toLowerCase()
  const shown = term
    ? champs.filter((c) => c.name.toLowerCase().includes(term) || c.alias.toLowerCase().includes(term))
    : champs
  const picked = pick ? champs.find((c) => c.name === pick) : undefined
  const choose = (name: string) => {
    setPick(name)
    setSearch("")
    setBrowsing(false)
  }
  const showGrid = !pick || browsing || !!term

  return (
    <div className="space-y-4">
      <Panel
        title="選角助手"
        caption={pick ? undefined : "搜尋或點一隻英雄，看你和大家用它的戰績、增幅與出裝"}
        hint={"英雄清單是目前條件（模式、版本、期間）下資料裡出現過的英雄，你玩過最多的排前面。\n選好之後按上一頁回到這裡。"}
      >
        <div className="space-y-3">
          {pick ? (
            <div className="flex items-center gap-3">
              {picked?.icon ? (
                <img src={picked.icon} alt="" decoding="async" className="size-12 shrink-0 rounded-lg bg-icon-tile" />
              ) : (
                <span className="size-12 shrink-0 rounded-lg bg-icon-tile" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold">{pick}</div>
                <div className="text-xs text-muted-foreground">
                  {picked ? `你 ${picked.mine} 場 · 所有人 ${picked.all} 場` : pool.loading ? "載入中…" : "這個條件下沒有人用過"}
                </div>
              </div>
              <Button variant="outline" className="h-11 shrink-0" onClick={() => setBrowsing(!browsing)}>
                {browsing ? "收起" : "換一隻"}
              </Button>
            </div>
          ) : null}
          {showGrid && (
            <ChampionGrid
              loading={pool.loading}
              error={pool.error}
              search={search}
              onSearch={setSearch}
              champs={shown}
              total={champs.length}
              picked={pick}
              onPick={choose}
            />
          )}
        </div>
      </Panel>

      {pick ? (
        <ChampionReport key={pick} name={pick} apply={apply} accountLabel={isMe ? "你" : (splitRiotId(account?.riot_id ?? null, account?.puuid ?? "").name || "目前帳號")} players={players} />
      ) : null}
    </div>
  )
}

function ChampionGrid({
  loading,
  error,
  search,
  onSearch,
  champs,
  total,
  picked,
  onPick,
}: {
  loading: boolean
  error: string | null
  search: string
  onSearch: (value: string) => void
  champs: { name: string; icon: string | undefined; mine: number }[]
  total: number
  picked: string | null
  onPick: (name: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          // Enter 直接選第一個符合的（桌機上打兩個字就選好）
          onKeyDown={(e) => {
            if (e.key === "Enter" && champs[0]) onPick(champs[0].name)
          }}
          placeholder={`搜尋英雄（${total} 隻）`}
          aria-label="搜尋英雄"
          className="h-11 pr-10 pl-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            aria-label="清除搜尋"
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-[264px] w-full" />
      ) : error ? (
        <QueryError error={error} />
      ) : !champs.length ? (
        <EmptyState>{total ? "沒有符合的英雄。" : "這個條件下還沒有對局。"}</EmptyState>
      ) : (
        <div className="reveal max-h-[264px] overflow-y-auto overscroll-contain pr-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5">
            {champs.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.name)}
                aria-pressed={picked === c.name}
                className={cn(
                  "pressable flex min-h-11 min-w-0 flex-col items-center gap-0.5 rounded-md border border-transparent p-1 transition-colors hover:border-primary/40",
                  picked === c.name && "border-primary bg-primary/10",
                )}
              >
                <img loading="lazy" decoding="async" src={c.icon} alt="" className="size-10 rounded bg-icon-tile" />
                <span className="w-full truncate text-center text-[10px] leading-tight">{c.name}</span>
                <span className="text-[9px] leading-none tabular-nums text-muted-foreground">{c.mine ? `${c.mine} 場` : " "}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type Apply = (query: CubeQuery, scope?: "account" | "all") => CubeQuery

function ChampionReport({
  name,
  apply,
  accountLabel,
  players,
}: {
  name: string
  apply: Apply
  accountLabel: string
  players: { puuid: string; riot_id: string | null; crew: number; is_me: number }[]
}) {
  const filters = useMemo(() => [onlyChamp(name)], [name])
  const mine = useCube(apply({ measures: STAT_MEASURES, filters }))
  const everyone = useCube(apply({ measures: STAT_MEASURES, filters }, "all"))
  const augments = useCube(
    apply(
      {
        measures: LIST_MEASURES,
        dimensions: ["augments.name", "augments.icon_path"],
        filters: [...filters, HAS_AUGMENT],
        order: { [G]: "desc" },
        limit: NO_LIMIT,
      },
      "all",
    ),
  )
  const items = useCube(
    apply(
      {
        measures: LIST_MEASURES,
        dimensions: ["items.name", "items.icon_path"],
        filters: [...filters, NO_TRINKET],
        order: { [G]: "desc" },
        limit: NO_LIMIT,
      },
      "all",
    ),
  )
  const crew = useMemo(() => players.filter((p) => p.crew), [players])
  const crewRows = useCube(
    crew.length
      ? apply(
          {
            measures: [G, W, "participants.losses", WR, "participants.kda"],
            dimensions: ["participants.puuid"],
            filters: [...filters, { member: "participants.puuid", operator: "equals", values: crew.map((p) => p.puuid) }],
            order: { [G]: "desc" },
            limit: NO_LIMIT,
          },
          "all",
        )
      : null,
  )

  const allRow = everyone.rows[0]
  const allGames = allRow ? num0(allRow, G) : 0
  const baseline = allRow ? numOf(allRow, WR) : null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`${accountLabel}用這隻`} caption="目前帳號，套用標題列的條件" index={0} refreshing={mine.refreshing}>
        <StatBlock
          state={mine}
          baseline={baseline}
          baselineLabel="所有人用這隻的勝率"
          empty={`${accountLabel}在這個條件下還沒用這隻打過。`}
        />
      </Panel>
      <Panel
        title="大家用這隻"
        caption="資料庫裡所有玩家（一場十人都算）"
        hint="包含你、追蹤對象和所有同場的路人。所有人的整體勝率接近 50%，所以這裡的勝率就是這隻英雄本身的強弱（在我們看得到的對局裡）。"
        index={1}
        refreshing={everyone.refreshing}
      >
        <StatBlock state={everyone} empty="這個條件下沒有人用過這隻。" />
      </Panel>
      <Panel
        title="常勝的增幅"
        caption={`所有人用這隻時選的增幅，至少 ${AUG_MIN} 場才列`}
        hint={
          "比較基準是這隻英雄的整體勝率（所有人）。\n" +
          "「看得出高／低」：這個增幅勝率的 95% 信賴區間（Wilson）整段在基準之上／之下。\n" +
          "「還在誤差內」：區間跨過基準，高低可能只是運氣。\n" +
          "這個專案之前的分析發現：增幅的強弱大多是雜訊，同時看很多個增幅時偶爾會有一兩個碰巧落在區間外。拿到喜歡的就選，不必硬追勝率。"
        }
        index={2}
        refreshing={augments.refreshing || everyone.refreshing}
      >
        <AugmentList state={augments} baseline={baseline} champGames={allGames} />
      </Panel>
      <Panel
        title="常見出裝"
        caption="所有人用這隻時終場身上的裝備（不含飾品）"
        hint="依出現場次排序。出現率＝帶著這件收場的場次 ÷ 這隻英雄的總場次。勝率和這隻英雄的整體勝率比，只是相關、不是因果：終場裝備同時受對局長短與經濟影響。"
        index={3}
        refreshing={items.refreshing || everyone.refreshing}
      >
        <ItemList state={items} baseline={baseline} champGames={allGames} />
      </Panel>
      <Panel
        title="朋友誰玩得好"
        caption="你和追蹤對象用這隻的戰績，依場次排序"
        index={4}
        className="lg:col-span-2"
        refreshing={crewRows.refreshing}
      >
        <CrewList state={crewRows} players={crew} hasCrew={crew.length > 0} baseline={baseline} />
      </Panel>
    </div>
  )
}

type QueryState = { rows: CubeRow[]; loading: boolean; error: string | null }

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums leading-tight">{children}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">{sub}</div>}
    </div>
  )
}

/** 場次／勝率／KDA／貢獻四格，加一條勝敗比例條 */
function StatBlock({
  state,
  baseline,
  baselineLabel,
  empty,
}: {
  state: QueryState
  baseline?: number | null
  baselineLabel?: string
  empty: string
}) {
  if (state.loading) return <Skeleton className="h-[112px] w-full" />
  if (state.error) return <QueryError error={state.error} />
  const r = state.rows[0]
  const games = r ? num0(r, G) : 0
  if (!r || !games) return <EmptyState>{empty}</EmptyState>
  const wr = numOf(r, WR)
  const kda = numOf(r, "participants.kda")
  const work = numOf(r, WORK)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-4">
        <Stat label="場次">
          <CountUp text={String(games)} />
        </Stat>
        <Stat label="勝率">
          <span className={cn(wr === null ? "text-muted-foreground" : wr >= 50 ? "text-win" : "text-loss")}>
            <CountUp text={wr === null ? "—" : `${round1(wr)}%`} />
          </span>
        </Stat>
        <Stat
          label="KDA"
          sub={`${round1(num0(r, "participants.avg_kills"))}/${round1(num0(r, "participants.avg_deaths"))}/${round1(num0(r, "participants.avg_assists"))}`}
        >
          {kda === null ? "—" : <CountUp text={round2(kda)} />}
        </Stat>
        <Stat label="貢獻">
          <span data-tip="本場貢獻的平均（0～100，50＝整體基準）">
            <ContribScore dev={work === null ? null : work - 50} gap={WORK_GAP} />
          </span>
        </Stat>
      </div>
      <RecordCell
        winrate={wr}
        wins={num0(r, W)}
        losses={num0(r, "participants.losses")}
        baseline={baseline}
        baselineLabel={baselineLabel}
      />
    </div>
  )
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5" data-slot="skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

function WinratePill({ wr, baseline }: { wr: number | null; baseline: number | null }) {
  return (
    <span
      className={cn(
        "w-[52px] shrink-0 rounded border px-1 text-right text-[11px] tabular-nums",
        wr === null || baseline === null
          ? "border-border text-muted-foreground"
          : wr >= baseline
            ? "border-win/30 bg-win/10 text-win"
            : "border-loss/30 bg-loss/10 text-loss",
      )}
    >
      {wr === null ? "—" : `${round1(wr)}%`}
    </span>
  )
}

function AugmentList({ state, baseline, champGames }: { state: QueryState; baseline: number | null; champGames: number }) {
  const rows = useMemo(() => state.rows.filter((r) => num0(r, G) >= AUG_MIN), [state.rows])
  if (state.loading) return <ListSkeleton rows={6} />
  if (state.error) return <QueryError error={state.error} />
  const hidden = state.rows.length - rows.length
  return (
    <div className="space-y-2">
      {!rows.length ? (
        <EmptyState>還沒有哪個增幅在這隻英雄上被選到 {AUG_MIN} 場。</EmptyState>
      ) : (
        <div className="max-h-[320px] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
          {rows.map((r, i) => {
            const games = num0(r, G)
            const wins = num0(r, W)
            const wr = numOf(r, WR)
            const interval = wilson(wins, games)
            const verdict = verdictOf(interval, baseline)
            const label = String(r["augments.name"] ?? "").trim() || "（無名稱增幅）"
            return (
              <div key={label} style={stagger(i)} className="slide-in flex min-h-11 items-center gap-2 px-1">
                <img loading="lazy" decoding="async" src={iconUrl(r["augments.icon_path"] as string)} alt="" className="size-7 shrink-0 rounded bg-icon-tile" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{label}</span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                    {games} 場{champGames ? ` · 選取 ${Math.round((100 * games) / champGames)}%` : ""}
                  </span>
                </span>
                <span
                  className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[11px]", VERDICT_CLASS[verdict])}
                  data-tip={
                    interval
                      ? `95% 區間 ${round1(interval[0])}%～${round1(interval[1])}%\n這隻英雄整體 ${baseline === null ? "—" : `${round1(baseline)}%`}`
                      : undefined
                  }
                >
                  {VERDICT_LABEL[verdict]}
                </span>
                <span
                  className={cn(
                    "w-[46px] shrink-0 text-right text-[13px] font-semibold tabular-nums",
                    verdict === "high" ? "text-win" : verdict === "low" ? "text-loss" : "text-foreground",
                  )}
                >
                  {wr === null ? "—" : `${round1(wr)}%`}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {hidden > 0 && <p className="text-[11px] text-muted-foreground">另有 {hidden} 個增幅不到 {AUG_MIN} 場，沒有列出</p>}
    </div>
  )
}

function ItemList({ state, baseline, champGames }: { state: QueryState; baseline: number | null; champGames: number }) {
  if (state.loading) return <ListSkeleton rows={6} />
  if (state.error) return <QueryError error={state.error} />
  if (!state.rows.length) return <EmptyState>這個條件下沒有資料。</EmptyState>
  return (
    <div className="max-h-[320px] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
      {state.rows.map((r, i) => {
        const games = num0(r, G)
        const label = String(r["items.name"] ?? "—")
        return (
          <div key={label} style={stagger(i)} className="slide-in flex min-h-11 items-center gap-2 px-1">
            <img loading="lazy" decoding="async" src={iconUrl(r["items.icon_path"] as string)} alt="" className="size-7 shrink-0 rounded bg-icon-tile" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{label}</span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">
                {games} 場{champGames ? ` · 出現 ${Math.round((100 * games) / champGames)}%` : ""}
              </span>
            </span>
            <WinratePill wr={numOf(r, WR)} baseline={baseline} />
          </div>
        )
      })}
    </div>
  )
}

function CrewList({
  state,
  players,
  hasCrew,
  baseline,
}: {
  state: QueryState
  players: { puuid: string; riot_id: string | null; is_me: number }[]
  hasCrew: boolean
  baseline: number | null
}) {
  if (!hasCrew) return <EmptyState>還沒有追蹤任何玩家。到「追蹤對象」頁加人之後，這裡會列出誰用過這隻。</EmptyState>
  if (state.loading) return <ListSkeleton rows={3} />
  if (state.error) return <QueryError error={state.error} />
  if (!state.rows.length) return <EmptyState>你和追蹤對象在這個條件下都還沒用過這隻。</EmptyState>
  const byPuuid = new Map(players.map((p) => [p.puuid, p]))
  return (
    <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
      {state.rows.map((r, i) => {
        const puuid = String(r["participants.puuid"])
        const player = byPuuid.get(puuid)
        const { name, tag } = splitRiotId(player?.riot_id ?? null, puuid)
        const kda = numOf(r, "participants.kda")
        return (
          <div key={puuid} style={stagger(i)} className="slide-in flex min-h-11 items-center gap-3 px-1">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {name}
                <span className="text-muted-foreground">{tag}</span>
                {player?.is_me ? <span className="ml-1 text-[11px] text-primary">（你）</span> : null}
              </span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">
                {num0(r, G)} 場 · KDA {kda === null ? "—" : round2(kda)}
              </span>
            </span>
            <div className="w-[min(46%,180px)] shrink-0">
              <RecordCell
                winrate={numOf(r, WR)}
                wins={num0(r, W)}
                losses={num0(r, "participants.losses")}
                baseline={baseline}
                baselineLabel="所有人用這隻的勝率"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

