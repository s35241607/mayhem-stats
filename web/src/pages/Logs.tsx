import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Download, Pause, Play, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DetailDrawer } from "@/components/DetailDrawer"
import { EmptyState, LoadingBlock } from "@/components/primitives"
import { cn } from "@/lib/utils"

type Kind = "429" | "query" | "login" | "denied" | "error" | "api"
type Row = {
  id: number
  ts: string
  source: string
  kind: Kind
  method: string | null
  path: string | null
  status: number | null
  ms: number | null
  who: string | null
  ip: string | null
  detail: string | null
}
type Resp = {
  rows: Row[]
  nextBefore: number | null
  newest: number | null
  counts: Partial<Record<Kind, number>>
  kpi: { total: number; errorRate: number | null; p50: number | null; p95: number | null }
  histogram: { t: string; kinds: Partial<Record<Kind, number>> }[]
  bucketSeconds: number
  topPaths: { path: string; n: number }[]
  topWho: { who: string; n: number }[]
  statusDist: Record<string, number>
  retentionDays: number
}

/** 篩選條件（搜尋列解析出來的 token 與時間範圍） */
type Filters = {
  kinds: Kind[]
  who: string
  path: string
  ip: string
  method: string
  source: "all" | "mirror" | "local"
  statusMin: number | null
  statusMax: number | null
  msMin: number | null
  q: string
  hours: number
}

const EMPTY: Filters = {
  kinds: [],
  who: "",
  path: "",
  ip: "",
  method: "",
  source: "all",
  statusMin: null,
  statusMax: null,
  msMin: null,
  q: "",
  hours: 24,
}

const KIND_LABEL: Record<Kind, string> = { "429": "429 限流", query: "查詢", login: "登入", denied: "拒絕", error: "錯誤", api: "其他" }
const KIND_TONE: Record<Kind, string> = {
  "429": "border-loss/50 bg-loss/10 text-loss",
  error: "border-loss/50 bg-loss/10 text-loss",
  query: "border-primary/50 bg-primary/10 text-primary",
  login: "border-gold/60 bg-gold/10 text-gold",
  denied: "border-border bg-muted text-foreground",
  api: "border-border bg-muted/40 text-muted-foreground",
}
/** 直方圖的堆疊色（主題 token） */
const KIND_BAR: Record<Kind, string> = {
  "429": "bg-loss",
  error: "bg-loss/60",
  query: "bg-primary",
  login: "bg-gold",
  denied: "bg-muted-foreground/60",
  api: "bg-muted-foreground/25",
}
const KIND_ORDER: Kind[] = ["429", "error", "denied", "login", "query", "api"]
const KIND_NAMES = Object.keys(KIND_LABEL) as Kind[]

const WINDOWS: { hours: number; label: string }[] = [
  { hours: 1, label: "1 小時" },
  { hours: 24, label: "24 小時" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
]
const LIVE_MS = 5000

/** 搜尋列的語法：kind:429 who:Lan path:cube method:GET ip:ab12 status>=400 status<=499 status:404 ms>500 source:mirror，其餘的字當關鍵字 */
function parseQuery(text: string, base: Filters): Filters {
  const next: Filters = { ...base, kinds: [...base.kinds] }
  const free: string[] = []
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const m = token.match(/^(kind|who|path|method|ip|source|status|ms)(>=|<=|:|>|<)(.+)$/)
    if (!m) {
      free.push(token)
      continue
    }
    const [, key, op, raw] = m
    const num = Number(raw)
    if (key === "kind" && KIND_NAMES.includes(raw as Kind)) {
      if (!next.kinds.includes(raw as Kind)) next.kinds.push(raw as Kind)
    } else if (key === "who") next.who = raw
    else if (key === "path") next.path = raw
    else if (key === "ip") next.ip = raw
    else if (key === "method") next.method = raw.toUpperCase()
    else if (key === "source" && ["all", "mirror", "local"].includes(raw)) next.source = raw as Filters["source"]
    else if (key === "status" && Number.isFinite(num)) {
      if (op === ">=" || op === ">") next.statusMin = op === ">" ? num + 1 : num
      else if (op === "<=" || op === "<") next.statusMax = op === "<" ? num - 1 : num
      else {
        next.statusMin = num
        next.statusMax = num
      }
    } else if (key === "ms" && Number.isFinite(num) && (op === ">" || op === ">=")) next.msMin = num
    else free.push(token)
  }
  next.q = free.join(" ")
  return next
}

/** 把篩選條件換成 API 的查詢字串（時間範圍用 from／to，秒） */
function toParams(f: Filters, extra: Record<string, string> = {}): URLSearchParams {
  const now = Date.now() / 1000
  const p = new URLSearchParams({ from: String(now - f.hours * 3600), to: String(now), source: f.source })
  if (f.kinds.length) p.set("kind", f.kinds.join(","))
  if (f.who) p.set("who", f.who)
  if (f.path) p.set("path", f.path)
  if (f.ip) p.set("ip", f.ip)
  if (f.method) p.set("method", f.method)
  if (f.statusMin != null) p.set("status_min", String(f.statusMin))
  if (f.statusMax != null) p.set("status_max", String(f.statusMax))
  if (f.msMin != null) p.set("ms_min", String(f.msMin))
  if (f.q) p.set("q", f.q)
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p
}

/** 目前生效的條件，每一條都是一個可以按 × 拿掉的標籤 */
function chipsOf(f: Filters): { key: string; label: string; clear: () => Partial<Filters> }[] {
  const out: { key: string; label: string; clear: () => Partial<Filters> }[] = []
  for (const k of f.kinds) out.push({ key: `kind-${k}`, label: `類型：${KIND_LABEL[k]}`, clear: () => ({ kinds: f.kinds.filter((x) => x !== k) }) })
  if (f.who) out.push({ key: "who", label: `是誰：${f.who}`, clear: () => ({ who: "" }) })
  if (f.path) out.push({ key: "path", label: `路徑：${f.path}`, clear: () => ({ path: "" }) })
  if (f.ip) out.push({ key: "ip", label: `IP：${f.ip}`, clear: () => ({ ip: "" }) })
  if (f.method) out.push({ key: "method", label: `方法：${f.method}`, clear: () => ({ method: "" }) })
  if (f.source !== "all") out.push({ key: "source", label: `來源：${f.source === "mirror" ? "對外鏡像" : "本機"}`, clear: () => ({ source: "all" }) })
  if (f.statusMin != null || f.statusMax != null) {
    const label = f.statusMin === f.statusMax ? `狀態：${f.statusMin}` : `狀態：${f.statusMin ?? "…"}～${f.statusMax ?? "…"}`
    out.push({ key: "status", label, clear: () => ({ statusMin: null, statusMax: null }) })
  }
  if (f.msMin != null) out.push({ key: "ms", label: `耗時 ≥ ${f.msMin} ms`, clear: () => ({ msMin: null }) })
  if (f.q) out.push({ key: "q", label: `關鍵字：${f.q}`, clear: () => ({ q: "" }) })
  return out
}

const fmtMs = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`)
const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`)

export function Logs() {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [text, setText] = useState("")
  const [data, setData] = useState<Resp | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [sort, setSort] = useState<"time" | "ms">("time")
  const [live, setLive] = useState(false)
  const [selected, setSelected] = useState<Row | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const reqId = useRef(0)

  const query = (opts: { before?: number } = {}) => {
    const id = ++reqId.current
    const params = toParams(filters, {
      limit: "200",
      sort,
      ...(opts.before ? { before: String(opts.before) } : {}),
    })
    return fetch(`/api/admin/logs?${params}`)
      .then(async (res) => {
        const payload = await res.json()
        if (id !== reqId.current) return
        if (!res.ok) {
          setError(typeof payload.error === "string" ? payload.error : "讀取失敗")
          return
        }
        setError(null)
        const resp = payload as Resp
        if (opts.before) setRows((prev) => [...prev, ...resp.rows])
        else {
          setRows(resp.rows)
          setData(resp)
        }
        setNextBefore(resp.nextBefore)
      })
      .catch(() => {
        if (id === reqId.current) setError("讀取失敗，請稍後再試")
      })
      .finally(() => {
        if (id === reqId.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      })
  }

  // 條件或排序一變就從第一頁重查；即時追蹤開著時每 5 秒重查第一頁
  useEffect(() => {
    setLoading(true)
    query()
    if (!live) return
    const timer = setInterval(() => query(), LIVE_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, live])

  const applyText = () => {
    const parsed = parseQuery(text, filters)
    setFilters(parsed)
    setText("")
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") applyText()
    if (e.key === "Escape") setText("")
  }
  const toggleKind = (k: Kind) =>
    setFilters((f) => ({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] }))

  const chips = useMemo(() => chipsOf(filters), [filters])
  const counts = data?.counts ?? {}
  const kpi = data?.kpi
  const hist = data?.histogram ?? []
  const histMax = Math.max(1, ...hist.map((b) => Object.values(b.kinds).reduce((a, n) => a + (n ?? 0), 0)))
  const csvHref = `/api/admin/logs/export.csv?${toParams(filters)}`

  return (
    <div className="space-y-3">
      {/* 工具列：搜尋（語法見下方提示）、時間範圍、來源、即時追蹤、匯出 */}
      <div className="rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-72 flex-1">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="搜尋：kind:429  who:Lan  path:cube  status>=400  ms>500  或直接打關鍵字，按 Enter"
              className="h-9 font-mono text-xs"
              aria-label="搜尋紀錄"
            />
          </div>
          <div className="inline-flex overflow-hidden rounded-md border text-xs">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, hours: w.hours }))}
                className={cn("cursor-pointer px-2.5 py-1.5 transition", filters.hours === w.hours ? "bg-primary/15 text-primary" : "hover:bg-muted/50")}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-md border text-xs">
            {(["all", "mirror", "local"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, source: s }))}
                className={cn("cursor-pointer px-2.5 py-1.5 transition", filters.source === s ? "bg-primary/15 text-primary" : "hover:bg-muted/50")}
              >
                {s === "all" ? "全部來源" : s === "mirror" ? "對外鏡像" : "本機"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant={live ? "default" : "outline"} onClick={() => setLive((v) => !v)}>
              {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {live ? "即時追蹤中" : "即時追蹤"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => query()} aria-label="立即重新讀取">
              <RefreshCw className="size-3.5" />
            </Button>
            <a
              href={csvHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs hover:bg-muted/50"
              download
            >
              <Download className="size-3.5" />
              匯出 CSV
            </a>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px]">
                {c.label}
                <button type="button" onClick={() => setFilters((f) => ({ ...f, ...c.clear() }))} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`拿掉 ${c.label}`}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button type="button" onClick={() => setFilters((f) => ({ ...EMPTY, hours: f.hours }))} className="cursor-pointer px-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline">
              全部清除
            </button>
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted-foreground">
          語法：<span className="font-mono">kind:</span>（429／query／login／denied／error／api）、<span className="font-mono">who:</span>、<span className="font-mono">path:</span>、<span className="font-mono">ip:</span>、<span className="font-mono">method:</span>、<span className="font-mono">status&gt;=400</span>、<span className="font-mono">ms&gt;500</span>、<span className="font-mono">source:mirror</span>。保留 {data?.retentionDays ?? 30} 天。
        </div>
      </div>

      {error && <div className="rounded-xl border border-loss/50 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>}

      {data && (
        <>
          {/* KPI：總數、5xx 比例、耗時 p50／p95，還有 429 與拒絕 */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
            <Kpi label="請求數" value={(kpi?.total ?? 0).toLocaleString()} />
            <Kpi label="5xx 錯誤率" value={fmtPct(kpi?.errorRate)} tone={(kpi?.errorRate ?? 0) > 0 ? "loss" : undefined} />
            <Kpi label="耗時 p50" value={fmtMs(kpi?.p50)} />
            <Kpi label="耗時 p95" value={fmtMs(kpi?.p95)} tone={(kpi?.p95 ?? 0) > 1000 ? "gold" : undefined} />
            <Kpi label="429 限流" value={(counts["429"] ?? 0).toLocaleString()} tone={(counts["429"] ?? 0) > 0 ? "loss" : undefined} />
            <Kpi label="拒絕 401／403" value={(counts.denied ?? 0).toLocaleString()} />
          </div>

          {/* 直方圖：每根是一個時間桶，依類型堆疊，滑過看數字 */}
          <div className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold">
                請求分布 <span className="font-normal text-muted-foreground">（每格 {formatBucket(data.bucketSeconds)}）</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KIND_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition",
                      filters.kinds.includes(k) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className={cn("size-2 rounded-sm", KIND_BAR[k])} />
                    {KIND_LABEL[k]} <span className="font-mono text-muted-foreground">{(counts[k] ?? 0).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
            {hist.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">這段時間沒有資料。</div>
            ) : (
              <div className="flex h-32 items-end gap-px">
                {hist.map((b) => {
                  const total = Object.values(b.kinds).reduce((a, n) => a + (n ?? 0), 0)
                  return (
                    <div
                      key={b.t}
                      className="flex h-full min-w-0 flex-1 flex-col justify-end"
                      data-tip={`${b.t}\n${total} 筆${KIND_ORDER.filter((k) => b.kinds[k]).map((k) => `\n${KIND_LABEL[k]} ${b.kinds[k]}`).join("")}`}
                    >
                      <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]" style={{ height: `${(total / histMax) * 100}%` }}>
                        {KIND_ORDER.map((k) =>
                          b.kinds[k] ? <div key={k} className={KIND_BAR[k]} style={{ height: `${(b.kinds[k]! / total) * 100}%` }} /> : null,
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* 左側：熱門路徑、熱門的人、狀態分佈，點了就加進篩選 */}
            <aside className="space-y-3">
              <Facet title="熱門路徑" items={data.topPaths.map((p) => ({ label: p.path, n: p.n, onPick: () => setFilters((f) => ({ ...f, path: p.path })) }))} mono />
              <Facet title="最常出現的人" items={data.topWho.map((w) => ({ label: w.who, n: w.n, onPick: () => setFilters((f) => ({ ...f, who: w.who })) }))} />
              <div className="rounded-xl border bg-card p-3">
                <div className="mb-2 text-xs font-semibold">狀態分佈</div>
                <div className="space-y-1">
                  {Object.entries(data.statusDist).sort(([a], [b]) => a.localeCompare(b)).map(([cls, n]) => (
                    <div key={cls} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{cls}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{n.toLocaleString()}</span>
                    </div>
                  ))}
                  {Object.keys(data.statusDist).length === 0 && <div className="text-xs text-muted-foreground">沒有資料</div>}
                </div>
              </div>
            </aside>

            {/* 主表格 */}
            <div className="min-w-0 rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
                <span>
                  列出 <span className="font-mono text-foreground">{rows.length.toLocaleString()}</span> 筆
                  {live && <span className="ml-2 text-primary">· 每 5 秒更新</span>}
                </span>
                <span className="flex gap-1">
                  <SortButton active={sort === "time"} onClick={() => setSort("time")}>依時間</SortButton>
                  <SortButton active={sort === "ms"} onClick={() => setSort("ms")}>依耗時（慢的在前）</SortButton>
                </span>
              </div>
              {rows.length === 0 ? (
                <EmptyState>符合條件的紀錄沒有。</EmptyState>
              ) : (
                <div className="max-h-[62vh] overflow-auto">
                  <table className="w-full min-w-[760px] text-xs">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        <th className="px-3 py-2 font-medium">時間</th>
                        <th className="px-3 py-2 font-medium">類型</th>
                        <th className="px-3 py-2 font-medium">請求</th>
                        <th className="px-3 py-2 text-right font-medium">狀態</th>
                        <th className="px-3 py-2 text-right font-medium">耗時</th>
                        <th className="px-3 py-2 font-medium">是誰</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.id}
                          onClick={() => setSelected(r)}
                          className={cn("cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-muted/40", selected?.id === r.id && "bg-primary/10")}
                        >
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{r.ts}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                            {r.kind === "429" && r.detail && <span className="ml-1 text-[10px] text-muted-foreground">{r.detail}</span>}
                          </td>
                          <td className="max-w-[28rem] truncate px-3 py-1.5 font-mono" title={`${r.method} ${r.path}`}>
                            <span className="text-muted-foreground">{r.method}</span> {r.path}
                          </td>
                          <td className={cn("whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums", (r.status ?? 0) >= 500 ? "text-loss" : (r.status ?? 0) >= 400 ? "text-gold" : "")}>
                            {r.status ?? "—"}
                          </td>
                          <td className={cn("whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums", (r.ms ?? 0) > 1000 ? "text-gold" : "text-muted-foreground")}>
                            {fmtMs(r.ms)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono">{r.who ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {nextBefore !== null && (
                <div className="flex justify-center border-t py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => {
                      setLoadingMore(true)
                      query({ before: nextBefore })
                    }}
                  >
                    {loadingMore ? "載入中…" : "載入更多"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!data && loading && !error && <LoadingBlock height={240} label="讀取紀錄中…" />}

      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.method ?? ""} ${selected.path ?? ""}` : ""}
        subtitle={selected ? `${selected.ts}・${KIND_LABEL[selected.kind]}` : undefined}
      >
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">時間</dt><dd className="font-mono">{selected.ts}</dd>
              <dt className="text-muted-foreground">來源</dt><dd>{selected.source === "mirror" ? "對外鏡像" : "本機"}</dd>
              <dt className="text-muted-foreground">類型</dt><dd><span className={cn("rounded-full border px-2 py-0.5 text-[10px]", KIND_TONE[selected.kind])}>{KIND_LABEL[selected.kind]}</span></dd>
              <dt className="text-muted-foreground">方法</dt><dd className="font-mono">{selected.method ?? "—"}</dd>
              <dt className="text-muted-foreground">路徑</dt><dd className="break-all font-mono">{selected.path ?? "—"}</dd>
              <dt className="text-muted-foreground">狀態</dt><dd className="font-mono">{selected.status ?? "—"}</dd>
              <dt className="text-muted-foreground">耗時</dt><dd className="font-mono">{fmtMs(selected.ms)}</dd>
              <dt className="text-muted-foreground">是誰</dt><dd className="font-mono">{selected.who ?? "—"}</dd>
              <dt className="text-muted-foreground">IP 雜湊</dt><dd className="font-mono">{selected.ip ?? "—"}</dd>
              <dt className="text-muted-foreground">詳細</dt><dd>{selected.detail ?? "—"}</dd>
              <dt className="text-muted-foreground">紀錄編號</dt><dd className="font-mono">{selected.id}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              {selected.who && (
                <Button size="sm" variant="outline" onClick={() => { setFilters((f) => ({ ...f, who: selected.who ?? "" })); setSelected(null) }}>
                  只看這個人
                </Button>
              )}
              {selected.path && (
                <Button size="sm" variant="outline" onClick={() => { setFilters((f) => ({ ...f, path: selected.path ?? "" })); setSelected(null) }}>
                  只看這個路徑
                </Button>
              )}
              {selected.ip && (
                <Button size="sm" variant="outline" onClick={() => { setFilters((f) => ({ ...f, ip: selected.ip ?? "" })); setSelected(null) }}>
                  同一來源
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(JSON.stringify(selected, null, 2))}>
                複製 JSON
              </Button>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "loss" | "gold" }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-xl font-bold tabular-nums", tone === "loss" && "text-loss", tone === "gold" && "text-gold")}>{value}</div>
    </div>
  )
}

function Facet({ title, items, mono }: { title: string; items: { label: string; n: number; onPick: () => void }[]; mono?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 text-xs font-semibold">{title}</div>
      <div className="space-y-0.5">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={it.onPick}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted/50"
          >
            <span className={cn("min-w-0 truncate", mono && "font-mono")}>{it.label}</span>
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{it.n.toLocaleString()}</span>
          </button>
        ))}
        {items.length === 0 && <div className="text-xs text-muted-foreground">沒有資料</div>}
      </div>
    </div>
  )
}

function SortButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("cursor-pointer rounded px-2 py-0.5 transition", active ? "bg-primary/15 text-primary" : "hover:bg-muted/50")}
    >
      {children}
    </button>
  )
}

function formatBucket(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分鐘`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小時`
  return `${Math.round(seconds / 86400)} 天`
}
