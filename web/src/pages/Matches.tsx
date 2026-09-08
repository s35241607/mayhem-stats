import { useEffect, useState } from "react"
import { ChevronLeft, Crown, Swords } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Panel, EmptyState } from "@/components/primitives"
import { iconUrl } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"

type MatchRow = {
  platform_id: string
  game_id: number
  game_creation: number
  game_duration: number
  game_mode: string
  champion_name: string
  champion_icon: string | null
  win: number
  kills: number
  deaths: number
  assists: number
  cs: number
  gold_earned: number
  dmg_to_champions: number
  team_kills: number
  ended_surrender: number
  penta_kills: number
  quadra_kills: number
}

type Player = MatchRow & {
  participant_id: number
  riot_id: string
  team_id: number
  is_me: number
  dmg_taken: number
  champ_level: number
  augments: { slot: number; name: string | null; rarity: string | null; icon_path: string | null }[]
  items: { slot: number; item_id: number; name: string | null; icon_path: string | null }[]
}

const RARITY_RING: Record<string, string> = {
  kPrismatic: "ring-prismatic/70",
  kGold: "ring-gold/70",
  kSilver: "ring-silver/60",
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

const fmtDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

/** 相對長度條。分母用全場最大值，看得出誰是輸出核心、誰在扛。 */
function Meter({ value, max, tone }: { value: number; max: number; tone: "dmg" | "taken" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-[40px] overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", tone === "dmg" ? "bg-primary" : "bg-chart-2")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {(value / 1000).toFixed(1)}k
      </span>
    </div>
  )
}

function PlayerRow({ p, maxDmg, maxTaken }: { p: Player; maxDmg: number; maxTaken: number }) {
  const kp = p.team_kills ? Math.round(((p.kills + p.assists) / p.team_kills) * 100) : 0
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(150px,1.4fr)_auto_minmax(110px,1fr)_minmax(110px,1fr)_auto] items-center gap-3 rounded-md px-2 py-2",
        p.is_me && "bg-primary/10 ring-1 ring-primary/25",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative shrink-0">
          <img
            src={iconUrl(p.champion_icon) }
            alt=""
            className="size-9 rounded-md bg-secondary"
          />
          <span className="absolute -bottom-1 -right-1 rounded bg-background px-1 text-[10px] font-bold tabular-nums">
            {p.champ_level}
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.champion_name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{p.riot_id}</div>
        </div>
      </div>

      <div className="text-center">
        <div className="text-sm font-semibold tabular-nums">
          {p.kills} / <span className="text-loss">{p.deaths}</span> / {p.assists}
        </div>
        <div className="text-[11px] text-muted-foreground">參團 {kp}%</div>
      </div>

      <Meter value={p.dmg_to_champions} max={maxDmg} tone="dmg" />
      <Meter value={p.dmg_taken} max={maxTaken} tone="taken" />

      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-0.5">
          {p.items
            .filter((i) => i.item_id)
            .map((item) => (
              <img
                key={item.slot}
                src={iconUrl(item.icon_path)}
                alt=""
                title={item.name ?? ""}
                className="size-6 rounded bg-secondary"
              />
            ))}
        </div>
        <div className="flex gap-0.5">
          {p.augments.map((a) => (
            <img
              key={a.slot}
              src={iconUrl(a.icon_path)}
              alt=""
              title={`${a.name ?? ""}${a.rarity ? ` (${a.rarity.replace("k", "")})` : ""}`}
              className={cn(
                "size-6 rounded ring-1 bg-secondary",
                a.rarity ? RARITY_RING[a.rarity] : "ring-border",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function MatchDetail({
  platformId,
  gameId,
  onBack,
}: {
  platformId: string
  gameId: number
  onBack: () => void
}) {
  const [data, setData] = useState<{ match: MatchRow; players: Player[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    fetch(`/api/match/${platformId}/${gameId}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e: Error) => setError(e.message))
  }, [platformId, gameId])

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!data) return <Skeleton className="h-[520px] w-full" />

  const { match, players } = data
  const maxDmg = Math.max(...players.map((p) => p.dmg_to_champions), 1)
  const maxTaken = Math.max(...players.map((p) => p.dmg_taken), 1)
  const me = players.find((p) => p.is_me)
  const teams = [100, 200].map((teamId) => ({
    teamId,
    won: players.find((p) => p.team_id === teamId)?.win === 1,
    players: players.filter((p) => p.team_id === teamId),
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={onBack}>
          <ChevronLeft /> 回列表
        </Button>
        <Badge variant={me?.win ? "default" : "destructive"} className="text-sm">
          {me?.win ? "勝利" : "敗北"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {fmtDate(match.game_creation)} · {fmtDuration(match.game_duration)} ·{" "}
          {match.game_mode}
          {match.ended_surrender ? " · 投降結束" : ""}
        </span>
      </div>

      {teams.map((team) => (
        <Panel
          key={team.teamId}
          title={`${team.teamId === 100 ? "藍隊" : "紅隊"} · ${team.won ? "勝" : "敗"}`}
          caption={`總擊殺 ${team.players[0]?.team_kills ?? 0}`}
          action={
            team.won ? <Crown className="size-4 text-gold" /> : <Swords className="size-4 text-muted-foreground" />
          }
        >
          <div className="mb-1 grid grid-cols-[minmax(150px,1.4fr)_auto_minmax(110px,1fr)_minmax(110px,1fr)_auto] gap-3 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>玩家</span>
            <span className="text-center">K / D / A</span>
            <span>對英雄輸出</span>
            <span>承受傷害</span>
            <span className="text-right">裝備 / 增幅</span>
          </div>
          <Separator className="mb-1" />
          <div className="space-y-0.5">
            {team.players.map((p) => (
              <PlayerRow key={p.participant_id} p={p} maxDmg={maxDmg} maxTaken={maxTaken} />
            ))}
          </div>
        </Panel>
      ))}

      <p className="text-xs text-muted-foreground">
        長度條的分母是全場最大值，所以看得出誰是輸出核心、誰在扛傷害。
        增幅外框顏色代表稀有度，滑過去看名稱。
      </p>
    </div>
  )
}

export function Matches() {
  const { queueId } = useFilters()
  const [selected, setSelected] = useState<{ platformId: string; gameId: number } | null>(null)
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const pageSize = 25

  useEffect(() => {
    setRows(null)
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
    if (queueId) params.set("queue", queueId)
    fetch(`/api/matches?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.matches)
        setTotal(d.total)
      })
  }, [queueId, offset])

  if (selected) {
    return (
      <MatchDetail
        platformId={selected.platformId}
        gameId={selected.gameId}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <Panel title="對局紀錄" caption={`共 ${total} 場，點任一列看完整戰報`}>
      {!rows ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState>這個條件下沒有對局。</EmptyState>
      ) : (
        <>
          <div className="space-y-1">
            {rows.map((m) => (
              <button
                key={`${m.platform_id}:${m.game_id}`}
                onClick={() =>
                  setSelected({ platformId: m.platform_id, gameId: m.game_id })
                }
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border-l-2 px-3 py-2 text-left transition hover:bg-accent",
                  m.win ? "border-l-win bg-win/5" : "border-l-loss bg-loss/5",
                )}
              >
                <img
                  src={iconUrl(m.champion_icon)}
                  alt=""
                  className="size-9 shrink-0 rounded-md bg-secondary"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.champion_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtDate(m.game_creation)} · {fmtDuration(m.game_duration)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    {m.kills} / <span className="text-loss">{m.deaths}</span> / {m.assists}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {(m.dmg_to_champions / 1000).toFixed(1)}k 輸出 · {m.cs} 補兵
                  </div>
                </div>
                {m.penta_kills > 0 && (
                  <Badge className="bg-gold/20 text-gold">五殺</Badge>
                )}
                {m.penta_kills === 0 && m.quadra_kills > 0 && (
                  <Badge variant="secondary">四殺</Badge>
                )}
                <Badge variant={m.win ? "default" : "destructive"} className="w-11 justify-center">
                  {m.win ? "勝" : "敗"}
                </Badge>
              </button>
            ))}
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
