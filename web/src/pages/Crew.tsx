import { useMemo, useState, type CSSProperties } from "react"
import { ArrowRight, Check, ChevronsUpDown, Search } from "lucide-react"
import { RecordCell } from "@/components/cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, Panel, QueryError } from "@/components/primitives"
import { RadarChart, shrunk, type RadarDatum } from "@/components/charts"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useFilters, type Player } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { useNavigate } from "@/lib/nav"
import { cn } from "@/lib/utils"
import { MIN_GAMES, NO_LIMIT, PRIMARY_ONLY, ROLES, round0 } from "./shared"

// ── 「適合／不適合」的判斷規則 ─────────────────────────────────────────
// 基準是這個人「自己的」整體勝率：每個人本來的水準不同，拿 50% 或大家的平均來比，
// 勝率本來就高的人每一類都會被判成適合。勝率先依場次往基準收縮（和熱力圖、長條同一套 shrunk），
// 三場全勝不會直接被當成適合。收縮後還差多少個百分點才算數：
// 類型樣本大（主定位一類通常十幾到幾十場），門檻 3；英雄樣本小、極端值多，門檻 5。
// 這套規則跟著目前的篩選（期間、模式）即時算，所以留在前端，不進語意層。
const ROLE_MIN = MIN_GAMES
const ROLE_GAP = 3
const CHAMP_MIN = 3
const CHAMP_GAP = 5
const PICKS_SHOWN = 3

const n0 = (r: CubeRow | undefined, k: string) => (r ? (num(r[k]) ?? 0) : 0)
const opt = (r: CubeRow | undefined, k: string) => (r ? num(r[k]) : null)
const pp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`

/** Riot ID 拆成名稱與 #tag，版面上 tag 用淡色 */
const splitId = (riotId: string | null, puuid: string) => {
  const [name, tag] = (riotId ?? puuid.slice(0, 8)).split("#")
  return { name, tag: tag ? `#${tag}` : "" }
}

function PlayerName({ player, className }: { player: Player; className?: string }) {
  const { name, tag } = splitId(player.riot_id, player.puuid)
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="truncate font-medium">{name}</span>
      {tag && <span className="shrink-0 text-[11px] text-muted-foreground">{tag}</span>}
      {!!player.is_me && (
        <Badge variant="outline" className="shrink-0 border-primary/40 px-1 py-0 text-[10px] text-primary">
          我
        </Badge>
      )}
    </span>
  )
}

type Pick = { label: string; icon?: string; games: number; wins: number; winrate: number | null; delta: number }
type Call = { good: Pick[]; bad: Pick[] }

/** 把一組（類型或英雄）分成適合／不適合：場次夠、收縮後和基準差到門檻才列。 */
function classify(items: Omit<Pick, "delta">[], base: number | null, minGames: number, gap: number, limit = PICKS_SHOWN): Call {
  if (base === null) return { good: [], bad: [] }
  const scored = items
    .filter((i) => i.games >= minGames)
    .map((i) => ({ ...i, delta: shrunk(i.games, i.winrate, base) - base }))
  // 並列時依名稱排，每次顯示同一組
  const tie = (a: Pick, b: Pick) => b.games - a.games || a.label.localeCompare(b.label, "zh-Hant")
  return {
    good: scored.filter((i) => i.delta >= gap).sort((a, b) => b.delta - a.delta || tie(a, b)).slice(0, limit),
    bad: scored.filter((i) => i.delta <= -gap).sort((a, b) => a.delta - b.delta || tie(a, b)).slice(0, limit),
  }
}

/** 迷你六邊形：形狀是各類型佔他自己場次的比例（偏好玩什麼），頂點點是適不適合。
 *
 *  一覽表裡每人一個，七個人上下排成一欄就能一眼比形狀——比七張大雷達圖或疊在一起的
 *  七條線都好讀。用 SVG 而不是 ECharts：七個 canvas 實例的成本不值得，這裡也不需要互動。
 *  外框是「他自己最常玩的那一類」：原本全員同一把尺，某人射手佔 58%，其他人的形狀
 *  全縮在中心成一團點，看不出偏好。確切比例放在滑過的提示裡。 */
function MiniHex({ data, total, call, size = 96 }: { data: RadarDatum[]; total: number; call: Call; size?: number }) {
  const c = size / 2
  const r = size / 2 - 13 // 留位置給單字標籤
  const n = data.length
  const at = (i: number, frac: number) => {
    const a = ((90 + (i * 360) / n) * Math.PI) / 180 // 和 ECharts 雷達同方向：正上方開始、逆時針
    return [c + Math.cos(a) * r * frac, c - Math.sin(a) * r * frac] as const
  }
  const ring = (frac: number) => data.map((_, i) => at(i, frac).join(",")).join(" ")
  const good = new Set(call.good.map((p) => p.label))
  const bad = new Set(call.bad.map((p) => p.label))
  const share = data.map((d) => (total ? d.games / total : 0))
  const scaleMax = Math.max(0.01, ...share)
  const tip = data
    .map((d, i) => `${d.label} ${Math.round(share[i] * 100)}%（${d.games} 場${d.games ? `，勝率 ${d.winrate?.toFixed(1)}%` : ""}）`)
    .join("\n")
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <title>{`各類型佔他場次的比例\n${tip}`}</title>
      <polygon points={ring(1)} className="fill-muted/30 stroke-muted-foreground/40" strokeWidth={1} />
      <polygon points={ring(0.5)} className="fill-none stroke-muted-foreground/25" strokeWidth={0.75} />
      {data.map((_, i) => {
        const [x, y] = at(i, 1)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="stroke-muted-foreground/25" strokeWidth={0.75} />
      })}
      <polygon
        points={share.map((s, i) => at(i, Math.min(1, s / scaleMax)).join(",")).join(" ")}
        className="fill-data/30 stroke-data"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const [x, y] = at(i, Math.min(1, share[i] / scaleMax))
        const [lx, ly] = at(i, 1.28)
        return (
          <g key={d.label}>
            <circle
              cx={x}
              cy={y}
              r={good.has(d.label) || bad.has(d.label) ? 3 : 2}
              className={good.has(d.label) ? "fill-win" : bad.has(d.label) ? "fill-loss" : "fill-muted-foreground"}
            />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn(
                "text-[9px] font-semibold",
                good.has(d.label) ? "fill-win" : bad.has(d.label) ? "fill-loss" : "fill-muted-foreground",
              )}
            >
              {d.label.slice(0, 1)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 類型的小標籤：「法師 +6.0」 */
function RoleChips({ items, tone }: { items: Pick[]; tone: "win" | "loss" }) {
  if (!items.length) return <span className="text-[11px] text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap content-start items-start gap-1">
      {items.map((i) => (
        <span
          key={i.label}
          title={`${i.label}・${i.games} 場・${i.wins} 勝 ${i.games - i.wins} 敗・勝率 ${i.winrate?.toFixed(1)}%`}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[11px] tabular-nums",
            tone === "win" ? "border-win/30 bg-win/10 text-win" : "border-loss/30 bg-loss/10 text-loss",
          )}
        >
          {i.label} <span className="font-mono">{i.delta >= 0 ? "+" : ""}{i.delta.toFixed(1)}</span>
        </span>
      ))}
    </span>
  )
}

/** 英雄頭像列：頭像外框是勝／敗色，右下角是差距，滑過看名稱與戰績 */
function ChampIcons({ items, tone }: { items: Pick[]; tone: "win" | "loss" }) {
  if (!items.length) return <span className="text-[11px] text-muted-foreground">—</span>
  return (
    <span className="flex gap-1.5">
      {items.map((i) => (
        <span
          key={i.label}
          title={`${i.label}・${i.games} 場・${i.wins} 勝 ${i.games - i.wins} 敗・勝率 ${i.winrate?.toFixed(1)}%・比他自己平均 ${pp(i.delta)}`}
          className="relative shrink-0"
        >
          <img
            src={iconUrl(i.icon)}
            alt={i.label}
            className={cn("size-8 rounded-md bg-icon-tile ring-2", tone === "win" ? "ring-win/70" : "ring-loss/70")}
          />
          <span
            className={cn(
              "absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-background px-0.5 font-mono text-[9px] leading-tight tabular-nums",
              tone === "win" ? "text-win" : "text-loss",
            )}
          >
            {i.delta >= 0 ? "+" : ""}
            {Math.round(i.delta)}
          </span>
        </span>
      ))}
    </span>
  )
}

function PickList({ title, tone, items, empty }: { title: string; tone: "win" | "loss"; items: Pick[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className={cn("mb-1 text-[11px] font-semibold", tone === "win" ? "text-win" : "text-loss")}>{title}</div>
      {items.length ? (
        <div className="space-y-1">
          {items.map((i) => (
            <div key={i.label} className="flex items-center gap-2">
              {i.icon && <img src={iconUrl(i.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />}
              <span className="min-w-0 flex-1 truncate text-[13px]">{i.label}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {i.wins} 勝 {i.games - i.wins} 敗
              </span>
              <span
                className={cn(
                  "w-[58px] shrink-0 rounded border px-1 text-right font-mono text-[11px] tabular-nums",
                  tone === "win" ? "border-win/30 bg-win/10 text-win" : "border-loss/30 bg-loss/10 text-loss",
                )}
              >
                {pp(i.delta)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">{empty}</div>
      )}
    </div>
  )
}

type Analysis = { radar: RadarDatum[]; roleCall: Call; champCall: Call }

/** 抽屜：某個人的完整分析（大雷達圖 + 適合／不適合），以及他（在某一類）玩過的每隻英雄。 */
function PlayerDrawerBody({
  player,
  role,
  overallWr,
  total,
  analysis,
  crewFilter,
  onRole,
}: {
  player: Player
  role: string | null
  overallWr: number | null
  total: number
  analysis: Analysis
  crewFilter: (puuids: string[]) => CubeFilter
  onRole: (role: string | null) => void
}) {
  const { apply, setAccount } = useFilters()
  const go = useNavigate()
  const settled = useDrawerSettled()
  const champs = useCube(
    apply(
      {
        measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate"],
        dimensions: ["champions.name", "champions.icon_path"],
        filters: [
          crewFilter([player.puuid]),
          ...(role ? [{ member: "champion_roles.name", operator: "equals" as const, values: [role] }, ...PRIMARY_ONLY] : []),
        ],
        order: { "participants.games": "desc" },
        limit: NO_LIMIT,
      },
      "all",
    ),
  )

  return (
    <>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAccount(player)
            go("dashboard")
          }}
        >
          切換成看他的完整數據
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
      <div className="grid gap-4 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="text-sm font-semibold">各類型勝率</div>
          <div className="text-[11px] text-muted-foreground">
            只算主定位；虛線圈是他自己的整體勝率 {overallWr?.toFixed(1) ?? "—"}%。點某一類的方向，下面只列那一類的英雄
          </div>
          {settled ? (
            <RadarChart
              data={analysis.radar}
              mode="winrate"
              baseline={overallWr}
              total={total}
              height={280}
              selected={role}
              onPick={(r) => onRole(role === r ? null : r)}
            />
          ) : (
            <div className="h-[280px]" />
          )}
        </div>
        <div className="grid content-start gap-4">
          <PickList title="適合的類型" tone="win" items={analysis.roleCall.good} empty="沒有明顯比平常好的類型" />
          <PickList title="不適合的類型" tone="loss" items={analysis.roleCall.bad} empty="沒有明顯比平常差的類型" />
          <PickList title="適合的英雄" tone="win" items={analysis.champCall.good} empty={`還沒有英雄在 ${CHAMP_MIN} 場以上明顯比平常好`} />
          <PickList title="不適合的英雄" tone="loss" items={analysis.champCall.bad} empty={`還沒有英雄在 ${CHAMP_MIN} 場以上明顯比平常差`} />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{role ? `${role}（主定位）玩過的英雄` : "玩過的每隻英雄"}</div>
        {role && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRole(null)}>
            看全部類型
          </Button>
        )}
      </div>
      {!settled || champs.loading ? (
        <Skeleton className="h-[320px] w-full" />
      ) : champs.error ? (
        <div className="text-sm text-destructive">{champs.error}</div>
      ) : !champs.rows.length ? (
        <EmptyState>這個條件下沒有對局。</EmptyState>
      ) : (
        <div className="space-y-1">
          {champs.rows.map((r, i) => (
            <div
              key={String(r["champions.name"])}
              style={{ "--stagger": `${Math.min(i * 30, 400)}ms` } as CSSProperties}
              className="slide-in grid grid-cols-[minmax(0,1fr)_4rem_minmax(9rem,13rem)] items-center gap-3 rounded-md px-2 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <img src={iconUrl(r["champions.icon_path"] as string)} alt="" className="size-8 shrink-0 rounded-md bg-icon-tile" />
                <span className="truncate text-[13px] font-medium">{String(r["champions.name"])}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{n0(r, "participants.games")} 場</span>
              <RecordCell
                winrate={opt(r, "participants.winrate")}
                wins={n0(r, "participants.wins")}
                losses={n0(r, "participants.losses")}
                baseline={overallWr}
                baselineLabel="他自己的整體勝率"
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type ChampionOption = { name: string; icon: string; games: number; players: number }

/** 英雄選擇器：可搜尋，依「幾個人玩過、合計幾場」排序 */
function ChampionPicker({
  options,
  value,
  onChange,
}: {
  options: ChampionOption[]
  value: string | null
  onChange: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.name === value)
  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-[280px] justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {current ? (
              <img src={iconUrl(current.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
            <span className="truncate">{current?.name ?? "選一隻英雄"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="搜尋英雄名稱…" />
          <CommandList>
            <CommandEmpty>這群人都沒玩過這隻。</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.name}
                value={o.name}
                onSelect={() => pick(o.name)}
                // 同 AccountSwitcher：這版 cmdk 的 onSelect 在某些包法下不觸發，點擊路徑另外接上
                onClick={() => pick(o.name)}
                className="gap-2"
              >
                <img src={iconUrl(o.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {o.players} 人・{o.games} 場
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function Crew() {
  const { players, apply } = useFilters()
  const crew = useMemo(() => players.filter((p) => p.crew), [players])
  // 預設全部人都比；點名字可以拿掉（至少留一個）
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const chosen = crew.filter((p) => !excluded.has(p.puuid))
  const puuids = chosen.map((p) => p.puuid)
  const [focus, setFocus] = useState<{ puuid: string; role: string | null } | null>(null)
  const [champion, setChampion] = useState<string | null>(null)

  const byId = useMemo(() => new Map(crew.map((p) => [p.puuid, p])), [crew])
  const focusPlayer = focus ? byId.get(focus.puuid) : undefined
  useCrumb(
    10,
    focusPlayer ? `${splitId(focusPlayer.riot_id, focusPlayer.puuid).name}${focus?.role ? `・${focus.role}` : ""}` : null,
    () => setFocus(null),
  )

  // 全域條件（模式、期間、下鑽）照套，但不鎖定帳號（scope "all"），改成鎖定這群人。equals 給多個值就是 IN。
  const crewFilter = (ids: string[]): CubeFilter => ({ member: "participants.puuid", operator: "equals", values: ids })
  const q = (query: CubeQuery): CubeQuery | null =>
    puuids.length ? apply({ ...query, filters: [crewFilter(puuids), ...(query.filters ?? [])] }, "all") : null

  const summary = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate", "participants.kda"],
      dimensions: ["participants.puuid"],
      limit: NO_LIMIT,
    }),
  )
  const roles = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.winrate"],
      dimensions: ["participants.puuid", "champion_roles.name"],
      filters: PRIMARY_ONLY,
      limit: NO_LIMIT,
    }),
  )
  const champs = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate"],
      dimensions: ["participants.puuid", "champions.name", "champions.icon_path"],
      limit: NO_LIMIT,
    }),
  )
  const error = summary.error ?? roles.error ?? champs.error
  const loading = summary.loading || roles.loading || champs.loading

  const sumOf = (puuid: string) => summary.rows.find((r) => r["participants.puuid"] === puuid)
  const gamesOf = (puuid: string) => n0(sumOf(puuid), "participants.games")
  const wrOf = (puuid: string) => opt(sumOf(puuid), "participants.winrate")

  // 每個人的分析一次算好：一覽表、抽屜都用同一份
  const analysis = useMemo(() => {
    const out = new Map<string, Analysis>()
    for (const p of crew) {
      const s = summary.rows.find((r) => r["participants.puuid"] === p.puuid)
      const base = opt(s, "participants.winrate")
      const radar: RadarDatum[] = ROLES.map((label) => {
        const r = roles.rows.find((x) => x["participants.puuid"] === p.puuid && x["champion_roles.name"] === label)
        return { label, games: n0(r, "participants.games"), wins: n0(r, "participants.wins"), winrate: opt(r, "participants.winrate") }
      })
      const mine = champs.rows
        .filter((r) => r["participants.puuid"] === p.puuid)
        .map((r) => ({
          label: String(r["champions.name"]),
          icon: r["champions.icon_path"] as string,
          games: n0(r, "participants.games"),
          wins: n0(r, "participants.wins"),
          winrate: opt(r, "participants.winrate"),
        }))
      out.set(p.puuid, {
        radar,
        roleCall: classify(radar, base, ROLE_MIN, ROLE_GAP),
        champCall: classify(mine, base, CHAMP_MIN, CHAMP_GAP),
      })
    }
    return out
  }, [crew, summary.rows, roles.rows, champs.rows])

  // 依場次排：場次多的人判斷比較可信，放前面
  const ordered = [...chosen].sort((a, b) => gamesOf(b.puuid) - gamesOf(a.puuid))
  // ── 查英雄：選項是這群人玩過的英雄，依「幾個人玩過、合計幾場」排 ──
  const championOptions = useMemo(() => {
    const m = new Map<string, ChampionOption>()
    for (const r of champs.rows) {
      if (!puuids.includes(String(r["participants.puuid"]))) continue
      const name = String(r["champions.name"])
      const cur = m.get(name) ?? { name, icon: r["champions.icon_path"] as string, games: 0, players: 0 }
      cur.games += n0(r, "participants.games")
      cur.players += 1
      m.set(name, cur)
    }
    return [...m.values()].sort((a, b) => b.players - a.players || b.games - a.games)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champs.rows, puuids.join()])
  const pickedChampion = champion && championOptions.some((o) => o.name === champion) ? champion : (championOptions[0]?.name ?? null)
  const championRows = ordered
    .map((p) => {
      const r = champs.rows.find((x) => x["participants.puuid"] === p.puuid && x["champions.name"] === pickedChampion)
      const base = wrOf(p.puuid)
      const games = n0(r, "participants.games")
      const wr = opt(r, "participants.winrate")
      return {
        player: p,
        games,
        wins: n0(r, "participants.wins"),
        losses: n0(r, "participants.losses"),
        winrate: wr,
        base,
        delta: games && base !== null ? shrunk(games, wr, base) - base : null,
      }
    })
    .sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0))
  const played = championRows.filter((r) => r.games)
  const champTotal = played.reduce((a, r) => a + r.games, 0)
  const champWins = played.reduce((a, r) => a + r.wins, 0)

  if (!players.length) return <Skeleton className="h-[420px] w-full" />
  if (crew.length < 2) {
    return (
      <EmptyState>
        還沒有可以比較的好友。到「追蹤對象」加入一起打的朋友，他們的戰績被採集進來之後就會出現在這裡。
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      {error && <QueryError error={error} />}

      <Panel
        title="比較對象"
        caption="你和追蹤中的好友。點名字可以拿掉或加回來；模式、期間與上方的篩選照常套用。大部分場次是一起打的，勝率會互相牽動，差距要搭配場次看"
      >
        <div className="flex flex-wrap gap-2">
          {crew.map((p) => {
            const on = !excluded.has(p.puuid)
            return (
              <button
                key={p.puuid}
                onClick={() =>
                  setExcluded((cur) => {
                    const next = new Set(cur)
                    if (on) {
                      if (crew.length - next.size <= 1) return cur // 至少留一個
                      next.add(p.puuid)
                    } else next.delete(p.puuid)
                    return next
                  })
                }
                className={cn(
                  "flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition",
                  on ? "border-primary/50 bg-primary/10" : "text-muted-foreground opacity-60 hover:opacity-100",
                )}
              >
                <Check className={cn("size-3.5 shrink-0", on ? "text-primary" : "opacity-0")} />
                <PlayerName player={p} />
              </button>
            )
          })}
        </div>
      </Panel>

      {/* ── 全員一覽：每人一列，迷你六邊形 + 適合／不適合 ── */}
      <Panel
        title="全員一覽"
        caption={`六邊形的形狀是他各類型的場次比例（只算主定位，最常玩的那一類頂到外框；滑過看確切比例），頂點與字的顏色是適不適合。適合／不適合：勝率依場次往他自己的整體勝率收縮後，類型差 ${ROLE_GAP} 個百分點以上（至少 ${ROLE_MIN} 場）、英雄差 ${CHAMP_GAP} 個百分點以上（至少 ${CHAMP_MIN} 場）才列，數字就是差距。滑過英雄頭像看戰績；點一列看他的完整分析與每隻英雄`}
      >
        {loading ? (
          <Skeleton className="h-[640px] w-full" />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[13rem_6rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-4 border-b px-2 pb-1.5 text-[11px] text-muted-foreground">
                <span>玩家</span>
                <span className="text-center">類型</span>
                <span className="grid grid-cols-2 gap-3">
                  <span className="text-win">適合的類型</span>
                  <span className="text-loss">不適合的類型</span>
                </span>
                <span className="grid grid-cols-2 gap-3">
                  <span className="text-win">適合的英雄</span>
                  <span className="text-loss">不適合的英雄</span>
                </span>
              </div>
              {ordered.map((p, i) => {
                const a = analysis.get(p.puuid)
                const base = wrOf(p.puuid)
                if (!a) return null
                return (
                  <button
                    key={p.puuid}
                    onClick={() => setFocus({ puuid: p.puuid, role: null })}
                    style={{ "--stagger": `${i * 35}ms` } as CSSProperties}
                    className={cn(
                      "slide-in grid w-full grid-cols-[13rem_6rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 rounded-md border-b px-2 py-1 text-left transition hover:bg-accent",
                      focus?.puuid === p.puuid && "bg-primary/10",
                    )}
                  >
                    <span className="min-w-0">
                      <PlayerName player={p} className="text-sm" />
                      <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                        {gamesOf(p.puuid)} 場・
                        <span className={cn(base !== null && base >= 50 ? "text-win" : "text-loss")}>{base?.toFixed(1) ?? "—"}%</span>
                        ・KDA {opt(sumOf(p.puuid), "participants.kda")?.toFixed(2) ?? "—"}
                      </span>
                    </span>
                    <MiniHex data={a.radar} total={gamesOf(p.puuid)} call={a.roleCall} />
                    <span className="grid grid-cols-2 items-center gap-3">
                      <RoleChips items={a.roleCall.good} tone="win" />
                      <RoleChips items={a.roleCall.bad} tone="loss" />
                    </span>
                    <span className="grid grid-cols-2 items-center gap-3">
                      <ChampIcons items={a.champCall.good} tone="win" />
                      <ChampIcons items={a.champCall.bad} tone="loss" />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* ── 查英雄：選一隻，看每個人玩它的勝率 ── */}
      <Panel
        title="查英雄"
        caption="選一隻英雄，看每個人玩它的戰績。右邊是和他自己整體勝率的差距（依場次收縮後），戰績條上的刻度也是他自己的整體勝率"
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ChampionPicker options={championOptions} value={pickedChampion} onChange={setChampion} />
          {pickedChampion && (
            <span className="text-xs text-muted-foreground">
              {played.length} 人玩過・合計 {champTotal} 場・{champWins} 勝 {champTotal - champWins} 敗
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : !pickedChampion ? (
          <EmptyState>這群人還沒有對局。</EmptyState>
        ) : (
          <div className="max-w-[900px] space-y-1">
            {championRows.map((r, i) => (
              <div
                key={r.player.puuid}
                style={{ "--stagger": `${i * 35}ms` } as CSSProperties}
                className={cn(
                  "slide-in grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(8rem,14rem)_4.5rem] items-center gap-3 rounded-md px-2 py-1.5",
                  !r.games && "opacity-60",
                )}
              >
                <PlayerName player={r.player} className="text-[13px]" />
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{r.games ? `${r.games} 場` : ""}</span>
                {r.games ? (
                  <RecordCell winrate={r.winrate} wins={r.wins} losses={r.losses} baseline={r.base} baselineLabel="他自己的整體勝率" />
                ) : (
                  <span className="text-xs text-muted-foreground">沒玩過</span>
                )}
                <span
                  className={cn(
                    "text-right font-mono text-[11px] tabular-nums",
                    r.delta === null || Math.abs(r.delta) < 2 ? "text-muted-foreground" : r.delta > 0 ? "text-win" : "text-loss",
                  )}
                >
                  {r.delta === null ? "" : pp(r.delta)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <DetailDrawer
        open={!!focusPlayer}
        onClose={() => setFocus(null)}
        title={focusPlayer ? <PlayerName player={focusPlayer} /> : ""}
        subtitle={
          focusPlayer
            ? `整體 ${wrOf(focusPlayer.puuid)?.toFixed(1) ?? "—"}%・${round0(gamesOf(focusPlayer.puuid))} 場・KDA ${opt(sumOf(focusPlayer.puuid), "participants.kda")?.toFixed(2) ?? "—"}`
            : undefined
        }
      >
        {focusPlayer && analysis.get(focusPlayer.puuid) && (
          <PlayerDrawerBody
            key={focusPlayer.puuid}
            player={focusPlayer}
            role={focus?.role ?? null}
            overallWr={wrOf(focusPlayer.puuid)}
            total={gamesOf(focusPlayer.puuid)}
            analysis={analysis.get(focusPlayer.puuid)!}
            crewFilter={crewFilter}
            onRole={(role) => setFocus({ puuid: focusPlayer.puuid, role })}
          />
        )}
      </DetailDrawer>
    </div>
  )
}
