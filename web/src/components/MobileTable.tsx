import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronRight, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { iconUrl } from "@/lib/cube"
import { cn } from "@/lib/utils"
import type { GridColumn } from "@/components/AgTable"

type Row = Record<string, unknown>

/** 一次先畫幾張，捲到底再接下一批。資料仍是全部（「N 列」照實寫），只是不一次排版幾百張卡片 */
const BATCH = 40

/** 手機上 AgTable 的替身：同一份欄位定義（GridColumn）、同一份列資料，畫成卡片。
 *
 *  手機寬 390px 時 AG Grid 只看得到「英雄、場次」兩欄，其餘要在 300px 的框裡橫拉。
 *  這裡第一個維度欄當卡片標題，其餘可見欄位排成兩欄的「標題＋內容」，複合格子（cells.tsx）原樣放進去。
 *  排序、搜尋、下鑽、交叉篩選的 highlight 都和表格同一套語意；欄位顯示／凍結是表格版面的設定，這裡不用。 */
export function MobileTable({
  columns,
  rows,
  onDrill,
  onRowClick,
  highlight,
  emptyHint,
}: {
  columns: GridColumn[]
  rows: Row[]
  onDrill?: (column: GridColumn, value: string, row: Row) => void
  onRowClick?: (row: Row) => void
  highlight?: { key: string; value: string } | null
  emptyHint?: string
}) {
  const visible = useMemo(() => columns.filter((c) => !c.hide), [columns])
  const head = visible.find((c) => c.kind === "dimension")
  const body = visible.filter((c) => c !== head)
  const [query, setQuery] = useState("")
  // null＝照查詢回來的順序（各頁的預設排序，例如英雄依場次）
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null)
  const [shown, setShown] = useState(BATCH)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q
      ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)))
      : rows
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      const metric = col?.kind === "metric"
      out = [...out].sort((a, b) => {
        const d = metric
          ? (Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0)
          : String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), "zh-Hant")
        return sort.desc ? -d : d
      })
    }
    return out
  }, [rows, columns, query, sort])

  // 換了搜尋、排序或資料就回到第一批（渲染時比對，不在 effect 裡 setState）
  const [prevList, setPrevList] = useState(list)
  if (prevList !== list) {
    setPrevList(list)
    setShown(BATCH)
  }

  // 交叉篩選：點了圖表某一項，那張卡片一定要畫出來，再捲到眼前
  const listRef = useRef<HTMLDivElement>(null)
  const hiIndex = highlight ? list.findIndex((r) => String(r[highlight.key]) === highlight.value) : -1
  const limit = hiIndex >= shown ? hiIndex + BATCH : shown
  useEffect(() => {
    if (hiIndex < 0) return
    const t = setTimeout(() => listRef.current?.querySelector('[data-hi="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 50)
    return () => clearTimeout(t)
  }, [hiIndex])

  // 捲到底自動接下一批
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= list.length) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(limit + BATCH), {
      rootMargin: "600px 0px",
    })
    io.observe(el)
    return () => io.disconnect()
  }, [limit, list.length])

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        {emptyHint ?? "這個條件下沒有資料。"}
      </div>
    )
  }

  const sortable = visible
  const tap = (row: Row) => {
    if (onDrill && head && row[head.key] != null) onDrill(head, String(row[head.key]), row)
    else onRowClick?.(row)
  }
  const clickable = !!(onDrill || onRowClick)

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋…" className="h-10 pl-9 pr-9 text-sm" aria-label="搜尋這張表" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center text-muted-foreground" aria-label="清除搜尋">
              <X className="size-4" />
            </button>
          )}
        </div>
        {/* 原生下拉：手機上會叫出系統自己的選單，比自繪的好點 */}
        <select
          aria-label="排序依據"
          value={sort?.key ?? ""}
          onChange={(e) => setSort(e.target.value ? { key: e.target.value, desc: sort?.desc ?? true } : null)}
          className="h-10 max-w-[9.5rem] shrink-0 rounded-md border bg-secondary/50 px-2 text-sm"
        >
          <option value="">預設排序</option>
          {sortable.map((c) => (
            <option key={c.key} value={c.key}>
              依{c.title}
            </option>
          ))}
        </select>
        <button
          disabled={!sort}
          onClick={() => sort && setSort({ ...sort, desc: !sort.desc })}
          className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-secondary/50 disabled:opacity-40"
          aria-label={sort?.desc === false ? "由小到大，點了改成由大到小" : "由大到小，點了改成由小到大"}
        >
          {sort?.desc === false ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        {list.length === rows.length ? `${rows.length} 列` : `${list.length} / ${rows.length} 列`}
        {clickable && "・點一張看細項"}
      </div>

      <div ref={listRef} className="space-y-2">
        {list.slice(0, limit).map((row, i) => (
          <MobileCard
            key={i}
            row={row}
            index={i}
            head={head}
            body={body}
            hi={i === hiIndex}
            onTap={clickable ? () => tap(row) : undefined}
          />
        ))}
      </div>
      {limit < list.length && <div ref={sentinel} className="py-3 text-center text-xs text-muted-foreground">載入更多…</div>}
      {limit >= list.length && list.length > BATCH && <div className="py-2 text-center text-xs text-muted-foreground">已經是全部 {list.length} 列</div>}
    </div>
  )
}

/** 卡片上先放幾欄：其餘收在「+N 欄」，一隻英雄十幾欄全攤開的話一張卡片就是一整個螢幕 */
const PEEK = 5

function MobileCard({
  row,
  index,
  head,
  body,
  hi,
  onTap,
}: {
  row: Row
  index: number
  head?: GridColumn
  body: GridColumn[]
  hi: boolean
  onTap?: () => void
}) {
  const [open, setOpen] = useState(false)
  const fields = open ? body : body.slice(0, PEEK)
  // 第一個複合格子（通常是戰績條）佔滿整列，其餘兩欄並排
  const wide = body.find((c) => c.cell)
  return (
    <div
      data-hi={hi}
      // 整張卡都能點（方便手指）；鍵盤與讀屏走標題那顆按鈕
      onClick={onTap}
      className={cn(
        "cv-row space-y-2.5 border bg-card px-3.5 py-3",
        onTap && "pressable cursor-pointer",
        hi && "border-primary ring-1 ring-primary",
        index < 12 && "slide-in",
      )}
      style={{ "--stagger": `${Math.min(index, 11) * 30}ms` } as CSSProperties}
    >
      {head && (
        <button
          type="button"
          disabled={!onTap}
          onClick={(e) => {
            e.stopPropagation()
            onTap?.()
          }}
          className="flex w-full min-w-0 items-center gap-2.5 text-left disabled:cursor-default"
        >
          {head.iconKey && row[head.iconKey] ? (
            <img loading="lazy" decoding="async" src={iconUrl(row[head.iconKey] as string)} alt="" className="size-9 shrink-0 rounded-md bg-icon-tile" />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{String(row[head.key] ?? "—")}</span>
          {onTap && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        </button>
      )}
      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {fields.map((c) => (
            <div key={c.key} className={cn("min-w-0", c.cell && "rich-cell", c === wide && "col-span-2")}>
              <dt className="text-[11px] text-muted-foreground">{c.title}</dt>
              <dd className="mt-0.5 min-w-0 text-sm">{renderValue(c, row)}</dd>
            </div>
          ))}
        </dl>
      )}
      {body.length > PEEK && (
        <button
          type="button"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          className="-mb-1 min-h-9 text-xs text-primary"
        >
          {open ? "收起" : `+${body.length - PEEK} 欄`}
        </button>
      )}
    </div>
  )
}

/** 一格的內容：和 AgTable 的格子同一套規則（複合格子、格式化、勝率上色、tone） */
function renderValue(col: GridColumn, row: Row): ReactNode {
  if (col.cell) return col.cell(row)
  const raw = row[col.key]
  if (col.kind === "dimension") {
    const icon = col.iconKey ? (row[col.iconKey] as string) : null
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {icon && <img loading="lazy" decoding="async" src={iconUrl(icon)} alt="" className="size-5 shrink-0 rounded bg-icon-tile" />}
        <span className="truncate font-medium">{raw == null ? "—" : String(raw)}</span>
      </span>
    )
  }
  const n = Number(raw)
  if (raw === null || raw === undefined || !Number.isFinite(n)) return <span className="font-semibold">—</span>
  const text = `${col.format ? col.format(n) : n}${col.suffix ?? ""}`
  const tone = col.tone ? col.tone(n, row) : /(winrate|wr)$/i.test(col.key) ? (n >= 50 ? "good" : "bad") : null
  return <span className={cn("font-semibold tabular-nums", tone === "good" && "text-win", tone === "bad" && "text-loss")}>{text}</span>
}
