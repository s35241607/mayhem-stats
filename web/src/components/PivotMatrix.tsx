import type { CSSProperties } from "react"
import { ArrowLeftRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState, Panel } from "@/components/primitives"
import { DimensionSelect } from "@/components/DimensionSelect"
import { useCube } from "@/hooks/useCube"
import { label, type CubeMeta } from "@/hooks/useCubeMeta"
import { num, type CubeQuery, type CubeRow } from "@/lib/cube"
import {
  dimensionsOf,
  displayValue,
  extraMeasuresOf,
  familyOf,
  levelQuery,
  n0,
  recordMeasures,
  sortRows,
  type DrillPick,
  type Family,
} from "@/lib/drill"
import { cn } from "@/lib/utils"

/** 欄數上限。列不設限（往下捲就好），但欄太多會橫向捲不完、DOM 也會爆（英雄 × 增幅是上萬格）。 */
const MAX_COLS = 40
/** 樣本收斂：場次 = SHRINK 時顏色只有一半強度，和時段熱力圖同一個想法 */
const SHRINK = 5

type Cell = { games: number; wins: number; value: number | null }
type Header = { key: string; raw: CubeRow[string] }

const cellKey = (row: string, col: string) => JSON.stringify([row, col])

/** 每一格，以及列、欄的順序。
 *  合計只拿來排順序：一對多的維度（增幅）加總會重複算，所以不顯示成數字。 */
function buildGrid(rows: CubeRow[], rowsDim: string, colsDim: string, family: Family, valueKey: string) {
  const cells = new Map<string, Cell>()
  const rowGames = new Map<string, number>()
  const colGames = new Map<string, number>()
  const rowSample = new Map<string, CubeRow>()
  const colSample = new Map<string, CubeRow>()
  for (const r of rows) {
    const rv = String(r[rowsDim] ?? "")
    const cv = String(r[colsDim] ?? "")
    const games = n0(r, `${family}.games`)
    cells.set(cellKey(rv, cv), { games, wins: n0(r, `${family}.wins`), value: num(r[valueKey]) })
    rowGames.set(rv, (rowGames.get(rv) ?? 0) + games)
    colGames.set(cv, (colGames.get(cv) ?? 0) + games)
    if (!rowSample.has(rv)) rowSample.set(rv, r)
    if (!colSample.has(cv)) colSample.set(cv, r)
  }
  const order = (dim: string, samples: Map<string, CubeRow>, games: Map<string, number>): Header[] => {
    const byGames = [...samples.entries()].sort((a, b) => (games.get(b[0]) ?? 0) - (games.get(a[0]) ?? 0))
    return sortRows(dim, byGames.map(([, r]) => r)).map((r) => ({ key: String(r[dim] ?? ""), raw: r[dim] }))
  }
  const allCols = order(colsDim, colSample, colGames)
  return {
    cells,
    rowKeys: order(rowsDim, rowSample, rowGames),
    colKeys: allCols.slice(0, MAX_COLS),
    hiddenCols: Math.max(0, allCols.length - MAX_COLS),
  }
}

export function PivotMatrix({
  meta,
  rowsDim,
  colsDim,
  onDimsChange,
  metric,
  onMetricChange,
  scoped,
  ignored,
  onPickCell,
}: {
  meta: CubeMeta
  rowsDim: string
  colsDim: string
  onDimsChange: (rows: string, cols: string) => void
  /** 格子顯示的指標，空字串 = 勝率 */
  metric: string
  onMetricChange: (name: string) => void
  scoped: (query: CubeQuery) => CubeQuery
  ignored: string[]
  /** 點一格：交給路徑模式，從這兩個條件繼續往下 */
  onPickCell: (picks: DrillPick[]) => void
}) {
  const family = familyOf(rowsDim)
  const metricOptions = extraMeasuresOf(meta, family)
  const metricMember = metricOptions.find((m) => m.name === metric)
  const valueKey = metricMember?.name ?? `${family}.winrate`
  const extra = metricMember ? [metricMember.name] : []

  const totals = useCube(scoped({ measures: [...recordMeasures(family), ...extra] }))
  const { rows, loading, error } = useCube(scoped(levelQuery(family, [rowsDim, colsDim], [], extra)))
  const baseline = num(totals.rows[0]?.[valueKey])

  // 不 memo：這個元件沒有自己的狀態，只在查詢結果或維度改變時重畫，而那時本來就要重算
  const grid = buildGrid(rows, rowsDim, colsDim, family, valueKey)

  const fmt = (v: number | null) => {
    if (v === null) return "—"
    if (!metricMember) return `${v.toFixed(0)}%`
    const d = metricMember.meta?.decimals ?? 1
    return `${d === 0 ? Math.round(v).toLocaleString() : v.toFixed(d)}${metricMember.meta?.unit ?? ""}`
  }

  /** 相對比較基準的好壞 → 勝／敗色，強度依差距與樣本數。沒有好壞方向的指標用單一資料色。 */
  const tint = (cell: Cell): CSSProperties | undefined => {
    if (!cell.games || cell.value === null || baseline === null) return undefined
    const weight = cell.games / (cell.games + SHRINK)
    const higherIsBetter = metricMember ? metricMember.meta?.higherIsBetter : true
    // 勝率差 30 個百分點算滿強度；其他指標用相對差，差一倍算滿
    const rel = metricMember ? (cell.value - baseline) / (Math.abs(baseline) || 1) : (cell.value - baseline) / 30
    const strength = Math.min(1, Math.abs(rel)) * weight
    const color =
      higherIsBetter === undefined ? "var(--data)" : (rel >= 0) === higherIsBetter ? "var(--win)" : "var(--loss)"
    return { backgroundColor: `color-mix(in oklab, ${color} ${Math.round(strength * 55)}%, transparent)` }
  }

  const rowOptions = [...dimensionsOf(meta, "participants"), ...dimensionsOf(meta, "teammates")].filter(
    (d, i, all) => all.findIndex((x) => x.name === d.name) === i,
  )
  const colOptions = dimensionsOf(meta, family).filter((d) => d.name !== rowsDim)

  const setRows = (name: string) => {
    // 換到另一家時，原本的欄接不上，改成那一家第一個可用的維度
    const same = dimensionsOf(meta, familyOf(name))
    const fits = name !== colsDim && same.some((d) => d.name === colsDim)
    onDimsChange(name, fits ? colsDim : (same.find((d) => d.name !== name)?.name ?? ""))
  }

  const pick = (rowRaw: CubeRow[string], colRaw: CubeRow[string], cell: Cell) => {
    const value = (v: CubeRow[string]) => (v === null || v === undefined ? null : String(v))
    // 第二層的數字就是這一格；第一層（只有列條件）的合計在一對多維度下不能用格子加總，留給路徑模式自己查
    onPickCell([
      { member: rowsDim, value: value(rowRaw), games: null, wins: null },
      { member: colsDim, value: value(colRaw), games: cell.games, wins: cell.wins },
    ])
  }

  const rowTitle = label(meta.byName.get(rowsDim), rowsDim)
  const colTitle = label(meta.byName.get(colsDim), colsDim)
  const metricTitle = metricMember ? label(metricMember, metricMember.name) : "勝率"

  return (
    <Panel
      title="交叉矩陣"
      caption={`顏色是和目前條件的整體${metricTitle}比，場次少的格子顏色會變淡。點一格從這兩個條件繼續往下鑽`}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">列</span>
          <DimensionSelect value={rowsDim} options={rowOptions} onChange={setRows} className="w-[140px]" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDimsChange(colsDim, rowsDim)}
            title="列與欄互換"
            aria-label="列與欄互換"
          >
            <ArrowLeftRight className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">欄</span>
          <DimensionSelect
            value={colsDim}
            options={colOptions}
            onChange={(c) => onDimsChange(rowsDim, c)}
            className="w-[140px]"
          />
          <span className="ml-2 text-xs text-muted-foreground">格子</span>
          <Select
            value={metricMember?.name ?? "__winrate__"}
            onValueChange={(v) => onMetricChange(v === "__winrate__" ? "" : v)}
          >
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__winrate__">勝率</SelectItem>
              {metricOptions.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  {label(m, m.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {ignored.length > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            同場玩家類的維度套不上：{ignored.join("、")}。
          </p>
        )}

        {loading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !rows.length ? (
          <EmptyState>這個條件下沒有資料。</EmptyState>
        ) : (
          <div className="reveal space-y-2">
            {grid.hiddenCols > 0 && (
              <p className="text-[11px] text-muted-foreground">
                「{colTitle}」有 {grid.colKeys.length + grid.hiddenCols} 種，只畫出場次最多的 {MAX_COLS} 欄（少了{" "}
                {grid.hiddenCols} 欄）。想全部看，按上面的互換把它放到列。
              </p>
            )}
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <table className="border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 border-b border-r bg-card px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                      {rowTitle} ╲ {colTitle}
                    </th>
                    {grid.colKeys.map((c) => (
                      <th
                        key={c.key}
                        className="sticky top-0 z-10 min-w-[72px] border-b bg-card px-2 py-2 text-center font-medium whitespace-nowrap text-muted-foreground"
                      >
                        {displayValue(colsDim, c.raw)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rowKeys.map((r) => (
                    <tr key={r.key}>
                      <th className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left font-medium whitespace-nowrap">
                        {displayValue(rowsDim, r.raw)}
                      </th>
                      {grid.colKeys.map((c) => {
                        const cell = grid.cells.get(cellKey(r.key, c.key))
                        if (!cell) {
                          return (
                            <td key={c.key} className="px-2 py-1.5 text-center text-muted-foreground">
                              ·
                            </td>
                          )
                        }
                        return (
                          <td key={c.key} className="p-0.5">
                            <button
                              onClick={() => pick(r.raw, c.raw, cell)}
                              style={tint(cell)}
                              title={`${displayValue(rowsDim, r.raw)} × ${displayValue(colsDim, c.raw)}：${cell.games} 場 ${cell.wins} 勝`}
                              className={cn(
                                "flex w-full flex-col items-center rounded px-1.5 py-1 font-mono tabular-nums transition",
                                "hover:ring-1 hover:ring-primary focus-visible:ring-1 focus-visible:ring-primary",
                              )}
                            >
                              <span className="text-[13px] font-semibold">{fmt(cell.value)}</span>
                              <span className="text-[10px] text-muted-foreground">{cell.games} 場</span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
