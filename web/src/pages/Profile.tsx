import { useMemo, useState, type CSSProperties } from "react"
import { ArrowLeftRight, ChevronRight, Shield, Swords } from "lucide-react"
import { RecordCell } from "@/components/cells"
import { CountUp } from "@/components/CountUp"
import { DrillPanel } from "@/components/MatchList"
import { EmptyState, Kpi, LoadingBlock, Panel, QueryError } from "@/components/primitives"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { WORK, WORK_GAMES } from "@/hooks/useContribution"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num, type CubeFilter, type CubeRow } from "@/lib/cube"
import { useFilters, type Player } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { useNavigate } from "@/lib/nav"
import { stringCodec, useUrlState } from "@/lib/urlState"
import { cn } from "@/lib/utils"
import { WEEKDAYS, splitRiotId } from "./shared"

/** 個人頁：看一位玩家的摘要，不切換整站的帳號。
 *
 *  網址：/profile?p=<puuid 前 8 碼>，認人的方式和全站的 acct 一樣（filters.tsx），完整 puuid 不放進會被貼出去的連結。
 *  全站的模式／期間／版本照樣套用（同一組條件換成這個人）；全域下鑽不套——下面的「每一場」列表走 /api/matches，
 *  那邊只認帳號、模式、期間、版本，套了下鑽會變成「卡片寫 12 場、點進去 30 場」。
 *  名稱遮罩在後端（/api/players 與 Cube 回應都經過 mask_name），這裡顯示的就是遮罩後的名字。 */

/** 拿手英雄列幾隻 */
const TOP_CHAMPS = 6
/** 最近幾輪列幾輪 */
const RECENT_SESSIONS = 6
/** 往回抓幾場來切輪次。抓滿了的話最舊那一輪可能被切掉一半，那一輪就不列 */
const SESSION_GAMES = 300

const G = "participants.games"
const W = "participants.wins"

const n0 = (r: CubeRow | undefined, k: string) => (r ? (num(r[k]) ?? 0) : 0)
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`)
const winrateOf = (wins: number, games: number) => (games ? (wins / games) * 100 : null)

/** 名字＋tag。遮罩已在後端做完 */
function NameLine({ player }: { player: Player }) {
  const { name, tag } = splitRiotId(player.riot_id, player.puuid)
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span className="min-w-0 truncate text-xl font-semibold">{name}</span>
      {tag && <span className="shrink-0 text-sm text-muted-foreground">{tag}</span>}
      {!!player.is_me && (
        <Badge variant="outline" className="shrink-0 border-primary/40 px-1.5 py-0 text-[10px] text-primary">
          我
        </Badge>
      )}
      {!player.is_me && !!player.tracked && (
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
          追蹤中
        </Badge>
      )}
    </span>
  )
}

type SessionGame = { gameId: string; time: string; win: boolean; score: number | null }
type Session = { queue: string; games: SessionGame[] }

/** 逐場（由新到舊）切成「同一輪連打」。輪次的規則只在語意層（participant_context：休息超過 60 分鐘開新的一輪），
 *  這裡只照它的「這輪第幾場」切：遇到第 1 場、或場序沒有往上加（中間被期間／版本篩掉）就是新的一輪。
 *  輪次是依模式分開算的，所以「全部模式」時每個模式各自切。 */
function sessionsOf(rows: CubeRow[]): Session[] {
  const asc = [...rows].reverse()
  const open = new Map<string, { session: Session; last: number }>()
  const done: Session[] = []
  for (const r of asc) {
    const queue = String(r["matches.queue_id"])
    const nth = Number(r["participant_context.game_in_session"])
    const game: SessionGame = {
      gameId: String(r["matches.game_id"]),
      time: String(r["matches.played_at"]),
      win: n0(r, W) > 0,
      score: num(r[WORK]),
    }
    const cur = open.get(queue)
    if (!cur || nth === 1 || !(nth > cur.last)) {
      const session = { queue, games: [game] }
      done.push(session)
      open.set(queue, { session, last: nth })
    } else {
      cur.session.games.push(game)
      cur.last = nth
    }
  }
  return done.sort((a, b) => b.games[0].time.localeCompare(a.games[0].time))
}

/** Cube 回的 played_at 是 UTC（「2026-11-23T13:05:00.000」，沒有時區記號；查詢的 timezone 只套在有粒度的時間維度上），
 *  照 UTC 解析再用本機時間顯示：11/23（週一）與 21:05 */
const localOf = (time: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : `${time}Z`)
const dayOf = (time: string) => {
  const d = localOf(time)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}
const clockOf = (time: string) => {
  const d = localOf(time)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

type Drill = { title: string; params: Record<string, string>; puuid: string }

export function Profile() {
  const { players, account, isMe, queueId, activeVersions, timeFilter, matchParams, drills, setAccount } = useFilters()
  const go = useNavigate()
  const [param, setParam] = useUrlState<string | null>("p", null, stringCodec)
  const [drill, setDrill] = useState<Drill | null>(null)
  const player = useMemo(
    () => (param ? (players.find((p) => p.puuid.startsWith(param)) ?? null) : null),
    [players, param],
  )
  useCrumb(10, player ? splitRiotId(player.riot_id, player.puuid).name : null, () => setParam(null))

  // 和 matchParams() 同一組條件（模式、版本、期間），只是人換掉：數字和點進去的每一場才對得上
  const scope = (member: string, puuid: string): CubeFilter[] => [
    { member, operator: "equals", values: [puuid] },
    ...(queueId ? [{ member: "matches.queue_id", operator: "equals", values: [queueId] }] : []),
    ...(activeVersions.length ? [{ member: "matches.patch", operator: "equals", values: activeVersions }] : []),
  ]
  const time = timeFilter("matches.played_at")
  const target = player?.puuid ?? null
  const self = account && target && account.puuid !== target ? account : null

  const summary = useCube(
    target ? { measures: [G, W, "participants.losses", "participants.winrate", WORK, WORK_GAMES], filters: scope("participants.puuid", target), ...time } : null,
  )
  const champs = useCube(
    target
      ? {
          measures: [G, W, "participants.winrate"],
          dimensions: ["champions.name", "champions.icon_path"],
          filters: scope("participants.puuid", target),
          ...time,
          order: { [G]: "desc", [W]: "desc", "champions.name": "asc" },
          limit: TOP_CHAMPS,
        }
      : null,
  )
  const games = useCube(
    target
      ? {
          measures: [W, WORK],
          dimensions: ["matches.game_id", "matches.queue_id", "matches.played_at", "participant_context.game_in_session"],
          filters: scope("participants.puuid", target),
          ...time,
          order: { "matches.played_at": "desc" },
          limit: SESSION_GAMES,
        }
      : null,
  )
  // 和目前帳號的對戰：teammates 以目前帳號為視角（subject），對方是這個人；勝場是目前帳號的
  const h2h = useCube(
    self && target
      ? {
          measures: ["teammates.games", "teammates.wins"],
          dimensions: ["teammates.relation"],
          filters: [...scope("teammates.subject_puuid", self.puuid), { member: "teammates.puuid", operator: "equals", values: [target] }],
          ...time,
        }
      : null,
  )
  const selfOverall = useCube(self ? { measures: ["participants.winrate"], filters: scope("participants.puuid", self.puuid), ...time } : null)

  const sessions = useMemo(() => {
    const list = sessionsOf(games.rows)
    // 抓滿了：最舊的那一輪可能只抓到後半段，不列
    if (games.rows.length >= SESSION_GAMES) list.pop()
    return list.slice(0, RECENT_SESSIONS)
  }, [games.rows])

  if (!param) {
    return (
      <EmptyState>
        還沒選要看誰。到「好友比較」點開一位玩家，或在「隊友」頁點一個人後按「看個人頁」，就會來到這裡。
        <br />
        個人頁只看那個人，不會切換整站正在看的帳號。
      </EmptyState>
    )
  }
  if (!player) return <EmptyState>找不到這位玩家（網址裡的代號是 {param}）。只有出現在已收錄對局裡的人才查得到。</EmptyState>

  const s = summary.rows[0]
  const total = n0(s, G)
  const wins = n0(s, W)
  const wr = num(s?.["participants.winrate"])
  const score = num(s?.[WORK])
  const scored = n0(s, WORK_GAMES)
  const who = isMe ? "你" : splitRiotId(account?.riot_id ?? null, account?.puuid ?? "").name
  const name = splitRiotId(player.riot_id, player.puuid).name
  const base = { ...matchParams(), puuid: player.puuid }

  const switchAccount = () => {
    setAccount(player)
    go("dashboard")
  }

  return (
    <div className="space-y-4">
      <div className="rise">
        <Card className="relative gap-3 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <NameLine player={player} />
              <p className="mt-0.5 text-xs text-muted-foreground">
                只看這個人，不會切換整站正在看的帳號。條件沿用目前的模式、期間與版本
                {drills.length ? `；全域下鑽（${drills.map((d) => d.label).join("、")}）這頁不套用` : ""}。
              </p>
            </div>
            {account?.puuid !== player.puuid && (
              <Button size="sm" variant="outline" onClick={switchAccount} className="max-sm:min-h-11 max-sm:w-full">
                <ArrowLeftRight className="size-3.5" />
                切換成看他的整站
              </Button>
            )}
          </div>
        </Card>
      </div>

      {summary.error ? (
        <QueryError error={summary.error} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="profile-kpis">
          <Kpi index={0} label="場次" value={String(total)} hint={`${wins} 勝 ${total - wins} 敗`} loading={summary.loading} refreshing={summary.refreshing} />
          <Kpi index={1} label="勝率" value={pct(wr)} tone={wr === null ? undefined : wr >= 50 ? "win" : "loss"} loading={summary.loading} refreshing={summary.refreshing} />
          <div className="max-sm:col-span-2">
            <Kpi
              index={2}
              label="平均本場貢獻"
              value={score === null ? "—" : score.toFixed(1)}
              hint={`${scored} 場有分數・50 是同定位基準`}
              loading={summary.loading}
              refreshing={summary.refreshing}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel index={1} title="拿手英雄" caption={`場次最多的 ${TOP_CHAMPS} 隻；刻度線是他的整體勝率。點一隻看那幾場。`} refreshing={champs.refreshing}>
          {champs.loading ? (
            <LoadingBlock height={TOP_CHAMPS * 52} label="載入拿手英雄…" />
          ) : champs.error ? (
            <QueryError error={champs.error} />
          ) : !champs.rows.length ? (
            <EmptyState>這個條件下沒有對局。</EmptyState>
          ) : (
            <ul className="divide-y divide-border/60" data-testid="profile-champs">
              {champs.rows.map((r, i) => {
                const champ = String(r["champions.name"] ?? "—")
                const g = n0(r, G)
                const w = n0(r, W)
                return (
                  <li key={champ} className="slide-in" style={{ "--stagger": `${Math.min(i * 35, 400)}ms` } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => setDrill({ title: `${name} 的${champ}`, params: { ...base, champion: champ }, puuid: player.puuid })}
                      className="pressable flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <img loading="lazy" decoding="async" src={iconUrl(r["champions.icon_path"] as string)} alt="" className="size-8 shrink-0 rounded bg-icon-tile" />
                      <span className="w-20 min-w-0 shrink-0 sm:w-28">
                        <span className="block truncate text-sm font-medium">{champ}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">{g} 場</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <RecordCell winrate={num(r["participants.winrate"])} wins={w} losses={g - w} baseline={wr} baselineLabel="他的整體勝率" />
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel
          index={2}
          title="最近幾輪"
          caption="同一輪連打：前一場結束後休息超過 60 分鐘就算新的一輪。點一輪看那幾場。"
          hint={"輪次的切法和「連敗與節奏」頁同一套（語意層 participant_context）。\n期間或版本條件把一輪切掉一部分時，只算條件內的場次。"}
          refreshing={games.refreshing}
        >
          {games.loading ? (
            <LoadingBlock height={RECENT_SESSIONS * 52} label="載入最近幾輪…" />
          ) : games.error ? (
            <QueryError error={games.error} />
          ) : !sessions.length ? (
            <EmptyState>這個條件下沒有對局。</EmptyState>
          ) : (
            <ul className="divide-y divide-border/60" data-testid="profile-sessions">
              {sessions.map((sess, i) => {
                const first = sess.games[0]
                const last = sess.games[sess.games.length - 1]
                const w = sess.games.filter((g) => g.win).length
                const l = sess.games.length - w
                const sc = sess.games.filter((g): g is SessionGame & { score: number } => g.score !== null)
                const avg = sc.length ? sc.reduce((a, g) => a + g.score, 0) / sc.length : null
                return (
                  <li key={`${sess.queue}:${first.gameId}`} className="slide-in" style={{ "--stagger": `${Math.min(i * 35, 400)}ms` } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() =>
                        setDrill({
                          title: `${name} ${dayOf(first.time)} 那一輪`,
                          params: { ...base, game_ids: sess.games.map((g) => g.gameId).join(",") },
                          puuid: player.puuid,
                        })
                      }
                      className="pressable flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <span className="min-w-[7.5rem]">
                        <span className="block text-sm font-medium tabular-nums">{dayOf(first.time)}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {clockOf(first.time)}–{clockOf(last.time)} 開打
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">
                        {sess.games.length} 場・<span className="text-win">{w} 勝</span> <span className="text-loss">{l} 敗</span>
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-[11px] tabular-nums text-muted-foreground">貢獻 {avg === null ? "—" : Math.round(avg)}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </span>
                      {/* 這一輪由先到後的勝敗 */}
                      <span className="flex w-full flex-wrap gap-0.5" aria-label={`${w} 勝 ${l} 敗`}>
                        {sess.games.map((g) => (
                          <span key={g.gameId} className={cn("bar-grow h-1.5 w-3 rounded-full", g.win ? "bg-win" : "bg-loss")} />
                        ))}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        index={3}
        title={`和${who}`}
        caption={self ? `同場過的對局：同隊時與敵對時，${who}的戰績。刻度線是${who}的整體勝率。` : undefined}
        refreshing={h2h.refreshing || selfOverall.refreshing}
      >
        {!self ? (
          <EmptyState>這就是目前整站正在看的帳號。</EmptyState>
        ) : h2h.loading ? (
          <LoadingBlock height={96} label="載入同場紀錄…" />
        ) : h2h.error ? (
          <QueryError error={h2h.error} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="profile-h2h">
            {(["teammate", "opponent"] as const).map((rel) => {
              const r = h2h.rows.find((x) => x["teammates.relation"] === rel)
              const g = n0(r, "teammates.games")
              const w = n0(r, "teammates.wins")
              const Icon = rel === "teammate" ? Shield : Swords
              const label = rel === "teammate" ? "同隊" : "敵對"
              return (
                <button
                  key={rel}
                  type="button"
                  disabled={!g}
                  onClick={() =>
                    setDrill({
                      title: `和 ${name} ${label}`,
                      params: { ...matchParams(), with_puuid: player.puuid, relation: rel },
                      puuid: self.puuid,
                    })
                  }
                  className="pressable rounded-lg border bg-muted/20 px-3 py-2.5 text-left transition-colors enabled:hover:bg-accent disabled:cursor-default"
                >
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-3.5" />
                    {label}
                    <span className="ml-auto font-mono text-base font-semibold tabular-nums text-foreground">
                      <CountUp text={`${g} 場`} />
                    </span>
                  </span>
                  {g ? (
                    <RecordCell
                      winrate={winrateOf(w, g)}
                      wins={w}
                      losses={g - w}
                      baseline={num(selfOverall.rows[0]?.["participants.winrate"])}
                      baselineLabel={`${who}的整體勝率`}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">沒有{label}過</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      {drill && <DrillPanel title={drill.title} params={drill.params} puuid={drill.puuid} onClose={() => setDrill(null)} />}
    </div>
  )
}
