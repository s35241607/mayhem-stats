import { useMemo, useState, type CSSProperties } from "react"
import { ArrowRight, Check, ChevronsUpDown, Search } from "lucide-react"
import { RecordCell } from "@/components/cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, Panel, QueryError } from "@/components/primitives"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { RadarChart, SHRINK_K, shrunk, type RadarDatum } from "@/components/charts"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useFilters, type Player } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { useNavigate } from "@/lib/nav"
import { cn } from "@/lib/utils"
import { BUILD_ROLES, BUILD_SHORT, MIN_GAMES, NO_LIMIT, round0 } from "./shared"

// ── 「適合／不適合」的判斷：勝率 × 表現 ───────────────────────────────
// 勝率：和這個人「自己的」整體勝率比（每個人本來水準不同），依場次往他的平均收縮後的差距。
// 表現：語意層的 builds.perf_index——這個出裝定位的關鍵指標（輸出與刺客看傷害佔比、坦克看承傷佔比、
//       鬥士／AP 坦看兩者平均、輔助看參團率）和全資料庫同定位平均的差距。同樣依場次往 0 收縮。
// 兩個都達標才叫「適合」、兩個都不達標才叫「不適合」；只有一邊的給次級標籤，
// 例如勝率好但表現差 =「靠隊友」：這個定位該做的事做得比一般人少，贏多半是陣容或隊友。
// 門檻跟著目前的篩選即時算，所以留在前端；定位與表現分數的定義在語意層（cube/model/cubes/builds.yml）。
const ROLE_MIN = MIN_GAMES
const CHAMP_MIN = 3
const WR_GAP_ROLE = 3
const WR_GAP_CHAMP = 5
const PERF_GAP = 2
const PICKS_SHOWN = 3

const n0 = (r: CubeRow | undefined, k: string) => (r ? (num(r[k]) ?? 0) : 0)
const opt = (r: CubeRow | undefined, k: string) => (r ? num(r[k]) : null)
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`

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

type Verdict = "good" | "potential" | "winning" | "bad" | "weak" | "losing" | "lucky"

const VERDICT: Record<Verdict, { label: string; side: "pos" | "neg"; strong: boolean; hint: string }> = {
  good: { label: "適合", side: "pos", strong: true, hint: "勝率和表現都比平常好" },
  potential: { label: "有潛力", side: "pos", strong: false, hint: "表現好，勝率還沒跟上" },
  winning: { label: "勝率好", side: "pos", strong: false, hint: "勝率比平常高，表現和一般人差不多" },
  bad: { label: "不適合", side: "neg", strong: true, hint: "勝率和表現都比平常差" },
  weak: { label: "表現弱", side: "neg", strong: false, hint: "這個定位該做的事做得比一般人少" },
  losing: { label: "勝率差", side: "neg", strong: false, hint: "勝率比平常低，表現和一般人差不多" },
  lucky: { label: "靠隊友", side: "neg", strong: false, hint: "勝率好，但這個定位該做的事做得比一般人少" },
}
const ORDER: Verdict[] = ["good", "potential", "winning", "bad", "lucky", "weak", "losing"]

function judge(wr: number, perf: number, wrGap: number): Verdict | null {
  const wrUp = wr >= wrGap
  const wrDown = wr <= -wrGap
  const pUp = perf >= PERF_GAP
  const pDown = perf <= -PERF_GAP
  if (wrUp && pUp) return "good"
  if (wrDown && pDown) return "bad"
  if (pUp) return "potential"
  if (wrUp && pDown) return "lucky"
  if (wrUp) return "winning"
  if (pDown) return "weak"
  if (wrDown) return "losing"
  return null
}

type Item = { label: string; icon?: string; games: number; wins: number; winrate: number | null; perf: number | null }
type Pick = Item & { wr: number; perfAdj: number; verdict: Verdict }
type Call = { pos: Pick[]; neg: Pick[]; all: Pick[] }

/** 依勝率差與表現分數把一組（出裝定位或英雄）分成正面／負面兩邊 */
function classify(items: Item[], base: number | null, minGames: number, wrGap: number, limit = PICKS_SHOWN): Call {
  if (base === null) return { pos: [], neg: [], all: [] }
  const all = items
    .filter((i) => i.games >= minGames)
    .map((i) => {
      const wr = shrunk(i.games, i.winrate, base) - base
      const perfAdj = i.perf === null ? 0 : (i.games * i.perf) / (i.games + SHRINK_K)
      return { ...i, wr, perfAdj, verdict: judge(wr, perfAdj, wrGap) }
    })
    .filter((i): i is Pick => i.verdict !== null)
  // 強的判斷在前，同一級依「勝率差＋表現」的絕對值排，並列依名稱
  const rank = (a: Pick, b: Pick) =>
    ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) ||
    Math.abs(b.wr + b.perfAdj) - Math.abs(a.wr + a.perfAdj) ||
    b.games - a.games ||
    a.label.localeCompare(b.label, "zh-Hant")
  const sorted = [...all].sort(rank)
  return {
    pos: sorted.filter((i) => VERDICT[i.verdict].side === "pos").slice(0, limit),
    neg: sorted.filter((i) => VERDICT[i.verdict].side === "neg").slice(0, limit),
    all,
  }
}

const tip = (i: Pick) =>
  `${i.label}・${VERDICT[i.verdict].label}（${VERDICT[i.verdict].hint}）\n` +
  `${i.games} 場・${i.wins} 勝 ${i.games - i.wins} 敗・勝率 ${i.winrate?.toFixed(1)}%\n` +
  `勝率比他自己平均 ${signed(i.wr)}pp・表現比同定位的人 ${signed(i.perfAdj)}pp`

function verdictClass(v: Verdict) {
  const { side, strong } = VERDICT[v]
  if (side === "pos") return strong ? "border-win/50 bg-win/15 text-win font-semibold" : "border-dashed border-win/40 text-win"
  return strong ? "border-loss/50 bg-loss/15 text-loss font-semibold" : "border-dashed border-loss/40 text-loss"
}

/** 迷你雷達（出裝定位八個頂點）：形狀是各出裝定位佔他自己場次的比例（偏好怎麼玩），頂點是判斷結果。
 *
 *  一覽表裡每人一個，七個人上下排成一欄就能一眼比形狀。用 SVG 而不是 ECharts：
 *  七個 canvas 實例的成本不值得，這裡也不需要互動。外框是「他自己最常用的那種出裝」，
 *  形狀才撐得開（全員同一把尺時，某人 AD 輸出佔一半，其他人全縮成一團點）。 */
function MiniHex({ data, total, call, size = 96 }: { data: RadarDatum[]; total: number; call: Call; size?: number }) {
  const c = size / 2
  const r = size / 2 - 14 // 留位置給標籤
  const n = data.length
  const at = (i: number, frac: number) => {
    const a = ((90 + (i * 360) / n) * Math.PI) / 180 // 和 ECharts 雷達同方向：正上方開始、逆時針
    return [c + Math.cos(a) * r * frac, c - Math.sin(a) * r * frac] as const
  }
  const ring = (frac: number) => data.map((_, i) => at(i, frac).join(",")).join(" ")
  const verdictOf = new Map(call.all.map((p) => [p.label, p.verdict]))
  const share = data.map((d) => (total ? d.games / total : 0))
  const scaleMax = Math.max(0.01, ...share)
  const tone = (label: string) => {
    const v = verdictOf.get(label)
    if (!v) return "fill-muted-foreground"
    return VERDICT[v].side === "pos" ? "fill-win" : "fill-loss"
  }
  const text = data
    .map((d, i) => `${d.label} ${Math.round(share[i] * 100)}%（${d.games} 場${verdictOf.get(d.label) ? `，${VERDICT[verdictOf.get(d.label)!].label}` : ""}）`)
    .join("\n")
  return (
    // 八個頂點時左右兩端的標籤會貼到邊，overflow 放出去（欄與欄之間有 gap，不會壓到別人）
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 overflow-visible">
      <title>{`各出裝定位佔他場次的比例\n${text}`}</title>
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
        const [lx, ly] = at(i, 1.3)
        const v = verdictOf.get(d.label)
        return (
          <g key={d.label}>
            <circle cx={x} cy={y} r={v && VERDICT[v].strong ? 3.2 : v ? 2.6 : 1.8} className={tone(d.label)} />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn("text-[9px] font-semibold", tone(d.label))}
            >
              {BUILD_SHORT[d.label] ?? d.label.slice(0, 1)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 出裝定位的判斷標籤：「適合 AP 輸出」，實心是強判斷、虛線框是次級 */
function RoleChips({ items }: { items: Pick[] }) {
  if (!items.length) return <span className="text-[11px] text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap content-start items-start gap-1">
      {items.map((i) => (
        <span key={i.label} title={tip(i)} className={cn("rounded border px-1.5 py-0.5 text-[11px]", verdictClass(i.verdict))}>
          <span className="opacity-80">{VERDICT[i.verdict].label}</span> {i.label}
        </span>
      ))}
    </span>
  )
}

/** 英雄頭像列：外框實線是強判斷、虛線是次級；滑過看戰績、勝率差與表現 */
function ChampIcons({ items }: { items: Pick[] }) {
  if (!items.length) return <span className="text-[11px] text-muted-foreground">—</span>
  return (
    <span className="flex gap-1.5">
      {items.map((i) => {
        const pos = VERDICT[i.verdict].side === "pos"
        return (
          <span key={i.label} title={tip(i)} className="relative shrink-0">
            <img
              src={iconUrl(i.icon)}
              alt={i.label}
              className={cn(
                "size-8 rounded-md bg-icon-tile",
                VERDICT[i.verdict].strong ? "ring-2" : "ring-1 opacity-80",
                pos ? "ring-win/80" : "ring-loss/80",
              )}
            />
            <span
              className={cn(
                "absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-background px-0.5 text-[9px] leading-tight",
                pos ? "text-win" : "text-loss",
              )}
            >
              {VERDICT[i.verdict].label}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** 抽屜裡的判斷清單：每項一列，判斷＋勝率差＋表現 */
function PickList({ title, items, empty }: { title: string; items: Pick[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{title}</div>
      {items.length ? (
        <div className="space-y-1">
          {items.map((i) => (
            <div key={i.label} className="flex items-center gap-2" title={tip(i)}>
              {i.icon && <img src={iconUrl(i.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />}
              <span className="min-w-0 flex-1 truncate text-[13px]">{i.label}</span>
              <span className={cn("shrink-0 rounded border px-1.5 text-[11px]", verdictClass(i.verdict))}>{VERDICT[i.verdict].label}</span>
              <span className="w-[112px] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                勝 {signed(i.wr)}・表 {signed(i.perfAdj)}
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

/** 抽屜：某個人的完整分析（大雷達圖 + 判斷），以及他（在某種出裝下）玩過的每隻英雄。 */
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
        measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate", "builds.perf_index"],
        dimensions: ["champions.name", "champions.icon_path"],
        filters: [crewFilter([player.puuid]), ...(role ? [{ member: "builds.build_role", operator: "equals" as const, values: [role] }] : [])],
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
          <div className="text-sm font-semibold">各出裝定位的勝率</div>
          <div className="text-[11px] text-muted-foreground">
            依終場裝備判斷的定位；虛線圈是他自己的整體勝率 {overallWr?.toFixed(1) ?? "—"}%。點某一類的方向，下面只列那種出裝的英雄
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
          <PickList title="出裝定位：好的一面" items={analysis.roleCall.pos} empty="沒有明顯比平常好的定位" />
          <PickList title="出裝定位：要注意的" items={analysis.roleCall.neg} empty="沒有明顯比平常差的定位" />
          <PickList title="英雄：好的一面" items={analysis.champCall.pos} empty={`還沒有英雄在 ${CHAMP_MIN} 場以上明顯比平常好`} />
          <PickList title="英雄：要注意的" items={analysis.champCall.neg} empty={`還沒有英雄在 ${CHAMP_MIN} 場以上明顯比平常差`} />
          <p className="text-[11px] text-muted-foreground">
            「勝」是勝率比他自己平均高幾個百分點；「表」是這個定位的關鍵指標比全資料庫同定位的人高幾個百分點
            （輸出與刺客看傷害佔比、坦克看承傷佔比、鬥士／AP 坦看兩者平均、輔助看參團率）。都已依場次收縮
          </p>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{role ? `出裝是${role}時玩過的英雄` : "玩過的每隻英雄"}</div>
        {role && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRole(null)}>
            看全部出裝
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
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(9rem,13rem)_4.5rem] gap-3 px-2 text-[11px] text-muted-foreground">
            <span>英雄</span>
            <span>場次</span>
            <span>戰績（刻度＝他自己的整體勝率）</span>
            <span className="text-right">表現</span>
          </div>
          {champs.rows.map((r, i) => {
            const perf = opt(r, "participants.games") ? opt(r, "builds.perf_index") : null
            return (
              <div
                key={String(r["champions.name"])}
                style={{ "--stagger": `${Math.min(i * 30, 400)}ms` } as CSSProperties}
                className="slide-in grid grid-cols-[minmax(0,1fr)_4rem_minmax(9rem,13rem)_4.5rem] items-center gap-3 rounded-md px-2 py-1.5"
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
                <span
                  title="這幾場的定位關鍵指標和全資料庫同定位平均的差距（百分點，未收縮）"
                  className={cn(
                    "text-right font-mono text-[11px] tabular-nums",
                    perf === null || Math.abs(perf) < PERF_GAP ? "text-muted-foreground" : perf > 0 ? "text-win" : "text-loss",
                  )}
                >
                  {perf === null ? "—" : `${signed(perf)}pp`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── 陣容情境 ─────────────────────────────────────────────────────────
// 分組與前排的定義在語意層（cube/model/cubes/comp_context.yml），這裡只決定怎麼畫。
const CONTEXTS = {
  ally_frontline: { label: "隊友前排數", dim: "comp_context.ally_frontline", buckets: ["0 個", "1 個", "2 個以上"], head: "隊上（不含自己）有幾個前排" },
  enemy_frontline: { label: "敵方前排數", dim: "comp_context.enemy_frontline", buckets: ["0 個", "1 個", "2 個", "3 個以上"], head: "敵方有幾個前排" },
  enemy_damage_type: { label: "敵方傷害類型", dim: "comp_context.enemy_damage_type", buckets: ["物理偏多", "均衡", "魔法偏多"], head: "敵方的傷害以什麼為主" },
  ally_damage_type: { label: "隊友傷害類型", dim: "comp_context.ally_damage_type", buckets: ["物理偏多", "均衡", "魔法偏多"], head: "隊友（不含自己）的傷害以什麼為主" },
} as const
type ContextKey = keyof typeof CONTEXTS
/** 矩陣格子至少幾場才上色、才列進建議：一兩場的格子只顯示數字 */
const CELL_MIN = 3

/** 格子底色：往比較基準收縮後的偏離幅度分四級，用主題 token 的透明度疊；偏離不到 2pp 不上色 */
function tintClass(dev: number) {
  const a = Math.abs(dev)
  if (a < 2) return "bg-muted/40"
  if (dev > 0) return a < 5 ? "bg-win/15" : a < 10 ? "bg-win/30" : "bg-win/45"
  return a < 5 ? "bg-loss/15" : a < 10 ? "bg-loss/30" : "bg-loss/45"
}

/** 陣容情境：選一個人、一種陣容分組，看他在各種陣容下出各種裝的勝率，並列出每種陣容的建議。 */
function CompContext({
  people,
  q,
  wrOf,
}: {
  people: Player[]
  q: (query: CubeQuery) => CubeQuery | null
  wrOf: (puuid: string) => number | null
}) {
  const [ctx, setCtx] = useState<ContextKey>("ally_frontline")
  const [who, setWho] = useState<string | null>(null)
  const person = people.find((p) => p.puuid === who) ?? people.find((p) => p.is_me) ?? people[0]
  const spec = CONTEXTS[ctx]
  const data = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.winrate", "builds.perf_index"],
      dimensions: ["participants.puuid", "builds.build_role", spec.dim],
      limit: NO_LIMIT,
    }),
  )
  if (!person) return null
  const base = wrOf(person.puuid)
  const mine = data.rows.filter((r) => r["participants.puuid"] === person.puuid)
  const cell = (role: string | null, bucket: string | null) => {
    const rows = mine.filter((r) => (role === null || r["builds.build_role"] === role) && (bucket === null || r[spec.dim] === bucket))
    const games = rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
    const wins = rows.reduce((a, r) => a + n0(r, "participants.wins"), 0)
    // 表現分數依場次加權合併（每一列本來就是那幾場的平均）
    const pw = rows.reduce((a, r) => a + (opt(r, "builds.perf_index") ?? 0) * n0(r, "participants.games"), 0)
    const winrate = games ? (100 * wins) / games : null
    return { games, wins, winrate, perf: games ? pw / games : null }
  }
  const dev = (c: ReturnType<typeof cell>) => (c.games && base !== null ? shrunk(c.games, c.winrate, base) - base : 0)
  // 每種陣容下的建議：場次夠、收縮後比他自己平均高／低 3pp 以上的出裝
  const advice = spec.buckets.map((b) => {
    const scored = BUILD_ROLES.map((role) => ({ role, c: cell(role, b) }))
      .filter((x) => x.c.games >= CELL_MIN)
      .map((x) => ({ ...x, d: dev(x.c) }))
    return {
      bucket: b,
      good: scored.filter((x) => x.d >= WR_GAP_ROLE).sort((a, b2) => b2.d - a.d).slice(0, 2),
      bad: scored.filter((x) => x.d <= -WR_GAP_ROLE).sort((a, b2) => a.d - b2.d).slice(0, 2),
    }
  })
  const cellTitle = (role: string | null, bucket: string | null, c: ReturnType<typeof cell>) =>
    `${role ?? "所有出裝"}・${bucket ? `${spec.label} ${bucket}` : "所有陣容"}\n` +
    (c.games
      ? `${c.games} 場・${c.wins} 勝 ${c.games - c.wins} 敗・勝率 ${c.winrate?.toFixed(1)}%\n比他自己平均 ${signed(dev(c))}pp（依場次收縮）` +
        (c.perf === null ? "" : `・表現 ${signed(c.perf)}pp`)
      : "沒有對局")

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={person.puuid}
          onChange={(e) => setWho(e.target.value)}
          className="h-8 max-w-[16rem] rounded-md border bg-background px-2 text-sm"
          aria-label="要看的玩家"
        >
          {people.map((p) => (
            <option key={p.puuid} value={p.puuid}>
              {splitId(p.riot_id, p.puuid).name}
              {p.is_me ? "（我）" : ""}
            </option>
          ))}
        </select>
        <ToggleGroup type="single" size="sm" variant="outline" value={ctx} onValueChange={(v) => v && setCtx(v as ContextKey)}>
          {(Object.keys(CONTEXTS) as ContextKey[]).map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {CONTEXTS[k].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          基準：他自己的整體勝率 {base?.toFixed(1) ?? "—"}%
        </span>
      </div>
      {data.loading ? (
        <Skeleton className="h-[360px] w-full" />
      ) : data.error ? (
        <div className="text-sm text-destructive">{data.error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="w-[120px] px-2 text-left font-normal">
                  出裝 ＼ {spec.head}
                </th>
                {spec.buckets.map((b) => (
                  <th key={b} className="px-2 text-center font-medium text-foreground">
                    {b}
                  </th>
                ))}
                <th className="px-2 text-center font-normal">所有陣容</th>
              </tr>
            </thead>
            <tbody>
              {[...BUILD_ROLES, null].map((role, i) => {
                const total = cell(role, null)
                if (role !== null && !total.games) return null
                return (
                  <tr key={role ?? "all"} className="rise" style={{ "--stagger": `${i * 35}ms` } as CSSProperties}>
                    <td className={cn("px-2 text-[13px]", role === null ? "font-semibold" : "font-medium")}>{role ?? "所有出裝"}</td>
                    {[...spec.buckets, null].map((b) => {
                      const c = b === null ? total : cell(role, b)
                      const colored = c.games >= CELL_MIN
                      return (
                        <td key={b ?? "all"} className="p-0">
                          <div
                            title={cellTitle(role, b, c)}
                            className={cn(
                              "flex h-12 flex-col items-center justify-center rounded-md",
                              !c.games ? "bg-muted/15" : colored ? tintClass(dev(c)) : "bg-muted/25",
                              (b === null || role === null) && "ring-1 ring-border",
                            )}
                          >
                            {c.games ? (
                              <>
                                <span className={cn("font-mono text-sm tabular-nums", colored ? "font-semibold" : "text-muted-foreground")}>
                                  {c.winrate?.toFixed(0)}%
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {c.wins}-{c.games - c.wins}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {advice.map((a) => (
              <div key={a.bucket} className="rounded-md border p-2 text-[12px]">
                <div className="mb-1 font-semibold">
                  {spec.label}：{a.bucket}
                </div>
                <div className="flex flex-wrap gap-1">
                  {a.good.map((x) => (
                    <span key={x.role} title={cellTitle(x.role, a.bucket, x.c)} className="rounded border border-win/50 bg-win/15 px-1.5 text-win">
                      適合 {x.role} {signed(x.d)}
                    </span>
                  ))}
                  {a.bad.map((x) => (
                    <span key={x.role} title={cellTitle(x.role, a.bucket, x.c)} className="rounded border border-loss/50 bg-loss/15 px-1.5 text-loss">
                      避開 {x.role} {signed(x.d)}
                    </span>
                  ))}
                  {!a.good.length && !a.bad.length && (
                    <span className="text-muted-foreground">沒有明顯的差別（或每種出裝都不到 {CELL_MIN} 場）</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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
      measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate", "participants.kda", "builds.perf_index"],
      dimensions: ["participants.puuid"],
      limit: NO_LIMIT,
    }),
  )
  const roles = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.winrate", "builds.perf_index"],
      dimensions: ["participants.puuid", "builds.build_role"],
      limit: NO_LIMIT,
    }),
  )
  const champs = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate", "builds.perf_index"],
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
      const roleRows = BUILD_ROLES.map((label) => {
        const r = roles.rows.find((x) => x["participants.puuid"] === p.puuid && x["builds.build_role"] === label)
        return {
          label,
          games: n0(r, "participants.games"),
          wins: n0(r, "participants.wins"),
          winrate: opt(r, "participants.winrate"),
          perf: opt(r, "builds.perf_index"),
        }
      })
      const mine = champs.rows
        .filter((r) => r["participants.puuid"] === p.puuid)
        .map((r) => ({
          label: String(r["champions.name"]),
          icon: r["champions.icon_path"] as string,
          games: n0(r, "participants.games"),
          wins: n0(r, "participants.wins"),
          winrate: opt(r, "participants.winrate"),
          perf: opt(r, "builds.perf_index"),
        }))
      out.set(p.puuid, {
        radar: roleRows.map(({ label, games, wins, winrate }) => ({ label, games, wins, winrate })),
        roleCall: classify(roleRows, base, ROLE_MIN, WR_GAP_ROLE),
        champCall: classify(mine, base, CHAMP_MIN, WR_GAP_CHAMP),
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
        perf: games ? opt(r, "builds.perf_index") : null,
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

      {/* ── 全員一覽：每人一列，迷你雷達 + 判斷 ── */}
      <Panel
        title="全員一覽"
        caption={`定位依「終場出裝」判斷（AD 輸出、AD 刺客、AP 輸出、AP 刺客、坦克、AD 鬥士、AP 坦、輔助）：AD 刺客是穿甲裝為主，AP 刺客是 AP 輸出裝配上官方定位為刺客的英雄，其餘不看官方定位。雷達是各出裝佔他場次的比例（最常用的頂到外框）。判斷同時看兩件事：勝率比他自己平均高或低（出裝 ${WR_GAP_ROLE}pp、英雄 ${WR_GAP_CHAMP}pp），以及表現——這個定位的關鍵指標比全資料庫同定位的人高或低 ${PERF_GAP}pp（輸出與刺客看傷害佔比、坦克看承傷佔比、鬥士／AP 坦看兩者平均、輔助看參團率）。兩者都好才是「適合」、都差才是「不適合」，只有一邊的給次級標籤（虛線框）。滑過看數字；點一列看完整分析`}
      >
        {loading ? (
          <Skeleton className="h-[640px] w-full" />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <div className="grid grid-cols-[13rem_6rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-4 border-b px-2 pb-1.5 text-[11px] text-muted-foreground">
                <span>玩家</span>
                <span className="text-center">出裝定位</span>
                <span className="grid grid-cols-2 gap-3">
                  <span className="text-win">出裝：好的一面</span>
                  <span className="text-loss">出裝：要注意的</span>
                </span>
                <span className="grid grid-cols-2 gap-3">
                  <span className="text-win">英雄：好的一面</span>
                  <span className="text-loss">英雄：要注意的</span>
                </span>
              </div>
              {ordered.map((p, i) => {
                const a = analysis.get(p.puuid)
                const base = wrOf(p.puuid)
                const perf = opt(sumOf(p.puuid), "builds.perf_index")
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
                      <span
                        className="block font-mono text-[11px] tabular-nums text-muted-foreground"
                        title="整體表現：各場定位關鍵指標和同定位平均的差距，再平均"
                      >
                        整體表現{" "}
                        <span className={cn(perf === null || Math.abs(perf) < 1 ? "" : perf > 0 ? "text-win" : "text-loss")}>
                          {perf === null ? "—" : `${signed(perf)}pp`}
                        </span>
                      </span>
                    </span>
                    <MiniHex data={a.radar} total={gamesOf(p.puuid)} call={a.roleCall} />
                    <span className="grid grid-cols-2 items-center gap-3">
                      <RoleChips items={a.roleCall.pos} />
                      <RoleChips items={a.roleCall.neg} />
                    </span>
                    <span className="grid grid-cols-2 items-center gap-3">
                      <ChampIcons items={a.champCall.pos} />
                      <ChampIcons items={a.champCall.neg} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* ── 陣容情境：在什麼陣容下，出什麼裝會贏 ── */}
      <Panel
        title="陣容情境"
        caption={`選一個人和一種陣容分組，看他在各種陣容下出各種裝的勝率（格子裡是勝率與勝-敗）。顏色和他自己的整體勝率比，依場次收縮，不到 ${CELL_MIN} 場的格子不上色。前排＝出裝是坦克、AD 鬥士或 AP 坦；隊友都不含自己。下方是每種陣容的建議：比他自己平均高或低 ${WR_GAP_ROLE}pp 以上才列。滑過格子看場次與表現`}
      >
        {loading ? <Skeleton className="h-[420px] w-full" /> : <CompContext people={ordered} q={q} wrOf={wrOf} />}
      </Panel>

      {/* ── 查英雄：選一隻，看每個人玩它的勝率與表現 ── */}
      <Panel
        title="查英雄"
        caption="選一隻英雄，看每個人玩它的戰績。「勝率」是和他自己整體勝率的差距（依場次收縮後），戰績條的刻度也是他自己的整體勝率；「表現」是這幾場的定位關鍵指標和全資料庫同出裝定位平均的差距"
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
          <div className="max-w-[980px] space-y-1">
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(8rem,14rem)_4.5rem_4.5rem] gap-3 px-2 text-[11px] text-muted-foreground">
              <span>玩家</span>
              <span>場次</span>
              <span>戰績</span>
              <span className="text-right">勝率</span>
              <span className="text-right">表現</span>
            </div>
            {championRows.map((r, i) => (
              <div
                key={r.player.puuid}
                style={{ "--stagger": `${i * 35}ms` } as CSSProperties}
                className={cn(
                  "slide-in grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(8rem,14rem)_4.5rem_4.5rem] items-center gap-3 rounded-md px-2 py-1.5",
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
                  {r.delta === null ? "" : `${signed(r.delta)}pp`}
                </span>
                <span
                  className={cn(
                    "text-right font-mono text-[11px] tabular-nums",
                    r.perf === null || Math.abs(r.perf) < PERF_GAP ? "text-muted-foreground" : r.perf > 0 ? "text-win" : "text-loss",
                  )}
                >
                  {r.perf === null ? "" : `${signed(r.perf)}pp`}
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
