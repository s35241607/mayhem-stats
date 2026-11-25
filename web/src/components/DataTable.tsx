import { useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { ColumnMenu } from "@/components/ColumnMenu"
import { applyOrder, moveId, useTableLayout } from "@/lib/tableLayout"
import { cn } from "@/lib/utils"

/** 手寫表格（格子裡有按鈕、徽章、自訂內容，不適合 AG Grid）的共用外殼。
 *  和 AgTable 一樣：點標題排序、拖曳標題換位置、拉標題右緣調寬度、「欄位」選單選顯示與凍結，
 *  版面存在 localStorage（stateKey）。 */
export type DataColumn<T> = {
  id: string
  /** 標題內容；選單裡用 label（沒給就用 title 的文字） */
  title: ReactNode
  label?: string
  /** 標題的滑過說明（TipLayer） */
  tip?: string
  align?: "left" | "right" | "center"
  /** 有給才能排序。null 一律排最後 */
  sortValue?: (row: T) => number | string | null
  /** 第一次點是由大到小（數字欄預設）；越小越好的欄（死亡）給 false */
  descFirst?: boolean
  cell: (row: T) => ReactNode
  className?: string | ((row: T) => string | false | undefined)
  /** 預設凍結在左邊 */
  pinned?: boolean
  /** 不能藏（辨識列的維度欄） */
  locked?: boolean
  minWidth?: number
}

type Sort = { key: string; dir: "asc" | "desc" }

const MIN_W = 48

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  stateKey,
  defaultSort = null,
  onRowClick,
  rowClassName,
  rowProps,
  toolbar,
  className,
  tableClassName,
  maxHeight,
  dense,
  stickyHeader,
  nowrap,
  showHelp = true,
}: {
  /** 表格下方那行操作說明；空間小的地方（抽屜裡的小表）可以關掉 */
  showHelp?: boolean
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** 版面存在 localStorage 的名稱；不給就不存（只在這次有效） */
  stateKey?: string
  /** 使用者沒選排序時的順序；null＝照傳進來的順序 */
  defaultSort?: Sort | null
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | false | undefined
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string>
  /** 工具列左邊的內容（「欄位」按鈕固定在右邊） */
  toolbar?: ReactNode
  className?: string
  /** 表格本身的 class（min-w、字級） */
  tableClassName?: string
  /** 給了就在這個高度內捲動，標題固定在上面 */
  maxHeight?: string
  dense?: boolean
  stickyHeader?: boolean
  /** 欄名與格子都不換行、不截斷：欄寬照最長的內容排，放不下就橫向捲動（欄位很多的寬表用）。使用者自己拉過寬度後照他拉的 */
  nowrap?: boolean
}) {
  const { layout, setLayout, reset } = useTableLayout(stateKey)
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns])
  const ids = useMemo(() => columns.map((c) => c.id), [columns])
  const order = useMemo(() => applyOrder(ids, layout.order), [ids, layout.order])
  const pinned = useMemo(
    () => new Set(layout.pinned ?? columns.filter((c) => c.pinned).map((c) => c.id)),
    [layout.pinned, columns],
  )
  const hidden = useMemo(() => new Set(layout.hidden.filter((id) => !byId.get(id)?.locked)), [layout.hidden, byId])
  // 凍結的排在最前面（sticky 只能貼左邊連續的一段）
  const display = useMemo(() => {
    const vis = order.filter((id) => !hidden.has(id))
    return [...vis.filter((id) => pinned.has(id)), ...vis.filter((id) => !pinned.has(id))].map((id) => byId.get(id)!)
  }, [order, hidden, pinned, byId])

  const sort = layout.sort && byId.get(layout.sort.key)?.sortValue ? layout.sort : defaultSort
  const sorted = useMemo(() => {
    const col = sort ? byId.get(sort.key) : undefined
    if (!sort || !col?.sortValue) return rows
    const get = col.sortValue
    const sign = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign
      return String(va).localeCompare(String(vb), "zh-Hant") * sign
    })
  }, [rows, sort, byId])

  const clickSort = (col: DataColumn<T>) => {
    if (!col.sortValue) return
    const first: Sort["dir"] = col.descFirst === false ? "asc" : "desc"
    setLayout((prev) => {
      const cur = prev.sort ?? defaultSort
      if (cur?.key !== col.id) return { ...prev, sort: { key: col.id, dir: first } }
      if (cur.dir === first) return { ...prev, sort: { key: col.id, dir: first === "desc" ? "asc" : "desc" } }
      // 第三下回到預設排序
      return { ...prev, sort: null }
    })
  }

  // ── 寬度：沒拉過時照內容自動排；一拉就把每欄目前的寬度記下來，改成固定寬度排版
  const fixed = Object.keys(layout.widths).length > 0
  const headRefs = useRef(new Map<string, HTMLTableCellElement>())
  const tableRef = useRef<HTMLTableElement>(null)
  // 凍結欄的 left 要等於它前面幾個凍結欄的實際寬度加總。寬度要量過才知道，
  // 直接改 DOM（不經 state），免得量完再渲染一輪；React 的 style prop 不碰 left
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    let left = 0
    for (const c of display) {
      const on = pinned.has(c.id)
      // 取消凍結的欄要清掉 left：標題格是 relative，留著會整格位移
      const px = on ? `${left}px` : ""
      table.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(c.id)}"]`).forEach((el) => (el.style.left = px))
      if (on) left += headRefs.current.get(c.id)?.offsetWidth ?? 0
    }
  })
  const startResize = (e: React.PointerEvent, col: DataColumn<T>) => {
    e.preventDefault()
    e.stopPropagation()
    const snapshot: Record<string, number> = { ...layout.widths }
    for (const c of display) snapshot[c.id] ??= headRefs.current.get(c.id)?.offsetWidth ?? 100
    const startX = e.clientX
    const startW = snapshot[col.id]
    const min = col.minWidth ?? MIN_W
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const w = Math.max(min, Math.round(startW + ev.clientX - startX))
      setLayout((prev) => ({ ...prev, widths: { ...snapshot, ...prev.widths, [col.id]: w } }))
    }
    const up = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", up)
      target.removeEventListener("pointercancel", up)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", up)
    target.addEventListener("pointercancel", up)
  }
  const autoFit = (col: DataColumn<T>) =>
    setLayout((prev) => {
      const widths = { ...prev.widths }
      delete widths[col.id]
      return { ...prev, widths }
    })

  // ── 拖曳標題換位置（原生 drag and drop；拉寬度的把手會擋掉拖曳）
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const move = (id: string, target: string) =>
    setLayout((prev) => {
      const next: typeof prev = { ...prev, order: moveId(applyOrder(ids, prev.order), id, target) }
      // 拖進／拖出凍結區：跟著目標欄的凍結狀態
      if (pinned.has(id) !== pinned.has(target)) {
        const set = new Set(pinned)
        if (pinned.has(target)) set.add(id)
        else set.delete(id)
        next.pinned = [...set]
      }
      return next
    })

  const totalWidth = fixed ? display.reduce((s, c) => s + (layout.widths[c.id] ?? 100), 0) : undefined
  const pad = dense ? "px-2 py-1" : "px-2 py-1.5"
  const alignCls = (c: DataColumn<T>) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")
  const stickyCls = (c: DataColumn<T>) => (pinned.has(c.id) ? "sticky z-[1] bg-card" : "")

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <span className="ml-auto" />
        <ColumnMenu
          columns={[...order.filter((id) => pinned.has(id)), ...order.filter((id) => !pinned.has(id))].map((id) => {
            const c = byId.get(id)!
            return {
              id,
              title: c.label ?? (typeof c.title === "string" ? c.title : id),
              hidden: hidden.has(id),
              pinned: pinned.has(id),
              locked: c.locked,
            }
          })}
          onToggleHidden={(id) =>
            setLayout((prev) => ({
              ...prev,
              hidden: hidden.has(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id],
            }))
          }
          onTogglePin={(id) =>
            setLayout((prev) => {
              const set = new Set(pinned)
              if (set.has(id)) set.delete(id)
              else set.add(id)
              return { ...prev, pinned: [...set] }
            })
          }
          onMove={move}
          onReset={reset}
        />
      </div>
      <div className="overflow-auto rounded-lg border" style={maxHeight ? { maxHeight } : undefined}>
        <table
          ref={tableRef}
          className={cn("text-sm", fixed ? "table-fixed" : "w-full", tableClassName, fixed && "!min-w-0")}
          style={fixed ? { width: totalWidth } : undefined}
        >
          {fixed && (
            <colgroup>
              {display.map((c) => (
                <col key={c.id} style={{ width: layout.widths[c.id] ?? 100 }} />
              ))}
            </colgroup>
          )}
          <thead className={cn(stickyHeader && "sticky top-0 z-[2] bg-card")}>
            <tr className="border-b text-[11px] text-muted-foreground">
              {display.map((c) => {
                const active = sort?.key === c.id
                return (
                  <th
                    key={c.id}
                    ref={(el) => {
                      if (el) headRefs.current.set(c.id, el)
                      else headRefs.current.delete(c.id)
                    }}
                    draggable
                    onDragStart={(e) => {
                      setDragId(c.id)
                      e.dataTransfer.effectAllowed = "move"
                      e.dataTransfer.setData("text/plain", c.id)
                    }}
                    onDragOver={(e) => {
                      if (!dragId || dragId === c.id) return
                      e.preventDefault()
                      setOverId(c.id)
                    }}
                    onDragLeave={() => setOverId((o) => (o === c.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragId && dragId !== c.id) move(dragId, c.id)
                      setDragId(null)
                      setOverId(null)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverId(null)
                    }}
                    data-tip={c.tip}
                    data-col={c.id}
                    className={cn(
                      "group/th relative select-none font-medium",
                      pad,
                      alignCls(c),
                      stickyCls(c),
                      nowrap && !fixed && "whitespace-nowrap",
                      pinned.has(c.id) && "z-[3]",
                      dragId === c.id && "opacity-50",
                      overId === c.id && "shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => clickSort(c)}
                      disabled={!c.sortValue}
                      className={cn(
                        "inline-flex max-w-full cursor-pointer items-center gap-0.5 disabled:cursor-grab",
                        c.align === "right" && "flex-row-reverse",
                        c.sortValue && "hover:text-foreground",
                        active && "text-foreground",
                      )}
                      aria-label={c.sortValue ? `依「${c.label ?? (typeof c.title === "string" ? c.title : c.id)}」排序` : undefined}
                    >
                      <span className={cn(fixed && "truncate")}>{c.title}</span>
                      {c.sortValue &&
                        (active ? (
                          sort!.dir === "desc" ? <ArrowDown className="size-3 shrink-0 text-primary" /> : <ArrowUp className="size-3 shrink-0 text-primary" />
                        ) : (
                          <ChevronsUpDown className="size-3 shrink-0 opacity-0 transition group-hover/th:opacity-60" />
                        ))}
                    </button>
                    {/* 拉寬度的把手；雙擊回到自動寬度 */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="拖曳調整欄寬"
                      onPointerDown={(e) => startResize(e, c)}
                      onDoubleClick={() => autoFit(c)}
                      onDragStart={(e) => e.preventDefault()}
                      draggable={false}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize after:absolute after:inset-y-1.5 after:right-0.5 after:w-px after:bg-border after:opacity-0 after:transition hover:after:opacity-100"
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn("border-b border-border/50 last:border-b-0", onRowClick && "cursor-pointer hover:bg-muted/40", rowClassName?.(row))}
                {...rowProps?.(row)}
              >
                {display.map((c) => (
                  <td
                    key={c.id}
                    data-col={c.id}
                    className={cn(
                      pad,
                      alignCls(c),
                      stickyCls(c),
                      fixed && "overflow-hidden text-ellipsis whitespace-nowrap",
                      nowrap && !fixed && "whitespace-nowrap",
                      typeof c.className === "function" ? c.className(row) : c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showHelp && <p className="text-[11px] text-muted-foreground">
        點標題排序（再點換方向、第三下回預設）・拖曳標題換位置・拉標題右緣調寬度（雙擊還原）・「欄位」選顯示與凍結
      </p>}
    </div>
  )
}
