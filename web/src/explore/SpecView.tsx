import { useEffect, useMemo } from "react"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { MAX_SERIES, ScatterChart, SeriesChart, type ChartSeries, type ScatterPoint, type SeriesKind } from "@/components/charts"
import { EmptyState, QueryError } from "@/components/primitives"
import { Skeleton } from "@/components/ui/skeleton"
import { CountUp } from "@/components/CountUp"
import { label, type CubeMeta } from "@/hooks/useCubeMeta"
import { num, type CubeRow } from "@/lib/cube"
import { COMPANION, displayValue, sortRows } from "@/lib/drill"
import { cn } from "@/lib/utils"
import { PivotTable } from "./PivotTable"
import { usePivot, useSpecRows } from "./data"
import { calcOf, formatValue, isCalc, valueTitle, vizProblem, type Spec } from "./spec"

const gamesOf = (row: CubeRow) => {
  const key = Object.keys(row).find((k) => k.endsWith(".games"))
  return key ? (num(row[key]) ?? 0) : 0
}
const unitOf = (spec: Spec, meta: CubeMeta, value: string) =>
  isCalc(value) ? (calcOf(spec, value)?.unit ?? "") : (meta.byName.get(value)?.meta?.unit ?? "")

/** 這個規格實際要查的維度（平面結果）。表格是全部；圖表是類別＋顏色 */
export function flatDims(spec: Spec): string[] {
  if (spec.viz === "table") return [...spec.rows, ...spec.cols, ...(spec.color && !spec.rows.includes(spec.color) ? [spec.color] : [])]
  if (spec.viz === "kpi") return []
  return [spec.rows[0], ...(spec.color && spec.color !== spec.rows[0] ? [spec.color] : [])].filter(Boolean)
}

/** 把一份規格畫出來。工作台的結果區和儀表板的每一格都是它，所以同一張卡片在兩邊看到的一定一樣。
 *  onPick：點了類別軸上的某一個值（工作台拿來加篩選）；儀表板不傳，圖表就只是看。 */
export function SpecView({
  spec,
  meta,
  height = 420,
  onPick,
  onState,
}: {
  spec: Spec
  meta: CubeMeta
  height?: number
  onPick?: (member: string, value: string) => void
  /** 回報列數與是否還在更新，給外層的標題列顯示 */
  onState?: (state: { rows: number; refreshing: boolean }) => void
}) {
  const problem = vizProblem(spec)
  const isPivot = spec.viz === "pivot"
  const dims = flatDims(spec)
  const flat = useSpecRows(spec, dims, !problem && !isPivot)
  const pivot = usePivot(spec, !problem && isPivot)
  const res = isPivot ? pivot : flat
  const ignored = res.ignored

  // 有自然順序的類別（日期、版本、對局長度…）照值排，其他照查詢回來的順序
  const rows = useMemo(
    () => (spec.rows[0] && !spec.sort && spec.viz !== "table" ? sortRows(spec.rows[0], flat.rows) : flat.rows),
    [flat.rows, spec.rows, spec.sort, spec.viz],
  )

  const chart = useMemo(() => {
    const category = spec.rows[0]
    if (!category || spec.viz === "table" || spec.viz === "pivot" || spec.viz === "kpi" || spec.viz === "scatter") return null
    const cat = (r: CubeRow) => String(r[category] ?? "")
    const categories = [...new Set(rows.map(cat))]
    const shown = categories.map((c) => displayValue(category, c))
    const at = new Map(categories.map((c, i) => [c, i]))
    let series: ChartSeries[]
    let dropped = 0
    if (spec.color && spec.color !== category) {
      // 顏色維度拆系列：只取第一個數值；系列依場次多寡取前六個
      const value = spec.values[0]
      const groups = new Map<string, { size: number; data: (number | null)[] }>()
      for (const r of rows) {
        const key = String(r[spec.color] ?? "")
        const g = groups.get(key) ?? { size: 0, data: categories.map(() => null) }
        g.size += gamesOf(r)
        g.data[at.get(cat(r))!] = num(r[value])
        groups.set(key, g)
      }
      const ordered = [...groups.entries()].sort((a, b) => b[1].size - a[1].size)
      dropped = Math.max(0, ordered.length - MAX_SERIES)
      series = ordered.slice(0, MAX_SERIES).map(([key, g]) => ({ name: displayValue(spec.color!, key), data: g.data, suffix: unitOf(spec, meta, value) }))
    } else {
      dropped = Math.max(0, spec.values.length - MAX_SERIES)
      series = spec.values.slice(0, MAX_SERIES).map((v) => ({
        name: valueTitle(spec, meta, v),
        data: rows.map((r) => num(r[v])),
        suffix: unitOf(spec, meta, v),
      }))
    }
    return { categories, shown, series, dropped }
  }, [rows, spec, meta])

  const columns: GridColumn[] = useMemo(
    () => [
      ...dims.map((key) => ({
        key,
        title: label(meta.byName.get(key), key),
        kind: "dimension" as const,
        iconKey: COMPANION[key]?.icon,
        rarityKey: COMPANION[key]?.rarity,
      })),
      ...spec.values.map((key) => ({
        key,
        title: valueTitle(spec, meta, key),
        kind: "metric" as const,
        format: (n: number) => formatValue(spec, meta, key, n).replace(unitOf(spec, meta, key), ""),
        suffix: unitOf(spec, meta, key),
      })),
    ],
    // dims 是每次渲染新建的陣列，用它的內容當依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dims.join("|"), spec, meta],
  )

  const count = isPivot ? 0 : rows.length
  useEffect(() => onState?.({ rows: count, refreshing: res.refreshing }), [count, res.refreshing]) // eslint-disable-line react-hooks/exhaustive-deps

  if (problem) return <EmptyState>{problem}</EmptyState>
  if (res.loading) return <Skeleton className="w-full" style={{ height }} />
  if (res.error) return <QueryError error={res.error} />

  const notes = (
    <>
      {ignored.length > 0 && <p className="text-[11px] text-muted-foreground">這個資料集套不上：{ignored.join("、")}。</p>}
      {chart && chart.dropped > 0 && (
        <p className="text-[11px] text-muted-foreground">
          系列有 {chart.dropped + MAX_SERIES} 個，只畫前 {MAX_SERIES} 個（類別色只有六個、不重複使用）。其餘請切成表格或樞紐表，或加篩選縮小。
        </p>
      )}
    </>
  )

  let body: React.ReactNode
  if (isPivot) {
    body = <PivotTable spec={spec} meta={meta} result={pivot} />
  } else if (!rows.length) {
    body = <EmptyState>這個條件下沒有資料。</EmptyState>
  } else if (spec.viz === "kpi") {
    body = (
      // 四個以內排成一列；class 寫成完整字串，Tailwind 才掃得到
      <div className={cn("grid gap-3 sm:grid-cols-2", spec.values.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {spec.values.map((v) => (
          <div key={v} className="rounded-lg border bg-secondary/30 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{valueTitle(spec, meta, v)}</div>
            <CountUp text={formatValue(spec, meta, v, num(rows[0][v]))} className="mt-1 block font-mono text-3xl font-bold tabular-nums tracking-tight" />
          </div>
        ))}
      </div>
    )
  } else if (spec.viz === "table") {
    body = (
      <AgTable
        columns={columns}
        rows={rows}
        height={height}
        fileName="explore"
        onDrill={onPick ? (col, value) => onPick(col.key, value) : undefined}
      />
    )
  } else if (spec.viz === "scatter") {
    const [mx, my] = spec.values
    const sizeKey = Object.keys(rows[0]).find((k) => k.endsWith(".games"))
    const points: ScatterPoint[] = rows.map((r) => ({
      label: displayValue(spec.rows[0], r[spec.rows[0]]),
      x: num(r[mx]) ?? 0,
      y: num(r[my]) ?? 0,
      size: sizeKey ? (num(r[sizeKey]) ?? 1) : 1,
    }))
    body = (
      <ScatterChart
        points={points}
        xName={valueTitle(spec, meta, mx)}
        yName={valueTitle(spec, meta, my)}
        xSuffix={unitOf(spec, meta, mx)}
        ySuffix={unitOf(spec, meta, my)}
        onPick={onPick ? (v) => onPick(spec.rows[0], v) : undefined}
      />
    )
  } else if (chart) {
    body = (
      <SeriesChart
        kind={spec.viz as SeriesKind}
        categories={chart.shown}
        series={chart.series}
        height={height}
        onPick={onPick ? (shownName) => onPick(spec.rows[0], chart.categories[chart.shown.indexOf(shownName)] ?? shownName) : undefined}
      />
    )
  }

  return (
    <div className={cn("refreshable space-y-2")} aria-busy={res.refreshing || undefined}>
      {notes}
      {body}
    </div>
  )
}
