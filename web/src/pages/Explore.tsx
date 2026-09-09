import { useEffect, useMemo, useState } from "react"
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
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
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
import { Panel, EmptyState } from "@/components/primitives"
import { DataGrid, type GridColumn } from "@/components/DataGrid"
import { FieldBuilder } from "@/components/FieldBuilder"
import {
  BarChart,
  Heatmap,
  TrendChart,
  ScatterChart,
  TreemapChart,
  type HeatCell,
  type ScatterPoint,
} from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { useCubeMeta, groupBy, label } from "@/hooks/useCubeMeta"
import { num, type CubeFilter, type CubeQuery } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { cn } from "@/lib/utils"

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
  { value: "lt", label: "小於" },
  { value: "set", label: "有值" },
]

/** 帶圖示或稀有度的維度，查詢時要順便把對應欄位撈回來才顯示得出來。 */
const COMPANION: Record<string, { icon?: string; rarity?: string }> = {
  "champions.name": { icon: "champions.icon_path" },
  "augments.name": { icon: "augments.icon_path", rarity: "augments.rarity" },
  "items.name": { icon: "items.icon_path" },
}

type SavedView = {
  id: string
  name: string
  dims: string[]
  measures: string[]
  segments: string[]
  filters: CubeFilter[]
  viz: Viz
  byDay: boolean
}

const STORAGE_KEY = "mayhem.explore.views"

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
      title={title}
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

export function Explore() {
  const { apply, account } = useFilters()
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

  useEffect(() => setViews(loadViews()), [])

  const toggle = (list: string[], set: (v: string[]) => void) => (name: string) =>
    set(list.includes(name) ? list.filter((k) => k !== name) : [...list, name])

  const activeMeasures = measures.length ? measures : ["participants.games"]
  const orderKey = sortBy || activeMeasures[0]

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
  }, scope)

  const { rows, loading, error } = useCube(dims.length || byDay ? query : null)

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
    }
    const next = [...views.filter((v) => v.name !== view.name), view]
    setViews(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setViewName("")
  }

  const applyView = (v: SavedView) => {
    setDims(v.dims)
    setMeasures(v.measures)
    setSegments(v.segments ?? [])
    setExtraFilters(v.filters ?? [])
    setViz(v.viz)
    setByDay(v.byDay)
  }

  const removeView = (id: string) => {
    const next = views.filter((v) => v.id !== id)
    setViews(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function renderViz() {
    if (loading) return <Skeleton className="h-[340px] w-full" />
    if (error) return <div className="text-sm text-destructive">{error}</div>
    if (!rows.length) return <EmptyState>這個條件下沒有資料。</EmptyState>

    const firstMeasure = meta.byName.get(activeMeasures[0])
    const suffix = firstMeasure?.meta?.unit ?? ""

    if (viz === "bar") {
      if (dims.length !== 1) {
        return <EmptyState>長條圖需要剛好一個分組維度（目前 {dims.length} 個）。</EmptyState>
      }
      return (
        <BarChart
          data={rows.slice(0, 24).map((r) => ({
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
        hour: Number(r["matches.hour_of_day"]),
        games: num(r["participants.games"]) ?? 0,
        winrate: num(r[activeMeasures[0]]),
      }))
      return <Heatmap cells={cells} />
    }

    return <DataGrid columns={columns} rows={rows} onDrill={(col, value) => drillInto(col.key, value)} />
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

        <Panel title="欄位配置" caption="拖進區塊即可加入，雙擊也行">
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
                title={sortDir === "desc" ? "由大到小" : "由小到大"}
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
                {["20", "50", "100", "500", "2000"].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n} 筆
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Panel>

        <Panel title="儲存的檢視" caption="存在瀏覽器裡，隨時叫回同一組設定">
          <div className="mb-2 flex gap-2">
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveView()}
              placeholder="命名這組設定…"
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" onClick={saveView} disabled={!viewName.trim()}>
              <Save className="size-3.5" />
            </Button>
          </div>
          {views.length === 0 ? (
            <p className="text-xs text-muted-foreground">還沒有儲存任何檢視。</p>
          ) : (
            <div className="space-y-1">
              {views.map((v) => (
                <div key={v.id} className="flex items-center gap-1">
                  <button
                    onClick={() => applyView(v)}
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs transition hover:bg-accent"
                  >
                    {v.name}
                  </button>
                  <button
                    onClick={() => removeView(v.id)}
                    className="rounded-sm p-1 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100"
                    aria-label="刪除"
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
              <Button size="sm" variant="ghost" onClick={() => setShowQuery((v) => !v)}>
                <Code2 className="size-3.5" />
              </Button>
            </div>
          }
        >
          {!dims.length && !byDay ? (
            <EmptyState>至少選一個分組維度，或開啟「按日期分組」。</EmptyState>
          ) : (
            <motion.div
              key={`${viz}-${dims.join()}-${activeMeasures.join()}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {renderViz()}
            </motion.div>
          )}
        </Panel>

        <AnimatePresence>
          {showQuery && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <Panel
                title="送給 Cube 的查詢"
                caption="前端只送成員名稱，SQL 由 Cube 依模型產生"
              >
                <pre className="overflow-x-auto rounded-md bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(query, null, 2)}
                </pre>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
  const [member, setMember] = useState("")
  const [operator, setOperator] = useState("equals")
  const [value, setValue] = useState("")

  const add = () => {
    if (!member) return
    if (operator !== "set" && !value.trim()) return
    onChange([...filters, { member, operator, values: operator === "set" ? [] : [value.trim()] }])
    setValue("")
  }

  const all = [...meta.dimensions, ...meta.measures]

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
            placeholder={operator === "set" ? "（不需要值）" : "值…"}
            disabled={operator === "set"}
            className="h-8 flex-1 text-xs"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={!member}>
            <Plus className="size-3.5" />
          </Button>
        </div>

        {filters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {filters.map((f, i) => (
              <Badge key={i} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5 text-[11px]">
                {label(meta.byName.get(f.member), f.member)}{" "}
                {OPERATORS.find((o) => o.value === f.operator)?.label} {f.values.join(", ")}
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
