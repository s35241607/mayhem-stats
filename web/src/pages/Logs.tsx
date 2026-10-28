import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EmptyState, LoadingBlock, Panel } from "@/components/primitives"
import { cn } from "@/lib/utils"

type Kind = "429" | "query" | "login" | "denied" | "error" | "api"
type Row = { id: number; ts: string; source: string; kind: Kind; method: string | null; path: string | null; status: number | null; ms: number | null; who: string | null; detail: string | null }
type Resp = {
  rows: Row[]
  nextBefore: number | null
  counts: Partial<Record<Kind, number>>
  topWho: { who: string; n: number }[]
  series429: { hour: string; n: number }[]
  retentionDays: number
}

const KIND_LABEL: Record<Kind, string> = {
  "429": "429 限流",
  query: "查詢",
  login: "登入",
  denied: "拒絕",
  error: "錯誤",
  api: "其他",
}

/** 類型的徽章色：全部用主題 token。429 與錯誤用 loss、查詢用主色、登入用金、拒絕與其他用灰 */
const KIND_TONE: Record<Kind, string> = {
  "429": "border-loss/50 bg-loss/10 text-loss",
  error: "border-loss/50 bg-loss/10 text-loss",
  query: "border-primary/50 bg-primary/10 text-primary",
  login: "border-gold/60 bg-gold/10 text-gold",
  denied: "border-border bg-muted text-foreground",
  api: "border-border bg-muted/40 text-muted-foreground",
}

const WINDOWS: { hours: number; label: string }[] = [
  { hours: 1, label: "1 小時" },
  { hours: 24, label: "1 天" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
]

const AUTO_REFRESH_MS = 10000

/** 管理員的追蹤紀錄：資料在資料庫的 access_log 表，可以依來源、類型、時間範圍、人、路徑篩選。只有管理員拿得到資料。 */
export function Logs() {
  const [source, setSource] = useState<string>("all")
  const [kind, setKind] = useState<string>("all")
  const [hours, setHours] = useState<number>(24)
  const [who, setWho] = useState("")
  const [path, setPath] = useState("")
  const [whoQ, setWhoQ] = useState("")
  const [pathQ, setPathQ] = useState("")
  const [auto, setAuto] = useState(true)
  const [data, setData] = useState<Resp | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const reqId = useRef(0)

  // 文字輸入停 300 毫秒才送出，免得每打一個字就查一次
  useEffect(() => {
    const t = setTimeout(() => {
      setWho(whoQ.trim())
      setPath(pathQ.trim())
    }, 300)
    return () => clearTimeout(t)
  }, [whoQ, pathQ])

  const query = (before?: number) => {
    const id = ++reqId.current
    const params = new URLSearchParams({ source, kind, hours: String(hours), who, path, limit: "200" })
    if (before) params.set("before", String(before))
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
        if (before) {
          setRows((prev) => [...prev, ...resp.rows])
        } else {
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

  // 條件一變就從第一頁重查；自動更新開著時每 10 秒重查第一頁（只打 API，不逐幀更新）
  useEffect(() => {
    setLoading(true)
    query()
    if (!auto) return
    const timer = setInterval(() => query(), AUTO_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, kind, hours, who, path, auto])

  const counts = data?.counts ?? {}
  const series = data?.series429 ?? []
  const peak = Math.max(1, ...series.map((b) => b.n))

  return (
    <div className="space-y-4">
      <Panel
        title="追蹤紀錄"
        caption={`管理員專用。每個 API 請求都記一筆（時間、路徑、狀態、耗時、是誰），保留 ${data?.retentionDays ?? 30} 天。IP 只存雜湊。`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" size="sm" variant="outline" value={source} onValueChange={(v) => v && setSource(v)}>
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="mirror">對外鏡像</ToggleGroupItem>
            <ToggleGroupItem value="local">本機</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v)} className="flex-wrap">
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="429">429 限流</ToggleGroupItem>
            <ToggleGroupItem value="query">查詢</ToggleGroupItem>
            <ToggleGroupItem value="login">登入</ToggleGroupItem>
            <ToggleGroupItem value="denied">拒絕</ToggleGroupItem>
            <ToggleGroupItem value="error">錯誤</ToggleGroupItem>
            <ToggleGroupItem value="api">其他</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={String(hours)} onValueChange={(v) => v && setHours(Number(v))}>
            {WINDOWS.map((w) => (
              <ToggleGroupItem key={w.hours} value={String(w.hours)}>{w.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={whoQ} onChange={(e) => setWhoQ(e.target.value)} placeholder="是誰（名字）" className="h-8 w-44 text-xs" />
          <Input value={pathQ} onChange={(e) => setPathQ(e.target.value)} placeholder="路徑（例如 cube/load）" className="h-8 w-56 text-xs" />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant={auto ? "default" : "outline"} onClick={() => setAuto((v) => !v)}>
              {auto ? "自動更新中" : "自動更新已關"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); query() }} aria-label="立即重新讀取">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </Panel>

      {error && <div className="rounded-xl border border-loss/50 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="429 限流" value={counts["429"] ?? 0} tone={(counts["429"] ?? 0) > 0 ? "loss" : "muted"} />
            <SummaryTile label="查詢請求" value={counts.query ?? 0} tone="primary" />
            <SummaryTile label="拒絕（401／403）" value={counts.denied ?? 0} tone="muted" />
            <SummaryTile label="錯誤（5xx）" value={counts.error ?? 0} tone={(counts.error ?? 0) > 0 ? "loss" : "muted"} />
          </div>

          {/* 429 的時間序列：每小時一根，看限流是不是集中在某段時間 */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 text-xs font-semibold">429 限流（每小時）</div>
            {series.every((b) => b.n === 0) ? (
              <div className="text-xs text-muted-foreground">這段時間沒有 429。</div>
            ) : (
              <div className="flex h-24 items-end gap-px" role="img" aria-label="每小時 429 次數">
                {series.map((b) => (
                  <div
                    key={b.hour}
                    data-tip={`${b.hour}：${b.n} 次`}
                    className="flex h-full flex-1 items-end"
                  >
                    <div
                      className={cn("w-full rounded-t-sm bg-loss/70", b.n === 0 && "bg-muted")}
                      style={{ height: `${Math.max(b.n === 0 ? 2 : 6, (b.n / peak) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.topWho.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
              <span className="text-xs text-muted-foreground">這段時間最常出現（點一下篩選）</span>
              {data.topWho.map((w) => (
                <button
                  key={w.who}
                  type="button"
                  onClick={() => setWhoQ(w.who)}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-0.5 font-mono text-xs transition",
                    who === w.who ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  {w.who} <span className="text-primary">{w.n}</span>
                </button>
              ))}
            </div>
          )}

          <Panel title="紀錄" caption={`最新的在最上面；目前列出 ${rows.length} 筆`}>
            {rows.length === 0 ? (
              <EmptyState>符合條件的紀錄沒有。</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-card">
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <th className="px-3 py-2 font-medium">時間</th>
                      <th className="px-3 py-2 font-medium">來源</th>
                      <th className="px-3 py-2 font-medium">類型</th>
                      <th className="px-3 py-2 font-medium">請求</th>
                      <th className="px-3 py-2 text-right font-medium">狀態</th>
                      <th className="px-3 py-2 text-right font-medium">耗時</th>
                      <th className="px-3 py-2 font-medium">是誰</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{r.ts}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.source === "mirror" ? "鏡像" : "本機"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                          {r.kind === "429" && r.detail && <span className="ml-1 text-[10px] text-muted-foreground">{r.detail}</span>}
                        </td>
                        <td className="break-all px-3 py-1.5 font-mono">{r.method} {r.path}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">{r.status ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{r.ms != null ? `${r.ms} ms` : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono">{r.who ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextBefore !== null && (
              <div className="mt-3 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => {
                    setLoadingMore(true)
                    query(nextBefore)
                  }}
                >
                  {loadingMore ? "載入中…" : "載入更多"}
                </Button>
              </div>
            )}
          </Panel>
        </>
      )}

      {!data && loading && !error && <LoadingBlock height={240} label="讀取紀錄中…" />}
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "loss" | "primary" | "gold" | "muted" }) {
  const color = { loss: "text-loss", primary: "text-primary", gold: "text-gold", muted: "text-foreground" }[tone]
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-2xl font-bold tabular-nums", color)}>{value.toLocaleString()}</div>
    </div>
  )
}
