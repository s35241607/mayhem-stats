import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { iconUrl } from "@/lib/cube"
import { cn } from "@/lib/utils"

export type GridColumn = {
  key: string
  title: string
  kind: "dimension" | "metric"
  iconKey?: string
  rarityKey?: string
  format?: (n: number) => string
  suffix?: string
  higherIsBetter?: boolean
}

type Row = Record<string, unknown>
type Cell = { r: number; c: number }

const RARITY: Record<string, string> = {
  kPrismatic: "bg-prismatic/15 text-prismatic border-prismatic/30",
  kGold: "bg-gold/15 text-gold border-gold/30",
  kSilver: "bg-silver/15 text-silver border-silver/30",
}

function inRange(cell: Cell, a: Cell | null, b: Cell | null) {
  if (!a || !b) return false
  return (
    cell.r >= Math.min(a.r, b.r) &&
    cell.r <= Math.max(a.r, b.r) &&
    cell.c >= Math.min(a.c, b.c) &&
    cell.c <= Math.max(a.c, b.c)
  )
}

/** 表格：排序 + Excel 式框選複製。
 *
 * 評估過三個套件都沒有採用：AG Grid 的框選屬 Enterprise 付費；
 * react-data-grid 雖然 MIT 就有，但它自帶的樣式結構和這裡的英雄圖示、
 * 稀有度徽章、勝率配色會打架；TanStack Table v9 內建 cellSelectionFeature，
 * 但 v9 是剛改版的新 API、文件還薄，而這裡真正需要的只有排序與框選，
 * 加起來不到五十行——為了用不到的功能扛 API 風險並不划算。 */
export function DataGrid({
  columns,
  rows,
  onDrill,
  emptyHint,
}: {
  columns: GridColumn[]
  rows: Row[]
  onDrill?: (column: GridColumn, value: string) => void
  emptyHint?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null)
  const [anchor, setAnchor] = useState<Cell | null>(null)
  const [focus, setFocus] = useState<Cell | null>(null)
  const [dragging, setDragging] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle")
  const containerRef = useRef<HTMLDivElement>(null)

  const visibleRows = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const factor = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      // 指標一律當數字比，維度用中文語系排序，混用時數字優先
      const an = Number(av)
      const bn = Number(bv)
      if (col?.kind === "metric" || (Number.isFinite(an) && Number.isFinite(bn))) {
        return ((Number.isFinite(an) ? an : -Infinity) - (Number.isFinite(bn) ? bn : -Infinity)) * factor
      }
      return String(av ?? "").localeCompare(String(bv ?? ""), "zh-Hant") * factor
    })
  }, [rows, sort, columns])

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key !== key
        ? { key, dir: "desc" }
        : prev.dir === "desc"
          ? { key, dir: "asc" }
          : null,
    )

  /** 選取範圍轉成 TSV。Excel 與 Google 試算表都吃這個格式，
   *  貼上去就是完整的儲存格，不會擠成一行。 */
  const selectionToTsv = useCallback(() => {
    if (!anchor || !focus) return ""
    const r0 = Math.min(anchor.r, focus.r)
    const r1 = Math.max(anchor.r, focus.r)
    const c0 = Math.min(anchor.c, focus.c)
    const c1 = Math.max(anchor.c, focus.c)
    const lines: string[] = []
    // 多選一欄以上時附上標題列，貼到試算表才知道哪欄是哪欄
    if (c1 > c0 || r1 > r0) {
      lines.push(columns.slice(c0, c1 + 1).map((c) => c.title).join("\t"))
    }
    for (let r = r0; r <= r1; r++) {
      const row = visibleRows[r]
      if (!row) continue
      lines.push(
        columns
          .slice(c0, c1 + 1)
          .map((col) => {
            const v = row[col.key]
            if (v === null || v === undefined) return ""
            // 數值不帶單位，方便貼進試算表後直接運算
            return String(v)
          })
          .join("\t"),
      )
    }
    return lines.join("\n")
  }, [anchor, focus, columns, visibleRows])

  const copySelection = useCallback(async () => {
    const tsv = selectionToTsv()
    if (!tsv) return
    try {
      await navigator.clipboard.writeText(tsv)
      setCopyState("done")
    } catch {
      // 瀏覽器擋下剪貼簿時要講出來，不然按了沒反應會以為是壞的。
      // 退而求其次：把內容選起來，讓使用者自己按 Ctrl+C。
      const box = document.createElement("textarea")
      box.value = tsv
      box.style.position = "fixed"
      box.style.opacity = "0"
      document.body.appendChild(box)
      box.select()
      setCopyState("failed")
      setTimeout(() => box.remove(), 8000)
    }
    setTimeout(() => setCopyState("idle"), 2500)
  }, [selectionToTsv])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && anchor && focus) {
        // 使用者正在選文字時不要搶走複製
        if (window.getSelection()?.toString()) return
        e.preventDefault()
        copySelection()
      }
      if (e.key === "Escape") {
        setAnchor(null)
        setFocus(null)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [anchor, focus, copySelection])

  useEffect(() => {
    const stop = () => setDragging(false)
    document.addEventListener("mouseup", stop)
    return () => document.removeEventListener("mouseup", stop)
  }, [])

  const selectedCount =
    anchor && focus
      ? (Math.abs(anchor.r - focus.r) + 1) * (Math.abs(anchor.c - focus.c) + 1)
      : 0

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        {emptyHint ?? "這個條件下沒有資料。"}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {selectedCount > 0
            ? `已選 ${selectedCount} 格`
            : "點一格再拖曳或 Shift+點擊可框選，Ctrl/⌘+C 複製成試算表格式"}
        </span>
        {selectedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className={cn("h-7", copyState === "failed" && "border-destructive/50 text-destructive")}
            onClick={copySelection}
          >
            {copyState === "done" ? (
              <Check className="size-3.5 text-win" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copyState === "done"
              ? "已複製"
              : copyState === "failed"
                ? "已選取，請按 Ctrl+C"
                : "複製"}
          </Button>
        )}
      </div>

      <div
        ref={containerRef}
        className="overflow-auto rounded-lg border"
        style={{ maxHeight: "62vh" }}
      >
        <table className="w-full border-collapse text-sm select-none">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={cn(
                    "cursor-pointer whitespace-nowrap border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground transition hover:text-foreground",
                    col.kind === "metric" ? "text-right" : "text-left",
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.title}
                    {sort?.key === col.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp className="size-3 text-primary" />
                      ) : (
                        <ArrowDown className="size-3 text-primary" />
                      )
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr key={ri} className="border-b last:border-0">
                {columns.map((col, ci) => {
                  const raw = row[col.key]
                  const selected = inRange({ r: ri, c: ci }, anchor, focus)
                  const isMetric = col.kind === "metric"
                  const n = Number(raw)

                  return (
                    <td
                      key={col.key}
                      onMouseDown={(e) => {
                        if (e.shiftKey && anchor) setFocus({ r: ri, c: ci })
                        else {
                          setAnchor({ r: ri, c: ci })
                          setFocus({ r: ri, c: ci })
                          setDragging(true)
                        }
                      }}
                      onMouseEnter={() => dragging && setFocus({ r: ri, c: ci })}
                      onDoubleClick={() => {
                        if (col.kind === "dimension" && raw != null) {
                          onDrill?.(col, String(raw))
                        }
                      }}
                      className={cn(
                        "px-3 py-1.5 transition-colors",
                        isMetric && "text-right font-semibold tabular-nums",
                        selected && "bg-primary/20 ring-1 ring-inset ring-primary/40",
                        !selected && "hover:bg-accent/50",
                        isMetric &&
                          col.key.endsWith("winrate") &&
                          Number.isFinite(n) &&
                          (n >= 50 ? "text-win" : "text-loss"),
                      )}
                    >
                      {col.kind === "dimension" ? (
                        <div className="flex items-center gap-2">
                          {col.iconKey && row[col.iconKey] ? (
                            <img
                              src={iconUrl(row[col.iconKey] as string)}
                              alt=""
                              className="size-6 shrink-0 rounded bg-secondary"
                            />
                          ) : null}
                          <span className="truncate">{(raw as string) ?? "—"}</span>
                          {col.rarityKey && row[col.rarityKey] ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "shrink-0 text-[10px]",
                                RARITY[row[col.rarityKey] as string],
                              )}
                            >
                              {String(row[col.rarityKey]).replace("k", "")}
                            </Badge>
                          ) : null}
                        </div>
                      ) : raw === null || raw === undefined ? (
                        "—"
                      ) : (
                        `${col.format ? col.format(n) : n}${col.suffix ?? ""}`
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        點欄位標題可排序，雙擊維度儲存格會下鑽該項目。
      </p>
    </div>
  )
}
