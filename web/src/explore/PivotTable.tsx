import { Fragment, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { num, type CubeRow } from "@/lib/cube"
import { displayValue } from "@/lib/drill"
import { label, type CubeMeta } from "@/hooks/useCubeMeta"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { levelKey, type PivotResult } from "./data"
import { formatValue, valueTitle, type Spec } from "./spec"

/** 欄維度展開後最多畫幾欄。再多表格會寬到沒辦法讀；超過時畫場次最多的幾欄並說明（CSV 仍是全部） */
const MAX_COL_KEYS = 40

const SEP = "\u0001"
const keyOf = (row: CubeRow, dims: string[]) => dims.map((d) => String(row[d] ?? "")).join(SEP)

/** 樞紐表：列維度一層一層展開，欄維度橫向展開，每個交叉點是數值架上的指標。
 *
 *  小計、總計都是語意層對那一層重新算出來的（usePivot 每層一個查詢），不是把下一層加起來——
 *  勝率、平均、不重複計數加起來是錯的。所以「小計」那一列的勝率就是那一組真正的勝率。
 *  第一層預設收合，點箭頭展開；超過一萬個格子的表也只會畫出展開的部分。 */
export function PivotTable({ spec, meta, result }: { spec: Spec; meta: CubeMeta; result: PivotResult }) {
  const R = spec.rows.length
  const C = spec.cols.length
  const values = spec.values
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const model = useMemo(() => {
    const level = (r: number, c: number) => result.levels.get(levelKey(r, c))?.rows ?? []
    const games = (row: CubeRow) => {
      const k = Object.keys(row).find((x) => x.endsWith(".games"))
      return k ? (num(row[k]) ?? 0) : 0
    }
    // 欄：最細一層的所有組合，依場次排序；第一層欄維度相同的排在一起
    const colTotals = level(0, C)
    const ordered = [...colTotals].sort((a, b) => games(b) - games(a))
    const colKeys = ordered.map((r) => keyOf(r, spec.cols))
    const shown = colKeys.slice(0, MAX_COL_KEYS)
    const grouped =
      C === 2
        ? [...new Set(shown.map((k) => k.split(SEP)[0]))].flatMap((head) => shown.filter((k) => k.split(SEP)[0] === head))
        : shown
    // 每一層列 × 每一層欄的查表：index[r][c].get(列鍵 + 欄鍵)
    const index: Map<string, CubeRow>[][] = []
    for (let r = 0; r <= R; r++) {
      index[r] = []
      for (let c = 0; c <= C; c++) {
        const map = new Map<string, CubeRow>()
        for (const row of level(r, c)) map.set(keyOf(row, spec.rows.slice(0, r)) + "|" + keyOf(row, spec.cols.slice(0, c)), row)
        index[r][c] = map
      }
    }
    // 列的樹：每一層的鍵依「這一層的列合計」的場次排序
    const children = (r: number, parent: string): string[] =>
      level(r, 0)
        .filter((row) => r === 1 || keyOf(row, spec.rows.slice(0, r - 1)) === parent)
        .sort((a, b) => games(b) - games(a))
        .map((row) => keyOf(row, spec.rows.slice(0, r)))
    return { colKeys: grouped, hiddenCols: colKeys.length - shown.length, index, children }
  }, [result.levels, spec.rows, spec.cols, R, C])

  const cell = (r: number, rowKey: string, c: number, colKey: string, value: string) =>
    num(model.index[r]?.[c]?.get(rowKey + "|" + colKey)?.[value])

  // 欄的結構：[最細的每一欄…, 第一層欄的小計…（兩層欄才有）, 總計]
  const colHeads = C === 2 ? [...new Set(model.colKeys.map((k) => k.split(SEP)[0]))] : []
  const totalsOn = spec.totals
  const leafCols = C > 0 ? model.colKeys : []

  // 關掉小計時，分組列（不是最細那一層）只當標題用，數字留白
  const blank = (r: number) => !totalsOn && r < R
  const renderCells = (r: number, rowKey: string, strong: boolean) => (
    <>
      {leafCols.map((ck) =>
        values.map((v) => (
          <td key={ck + v} className={cn("px-2 py-1.5 text-right font-mono tabular-nums", strong && "font-semibold")}>
            {blank(r) ? "" : formatValue(spec, meta, v, cell(r, rowKey, C, ck, v))}
          </td>
        )),
      )}
      {totalsOn &&
        C === 2 &&
        colHeads.map((h) =>
          values.map((v) => (
            <td key={`sub${h}${v}`} className="bg-muted/40 px-2 py-1.5 text-right font-mono tabular-nums">
              {formatValue(spec, meta, v, cell(r, rowKey, 1, h, v))}
            </td>
          )),
        )}
      {(totalsOn || C === 0) &&
        values.map((v) => (
          <td key={`tot${v}`} className={cn("px-2 py-1.5 text-right font-mono tabular-nums", C > 0 && "bg-primary/10 font-semibold", strong && "font-semibold")}>
            {blank(r) ? "" : formatValue(spec, meta, v, cell(r, rowKey, 0, "", v))}
          </td>
        ))}
    </>
  )

  const renderRows = (r: number, parent: string): React.ReactNode =>
    model.children(r, parent).map((rowKey) => {
      const expandable = r < R
      const isOpen = open.has(rowKey)
      const raw = rowKey.split(SEP)[r - 1]
      return (
        <Fragment key={rowKey}>
          <tr className={cn("border-t border-border/60 transition-colors hover:bg-accent/40", r < R && totalsOn && "bg-muted/20")}>
            <th scope="row" className="sticky left-0 z-[1] max-w-[280px] bg-card px-2 py-1.5 text-left font-normal">
              <span className="flex items-center gap-1" style={{ paddingLeft: (r - 1) * 16 }}>
                {expandable ? (
                  <button
                    type="button"
                    onClick={() => toggle(rowKey)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "收合" : "展開"} ${displayValue(spec.rows[r - 1], raw)}`}
                    className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                ) : (
                  R > 1 && <span className="inline-block w-[22px]" />
                )}
                <span className={cn("truncate", r < R && "font-medium")}>{displayValue(spec.rows[r - 1], raw)}</span>
              </span>
            </th>
            {renderCells(r, rowKey, r < R)}
          </tr>
          {expandable && isOpen && renderRows(r + 1, rowKey)}
        </Fragment>
      )
    })

  const title = (member: string) => label(meta.byName.get(member), member)
  const colLabel = (ck: string) => ck.split(SEP).map((part, i) => displayValue(spec.cols[i], part))

  const downloadCsv = () => {
    // 匯出最細那一層的長表：一列是一個「列 × 欄」的組合。小計不放（拿去別的工具會被重複加總）
    const rows = result.levels.get(levelKey(R, C))?.rows ?? []
    const dims = [...spec.rows, ...spec.cols]
    const esc = (v: unknown) => {
      const text = v === null || v === undefined ? "" : String(v)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = [
      [...dims.map(title), ...values.map((v) => valueTitle(spec, meta, v))].map(esc).join(","),
      ...rows.map((r) => [...dims.map((d) => r[d]), ...values.map((v) => r[v])].map(esc).join(",")),
    ]
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }))
    link.download = "pivot.csv"
    link.click()
    URL.revokeObjectURL(link.href)
    toast(`已下載 ${rows.length} 列`)
  }

  const expandAll = () => {
    const all = new Set<string>()
    const walk = (r: number, parent: string) => {
      if (r >= R) return
      for (const k of model.children(r, parent)) {
        all.add(k)
        walk(r + 1, k)
      }
    }
    walk(1, "")
    setOpen(all)
  }

  return (
    <div className="reveal space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {totalsOn ? "小計與總計是語意層對那一層重新算的，不是把下一層相加" : "只顯示最細的一層（小計已關閉）"}
          {result.queries > 1 && `・共 ${result.queries} 個查詢`}
        </span>
        {model.hiddenCols > 0 && <span>・欄有 {model.colKeys.length + model.hiddenCols} 種，只畫場次最多的 {MAX_COL_KEYS} 欄（CSV 是全部）</span>}
        <span className="ml-auto flex gap-1">
          {R > 1 && (
            <>
              <Button size="sm" variant="ghost" onClick={expandAll}>全部展開</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>全部收合</Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={downloadCsv} aria-label="下載 CSV">
            <Download className="size-3.5" />
            CSV
          </Button>
        </span>
      </div>
      <div className="max-h-[620px] overflow-auto rounded-lg border">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-[2] bg-card text-muted-foreground">
            {C > 0 && (
              <tr>
                <th className="sticky left-0 z-[3] bg-card px-2 py-1.5 text-left font-medium">{spec.cols.map(title).join(" › ")}</th>
                {leafCols.map((ck) => (
                  <th key={ck} colSpan={values.length} className="border-l border-border/60 px-2 py-1.5 text-center font-medium text-foreground">
                    {colLabel(ck).join(" › ")}
                  </th>
                ))}
                {totalsOn && C === 2 && colHeads.map((h) => (
                  <th key={`sub${h}`} colSpan={values.length} className="border-l border-border/60 bg-muted/40 px-2 py-1.5 text-center font-medium">
                    {displayValue(spec.cols[0], h)} 小計
                  </th>
                ))}
                {totalsOn && (
                  <th colSpan={values.length} className="border-l border-border/60 bg-primary/10 px-2 py-1.5 text-center font-medium text-foreground">
                    總計
                  </th>
                )}
              </tr>
            )}
            <tr>
              <th className="sticky left-0 z-[3] bg-card px-2 py-1.5 text-left font-medium">{spec.rows.map(title).join(" › ") || "　"}</th>
              {Array.from({ length: (C > 0 ? leafCols.length : 0) + (totalsOn && C === 2 ? colHeads.length : 0) + (totalsOn || C === 0 ? 1 : 0) }).map((_, i) =>
                values.map((v) => (
                  <th key={`${i}${v}`} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {valueTitle(spec, meta, v)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {R > 0 && renderRows(1, "")}
            {(totalsOn || R === 0) && (
              <tr className="border-t-2 border-primary/40 bg-primary/10">
                <th scope="row" className="sticky left-0 z-[1] bg-card px-2 py-1.5 text-left font-semibold">
                  <span className="-mx-2 -my-1.5 block bg-primary/10 px-2 py-1.5">總計</span>
                </th>
                {renderCells(0, "", true)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
