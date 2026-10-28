import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EmptyState, LoadingBlock, Panel } from "@/components/primitives"
import { cn } from "@/lib/utils"

type LogKind = "429" | "query" | "login" | "error" | "other"
type LogRow = { ts: string | null; kind: LogKind; text: string; who: string | null }
type LogResponse = {
  source: string
  file: string
  rows: LogRow[]
  counts: Partial<Record<LogKind, number>>
  topWho: [string, number][]
  scanned: number
}

const KIND_LABEL: Record<LogKind, string> = {
  "429": "429 限流",
  query: "查詢",
  login: "登入",
  error: "錯誤",
  other: "其他",
}

/** 類型的徽章色：全部用主題 token。429 與錯誤用 loss、查詢用主色、登入用金、其他用灰 */
const KIND_TONE: Record<LogKind, string> = {
  "429": "border-loss/50 bg-loss/10 text-loss",
  error: "border-loss/50 bg-loss/10 text-loss",
  query: "border-primary/50 bg-primary/10 text-primary",
  login: "border-gold/60 bg-gold/10 text-gold",
  other: "border-border bg-muted/40 text-muted-foreground",
}

const AUTO_REFRESH_MS = 5000

/** 管理員的系統記錄：鏡像與本機的 log，可以篩類型、搜尋、看是誰在什麼時候打了什麼。只有管理員拿得到資料，一般人打開會看到拒絕訊息。 */
export function Logs() {
  const [source, setSource] = useState<"mirror" | "local">("mirror")
  const [kind, setKind] = useState<string>("all")
  const [lines, setLines] = useState<number>(500)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [auto, setAuto] = useState(true)
  const [data, setData] = useState<LogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)

  // 搜尋輸入停 300 毫秒才送出，免得每打一個字就查一次
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const load = async () => {
    const id = ++reqId.current
    const params = new URLSearchParams({ source, kind, lines: String(lines), q: search })
    try {
      const res = await fetch(`/api/admin/logs?${params}`)
      const payload = await res.json()
      if (id !== reqId.current) return
      if (!res.ok) {
        setError(typeof payload.error === "string" ? payload.error : "讀取失敗")
        setData(null)
      } else {
        setError(null)
        setData(payload as LogResponse)
      }
    } catch {
      if (id === reqId.current) setError("讀取失敗，請稍後再試")
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  // 條件一變就重查；自動更新開著時每 5 秒查一次（只打 API，不逐幀更新）
  useEffect(() => {
    setLoading(true)
    load()
    if (!auto) return
    const timer = setInterval(load, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, kind, lines, search, auto])

  const counts = data?.counts ?? {}
  const topWho = data?.topWho ?? []

  return (
    <div className="space-y-4">
      <Panel title="系統記錄" caption="管理員專用。鏡像的 log 記每一個 API 請求（時間、狀態、耗時、是誰）與每一次 429 限流；本機的 log 是本機服務自己的輸出。">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" size="sm" variant="outline" value={source} onValueChange={(v) => v && setSource(v as "mirror" | "local")}>
            <ToggleGroupItem value="mirror">對外鏡像</ToggleGroupItem>
            <ToggleGroupItem value="local">本機</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v)} className="flex-wrap">
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="429">429 限流</ToggleGroupItem>
            <ToggleGroupItem value="query">查詢</ToggleGroupItem>
            <ToggleGroupItem value="login">登入</ToggleGroupItem>
            <ToggleGroupItem value="error">錯誤</ToggleGroupItem>
            <ToggleGroupItem value="other">其他</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={String(lines)} onValueChange={(v) => v && setLines(Number(v))}>
            <ToggleGroupItem value="200">200 行</ToggleGroupItem>
            <ToggleGroupItem value="500">500 行</ToggleGroupItem>
            <ToggleGroupItem value="2000">2000 行</ToggleGroupItem>
          </ToggleGroup>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋（名字、路徑、狀態碼…）"
            className="h-8 w-56 text-xs"
          />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant={auto ? "default" : "outline"} onClick={() => setAuto((v) => !v)}>
              {auto ? "自動更新中" : "自動更新已關"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); load() }} aria-label="立即重新讀取">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </Panel>

      {error && (
        <div className="rounded-xl border border-loss/50 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>
      )}

      {data && (
        <>
          {/* 摘要：這批 log 裡各類型各幾筆、誰最常出現 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="429 限流" value={counts["429"] ?? 0} tone={(counts["429"] ?? 0) > 0 ? "loss" : "muted"} />
            <SummaryTile label="查詢請求" value={counts.query ?? 0} tone="primary" />
            <SummaryTile label="錯誤" value={counts.error ?? 0} tone={(counts.error ?? 0) > 0 ? "loss" : "muted"} />
            <SummaryTile label="登入事件" value={counts.login ?? 0} tone="gold" />
          </div>

          {topWho.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
              <span className="text-xs text-muted-foreground">這批記錄裡最常出現</span>
              {topWho.map(([who, n]) => (
                <span key={who} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs">
                  {who} <span className="text-primary">{n}</span>
                </span>
              ))}
            </div>
          )}

          <Panel
            title={`最近的記錄（${data.file}）`}
            caption={`讀了最後 ${data.scanned} 行，符合條件的 ${data.rows.length} 筆，最新的在最上面`}
          >
            {data.rows.length === 0 ? (
              <EmptyState>符合條件的記錄沒有。</EmptyState>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <th className="px-3 py-2 font-medium">時間</th>
                      <th className="px-3 py-2 font-medium">類型</th>
                      <th className="px-3 py-2 font-medium">內容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{r.ts ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                        </td>
                        <td className="break-all px-3 py-1.5 font-mono">{r.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {!data && loading && !error && <LoadingBlock height={240} label="讀取記錄中…" />}
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
