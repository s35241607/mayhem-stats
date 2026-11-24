import { useMemo, useState, type CSSProperties } from "react"
import { ChevronRight, Users } from "lucide-react"
import { useCube } from "@/hooks/useCube"
import { useFilters } from "@/lib/filters"
import { iconUrl, type CubeRow } from "@/lib/cube"
import { useUrlState, stringCodec } from "@/lib/urlState"
import { cn } from "@/lib/utils"
import { EmptyState, LoadingBlock } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import { DrillPanel } from "@/components/MatchList"
import { CountUp } from "@/components/CountUp"
import { splitRiotId } from "./shared"
import { PushToggle } from "@/components/PushToggle"

/** 首頁「戰報」：一輪一張卡。
 *
 *  「一輪」用語意層的 participant_context.game_in_session（休息超過 60 分鐘就算新的一輪，規則只在那個 cube）：
 *  依時間排好後，遇到「第 1 場」就開新的一張。期間或版本篩選切到一輪中間時，從第一筆看到的那場開始算。
 *  不在前端另寫一份 60 分鐘的界線——語意層改規則時這裡會跟著動。 */

const GAME_ID = "matches.game_id"
const PLAYED = "matches.played_at"
const IN_SESSION = "participant_context.game_in_session"
/** 一次撈幾場：約 40～60 輪，夠看一陣子；「看更早」再多撈一批 */
const BATCH = 400
/** 一開始畫幾張卡 */
const SHOW = 8

type Game = {
  gameId: string
  at: Date
  inSession: number
  win: boolean
  team: string
  champion: string
  icon: string | null
  k: number
  d: number
  a: number
  score: number | null
}

type Session = { games: Game[]; wins: number; avgScore: number | null; best: Game | null; worst: Game | null }

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))
// Cube 的時間沒有時區字尾，是 UTC（matches.played_at 的說明）
const utc = (v: unknown) => new Date(String(v).endsWith("Z") ? String(v) : `${v}Z`)

function toGame(r: CubeRow): Game {
  return {
    gameId: String(r[GAME_ID]),
    at: utc(r[PLAYED]),
    inSession: Number(r[IN_SESSION]) || 1,
    win: Number(r["participants.wins"]) > 0,
    team: String(r["participants.team_side"]),
    champion: String(r["champions.name"] ?? "—"),
    icon: (r["champions.icon_path"] as string) ?? null,
    k: num(r["participants.avg_kills"]) ?? 0,
    d: num(r["participants.avg_deaths"]) ?? 0,
    a: num(r["participants.avg_assists"]) ?? 0,
    score: num(r["contribution.work"]),
  }
}

/** 由舊到新掃：「第 1 場」或場序沒有往上加（期間從一輪中間切進來）就開新的一輪 */
function groupSessions(games: Game[]): Session[] {
  const asc = [...games].sort((x, y) => x.at.getTime() - y.at.getTime())
  const groups: Game[][] = []
  for (const g of asc) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (!prev || g.inSession === 1 || g.inSession <= prev.inSession) groups.push([g])
    else last.push(g)
  }
  return groups.reverse().map((list) => {
    const scored = list.filter((g) => g.score !== null)
    const byScore = [...scored].sort((x, y) => y.score! - x.score!)
    return {
      games: list,
      wins: list.filter((g) => g.win).length,
      avgScore: scored.length ? scored.reduce((s, g) => s + g.score!, 0) / scored.length : null,
      best: byScore[0] ?? null,
      // 只有一場的輪不另標「最慘」
      worst: byScore.length > 1 ? byScore[byScore.length - 1] : null,
    }
  })
}

const WEEK = "日一二三四五六"
function dayPart(h: number) {
  if (h < 6) return "凌晨"
  if (h < 12) return "早上"
  if (h < 18) return "下午"
  return "晚上"
}
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
function sessionLabel(s: Session) {
  const first = s.games[0].at
  return `${first.getMonth() + 1}/${first.getDate()}（${WEEK[first.getDay()]}）${dayPart(first.getHours())}`
}

export function Feed() {
  const { apply, matchParams, players, account } = useFilters()
  const [batches, setBatches] = useState(1)
  const [shown, setShown] = useState(SHOW)
  // 點開的那一輪（第一場的 game_id），記在網址：上一頁就是關掉
  const [open, setOpen] = useUrlState<string>("s", "", stringCodec, "push")

  const query = useMemo(
    () =>
      apply({
        dimensions: [GAME_ID, PLAYED, IN_SESSION, "participants.team_side", "champions.name", "champions.icon_path"],
        // 勝負與隊伍：participants.win／team_id 不公開，用每場 0/1 的 wins 與藍紅隊 team_side
        measures: ["participants.wins", "participants.avg_kills", "participants.avg_deaths", "participants.avg_assists", "contribution.work"],
        order: { [PLAYED]: "desc" },
        limit: BATCH * batches,
      }),
    [apply, batches],
  )
  const { rows, loading, refreshing, error } = useCube(query)
  const games = useMemo(() => rows.map(toGame), [rows])
  const sessions = useMemo(() => groupSessions(games), [games])
  // 撈滿一批時，最舊的那一輪可能被切掉一半：不畫它，按「看更早」再撈
  const full = rows.length >= BATCH * batches
  const complete = full ? sessions.slice(0, -1) : sessions
  const visible = complete.slice(0, shown)

  // 一起打的朋友：這幾輪裡，和我同隊的追蹤對象（不鎖帳號，只套模式／期間／版本）
  const crew = useMemo(() => players.filter((p) => p.crew && p.puuid !== account?.puuid), [players, account])
  const visibleIds = useMemo(() => visible.flatMap((s) => s.games.map((g) => g.gameId)), [visible])
  const mates = useCube(
    crew.length && visibleIds.length
      ? apply(
          {
            dimensions: [GAME_ID, "participants.puuid", "participants.team_side"],
            measures: ["participants.games"],
            filters: [
              { member: "participants.puuid", operator: "equals", values: crew.map((p) => p.puuid) },
              { member: GAME_ID, operator: "equals", values: visibleIds },
            ],
            limit: 5000,
          },
          "all",
        )
      : null,
  )
  const matesBySession = useMemo(() => {
    const teamOf = new Map(games.map((g) => [g.gameId, g.team]))
    const out = new Map<string, { name: string; games: number }[]>()
    for (const s of visible) {
      const ids = new Set(s.games.map((g) => g.gameId))
      const count = new Map<string, number>()
      for (const r of mates.rows) {
        const id = String(r[GAME_ID])
        if (!ids.has(id) || String(r["participants.team_side"]) !== teamOf.get(id)) continue
        const p = String(r["participants.puuid"])
        count.set(p, (count.get(p) ?? 0) + 1)
      }
      out.set(
        s.games[0].gameId,
        [...count.entries()]
          .sort((x, y) => y[1] - x[1])
          .map(([puuid, n]) => {
            const player = players.find((p) => p.puuid === puuid)
            return { name: splitRiotId(player?.riot_id ?? null, puuid).name, games: n }
          }),
      )
    }
    return out
  }, [visible, mates.rows, games, players])

  // 結論先講：最近 7 天（以最新一場往回算）幾輪、幾勝幾敗
  const recap = useMemo(() => {
    if (!games.length) return null
    const latest = Math.max(...games.map((g) => g.at.getTime()))
    const week = complete.filter((s) => latest - s.games[0].at.getTime() < 7 * 86400_000)
    const n = week.reduce((a, s) => a + s.games.length, 0)
    const w = week.reduce((a, s) => a + s.wins, 0)
    return n ? { sessions: week.length, games: n, wins: w } : null
  }, [games, complete])

  const openSession = complete.find((s) => s.games[0].gameId === open)

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (loading) return <LoadingBlock height={520} label="整理每一輪的戰績…" />
  if (!complete.length) return <EmptyState>這個條件下還沒有對局。打幾場、等採集完，這裡會一輪一張卡列出來。</EmptyState>

  return (
    <div className="mx-auto max-w-3xl space-y-3" aria-busy={refreshing || undefined}>
      {recap && (
        <p className="rise text-sm text-muted-foreground">
          最近 7 天打了 <b className="text-foreground">{recap.sessions}</b> 輪、<b className="text-foreground">{recap.games}</b> 場，
          <span className="text-win"> {recap.wins} 勝</span>
          <span className="text-loss"> {recap.games - recap.wins} 敗</span>
          （勝率 {Math.round((recap.wins / recap.games) * 100)}%）
        </p>
      )}

      {visible.map((s, i) => (
        <SessionCard
          key={s.games[0].gameId}
          session={s}
          index={i}
          latest={i === 0}
          mates={matesBySession.get(s.games[0].gameId) ?? []}
          onOpen={() => setOpen(s.games[0].gameId)}
        />
      ))}

      <div className="flex justify-center pt-1">
        {shown < complete.length ? (
          <Button variant="outline" className="max-sm:h-11" onClick={() => setShown(shown + SHOW)}>
            再看 {Math.min(SHOW, complete.length - shown)} 輪
          </Button>
        ) : full ? (
          <Button variant="outline" className="max-sm:h-11" onClick={() => setBatches(batches + 1)} disabled={refreshing}>
            看更早的
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">已經是這個條件下的全部 {complete.length} 輪</span>
        )}
      </div>

      {/* 新對局通知：打完一輪回來看戰報的人最需要（手機上「更多」裡也有） */}
      <div className="pt-2 max-md:hidden">
        <PushToggle />
      </div>

      {openSession && (
        <DrillPanel
          title={`${sessionLabel(openSession)}這一輪`}
          params={{ ...matchParams(), game_ids: openSession.games.map((g) => g.gameId).join(",") }}
          puuid={account?.puuid}
          onClose={() => setOpen("")}
        />
      )}
    </div>
  )
}

function GameLine({ label, game }: { label: string; game: Game }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {game.icon ? (
        <img loading="lazy" decoding="async" src={iconUrl(game.icon)} alt="" className="size-8 shrink-0 rounded-md bg-icon-tile" />
      ) : (
        <span className="size-8 shrink-0 rounded-md bg-icon-tile" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className={cn("font-semibold", game.win ? "text-win" : "text-loss")}>{game.win ? "勝" : "敗"}</span> {game.champion}
        <span className="ml-1.5 tabular-nums text-muted-foreground">
          {game.k}/{game.d}/{game.a}
        </span>
      </span>
      {game.score !== null && <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">{Math.round(game.score)}</span>}
    </div>
  )
}

function SessionCard({
  session: s,
  index,
  latest,
  mates,
  onOpen,
}: {
  session: Session
  index: number
  latest: boolean
  mates: { name: string; games: number }[]
  onOpen: () => void
}) {
  const n = s.games.length
  const first = s.games[0].at
  const last = s.games[n - 1].at
  const rate = Math.round((s.wins / n) * 100)
  return (
    <section
      className="rise glass-card space-y-3 border px-4 py-3.5 sm:rounded-xl"
      style={{ "--stagger": `${Math.min(index, 6) * 45}ms` } as CSSProperties}
    >
      <button onClick={onOpen} className="pressable flex w-full items-start gap-3 text-left" aria-label={`${sessionLabel(s)}這一輪的每一場`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-[15px] font-bold">{sessionLabel(s)}</h2>
            {latest && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">最新</span>}
            <span className="text-xs tabular-nums text-muted-foreground">
              {hm(first)}–{hm(last)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-sm">
            <span className="tabular-nums">{n} 場</span>
            <span className="text-win tabular-nums">{s.wins} 勝</span>
            <span className="text-loss tabular-nums">{n - s.wins} 敗</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-mono text-2xl font-semibold leading-none tabular-nums", rate >= 50 ? "text-win" : "text-loss")}>
            <CountUp text={`${rate}%`} />
          </div>
          {s.avgScore !== null && <div className="mt-1 text-[11px] text-muted-foreground">平均貢獻 {Math.round(s.avgScore)}</div>}
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>

      {/* 勝敗一格一場，由舊到新 */}
      <div className="flex gap-0.5" aria-hidden>
        {s.games.map((g) => (
          <span key={g.gameId} className={cn("h-1.5 flex-1 rounded-full", g.win ? "bg-win" : "bg-loss")} />
        ))}
      </div>

      {(s.best || s.worst) && (
        <div className="space-y-1.5">
          {s.best && <GameLine label="最佳" game={s.best} />}
          {s.worst && <GameLine label="最慘" game={s.worst} />}
        </div>
      )}

      {mates.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            和 {mates.map((m) => (m.games === n ? m.name : `${m.name}（${m.games} 場）`)).join("、")} 一起
          </span>
        </p>
      )}
    </section>
  )
}
