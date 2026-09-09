import { useEffect, useState } from "react"
import { ChevronLeft, Coins, Swords } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Panel, EmptyState } from "@/components/primitives"
import { iconUrl } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"

type Item = { slot: number; item_id: number; name: string | null; icon_path: string | null }
type Augment = { slot: number; name: string | null; rarity: string | null; icon_path: string | null }

type MatchRow = {
  platform_id: string
  game_id: number
  participant_id: number
  game_creation: number
  game_duration: number
  game_mode: string
  ended_surrender: number
  champion_name: string
  champion_icon: string | null
  champ_level: number
  win: number
  kills: number
  deaths: number
  assists: number
  cs: number
  gold_earned: number
  dmg_to_champions: number
  team_kills: number
  penta_kills: number
  quadra_kills: number
  items: Item[]
}

type Player = MatchRow & {
  riot_id: string
  team_id: number
  is_me: number
  dmg_taken: number
  dmg_physical: number
  dmg_magic: number
  dmg_true: number
  dmg_mitigated: number
  total_heal: number
  gold_spent: number
  time_ccing_others: number
  largest_multi_kill: number
  longest_time_living: number
  dmg_to_objectives: number
  first_blood: number
  first_tower: number
  double_kills: number
  triple_kills: number
  augments: Augment[]
}

const RARITY_RING: Record<string, string> = {
  kPrismatic: "ring-prismatic/70",
  kGold: "ring-gold/70",
  kSilver: "ring-silver/60",
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** 六格裝備 + 飾品，空格也要畫出來，才看得出他沒補滿。 */
function ItemRow({ items, size = "size-7" }: { items: Item[]; size?: string }) {
  const bySlot = new Map(items.map((i) => [i.slot, i]))
  return (
    <div className="flex gap-0.5">
      {[0, 1, 2, 3, 4, 5, 6].map((slot) => {
        const item = bySlot.get(slot)
        return item?.item_id ? (
          <img
            key={slot}
            src={iconUrl(item.icon_path)}
            alt=""
            title={item.name ?? ""}
            className={cn(size, "rounded bg-secondary", slot === 6 && "ml-1")}
          />
        ) : (
          <div
            key={slot}
            className={cn(size, "rounded bg-secondary/40", slot === 6 && "ml-1")}
          />
        )
      })}
    </div>
  )
}

function AugmentRow({ augments }: { augments: Augment[] }) {
  return (
    <div className="flex gap-0.5">
      {augments.map((a) => (
        <img
          key={a.slot}
          src={iconUrl(a.icon_path)}
          alt=""
          title={`${a.name ?? ""}${a.rarity ? `（${a.rarity.replace("k", "")}）` : ""}`}
          className={cn("size-6 rounded bg-secondary ring-1", a.rarity ? RARITY_RING[a.rarity] : "ring-border")}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────── 計分板

function Scoreboard({ players }: { players: Player[] }) {
  const teams = [100, 200].map((teamId) => {
    const members = players.filter((p) => p.team_id === teamId)
    return {
      teamId,
      members,
      won: members[0]?.win === 1,
      kills: members.reduce((s, p) => s + p.kills, 0),
      deaths: members.reduce((s, p) => s + p.deaths, 0),
      assists: members.reduce((s, p) => s + p.assists, 0),
      gold: members.reduce((s, p) => s + p.gold_earned, 0),
    }
  })

  return (
    <div className="space-y-4">
      {teams.map((team) => (
        <div key={team.teamId} className="overflow-hidden rounded-lg border">
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 text-sm",
              team.won ? "bg-win/10" : "bg-loss/10",
            )}
          >
            <span className={cn("font-semibold", team.won ? "text-win" : "text-loss")}>
              {team.teamId === 100 ? "隊伍 1" : "隊伍 2"} · {team.won ? "勝利" : "失敗"}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Swords className="size-3.5 text-muted-foreground" />
              {team.kills} / {team.deaths} / {team.assists}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Coins className="size-3.5 text-muted-foreground" />
              {team.gold.toLocaleString()}
            </span>
          </div>

          <div className="divide-y">
            {team.members.map((p) => (
              <div
                key={p.participant_id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2",
                  p.is_me && "bg-primary/10",
                )}
              >
                <div className="relative shrink-0">
                  <img
                    src={iconUrl(p.champion_icon)}
                    alt=""
                    className="size-10 rounded-md bg-secondary"
                  />
                  <span className="absolute -bottom-1 -right-1 rounded bg-background px-1 text-[10px] font-bold tabular-nums">
                    {p.champ_level}
                  </span>
                </div>

                <div className="min-w-[110px] flex-1">
                  <div className="truncate text-sm font-medium">{p.riot_id}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.champion_name}
                  </div>
                </div>

                <AugmentRow augments={p.augments} />
                <ItemRow items={p.items} />

                <div className="w-[92px] text-right text-sm font-semibold tabular-nums">
                  {p.kills} / <span className="text-loss">{p.deaths}</span> / {p.assists}
                </div>
                <div className="w-[70px] text-right text-sm tabular-nums text-muted-foreground">
                  {p.gold_earned.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────── 數據（十人橫向比較）

type StatRow = { label: string; get: (p: Player) => number; fmt?: (n: number) => string }

const STAT_SECTIONS: { title: string; rows: StatRow[] }[] = [
  {
    title: "對戰",
    rows: [
      { label: "擊殺", get: (p) => p.kills },
      { label: "死亡", get: (p) => p.deaths },
      { label: "助攻", get: (p) => p.assists },
      { label: "最高同時擊殺", get: (p) => p.largest_multi_kill },
      { label: "雙殺 / 三殺", get: (p) => p.double_kills + p.triple_kills },
      { label: "控場分數", get: (p) => p.time_ccing_others },
      { label: "最久存活（秒）", get: (p) => p.longest_time_living },
    ],
  },
  {
    title: "造成傷害",
    rows: [
      { label: "對英雄總傷害", get: (p) => p.dmg_to_champions, fmt: (n) => n.toLocaleString() },
      { label: "對英雄物理傷害", get: (p) => p.dmg_physical, fmt: (n) => n.toLocaleString() },
      { label: "對英雄魔法傷害", get: (p) => p.dmg_magic, fmt: (n) => n.toLocaleString() },
      { label: "對英雄真實傷害", get: (p) => p.dmg_true, fmt: (n) => n.toLocaleString() },
      { label: "對建築物傷害", get: (p) => p.dmg_to_objectives, fmt: (n) => n.toLocaleString() },
    ],
  },
  {
    title: "承受與生存",
    rows: [
      { label: "承受傷害", get: (p) => p.dmg_taken, fmt: (n) => n.toLocaleString() },
      { label: "減免傷害", get: (p) => p.dmg_mitigated, fmt: (n) => n.toLocaleString() },
      { label: "治療量", get: (p) => p.total_heal, fmt: (n) => n.toLocaleString() },
    ],
  },
  {
    title: "資源",
    rows: [
      { label: "取得金錢", get: (p) => p.gold_earned, fmt: (n) => n.toLocaleString() },
      { label: "花費金錢", get: (p) => p.gold_spent, fmt: (n) => n.toLocaleString() },
      { label: "補兵", get: (p) => p.cs },
    ],
  },
]

function StatTable({ players }: { players: Player[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              項目
            </th>
            {players.map((p) => (
              <th key={p.participant_id} className="px-2 py-2">
                <div className="flex flex-col items-center gap-1">
                  <img
                    src={iconUrl(p.champion_icon)}
                    alt=""
                    title={p.riot_id}
                    className={cn(
                      "size-8 rounded-md bg-secondary",
                      p.is_me && "ring-2 ring-primary",
                      p.team_id === 100 ? "ring-offset-0" : "",
                    )}
                  />
                  <span
                    className={cn(
                      "h-0.5 w-6 rounded-full",
                      p.team_id === 100 ? "bg-chart-2" : "bg-loss",
                    )}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_SECTIONS.map((section) => (
            <>
              <tr key={section.title} className="bg-secondary/40">
                <td
                  colSpan={players.length + 1}
                  className="px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  {section.title}
                </td>
              </tr>
              {section.rows.map((row) => {
                const values = players.map(row.get)
                const max = Math.max(...values)
                return (
                  <tr key={`${section.title}-${row.label}`} className="border-b last:border-0">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1.5 text-xs text-muted-foreground">
                      {row.label}
                    </td>
                    {players.map((p, i) => (
                      <td
                        key={p.participant_id}
                        className={cn(
                          "px-2 py-1.5 text-center tabular-nums",
                          // 全場最高的用主色標出來，一眼看得到誰在該項領先
                          values[i] === max && max > 0 ? "font-bold text-primary" : "",
                          p.is_me && "bg-primary/5",
                        )}
                      >
                        {row.fmt ? row.fmt(values[i]) : values[i]}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────── 單場戰報

function MatchDetail({
  platformId,
  gameId,
  puuid,
  onBack,
}: {
  platformId: string
  gameId: number
  puuid?: string
  onBack: () => void
}) {
  const [data, setData] = useState<{ match: MatchRow; players: Player[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    const q = puuid ? `?puuid=${encodeURIComponent(puuid)}` : ""
    fetch(`/api/match/${platformId}/${gameId}${q}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => setError(e.message))
  }, [platformId, gameId, puuid])

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!data) return <Skeleton className="h-[560px] w-full" />

  const { match, players } = data
  const subject = players.find((p) => p.is_me)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={onBack}>
          <ChevronLeft /> 回列表
        </Button>
        <span
          className={cn(
            "text-lg font-bold",
            subject?.win ? "text-win" : "text-loss",
          )}
        >
          {subject?.win ? "勝利" : "失敗"}
        </span>
        <span className="text-sm text-muted-foreground">
          {match.game_mode} · {fmtDuration(match.game_duration)} · {fmtDate(match.game_creation)}
          {match.ended_surrender ? " · 投降結束" : ""}
        </span>
      </div>

      <Tabs defaultValue="board">
        <TabsList className="mb-3">
          <TabsTrigger value="board">計分板</TabsTrigger>
          <TabsTrigger value="stats">數據</TabsTrigger>
        </TabsList>
        <TabsContent value="board">
          <Scoreboard players={players} />
        </TabsContent>
        <TabsContent value="stats">
          <StatTable players={players} />
          <p className="mt-2 text-xs text-muted-foreground">
            每一列的全場最高值以主色標示。上方色條藍＝隊伍 1、紅＝隊伍 2。
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────── 對局列表

export function Matches() {
  const { queueId, account } = useFilters()
  const [selected, setSelected] = useState<{ platformId: string; gameId: number } | null>(null)
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const pageSize = 20

  useEffect(() => {
    setOffset(0)
    setSelected(null)
  }, [account?.puuid])

  useEffect(() => {
    if (!account) return
    setRows(null)
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
      puuid: account.puuid,
    })
    if (queueId) params.set("queue", queueId)
    fetch(`/api/matches?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.matches)
        setTotal(d.total)
      })
  }, [queueId, offset, account])

  if (selected) {
    return (
      <MatchDetail
        platformId={selected.platformId}
        gameId={selected.gameId}
        puuid={account?.puuid}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <Panel
      title={`近期對戰（共 ${total} 場）`}
      caption="點任一列看完整戰報"
    >
      {!rows ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState>這個條件下沒有對局。</EmptyState>
      ) : (
        <>
          <div className="space-y-1.5">
            {rows.map((m) => {
              const kda =
                m.deaths === 0 ? "Perfect" : ((m.kills + m.assists) / m.deaths).toFixed(2)
              const kp = m.team_kills
                ? Math.round(((m.kills + m.assists) / m.team_kills) * 100)
                : 0
              return (
                <button
                  key={`${m.platform_id}:${m.game_id}`}
                  onClick={() => setSelected({ platformId: m.platform_id, gameId: m.game_id })}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-l-[3px] px-3 py-2.5 text-left transition hover:bg-accent",
                    m.win ? "border-l-win bg-win/5" : "border-l-loss bg-loss/5",
                  )}
                >
                  <div className="relative shrink-0">
                    <img
                      src={iconUrl(m.champion_icon)}
                      alt=""
                      className="size-11 rounded-md bg-secondary"
                    />
                    <span className="absolute -bottom-1 -right-1 rounded bg-background px-1 text-[10px] font-bold tabular-nums">
                      {m.champ_level}
                    </span>
                  </div>

                  <div className="w-[62px] shrink-0">
                    <div
                      className={cn(
                        "text-sm font-bold",
                        m.win ? "text-win" : "text-loss",
                      )}
                    >
                      {m.win ? "勝利" : "戰敗"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtDuration(m.game_duration)}
                    </div>
                  </div>

                  <ItemRow items={m.items ?? []} size="size-6" />

                  <div className="w-[104px] text-center">
                    <div className="text-sm font-semibold tabular-nums">
                      {m.kills} / <span className="text-loss">{m.deaths}</span> / {m.assists}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      KDA {kda} · 參團 {kp}%
                    </div>
                  </div>

                  <div className="w-[92px] text-right text-[11px] text-muted-foreground tabular-nums">
                    <div>{m.cs} 補兵</div>
                    <div>{k(m.gold_earned)} 金錢</div>
                  </div>

                  <div className="ml-auto text-right">
                    <div className="text-xs text-muted-foreground">{m.champion_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtDate(m.game_creation)}
                    </div>
                  </div>

                  {m.penta_kills > 0 && <Badge className="bg-gold/20 text-gold">五殺</Badge>}
                  {m.penta_kills === 0 && m.quadra_kills > 0 && (
                    <Badge variant="secondary">四殺</Badge>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              第 {offset + 1}–{Math.min(offset + pageSize, total)} 場，共 {total} 場
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                上一頁
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + pageSize >= total}
                onClick={() => setOffset(offset + pageSize)}
              >
                下一頁
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}
