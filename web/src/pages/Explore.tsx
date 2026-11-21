import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  Table2,
  BarChart3,
  LineChart,
  Grid3x3,
  ScatterChart as ScatterIcon,
  LayoutGrid,
  Code2,
  Plus,
  X,
  Save,
  Trash2,
  ArrowUpDown,
  User,
  Users,
  Blocks,
  GitFork,
  Grid2x2,
  ListVideo,
  ImageDown,
  Pencil,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel, EmptyState, QueryError } from "@/components/primitives"
import { DrillPanel, MAX_GAME_IDS } from "@/components/MatchList"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { FieldBuilder } from "@/components/FieldBuilder"
import { DrillPath } from "@/components/DrillPath"
import { PivotMatrix } from "@/components/PivotMatrix"
import {
  BarChart,
  Heatmap,
  HOURS_24,
  TrendChart,
  ScatterChart,
  TreemapChart,
  type HeatCell,
  type ScatterPoint,
} from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { useCubeMeta, groupBy, label } from "@/hooks/useCubeMeta"
import { useDrillScope } from "@/hooks/useDrillScope"
import { num, type CubeFilter, type CubeQuery } from "@/lib/cube"
import { COMPANION, MAX_LEVELS, familyOf, type DrillPick } from "@/lib/drill"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"
import { jsonCodec, useUrlState } from "@/lib/urlState"

const VIZ = [
  { value: "table", label: "表格", icon: Table2 },
  { value: "bar", label: "長條", icon: BarChart3 },
  { value: "line", label: "折線", icon: LineChart },
  { value: "scatter", label: "散布", icon: ScatterIcon },
  { value: "treemap", label: "佔比", icon: LayoutGrid },
  { value: "heatmap", label: "熱力圖", icon: Grid3x3 },
] as const
type Viz = (typeof VIZ)[number]["value"]

const OPERATORS = [
  { value: "equals", label: "等於" },
  { value: "notEquals", label: "不等於" },
  { value: "contains", label: "包含" },
  { value: "gt", label: "大於" },
  { value: "gte", label: "至少" },
  { value: "lt", label: "小於" },
  { value: "lte", label: "至多" },
  { value: "set", label: "有值" },
]

/** 三種看法：自己組欄位、一層一層往下鑽、兩個維度交叉。 */
const MODES = [
  { value: "free", label: "自由組合", icon: Blocks },
  { value: "path", label: "下鑽路徑", icon: GitFork },
  { value: "pivot", label: "交叉矩陣", icon: Grid2x2 },
] as const
type Mode = (typeof MODES)[number]["value"]

const DEFAULT_PIVOT = { rows: "champions.name", cols: "matches.duration_bucket" }

type SavedView = UrlView & { id: string; name: string }

/** 一份配置（不含名字）。存檔與網址共用同一個形狀 */
type UrlView = {
  dims: string[]
  measures: string[]
  segments: string[]
  filters: CubeFilter[]
  viz: Viz
  byDay: boolean
  // 下面是後來加的，舊的存檔沒有這些欄位
  mode?: Mode
  path?: string[]
  pivotRows?: string
  pivotCols?: string
  scope?: "account" | "all"
  limit?: string
  sortBy?: string
  sortDir?: "desc" | "asc"
  extraMeasure?: string
  pivotMetric?: string
}

const STORAGE_KEY = "mayhem.explore.views"
/** 長條圖兩個維度時最多並排幾張小圖 */
const SMALL_MULTIPLES = 6
const viewCodec = jsonCodec<UrlView>()

function loadViews(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      data-tip={title}
      className={cn(
        "rounded-md border px-2 py-1 text-xs font-medium transition-all duration-150",
        active
          ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_12px_-2px_var(--primary)]"
          : "border-border text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

const FALLBACK_MEASURES = ["participants.games"]

/** Cube 的 join graph 不是任意成員都能互接；共享 matches 的 participants 家族可以互查，
 * 增幅組合、同場關係與遊玩序列則各自是獨立粒度。先在前端擋住不相容組合，
 * 讓使用者在送出長查詢前知道要換哪一組欄位。 */
const PARTICIPANT_CUBES = new Set([
  "participants",
  "matches",
  "champions",
  "champion_roles",
  "augments",
  "items",
  "participant_context",
  "team_context",
  "builds",
  "comp_context",
  "contribution",
])

function analysisFamily(member: string) {
  const cube = member.split(".")[0]
  return PARTICIPANT_CUBES.has(cube) ? "participants" : cube
}

export function Explore() {
  const { apply, account, drills } = useFilters()
  // 自由探索預設看目前帳號，但可以放開成跨玩家聚合。
  // 鎖死的話「玩家」這個維度永遠只會回傳一列，等於給了不能用的控制項。
  const [scope, setScope] = useState<"account" | "all">("account")
  const { meta, loading: metaLoading, error: metaError } = useCubeMeta()

  const [dims, setDims] = useState<string[]>(["champions.name"])
  const [measures, setMeasures] = useState<string[]>([
    "participants.games",
    "participants.winrate",
  ])
  const [segments, setSegments] = useState<string[]>([])
  const [extraFilters, setExtraFilters] = useState<CubeFilter[]>([])
  const [viz, setViz] = useState<Viz>("table")
  const [byDay, setByDay] = useState(false)
  const [limit, setLimit] = useState("100")
  const [sortBy, setSortBy] = useState<string>("")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")
  const [showQuery, setShowQuery] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [viewName, setViewName] = useState("")

  const [mode, setMode] = useState<Mode>("free")
  const [path, setPath] = useState<string[] | null>(null)
  const [picks, setPicks] = useState<DrillPick[]>([])
  const [extraMeasure, setExtraMeasure] = useState("")
  const [pivot, setPivot] = useState(DEFAULT_PIVOT)
  const [pivotMetric, setPivotMetric] = useState("")

  // 還沒選過路徑就用模型裡的第一條預設路徑
  const activePath = path ?? meta.hierarchies[0]?.levels ?? []
  const changePath = (next: string[]) => {
    setPath(next)
    // 已經點過的條件只在「前面幾層沒變」時保留
    setPicks((prev) => {
      const kept: DrillPick[] = []
      for (const [i, p] of prev.entries()) {
        if (next[i] !== p.member) break
        kept.push(p)
      }
      return kept
    })
  }
  const drillFamily = familyOf((mode === "pivot" ? pivot.rows : activePath[0]) ?? "participants.")
  const drillScope = useDrillScope({ family: drillFamily, scope, segments, filters: extraFilters })

  /** 矩陣點一格：路徑前兩層換成矩陣的列與欄，原本後面的層只要同一家、不重複就接上去 */
  const pickCell = (cellPicks: DrillPick[]) => {
    const family = familyOf(pivot.rows)
    const rest = activePath.filter((d) => d !== pivot.rows && d !== pivot.cols && familyOf(d) === family)
    setPath([pivot.rows, pivot.cols, ...rest].slice(0, MAX_LEVELS))
    setPicks(cellPicks)
    setMode("path")
  }

  useEffect(() => setViews(loadViews()), [])

  // 圖表存成圖片。ResponsiveChart 把 ECharts 實例掛在圖表容器上（__chart）。
  // 底色要先轉成 rgb：主題色可能是 oklch()，直接交給 ECharts 會解析失敗（見 charts.tsx 的 cssVar）
  const vizRef = useRef<HTMLDivElement>(null)
  const downloadPng = () => {
    const el = vizRef.current?.querySelector<HTMLElement>("div[_echarts_instance_]")
    const chart = (el?.parentElement as (HTMLElement & { __chart?: { getDataURL: (o: object) => string } }) | null | undefined)?.__chart
    if (!el || !chart) return
    const ctx = document.createElement("canvas").getContext("2d")!
    ctx.fillStyle = getComputedStyle(el.closest<HTMLElement>('[data-slot="card"]') ?? document.body).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const link = document.createElement("a")
    link.href = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: `rgb(${r}, ${g}, ${b})` })
    link.download = `explore-${viz}-${new Date().toISOString().slice(0, 10)}.png`
    link.click()
  }

  const toggle = (list: string[], set: (v: string[]) => void) => (name: string) =>
    set(list.includes(name) ? list.filter((k) => k !== name) : [...list, name])

  // 後備值要是模組層的常數。寫成行內陣列的話每次 render 都是新的參照，
  // 下面依賴它的 useMemo 就每次都重算，等於沒有 memo。
  const activeMeasures = measures.length ? measures : FALLBACK_MEASURES
  const orderKey = sortBy || activeMeasures[0]

  const queryFamilies = new Set(
    [...dims, ...activeMeasures].map(analysisFamily),
  )
  const queryFamily = queryFamilies.size === 1 ? [...queryFamilies][0] : null
  const filterFamilies = new Set(
    [...extraFilters, ...drills].map((filter) => analysisFamily(filter.member)),
  )
  const queryFamilyError =
    queryFamilies.size > 1
      ? `目前欄位來自不同分析粒度（${[...queryFamilies].join("、")}）。請只保留同一組資料的維度與指標。`
      : queryFamily && [...filterFamilies].some((family) => family !== queryFamily)
        ? `目前查詢套用了其他分析粒度的篩選（${[...filterFamilies].join("、")}）。請清除下鑽或自訂篩選後再查。`
      : queryFamily === "augment_pairs" && segments.length
        ? "增幅組合目前不支援「條件片段」；請清除條件片段，或改回個人／對局表現欄位。"
        : null

  const companions = dims.flatMap((d) =>
    [COMPANION[d]?.icon, COMPANION[d]?.rarity].filter(Boolean) as string[],
  )

  const query: CubeQuery = apply({
    measures: activeMeasures,
    dimensions: [...dims, ...companions],
    ...(segments.length ? { segments } : {}),
    ...(extraFilters.length ? { filters: extraFilters } : {}),
    ...(byDay
      ? { timeDimensions: [{ dimension: "matches.played_at", granularity: "day" }] }
      : {}),
    order: { [orderKey]: sortDir },
    limit: Number(limit),
  }, scope, queryFamily ?? undefined)

  const { rows, loading, error } = useCube(
    mode === "free" && (dims.length || byDay) && !queryFamilyError ? query : null,
  )

  const columns: GridColumn[] = useMemo(
    () => [
      ...(byDay
        ? [{ key: "matches.played_at.day", title: "日期", kind: "dimension" as const }]
        : []),
      ...dims.map((key) => ({
        key,
        title: label(meta.byName.get(key), key),
        kind: "dimension" as const,
        iconKey: COMPANION[key]?.icon,
        rarityKey: COMPANION[key]?.rarity,
      })),
      ...activeMeasures.map((key) => {
        const m = meta.byName.get(key)
        return {
          key,
          title: label(m, key),
          kind: "metric" as const,
          format: (n: number) =>
            (m?.meta?.decimals ?? 1) === 0
              ? Math.round(n).toLocaleString()
              : n.toFixed(m?.meta?.decimals ?? 1),
          suffix: m?.meta?.unit,
        }
      }),
    ],
    [dims, activeMeasures, byDay, meta],
  )

  // 圖表點下去是加篩選；要走到逐場，按結果標題列的「看這幾場」：用同一組條件向 Cube 查是哪幾場。
  // 只在「看目前帳號、欄位是個人／對局表現那一家」時提供——跨玩家或增幅組合的列對不回單一玩家的對局卡片
  const [showGames, setShowGames] = useState(false)
  const canListGames = mode === "free" && scope === "account" && queryFamily === "participants" && !queryFamilyError
  const gamesQuery = apply({
    measures: ["participants.games"],
    dimensions: ["matches.game_id"],
    ...(segments.length ? { segments } : {}),
    ...(extraFilters.length ? { filters: extraFilters } : {}),
    limit: MAX_GAME_IDS,
  })
  const gamesTitle = extraFilters.length
    ? extraFilters.map((f) => `${label(meta.byName.get(f.member), f.member)} ${f.values.join("、")}`).join("・")
    : "目前條件"

  /** 圖表或表格點下去就把該項目變成篩選，跟儀表板的下鑽一致。 */
  const drillInto = (member: string, value: string) => {
    setExtraFilters((prev) =>
      prev.some((f) => f.member === member && f.values[0] === value)
        ? prev
        : [...prev, { member, operator: "equals", values: [value] }],
    )
  }

  const saveView = () => {
    if (!viewName.trim()) return
    const view: SavedView = {
      id: String(Date.now()),
      name: viewName.trim(),
      dims,
      measures: activeMeasures,
      segments,
      filters: extraFilters,
      viz,
      byDay,
      scope,
      limit,
      sortBy,
      sortDir,
      extraMeasure,
      mode,
      path: activePath,
      pivotRows: pivot.rows,
      pivotCols: pivot.cols,
      pivotMetric,
    }
    const next = [...views.filter((v) => v.name !== view.name), view]
    setViews(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setViewName("")
  }

  // 目前的配置放進網址（x=）：重新整理還在、複製網址就能把這張圖連同全域篩選一起給別人。
  // 這頁的狀態很多又互相牽動，所以不是逐個換成 useUrlState，而是整包同步：
  // 進頁時若網址有帶就套用一次，之後每次配置變了就寫回去（等於預設時把參數拿掉）。
  const [urlView, setUrlView] = useUrlState<UrlView | null>("x", null, viewCodec)
  const hydrated = useRef(false)
  const snapshot: UrlView = {
    dims, measures, segments, filters: extraFilters, viz, byDay, scope, limit, sortBy, sortDir,
    extraMeasure, mode, path: path ?? undefined, pivotRows: pivot.rows, pivotCols: pivot.cols, pivotMetric,
  }
  const snapshotKey = JSON.stringify(snapshot)

  const applyView = (v: UrlView) => {
    setDims(v.dims)
    setMeasures(v.measures)
    setSegments(v.segments ?? [])
    setExtraFilters(v.filters ?? [])
    setViz(v.viz)
    setByDay(v.byDay)
    setScope(v.scope ?? "account")
    setLimit(v.limit ?? "100")
    setSortBy(v.sortBy ?? "")
    setSortDir(v.sortDir ?? "desc")
    setExtraMeasure(v.extraMeasure ?? "")
    setMode(v.mode ?? "free")
    if (v.path) setPath(v.path)
    setPicks([])
    if (v.pivotRows && v.pivotCols) setPivot({ rows: v.pivotRows, cols: v.pivotCols })
    setPivotMetric(v.pivotMetric ?? "")
  }

  const defaultKey = useRef(snapshotKey)
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true
      if (urlView) {
        applyView(urlView)
        return
      }
    }
    setUrlView(snapshotKey === defaultKey.current ? null : snapshot)
    // snapshot 的內容就是 snapshotKey；urlView 只在進頁那一次讀
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey])

  // 改名：點鉛筆把那一列換成輸入框，Enter 或離開就存；清空等於不改
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const commitRename = () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (name) {
      const next = views.map((v) => (v.id === renaming.id ? { ...v, name } : v))
      setViews(next)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
    setRenaming(null)
  }

  const removeView = (id: string) => {
    const next = views.filter((v) => v.id !== id)
    setViews(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function renderViz() {
    if (queryFamilyError) {
      return (
        <div
          // 顏色只用主題 token：寫死的 amber-200 在亮色主題幾乎看不見
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground"
          role="alert"
        >
          <div className="font-medium">這組欄位不能一起查詢</div>
          <div className="mt-1 text-xs text-muted-foreground">{queryFamilyError}</div>
        </div>
      )
    }
    if (loading) return <Skeleton className="h-[340px] w-full" />
    if (error) return <QueryError error={error} />
    if (!rows.length) return <EmptyState>這個條件下沒有資料。</EmptyState>

    const firstMeasure = meta.byName.get(activeMeasures[0])
    const suffix = firstMeasure?.meta?.unit ?? ""

    if (viz === "bar") {
      if (dims.length === 2) {
        // 兩個維度：依第二個維度拆成並排的小圖，每張的長條是第一個維度。
        // 不做同一張圖裡多種顏色的分組長條——那需要一組另外驗證過的類別色，小圖並排用單一資料色就讀得出來
        const [inner, outer] = dims
        const groups = new Map<string, typeof rows>()
        for (const r of rows) {
          const key = String(r[outer] ?? "—")
          groups.set(key, [...(groups.get(key) ?? []), r])
        }
        const size = (list: typeof rows) => list.reduce((a, r) => a + (num(r["participants.games"]) ?? num(r["teammates.games"]) ?? 1), 0)
        const ordered = [...groups.entries()].sort((a, b) => size(b[1]) - size(a[1]))
        const shown = ordered.slice(0, SMALL_MULTIPLES)
        return (
          <div className="space-y-2">
            {ordered.length > shown.length && (
              <p className="text-[11px] text-muted-foreground">
                「{label(meta.byName.get(outer), outer)}」有 {ordered.length} 種，只畫場次最多的 {shown.length} 種；其餘請看表格，或加一個篩選縮小範圍。
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {shown.map(([name, list]) => (
                <div key={name} className="min-w-0">
                  <div className="mb-1 truncate text-xs font-medium">{name}</div>
                  <BarChart
                    data={list.map((r) => ({
                      label: String(r[inner] ?? "—"),
                      value: num(r[activeMeasures[0]]) ?? 0,
                      games: num(r["participants.games"]) ?? num(r["teammates.games"]) ?? 0,
                    }))}
                    suffix={suffix}
                    colorBy={activeMeasures[0].endsWith("winrate") ? "value" : "flat"}
                    onPick={(v) => drillInto(inner, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      }
      if (dims.length !== 1) {
        return <EmptyState>長條圖需要一或兩個分組維度（目前 {dims.length} 個）。兩個時會依第二個拆成並排的小圖。</EmptyState>
      }
      return (
        <BarChart
          data={rows.map((r) => ({
            label: String(r[dims[0]] ?? "—"),
            value: num(r[activeMeasures[0]]) ?? 0,
            games: num(r["participants.games"]) ?? num(r["teammates.games"]) ?? 0,
          }))}
          suffix={suffix}
          colorBy={activeMeasures[0].endsWith("winrate") ? "value" : "flat"}
          onPick={(v) => drillInto(dims[0], v)}
        />
      )
    }

    if (viz === "scatter") {
      if (dims.length !== 1 || activeMeasures.length < 2) {
        return (
          <EmptyState>
            散布圖需要一個分組維度和兩個指標（目前 {dims.length} 個維度、
            {activeMeasures.length} 個指標）。
          </EmptyState>
        )
      }
      const [mx, my] = activeMeasures
      const sizeKey = activeMeasures.find((m) => m.endsWith("games")) ?? mx
      const pts: ScatterPoint[] = rows.map((r) => ({
        label: String(r[dims[0]] ?? "—"),
        x: num(r[mx]) ?? 0,
        y: num(r[my]) ?? 0,
        size: num(r[sizeKey]) ?? 1,
      }))
      return (
        <ScatterChart
          points={pts}
          xName={label(meta.byName.get(mx), mx)}
          yName={label(meta.byName.get(my), my)}
          xSuffix={meta.byName.get(mx)?.meta?.unit ?? ""}
          ySuffix={meta.byName.get(my)?.meta?.unit ?? ""}
          onPick={(v) => drillInto(dims[0], v)}
        />
      )
    }

    if (viz === "treemap") {
      if (dims.length !== 1) {
        return <EmptyState>佔比圖需要剛好一個分組維度。</EmptyState>
      }
      const sizeKey = activeMeasures.find((m) => m.endsWith("games")) ?? activeMeasures[0]
      const wrKey = activeMeasures.find((m) => m.endsWith("winrate"))
      return (
        <TreemapChart
          items={rows.slice(0, 60).map((r) => ({
            label: String(r[dims[0]] ?? "—"),
            value: num(r[sizeKey]) ?? 0,
            winrate: wrKey ? num(r[wrKey]) : null,
          }))}
          onPick={(v) => drillInto(dims[0], v)}
        />
      )
    }

    if (viz === "line") {
      if (!byDay) return <EmptyState>折線圖需要開啟「按日期分組」。</EmptyState>
      return (
        <TrendChart
          points={rows.map((r) => ({
            date: String(r["matches.played_at.day"] ?? "").slice(0, 10),
            games: num(r["participants.games"]) ?? 0,
            winrate: num(r[activeMeasures[0]]),
          }))}
        />
      )
    }

    if (viz === "heatmap") {
      if (!dims.includes("matches.weekday") || !dims.includes("matches.hour_of_day")) {
        return <EmptyState>熱力圖需要同時選「星期」和「時段」兩個維度。</EmptyState>
      }
      const cells: HeatCell[] = rows.map((r) => ({
        weekday: Number(r["matches.weekday"]),
        x: Number(r["matches.hour_of_day"]),
        games: num(r["participants.games"]) ?? 0,
        winrate: num(r[activeMeasures[0]]),
      }))
      return <Heatmap cells={cells} xLabels={HOURS_24} />
    }

    return (
      <AgTable
        columns={columns}
        rows={rows}
        height={520}
        fileName="explore"
        onDrill={(col, value) => drillInto(col.key, value)}
      />
    )
  }

  if (metaError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        讀不到語意層模型：{metaError}
      </div>
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel
          title="分析對象"
          caption={
            scope === "account"
              ? "只算這個帳號的表現"
              : "把資料庫裡所有玩家一起算。樣本大很多，但答的是「這個東西普遍好不好」，不是「我用得好不好」"
          }
        >
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={scope}
            onValueChange={(v) => v && setScope(v as "account" | "all")}
            className="w-full"
          >
            <ToggleGroupItem value="account" className="flex-1">
              <User className="size-3.5" />
              {account?.riot_id ?? "目前帳號"}
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1">
              <Users className="size-3.5" />
              全部玩家
            </ToggleGroupItem>
          </ToggleGroup>
          {scope === "all" && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              涵蓋的是「出現在你對局裡的人」，不是全服資料——你沒打過的對局本來就不在資料庫裡。
            </p>
          )}
        </Panel>

        {mode === "free" && (
        <Panel title="欄位配置" caption="拖曳加入，或點擊／按 Enter 直接加入">
          {metaLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <FieldBuilder
              dimensions={meta.dimensions}
              measures={meta.measures}
              selectedDims={dims}
              selectedMeasures={measures}
              onChange={(d, m) => {
                setDims(d)
                setMeasures(m)
              }}
            />
          )}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={byDay}
              onChange={(e) => setByDay(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            另外按日期分組（折線圖需要）
          </label>
        </Panel>
        )}

        {mode === "path" && meta.hierarchies.length > 0 && (
          <Panel title="預設路徑" caption="定義在語意層；選了之後還能逐層換維度、加減層數">
            <div className="space-y-1">
              {meta.hierarchies.map((h) => {
                const active = h.levels.join() === activePath.join()
                return (
                  <button
                    key={h.name}
                    onClick={() => {
                      setPath(h.levels)
                      setPicks([])
                    }}
                    className={cn(
                      "w-full rounded-md border px-2.5 py-1.5 text-left transition",
                      active ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent",
                    )}
                  >
                    <div className={cn("text-xs font-medium", active && "text-primary")}>{h.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {h.levels.map((l) => label(meta.byName.get(l), l)).join(" › ")}
                    </div>
                  </button>
                )
              })}
            </div>
          </Panel>
        )}

        {meta.segments.length > 0 && (
          <Panel title="條件片段" caption="模型裡定義好的可重用篩選">
            <div className="flex flex-wrap gap-1.5">
              {meta.segments.map((s) => (
                <Chip
                  key={s.name}
                  active={segments.includes(s.name)}
                  onClick={() => toggle(segments, setSegments)(s.name)}
                >
                  {s.shortTitle ?? s.title}
                </Chip>
              ))}
            </div>
          </Panel>
        )}

        <FilterBuilder
          meta={meta}
          filters={extraFilters}
          onChange={setExtraFilters}
        />

        {mode === "free" && (
        <Panel title="排序與筆數">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select value={sortBy || activeMeasures[0]} onValueChange={setSortBy}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeMeasures.map((m) => (
                    <SelectItem key={m} value={m}>
                      {label(meta.byName.get(m), m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
                data-tip={sortDir === "desc" ? "由大到小" : "由小到大"}
              >
                <ArrowUpDown className="size-3.5" />
                {sortDir === "desc" ? "降冪" : "升冪"}
              </Button>
            </div>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["20", "50", "100", "500", "2000", "50000"].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n === "50000" ? "全部" : `${n} 筆`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Panel>
        )}

        <Panel title="儲存的檢視" caption="存在瀏覽器裡，隨時叫回同一組設定">
          <div className="mb-2 flex gap-2">
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveView()}
              placeholder="命名這組設定…"
              aria-label="儲存檢視名稱"
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" onClick={saveView} disabled={!viewName.trim()} aria-label="儲存檢視">
              <Save className="size-3.5" />
            </Button>
          </div>
          {views.length === 0 ? (
            <p className="text-xs text-muted-foreground">還沒有儲存任何檢視。</p>
          ) : (
            <div className="space-y-1">
              {views.map((v) => (
                <div key={v.id} className="flex items-center gap-1">
                  {renaming?.id === v.id ? (
                    <Input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                      onKeyDown={(e) => (e.key === "Enter" ? commitRename() : e.key === "Escape" && setRenaming(null))}
                      onBlur={commitRename}
                      aria-label={`重新命名檢視 ${v.name}`}
                      className="h-7 min-w-0 flex-1 text-xs"
                    />
                  ) : (
                    <button
                      onClick={() => applyView(v)}
                      className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs transition hover:bg-accent"
                    >
                      {v.name}
                    </button>
                  )}
                  <button
                    onClick={() => setRenaming({ id: v.id, name: v.name })}
                    className="rounded-sm p-1 text-muted-foreground opacity-60 transition hover:text-foreground hover:opacity-100"
                    aria-label={`重新命名檢視 ${v.name}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onClick={() => removeView(v.id)}
                    className="rounded-sm p-1 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100"
                    aria-label={`刪除檢視 ${v.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as Mode)}
        >
          {MODES.map((m) => (
            <ToggleGroupItem key={m.value} value={m.value} className="px-3">
              <m.icon className="size-3.5" />
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {mode === "path" && (
          <DrillPath
            meta={meta}
            path={activePath}
            onPathChange={changePath}
            picks={picks}
            onPicksChange={setPicks}
            extraMeasure={extraMeasure}
            onExtraMeasureChange={setExtraMeasure}
            scoped={drillScope.scoped}
            ignored={drillScope.ignored}
            scopeAll={scope === "all"}
          />
        )}

        {mode === "pivot" && (
          <PivotMatrix
            meta={meta}
            rowsDim={pivot.rows}
            colsDim={pivot.cols}
            onDimsChange={(rows, cols) => setPivot({ rows, cols })}
            metric={pivotMetric}
            onMetricChange={setPivotMetric}
            scoped={drillScope.scoped}
            ignored={drillScope.ignored}
            onPickCell={pickCell}
          />
        )}

        {mode === "free" && (
        <>
        <Panel
          title="結果"
          caption={
            loading
              ? "查詢中…"
              : `${rows.length} 列 · ${scope === "account" ? (account?.riot_id ?? "目前帳號") : "全部玩家"}`
          }
          action={
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={viz}
                onValueChange={(v) => v && setViz(v as Viz)}
              >
                {VIZ.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} aria-label={item.label}>
                    <item.icon className="size-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {viz !== "table" && rows.length > 0 && (
                <Button size="sm" variant="ghost" onClick={downloadPng} aria-label="下載圖表圖片" data-tip="把這張圖存成 PNG（兩倍解析度，底色用目前主題的卡片色）">
                  <ImageDown className="size-3.5" />
                </Button>
              )}
              {canListGames && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowGames(true)}
                  data-tip={"列出符合目前條件的每一場。\n想只看某一根長條的場次：先點它（會變成一個篩選），再按這裡。"}
                >
                  <ListVideo className="size-3.5" />
                  看這幾場
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowQuery((v) => !v)}
                aria-label={showQuery ? "隱藏 Cube 查詢" : "顯示 Cube 查詢"}
                data-tip={showQuery ? "隱藏 Cube 查詢" : "顯示 Cube 查詢"}
              >
                <Code2 className="size-3.5" />
              </Button>
            </div>
          }
        >
          {!dims.length && !byDay ? (
            <EmptyState>至少選一個分組維度，或開啟「按日期分組」。</EmptyState>
          ) : (
            // 換圖表種類或欄位時整塊重新浮現。用 index.css 的 rise（CSS、只動 opacity／transform），
            // 不用 motion：JS 逐幀的動畫會被同時掛載的表格卡住（ui-conventions 動畫規則 1）
            <div key={`${viz}-${dims.join()}-${activeMeasures.join()}`} ref={vizRef} className="rise">
              {renderViz()}
            </div>
          )}
        </Panel>

          {/* 只淡入：原本用 motion 推高度並做離場動畫，兩樣都不在允許的範圍（高度會觸發排版、不做離場） */}
          {showQuery && (
            <div className="reveal">
              <Panel
                title="送給 Cube 的查詢"
                caption="前端只送成員名稱，SQL 由 Cube 依模型產生"
              >
                <pre className="overflow-x-auto rounded-md bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(query, null, 2)}
                </pre>
              </Panel>
            </div>
          )}
        </>
        )}
      </div>
      {showGames && canListGames && (
        <DrillPanel title={gamesTitle} gameIdKey="matches.game_id" query={gamesQuery} onClose={() => setShowGames(false)} />
      )}
    </div>
  )
}

function FilterBuilder({
  meta,
  filters,
  onChange,
}: {
  meta: ReturnType<typeof useCubeMeta>["meta"]
  filters: CubeFilter[]
  onChange: (f: CubeFilter[]) => void
}) {
  const { apply } = useFilters()
  const [member, setMember] = useState("")
  const [operator, setOperator] = useState("equals")
  const [value, setValue] = useState("")
  const listId = useId()

  // 多值：「等於／不等於／包含」可以一次給好幾個（逗號或頓號分開），也可以同一個欄位再加一次——
  // 會併進同一個條件（任一個符合就算），不是另開一個互相打架的條件。
  // 數值區間用「至少」加「至多」兩個條件。
  const multi = operator === "equals" || operator === "notEquals" || operator === "contains"
  const add = () => {
    if (!member) return
    if (operator === "set") return onChange([...filters, { member, operator, values: [] }])
    const typed = (multi ? value.split(/[,，、]/) : [value]).map((v) => v.trim()).filter(Boolean)
    if (!typed.length) return
    const same = filters.findIndex((f) => f.member === member && f.operator === operator)
    onChange(
      multi && same >= 0
        ? filters.map((f, i) => (i === same ? { ...f, values: [...new Set([...f.values, ...typed])] } : f))
        : [...filters, { member, operator, values: typed }],
    )
    setValue("")
  }

  const all = [...meta.dimensions, ...meta.measures]

  // 值的自動完成：選的是文字維度時，向 Cube 查它實際出現過哪些值（跨玩家、套用目前的模式與期間），
  // 用原生 datalist 顯示——打幾個字就能選，不必背「對局長度」的分組叫什麼。
  // 查不到（那一家 cube 接不上全域條件）就沒有建議，照樣可以自己打。
  const picked = meta.byName.get(member)
  const suggestable = !!picked && picked.type === "string" && meta.dimensions.some((d) => d.name === member) && multi
  const family = analysisFamily(member)
  const options = useCube(
    suggestable && (family === "participants" || family === "augment_pairs")
      ? apply({ dimensions: [member], limit: 500 }, "all", family)
      : null,
  )
  const suggestions = suggestable && !options.error ? options.rows.map((r) => r[member]).filter((v): v is string => typeof v === "string" && v !== "") : []

  return (
    <Panel title="自訂篩選" caption="任何維度或指標都能當條件">
      <div className="space-y-2">
        <Select value={member} onValueChange={setMember}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="選擇欄位…" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {[...groupBy(all).entries()].map(([group, items]) => (
              <div key={group}>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {items.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {label(m, m.name)}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger size="sm" className="w-[104px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={operator === "set" ? "（不需要值）" : multi ? "值…（多個用逗號分開）" : "值…"}
            disabled={operator === "set"}
            aria-label="篩選值"
            list={suggestions.length ? listId : undefined}
            className="h-8 flex-1 text-xs"
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          <Button size="sm" variant="outline" onClick={add} disabled={!member} aria-label="新增篩選">
            <Plus className="size-3.5" />
          </Button>
        </div>

        {filters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {filters.map((f, i) => (
              <Badge key={i} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5 text-[11px]">
                {label(meta.byName.get(f.member), f.member)}{" "}
                {OPERATORS.find((o) => o.value === f.operator)?.label} {f.values.join("、")}
                <button
                  onClick={() => onChange(filters.filter((_, j) => j !== i))}
                  className="opacity-60 transition hover:opacity-100"
                  aria-label="移除"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
