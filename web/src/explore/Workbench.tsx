import { useEffect, useMemo, useState, type ReactNode } from "react"
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, BarChart3, ChartArea, ChartColumnStacked, ChartLine, ChartPie, ChartScatter,
  Columns3, Filter, FunctionSquare, Grid3x3, Hash, ListVideo, Palette, Pencil, Plus, Rows3, Save, Search, Sigma, Table2, Trash2, X, Blocks, User, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel } from "@/components/primitives"
import { DrillPanel, MAX_GAME_IDS } from "@/components/MatchList"
import { useCube } from "@/hooks/useCube"
import { label, type CubeMeta, type Member } from "@/hooks/useCubeMeta"
import type { CubeFilter } from "@/lib/cube"
import { displayValue } from "@/lib/drill"
import { toast } from "@/lib/toast"
import { useUrlState } from "@/lib/urlState"
import { cn } from "@/lib/utils"
import { parse, refsOf } from "./calc"
import { useScoped } from "./data"
import { SpecView } from "./SpecView"
import { useItems, type CardItem } from "./store"
import {
  DATASETS, EMPTY_SPEC, MAX_COLS, MAX_ROWS, MAX_VALUES, VIZ_LABEL, fitsDataset, isCalc, specCodec, specDataset, valueTitle,
  type Calc, type Dataset, type Spec, type VizType,
} from "./spec"

type ShelfId = "rows" | "cols" | "values" | "color" | "filters"

const SHELVES: { id: ShelfId; title: string; icon: typeof Rows3; hint: string; accepts: "dimension" | "measure" | "both" }[] = [
  { id: "rows", title: "列", icon: Rows3, hint: `分組維度，由粗到細（最多 ${MAX_ROWS} 個）。圖表的類別軸是第一個`, accepts: "dimension" },
  { id: "cols", title: "欄", icon: Columns3, hint: `樞紐表橫向展開的維度（最多 ${MAX_COLS} 個）`, accepts: "dimension" },
  { id: "values", title: "數值", icon: Sigma, hint: `要看的指標或計算欄位（最多 ${MAX_VALUES} 個）`, accepts: "measure" },
  { id: "color", title: "顏色", icon: Palette, hint: "把圖表拆成多個系列的維度（一個）", accepts: "dimension" },
  { id: "filters", title: "篩選", icon: Filter, hint: "只看符合條件的資料；維度選值，指標給門檻", accepts: "both" },
]

const VIZ: { id: VizType; icon: typeof Table2 }[] = [
  { id: "table", icon: Table2 },
  { id: "pivot", icon: Grid3x3 },
  { id: "bar", icon: BarChart3 },
  { id: "stacked", icon: ChartColumnStacked },
  { id: "line", icon: ChartLine },
  { id: "area", icon: ChartArea },
  { id: "combo", icon: Blocks },
  { id: "pie", icon: ChartPie },
  { id: "scatter", icon: ChartScatter },
  { id: "kpi", icon: Hash },
]

const NUMBER_OPS = [
  { value: "gte", label: "至少" },
  { value: "lte", label: "至多" },
  { value: "gt", label: "大於" },
  { value: "lt", label: "小於" },
  { value: "equals", label: "等於" },
]

const tipOf = (m: Member, kind: string) =>
  [`{{lab|${kind}}}`, label(m, m.name), m.description, m.meta?.unit ? `單位：${m.meta.unit}` : null, `> ${m.name}`].filter(Boolean).join("\n")

/** 目錄裡的一個欄位：可以拖到欄位架，也可以直接點（加到預設的架上） */
function CatalogField({ member, kind, onAdd }: { member: Member; kind: "dimension" | "measure"; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${member.name}`, data: { name: member.name } })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onAdd}
      data-tip={tipOf(member, kind === "dimension" ? "維度" : "指標")}
      className={cn(
        "pressable flex w-full cursor-grab items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      {kind === "dimension" ? <Rows3 className="size-3 shrink-0 text-primary" /> : <Sigma className="size-3 shrink-0 text-data" />}
      <span className="min-w-0 flex-1 truncate">{label(member, member.name)}</span>
    </button>
  )
}

function Shelf({ id, title, icon: Icon, hint, children, empty }: { id: ShelfId; title: string; icon: typeof Rows3; hint: string; children: ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `shelf:${id}` })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-10 items-start gap-2 rounded-lg border border-dashed px-2 py-1.5 transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <span className="flex w-14 shrink-0 items-center gap-1 pt-1 text-[11px] font-medium text-muted-foreground" data-tip={hint}>
        <Icon className="size-3.5" />
        {title}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
        {empty && <span className="pt-0.5 text-[11px] text-muted-foreground/70">把欄位拖到這裡</span>}
      </div>
    </div>
  )
}

function ShelfChip({ shelf, name, text, tone, onRemove, children }: { shelf: ShelfId; name: string; text: string; tone: "dimension" | "measure" | "calc"; onRemove: () => void; children?: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `chip:${shelf}:${name}`, data: { name, from: shelf } })
  return (
    <span
      ref={setNodeRef}
      className={cn(
        "reveal inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pl-2 pr-1 text-xs",
        tone === "dimension" ? "border-primary/40 bg-primary/10" : tone === "calc" ? "border-data/50 bg-data/15" : "border-data/40 bg-data/10",
        isDragging && "opacity-40",
      )}
    >
      <span {...listeners} {...attributes} className="min-w-0 cursor-grab truncate active:cursor-grabbing">
        {tone === "calc" && <FunctionSquare className="mr-1 inline size-3" />}
        {text}
      </span>
      {children}
      <button type="button" onClick={onRemove} aria-label={`移除 ${text}`} className="rounded p-0.5 opacity-60 transition hover:bg-accent hover:opacity-100">
        <X className="size-3" />
      </button>
    </span>
  )
}

/** 篩選架上的一個條件：維度是勾選實際出現過的值，指標是運算子加門檻 */
function FilterEditor({ filter, meta, dataset, onChange }: { filter: CubeFilter; meta: CubeMeta; dataset: Dataset; onChange: (f: CubeFilter) => void }) {
  const [open, setOpen] = useState(filter.values.length === 0)
  const [search, setSearch] = useState("")
  const isMeasure = meta.measures.some((m) => m.name === filter.member)
  const { scoped } = useScoped(dataset, "all")
  // 打開才查：這個維度在目前的模式／期間下出現過哪些值
  const options = useCube(open && !isMeasure ? scoped({ dimensions: [filter.member], limit: 2000 }) : null)
  const values = useMemo(
    () => options.rows.map((r) => r[filter.member]).filter((v) => v !== null && v !== undefined && v !== "").map(String),
    [options.rows, filter.member],
  )
  const needle = search.trim().toLowerCase()
  const shown = values.filter((v) => !needle || displayValue(filter.member, v).toLowerCase().includes(needle)).slice(0, 200)
  const summary = isMeasure
    ? `${NUMBER_OPS.find((o) => o.value === filter.operator)?.label ?? filter.operator} ${filter.values[0] ?? "?"}`
    : filter.values.length
      ? `${filter.operator === "notEquals" ? "不是 " : ""}${filter.values.slice(0, 2).map((v) => displayValue(filter.member, v)).join("、")}${filter.values.length > 2 ? ` 等 ${filter.values.length} 個` : ""}`
      : "選值…"
  const toggle = (v: string) => onChange({ ...filter, values: filter.values.includes(v) ? filter.values.filter((x) => x !== v) : [...filter.values, v] })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-1 font-medium text-primary underline-offset-2 hover:underline">
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        {isMeasure ? (
          <div className="flex gap-2">
            <Select value={filter.operator} onValueChange={(operator) => onChange({ ...filter, operator })}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUMBER_OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              autoFocus
              defaultValue={filter.values[0] ?? ""}
              onChange={(e) => onChange({ ...filter, values: e.target.value === "" ? [] : [e.target.value] })}
              aria-label="門檻"
              className="h-8 flex-1 text-xs"
            />
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋值…" aria-label="搜尋值" className="h-8 flex-1 text-xs" />
              <Select value={filter.operator} onValueChange={(operator) => onChange({ ...filter, operator })}>
                <SelectTrigger size="sm" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">是</SelectItem>
                  <SelectItem value="notEquals">不是</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {options.loading ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">讀取中…</p>
              ) : !shown.length ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">{options.error ? "讀不到這個欄位的值" : "沒有符合的值"}</p>
              ) : (
                shown.map((v) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent">
                    <input type="checkbox" checked={filter.values.includes(v)} onChange={() => toggle(v)} className="accent-[var(--primary)]" />
                    <span className="truncate">{displayValue(filter.member, v)}</span>
                  </label>
                ))
              )}
            </div>
            {values.length > shown.length && <p className="text-[11px] text-muted-foreground">共 {values.length} 個值，輸入文字縮小範圍</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 計算欄位的編輯器。下面那排指標點一下就把 [標題] 插進公式，順便記住這個標題對到哪個成員 */
function CalcEditor({ initial, measures, onSave, onCancel }: { initial: Calc | null; measures: Member[]; onSave: (c: Calc) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "")
  const [formula, setFormula] = useState(initial?.formula ?? "")
  const [refs, setRefs] = useState<Record<string, string>>(initial?.refs ?? {})
  const [decimals, setDecimals] = useState(String(initial?.decimals ?? 1))
  const [unit, setUnit] = useState(initial?.unit ?? "")
  const [search, setSearch] = useState("")

  const check = useMemo(() => {
    if (!formula.trim()) return { error: null as string | null, missing: [] as string[] }
    try {
      const titles = refsOf(parse(formula))
      // 手打的 [標題]：找同名的指標補上對應；找不到的列出來
      const missing = titles.filter((t) => !refs[t] && !measures.some((m) => label(m, m.name) === t))
      return { error: null, missing }
    } catch (e) {
      return { error: (e as Error).message, missing: [] }
    }
  }, [formula, refs, measures])

  const insert = (m: Member) => {
    const title = label(m, m.name)
    setFormula((f) => `${f}${f && !/[\s(]$/.test(f) ? " " : ""}[${title}]`)
    setRefs((r) => ({ ...r, [title]: m.name }))
  }
  const save = () => {
    const titles = refsOf(parse(formula))
    const resolved: Record<string, string> = {}
    for (const t of titles) resolved[t] = refs[t] ?? measures.find((m) => label(m, m.name) === t)!.name
    onSave({ id: initial?.id ?? Math.random().toString(36).slice(2, 9), name: name.trim(), formula: formula.trim(), refs: resolved, decimals: Math.max(0, Math.min(4, Number(decimals) || 0)), unit: unit.trim() })
  }
  const valid = !!name.trim() && !!formula.trim() && !check.error && !check.missing.length
  const needle = search.trim().toLowerCase()

  return (
    <div className="reveal space-y-2 rounded-lg border border-data/40 bg-data/5 p-3 text-xs">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="名稱，例如 每死一次的擊殺" aria-label="計算欄位名稱" className="h-8 flex-1 text-xs" />
        <Input value={decimals} onChange={(e) => setDecimals(e.target.value)} aria-label="小數位數" data-tip="小數位數" className="h-8 w-12 text-center text-xs" />
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="單位" aria-label="單位" className="h-8 w-14 text-xs" />
      </div>
      <textarea
        value={formula}
        onChange={(e) => setFormula(e.target.value)}
        placeholder="[勝場] / [玩家對局數] * 100"
        aria-label="公式"
        rows={2}
        className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-primary"
      />
      {check.error ? (
        <p className="text-destructive">{check.error}</p>
      ) : check.missing.length ? (
        <p className="text-destructive">找不到這些指標：{check.missing.map((t) => `[${t}]`).join("、")}。從下面點選比較不會打錯。</p>
      ) : (
        <p className="text-muted-foreground">
          可用 + − × ÷、括號，和 佔比( )、排名( )、絕對值( )、四捨五入( , 位數)、最大( , )、最小( , )。算的是查詢回來的聚合數字。
        </p>
      )}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="找指標插進公式…" aria-label="找指標" className="h-7 text-xs" />
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {measures
          .filter((m) => !needle || label(m, m.name).toLowerCase().includes(needle))
          .slice(0, 60)
          .map((m) => (
            <button key={m.name} type="button" onClick={() => insert(m)} data-tip={tipOf(m, "指標")} className="rounded border px-1.5 py-0.5 transition hover:bg-accent">
              {label(m, m.name)}
            </button>
          ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={save} disabled={!valid}>{initial ? "更新" : "加入"}</Button>
      </div>
    </div>
  )
}

/** 工作台：左邊資料目錄，上面欄位架，下面即時出圖。
 *  規格（spec）整份放在網址（a=），重新整理、複製連結都是同一張圖；存檔是存到伺服器的卡片。 */
export function Workbench({ meta, pending, onPendingDone }: {
  meta: CubeMeta
  /** 從資料目錄按「加到工作台」帶過來的欄位：掛上來時放到預設的架上 */
  pending?: { name: string; kind: "dimension" | "measure" } | null
  onPendingDone?: () => void
}) {
  const [spec, setSpecRaw] = useUrlState<Spec>("a", EMPTY_SPEC, specCodec)
  const setSpec = (patch: Partial<Spec>) => setSpecRaw({ ...spec, ...patch })
  const dataset = specDataset(spec)
  const [browse, setBrowse] = useState<Dataset>(dataset)
  const [search, setSearch] = useState("")
  const [calcEdit, setCalcEdit] = useState<Calc | "new" | null>(null)
  const [state, setState] = useState({ rows: 0, refreshing: false })
  const [showGames, setShowGames] = useState(false)
  const [cardId, setCardId] = useUrlState<string | null>("card", null, { parse: (r) => r, format: (v) => v })
  const [saveName, setSaveName] = useState("")
  const items = useItems()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const { scoped } = useScoped(dataset, spec.scope)

  const isDimension = (name: string) => meta.dimensions.some((d) => d.name === name)
  const titleOf = (name: string) => (isCalc(name) ? valueTitle(spec, meta, name) : label(meta.byName.get(name), name))

  /** 把一個欄位放到某個架上。from 是它原本在哪個架（拖曳搬移時），會先從那裡拿掉 */
  const place = (name: string, shelf: ShelfId, from?: ShelfId) => {
    const dim = isDimension(name)
    if (shelf !== "filters" && (shelf === "values") === dim) {
      return toast(shelf === "values" ? "「數值」只能放指標或計算欄位" : "這個架只能放維度", "error")
    }
    // 換資料集：不同粒度的欄位不能混在同一個查詢裡，原本的清掉重來
    let base = spec
    if (!isCalc(name) && !fitsDataset(name, dataset)) {
      base = { ...EMPTY_SPEC, scope: spec.scope, rows: [], values: [], viz: spec.viz === "pivot" ? "pivot" : "table" }
      toast(`換成「${DATASETS.find((d) => fitsDataset(name, d.id))?.title ?? "另一個"}」資料集，原本的欄位已清掉`)
    }
    const next: Spec = { ...base, rows: [...base.rows], cols: [...base.cols], values: [...base.values], filters: [...base.filters] }
    const drop = (id: ShelfId | undefined) => {
      if (id === "rows") next.rows = next.rows.filter((x) => x !== name)
      if (id === "cols") next.cols = next.cols.filter((x) => x !== name)
      if (id === "values") next.values = next.values.filter((x) => x !== name)
      if (id === "color" && next.color === name) next.color = null
      if (id === "filters") next.filters = next.filters.filter((f) => f.member !== name)
    }
    if (from && from !== shelf) drop(from)
    if (shelf === "rows") {
      next.cols = next.cols.filter((x) => x !== name)
      next.rows = [...next.rows.filter((x) => x !== name), name].slice(-MAX_ROWS)
    } else if (shelf === "cols") {
      next.rows = next.rows.filter((x) => x !== name)
      next.cols = [...next.cols.filter((x) => x !== name), name].slice(-MAX_COLS)
      if (next.viz === "table") next.viz = "pivot"
    } else if (shelf === "values") {
      next.values = [...next.values.filter((x) => x !== name), name].slice(-MAX_VALUES)
    } else if (shelf === "color") {
      next.color = name
    } else if (!next.filters.some((f) => f.member === name)) {
      next.filters = [...next.filters, { member: name, operator: dim ? "equals" : "gte", values: [] }]
    }
    setSpecRaw(next)
  }
  const removeFrom = (shelf: ShelfId, name: string) =>
    setSpec(
      shelf === "rows" ? { rows: spec.rows.filter((x) => x !== name) }
        : shelf === "cols" ? { cols: spec.cols.filter((x) => x !== name) }
          : shelf === "values" ? { values: spec.values.filter((x) => x !== name) }
            : shelf === "color" ? { color: null }
              : { filters: spec.filters.filter((f) => f.member !== name) },
    )

  useEffect(() => {
    if (!pending) return
    place(pending.name, pending.kind === "dimension" ? "rows" : "values")
    onPendingDone?.()
    // 只在帶欄位過來的那一次執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const onDragEnd = (e: DragEndEvent) => {
    const target = String(e.over?.id ?? "")
    if (!target.startsWith("shelf:")) return
    const data = e.active.data.current as { name: string; from?: ShelfId }
    place(data.name, target.slice(6) as ShelfId, data.from)
  }

  // 目錄：目前瀏覽的資料集裡的欄位，依 cube 分段
  const catalog = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const hit = (m: Member) => !needle || label(m, m.name).toLowerCase().includes(needle) || (m.description ?? "").toLowerCase().includes(needle)
    const fits = (m: Member) => fitsDataset(m.name, browse) && hit(m)
    const dims = meta.dimensions.filter(fits)
    const measures = meta.measures.filter(fits)
    const cubes = meta.cubes
      .map((c) => ({
        cube: c,
        dims: dims.filter((d) => d.name.startsWith(c.name + ".")),
        measures: measures.filter((m) => m.name.startsWith(c.name + ".")),
      }))
      .filter((c) => c.dims.length || c.measures.length)
    return { cubes, count: dims.length + measures.length }
  }, [meta, browse, search])

  const datasetMeasures = useMemo(() => meta.measures.filter((m) => fitsDataset(m.name, dataset)), [meta.measures, dataset])
  const saveCalc = (c: Calc) => {
    const exists = spec.calcs.some((x) => x.id === c.id)
    setSpec({
      calcs: exists ? spec.calcs.map((x) => (x.id === c.id ? c : x)) : [...spec.calcs, c],
      values: spec.values.includes(`calc:${c.id}`) ? spec.values : [...spec.values, `calc:${c.id}`].slice(-MAX_VALUES),
    })
    setCalcEdit(null)
  }
  const removeCalc = (id: string) =>
    setSpec({ calcs: spec.calcs.filter((c) => c.id !== id), values: spec.values.filter((v) => v !== `calc:${id}`), sort: spec.sort?.by === `calc:${id}` ? null : spec.sort })

  // 存檔
  const current = items.cards.find((c) => c.id === cardId)
  const dirty = current ? JSON.stringify(current.spec) !== JSON.stringify(spec) : false
  const save = async (asNew: boolean) => {
    const name = (asNew ? saveName : (current?.name ?? saveName)).trim()
    if (!name) return toast("先幫這張卡片取個名字", "error")
    try {
      const saved = await items.save({ id: asNew ? undefined : current?.id, kind: "card", name, spec })
      setCardId(saved.id)
      setSaveName("")
      toast(asNew || !current ? `已存成卡片「${name}」` : `已更新「${name}」`)
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }
  const openCard = (card: CardItem) => {
    // 兩個參數要一起換：分開寫會先用舊規格配新卡片 id 畫一幀
    setSpecRaw(card.spec)
    setCardId(card.id)
    setBrowse(specDataset(card.spec))
  }
  const removeCard = async (card: CardItem) => {
    try {
      await items.remove(card.id)
      if (cardId === card.id) setCardId(null)
      toast(`已刪除「${card.name}」`)
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }

  const pickValue = (member: string, value: string) => {
    if (!isDimension(member)) return
    const existing = spec.filters.find((f) => f.member === member && f.operator === "equals")
    if (existing?.values.includes(value)) return
    setSpec({
      filters: existing
        ? spec.filters.map((f) => (f === existing ? { ...f, values: [...f.values, value] } : f))
        : [...spec.filters, { member, operator: "equals", values: [value] }],
    })
    toast(`已加篩選：${titleOf(member)} 是 ${displayValue(member, value)}`)
  }

  const canListGames = dataset === "participants" && spec.scope === "account"
  const sortOptions = [...spec.values, ...spec.rows]
  const validFilters = spec.filters.filter((f) => f.values.length)
  // 還沒選值的篩選不送出去（Cube 會把空值的 equals 當成錯誤）
  const effective = useMemo(() => ({ ...spec, filters: validFilters }), [spec]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── 資料目錄 ── */}
        <div className="space-y-4">
          <Panel title="資料" caption="點一下加入，或拖到右邊的欄位架">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1">
                {DATASETS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setBrowse(d.id)}
                    data-tip={`${d.title}\n${d.grain}\n${d.note}`}
                    className={cn(
                      "rounded-md border px-1.5 py-1 text-[11px] font-medium transition",
                      browse === d.id ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {d.title}
                    {dataset === d.id && <span className="ml-1 text-primary">●</span>}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{DATASETS.find((d) => d.id === browse)?.grain}</p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`搜尋 ${catalog.count} 個欄位…`} aria-label="搜尋欄位" className="h-8 pl-7 text-xs" />
              </div>
              <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                {catalog.cubes.map(({ cube, dims, measures }) => (
                  <div key={cube.name}>
                    <div className="sticky top-0 z-[1] bg-card pb-1 text-[11px] font-semibold text-muted-foreground" data-tip={cube.description || undefined}>
                      {cube.title}
                      <span className="ml-1 font-normal opacity-70">{dims.length + measures.length}</span>
                    </div>
                    {dims.map((m) => (
                      <CatalogField key={m.name} member={m} kind="dimension" onAdd={() => place(m.name, "rows")} />
                    ))}
                    {measures.map((m) => (
                      <CatalogField key={m.name} member={m} kind="measure" onAdd={() => place(m.name, "values")} />
                    ))}
                  </div>
                ))}
                {!catalog.count && <p className="py-4 text-center text-xs text-muted-foreground">沒有符合的欄位</p>}
              </div>
            </div>
          </Panel>

          <Panel
            title="計算欄位"
            caption="用現有指標寫公式，不必改語意層"
            action={
              <Button size="sm" variant="outline" onClick={() => setCalcEdit("new")} aria-label="新增計算欄位">
                <Plus className="size-3.5" />
              </Button>
            }
          >
            <div className="space-y-2">
              {calcEdit && (
                <CalcEditor key={calcEdit === "new" ? "new" : calcEdit.id} initial={calcEdit === "new" ? null : calcEdit} measures={datasetMeasures} onSave={saveCalc} onCancel={() => setCalcEdit(null)} />
              )}
              {!spec.calcs.length && !calcEdit && <p className="text-xs text-muted-foreground">還沒有。例：[勝場] / [玩家對局數] * 100、佔比([玩家對局數])</p>}
              {spec.calcs.map((c) => (
                <div key={c.id} className="flex items-center gap-1 text-xs">
                  <button type="button" onClick={() => place(`calc:${c.id}`, "values")} className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left transition hover:bg-accent" data-tip={`${c.name}\n> ${c.formula}`}>
                    <FunctionSquare className="mr-1 inline size-3 text-data" />
                    {c.name}
                  </button>
                  <button type="button" onClick={() => setCalcEdit(c)} aria-label={`編輯 ${c.name}`} className="rounded p-1 text-muted-foreground opacity-60 transition hover:opacity-100">
                    <Pencil className="size-3" />
                  </button>
                  <button type="button" onClick={() => removeCalc(c.id)} aria-label={`刪除 ${c.name}`} className="rounded p-1 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100">
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="我的卡片" caption={items.canEdit ? "存在伺服器，換瀏覽器也在；可以放進儀表板" : "唯讀：這裡可以打開，但不能存檔"}>
            <div className="space-y-2">
              {items.canEdit && (
                <div className="flex gap-2">
                  <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save(true)} placeholder="命名後另存成新卡片…" aria-label="卡片名稱" className="h-8 text-xs" />
                  <Button size="sm" variant="outline" onClick={() => void save(true)} disabled={!saveName.trim()} aria-label="另存新卡片">
                    <Save className="size-3.5" />
                  </Button>
                </div>
              )}
              {items.error && <p className="text-xs text-destructive">{items.error}</p>}
              {!items.cards.length && !items.loading && <p className="text-xs text-muted-foreground">還沒有存任何卡片。</p>}
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {items.cards.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openCard(c)}
                      className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs transition hover:bg-accent", c.id === cardId && "bg-primary/15 font-medium")}
                    >
                      {c.name}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{VIZ_LABEL[c.spec.viz]}</span>
                    </button>
                    {items.canEdit && (
                      <button type="button" onClick={() => void removeCard(c)} aria-label={`刪除卡片 ${c.name}`} className="rounded p-1 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100">
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── 欄位架與結果 ── */}
        <div className="min-w-0 space-y-4">
          <Panel>
            <div className="space-y-1.5">
              {SHELVES.map((shelf) => {
                const names =
                  shelf.id === "rows" ? spec.rows : shelf.id === "cols" ? spec.cols : shelf.id === "values" ? spec.values : shelf.id === "color" ? (spec.color ? [spec.color] : []) : spec.filters.map((f) => f.member)
                return (
                  <Shelf key={shelf.id} {...shelf} empty={!names.length}>
                    {names.map((name) => (
                      <ShelfChip
                        key={name}
                        shelf={shelf.id}
                        name={name}
                        text={titleOf(name)}
                        tone={isCalc(name) ? "calc" : isDimension(name) ? "dimension" : "measure"}
                        onRemove={() => removeFrom(shelf.id, name)}
                      >
                        {shelf.id === "filters" && (
                          <FilterEditor
                            filter={spec.filters.find((f) => f.member === name)!}
                            meta={meta}
                            dataset={dataset}
                            onChange={(f) => setSpec({ filters: spec.filters.map((x) => (x.member === name ? f : x)) })}
                          />
                        )}
                      </ShelfChip>
                    ))}
                  </Shelf>
                )
              })}
              {meta.segments.length > 0 && dataset === "participants" && (
                <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1 text-[11px] text-muted-foreground">
                  <span className="w-14 shrink-0">片段</span>
                  {meta.segments.map((s) => {
                    const on = spec.segments.includes(s.name)
                    return (
                      <button
                        key={s.name}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSpec({ segments: on ? spec.segments.filter((x) => x !== s.name) : [...spec.segments, s.name] })}
                        className={cn("rounded-md border px-2 py-0.5 transition", on ? "border-primary bg-primary/15 text-foreground" : "hover:bg-accent")}
                      >
                        {s.shortTitle || s.title}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Panel>

          <Panel
            refreshing={state.refreshing}
            title={current ? `${current.name}${dirty ? "（已修改）" : ""}` : "結果"}
            caption={`${DATASETS.find((d) => d.id === dataset)?.title}・${spec.scope === "account" ? "目前帳號" : "全部玩家"}${spec.viz !== "pivot" && spec.viz !== "kpi" ? `・${state.rows} 列` : ""}`}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canListGames && (
                  <Button size="sm" variant="outline" onClick={() => setShowGames(true)} data-tip="列出符合目前篩選的每一場">
                    <ListVideo className="size-3.5" />
                    看這幾場
                  </Button>
                )}
                {items.canEdit && current && dirty && (
                  <Button size="sm" onClick={() => void save(false)}>
                    <Save className="size-3.5" />
                    更新卡片
                  </Button>
                )}
              </div>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="single" size="sm" variant="outline" value={spec.viz} onValueChange={(v) => v && setSpec({ viz: v as VizType })}>
                  {VIZ.map((v) => (
                    <ToggleGroupItem key={v.id} value={v.id} aria-label={VIZ_LABEL[v.id]} data-tip={VIZ_LABEL[v.id]}>
                      <v.icon className="size-3.5" />
                      <span className="hidden 2xl:inline">{VIZ_LABEL[v.id]}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <ToggleGroup type="single" size="sm" variant="outline" value={spec.scope} onValueChange={(v) => v && setSpec({ scope: v as Spec["scope"] })}>
                  <ToggleGroupItem value="account" aria-label="目前帳號" data-tip="只看目前帳號">
                    <User className="size-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="all" aria-label="全部玩家" data-tip="跨資料庫裡所有玩家聚合">
                    <Users className="size-3.5" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <Select value={spec.sort?.by ?? "__auto__"} onValueChange={(by) => setSpec({ sort: by === "__auto__" ? null : { by, dir: spec.sort?.dir ?? "desc" } })}>
                  <SelectTrigger size="sm" className="w-[150px]" aria-label="排序依據">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">自動排序</SelectItem>
                    {sortOptions.map((name) => (
                      <SelectItem key={name} value={name}>
                        依 {titleOf(name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {spec.sort && (
                  <Button size="sm" variant="outline" onClick={() => setSpec({ sort: { by: spec.sort!.by, dir: spec.sort!.dir === "desc" ? "asc" : "desc" } })} aria-label="切換升降冪" data-tip={spec.sort.dir === "desc" ? "由大到小" : "由小到大"}>
                    {spec.sort.dir === "desc" ? <ArrowDownWideNarrow className="size-3.5" /> : <ArrowUpNarrowWide className="size-3.5" />}
                  </Button>
                )}
                <Select value={String(spec.limit)} onValueChange={(v) => setSpec({ limit: Number(v) })}>
                  <SelectTrigger size="sm" className="w-[104px]" aria-label="列數上限">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 200, 1000].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        前 {n} 列
                      </SelectItem>
                    ))}
                    <SelectItem value="0">全部</SelectItem>
                  </SelectContent>
                </Select>
                {spec.viz === "pivot" && (
                  <Button size="sm" variant={spec.totals ? "default" : "outline"} aria-pressed={spec.totals} onClick={() => setSpec({ totals: !spec.totals })}>
                    <Sigma className="size-3.5" />
                    小計與總計
                  </Button>
                )}
              </div>
              <div key={`${spec.viz}|${spec.rows.join()}|${spec.cols.join()}|${spec.color}`} className="rise">
                <SpecView spec={effective} meta={meta} onPick={pickValue} onState={setState} />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {showGames && canListGames && (
        <DrillPanel
          title={validFilters.length ? validFilters.map((f) => `${titleOf(f.member)} ${f.values.slice(0, 3).map((v) => displayValue(f.member, v)).join("、")}`).join("・") : "目前條件"}
          gameIdKey="matches.game_id"
          query={scoped({
            measures: ["participants.games"],
            dimensions: ["matches.game_id"],
            ...(spec.segments.length ? { segments: spec.segments } : {}),
            // 只帶維度的篩選：指標門檻是對「分組後」的數字設的，套到逐場上意思不一樣
            filters: validFilters.filter((f) => isDimension(f.member)),
            limit: MAX_GAME_IDS,
          })}
          onClose={() => setShowGames(false)}
        />
      )}
    </DndContext>
  )
}

