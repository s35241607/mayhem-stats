import { useState } from "react"
import { DataTable, type DataColumn } from "@/components/DataTable"
import { ArrowRight, ChevronDown, Crosshair, Swords } from "lucide-react"
import type { TimelineBuilding, TimelineKill } from "@/components/charts"
import { Hint } from "@/components/TipLayer"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { iconUrl } from "@/lib/cube"
import { cn } from "@/lib/utils"

type Actor = { killerId: number | null; assistIds: number[] }
export type KillEvent = TimelineKill & Actor & { victimId: number }
export type BuildingEvent = TimelineBuilding & Actor
export type TimelineFight = {
  start: number
  end: number
  killIndices: number[]
  kills100: number
  kills200: number
  winner: number | null
  objectiveIndices: number[]
  keyKillIndex: number | null
  reversal: boolean
}
type Player = { participant_id: number; team_id: number; champion_name: string; champion_icon: string | null }
type Mode = "key" | "fights" | "all"
type Event = KillEvent | BuildingEvent
type FeedEntry = { event: Event; key: string; highlight: boolean }
const BATCH = 16
const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
const objectiveName: Record<string, string> = {
  OUTER_TURRET: "外塔", INNER_TURRET: "內塔", BASE_TURRET: "高地塔",
  NEXUS_TURRET: "主堡塔", INHIBITOR_BUILDING: "兵營",
}
const involved = (e: Event, id: number) =>
  e.killerId === id || e.assistIds.includes(id) || ("victimId" in e && e.victimId === id)

function Hero({ player }: { player?: Player }) {
  if (!player) return <span className="text-muted-foreground">未知英雄</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {player.champion_icon && <img className="size-5 shrink-0 rounded bg-icon-tile" src={iconUrl(player.champion_icon)} alt="" />}
      <span className="break-words">{player.champion_name}</span>
    </span>
  )
}

function EventRows({ entries, byId, team }: { entries: FeedEntry[]; byId: Map<number, Player>; team: number }) {
  return (
    <ol className="divide-y divide-border/60">
      {entries.map(({ event, key, highlight }) => {
        const kill = "victimId" in event
        const side = kill ? event.team : 300 - event.owner
        return (
          <li key={key} className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs", highlight && "bg-primary/8")}>
            <span className="pt-0.5 font-mono tabular-nums text-muted-foreground">{time(event.t)}</span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className={cn("shrink-0 text-[11px]", side === team ? "text-win" : "text-loss")}>{side === team ? "我方" : "敵方"}</span>
                {event.killerId !== null ? (
                  <>
                    <Hero player={byId.get(event.killerId)} />
                    <span className="text-muted-foreground">{kill ? "擊殺" : "摧毀"}</span>
                  </>
                ) : <span className="text-muted-foreground">{kill ? "無玩家擊殺者" : "摧毀"}</span>}
                {kill ? <Hero player={byId.get(event.victimId)} /> : (
                  <span className="font-medium">{objectiveName[event.kind] ?? "建築"}</span>
                )}
                {highlight && <span className="rounded border border-primary/40 px-1 text-[10px] text-primary">關鍵擊殺</span>}
              </div>
              {event.assistIds.length > 0 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {kill ? "助攻" : "參與"} · {event.assistIds.map((id) => byId.get(id)?.champion_name ?? "未知英雄").join("、")}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Opponents({ player, kills, byId }: { player: Player; kills: KillEvent[]; byId: Map<number, Player> }) {
  const opponents = new Map<number, [number, number, number]>()
  const id = player.participant_id
  for (const event of kills) {
    const target = event.victimId === id ? event.killerId : event.victimId
    if (target === null || !byId.has(target) || byId.get(target)?.team_id === player.team_id || !involved(event, id)) continue
    const counts = opponents.get(target) ?? [0, 0, 0]
    counts[event.killerId === id ? 0 : event.victimId === id ? 2 : 1]++
    opponents.set(target, counts)
  }
  const entries = [...opponents].sort((a, b) => b[1][0] + b[1][1] + b[1][2] - a[1][0] - a[1][1] - a[1][2])
  return (
    <details className="group rounded-lg border bg-muted/15">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <span><strong>交手對象</strong><span className="ml-2 text-muted-foreground">{player.champion_name} · {entries.length} 位</span></span>
        <ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
      </summary>
      {entries.length ? (
        <div className="border-t p-2">
          <DataTable
            stateKey="timeline-opponents"
            rows={entries}
            rowKey={([opponent]) => String(opponent)}
            tableClassName="text-xs"
            dense
            showHelp={false}
            columns={[
              { id: "who", title: "對手", locked: true, pinned: true, descFirst: false, sortValue: ([o]) => byId.get(o)?.champion_name ?? null, cell: ([o]) => <Hero player={byId.get(o)} /> },
              ...(["擊殺", "助攻", "被擊殺"] as const).map((title, i): DataColumn<[number, [number, number, number]]> => ({
                id: String(i),
                title,
                align: "center",
                descFirst: true,
                sortValue: ([, counts]) => counts[i],
                className: "font-mono tabular-nums",
                cell: ([, counts]) => counts[i],
              })),
            ]}
          />
        </div>
      ) : <p className="px-3 pb-2 text-xs text-muted-foreground">沒有可辨識的英雄交手紀錄。</p>}
    </details>
  )
}

export function TimelineEvents({ kills, buildings, fights, players, team, subjectId }: {
  kills: KillEvent[]
  buildings: BuildingEvent[]
  fights: TimelineFight[]
  players: Player[]
  team: number
  subjectId?: number
}) {
  const keyKills = new Set(fights.flatMap((fight) => fight.keyKillIndex === null ? [] : [fight.keyKillIndex]))
  const [mode, setMode] = useState<Mode>(keyKills.size ? "key" : fights.length ? "fights" : "all")
  const [selection, setSelection] = useState("all")
  const [limit, setLimit] = useState(BATCH)
  const byId = new Map(players.map((player) => [player.participant_id, player]))
  const matchesPlayer = (e: Event) => selection === "all" || involved(e, Number(selection))
  const subject = byId.get(selection === "all" ? subjectId ?? -1 : Number(selection))
  const killEntry = (i: number): FeedEntry => ({ event: kills[i], key: `kill-${i}`, highlight: keyKills.has(i) })
  const buildingEntry = (i: number): FeedEntry => ({ event: buildings[i], key: `building-${i}`, highlight: false })
  const sortEvents = (a: FeedEntry, b: FeedEntry) => a.event.t - b.event.t
  const feed = mode === "all"
    ? [...kills.map((_, i) => killEntry(i)), ...buildings.map((_, i) => buildingEntry(i))].filter(({ event }) => matchesPlayer(event)).sort(sortEvents)
    : []
  const shownFights = mode === "all" ? [] : fights.filter((fight) => {
    const indices = mode === "key" ? (fight.keyKillIndex === null ? [] : [fight.keyKillIndex]) : fight.killIndices
    return indices.length > 0 && (indices.some((i) => matchesPlayer(kills[i])) || fight.objectiveIndices.some((i) => matchesPlayer(buildings[i])))
  })
  const total = mode === "all" ? feed.length : shownFights.length
  return (
    <section className="space-y-3 border-t pt-4" aria-label="事件分析">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Crosshair className="size-4 text-primary" aria-hidden="true" />事件分析
          <Hint text={"相隔最多 12 秒的英雄擊殺歸成一波，至少兩顆才列為交戰。\n關鍵擊殺是取得並維持人頭領先，且這波結束後 30 秒內、下一波開始前接續拆塔的一顆。\n交戰逆轉代表勝方一度在人頭上落後。事件先後可查，實際開戰者與因果需要看戰報。"} />
        </h3>
        <div className="flex flex-wrap gap-2">
          <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={mode} onValueChange={(value) => {
            if (value) { setMode(value as Mode); setLimit(BATCH) }
          }} aria-label="時間軸事件類型">
            <ToggleGroupItem value="key" className="text-xs">關鍵擊殺</ToggleGroupItem>
            <ToggleGroupItem value="fights" className="text-xs">交戰</ToggleGroupItem>
            <ToggleGroupItem value="all" className="text-xs">全部事件</ToggleGroupItem>
          </ToggleGroup>
          <Select value={selection} onValueChange={(value) => { setSelection(value); setLimit(BATCH) }}>
            <SelectTrigger size="sm" aria-label="篩選時間軸玩家"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部玩家</SelectItem>
              {players.map((player) => (
                <SelectItem key={player.participant_id} value={String(player.participant_id)}>
                  {player.team_id === team ? "我方" : "敵方"} · {player.champion_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="全場事件統計">
        {[
          ["英雄擊殺", kills.filter((kill) => kill.killerId !== null).length],
          ["交戰", fights.length],
          ["戰後推進", fights.filter((fight) => fight.objectiveIndices.length > 0).length],
          ["關鍵擊殺", keyKills.size],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">{label}</span><strong className="font-mono text-sm tabular-nums">{value}</strong>
          </div>
        ))}
      </div>
      {subject && <Opponents player={subject} kills={kills} byId={byId} />}
      {total === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">這個範圍沒有符合的事件。</p>
      ) : mode === "all" ? (
        <div className="rounded-lg border"><EventRows entries={feed.slice(0, limit)} byId={byId} team={team} /></div>
      ) : (
        <div className="space-y-1.5">
          {shownFights.slice(0, limit).map((fight) => {
            const pivot = fight.keyKillIndex === null ? undefined : kills[fight.keyKillIndex]
            const ours = team === 100 ? fight.kills100 : fight.kills200
            const theirs = team === 100 ? fight.kills200 : fight.kills100
            const entries = [...fight.killIndices.map(killEntry), ...fight.objectiveIndices.map(buildingEntry)].sort(sortEvents)
            return (
              <details key={fight.killIndices[0]} className="group rounded-lg border bg-muted/15">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                  <span className="font-mono tabular-nums text-muted-foreground">{mode === "key" && pivot ? time(pivot.t) : `${time(fight.start)}–${time(fight.end)}`}</span>
                  <span className={cn("rounded px-1.5 py-0.5 font-mono tabular-nums", ours === theirs ? "bg-muted" : ours > theirs ? "bg-win/10 text-win" : "bg-loss/10 text-loss")} data-tip="本波交戰人頭數 · 我方比敵方">{ours}–{theirs}</span>
                  {mode === "key" && pivot ? (
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      <Hero player={byId.get(pivot.killerId ?? -1)} /><ArrowRight className="size-3 text-muted-foreground" aria-label="擊殺" /><Hero player={byId.get(pivot.victimId)} />
                    </span>
                  ) : <Swords className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                  {fight.reversal && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">交戰逆轉</span>}
                  {fight.objectiveIndices.length > 0 && (
                    <span className="text-muted-foreground">
                      {Math.round(buildings[fight.objectiveIndices[0]].t - fight.end)} 秒後接續 {fight.objectiveIndices.map((i) => objectiveName[buildings[i].kind] ?? "建築").join("、")}
                    </span>
                  )}
                  <ChevronDown className="ml-auto size-4 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="border-t"><EventRows entries={entries} byId={byId} team={team} /></div>
              </details>
            )
          })}
        </div>
      )}
      {total > limit && <Button size="sm" variant="outline" onClick={() => setLimit(limit + BATCH)}>顯示更多（{limit}／{total}）</Button>}
    </section>
  )
}
