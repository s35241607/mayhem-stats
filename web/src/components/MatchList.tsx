import { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { MatchDetail, type MatchRow } from "@/pages/Matches"

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })

const COLUMNS: GridColumn[] = [
  { key: "champion_name", title: "英雄", kind: "dimension", iconKey: "champion_icon" },
  { key: "when", title: "時間", kind: "dimension" },
  { key: "result", title: "結果", kind: "dimension" },
  { key: "kda_text", title: "K / D / A", kind: "dimension" },
  { key: "kda", title: "KDA", kind: "metric", format: (n) => n.toFixed(2) },
  { key: "dmg_to_champions", title: "對英雄傷害", kind: "metric", format: (n) => Math.round(n).toLocaleString() },
  { key: "gold_earned", title: "取得金錢", kind: "metric", format: (n) => Math.round(n).toLocaleString() },
  { key: "duration_min", title: "時長(分)", kind: "metric", format: (n) => n.toFixed(1) },
]

/** 圖表下鑽用的逐場列表：先列出符合條件的每一場，雙擊一場看完整戰報。
 *  時段頁（某天、某個時段）和隊友頁（和某人同場）共用。 */
export function MatchList({
  params,
  puuid,
  fileName,
}: {
  /** 直接送給 /api/matches 的查詢參數 */
  params: Record<string, string>
  /** 戰報要以誰為主角標示 */
  puuid?: string
  fileName: string
}) {
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ platformId: string; gameId: number } | null>(null)
  const key = new URLSearchParams({ limit: "200", ...params }).toString()

  useEffect(() => {
    setRows(null)
    setError(null)
    setPicked(null)
    const controller = new AbortController()
    fetch(`/api/matches?${key}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { matches: MatchRow[] }) => setRows(d.matches))
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message))
    return () => controller.abort()
  }, [key])

  if (picked) {
    return (
      <MatchDetail
        platformId={picked.platformId}
        gameId={picked.gameId}
        puuid={puuid}
        onBack={() => setPicked(null)}
      />
    )
  }

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!rows) return <Skeleton className="h-[260px] w-full" />
  if (!rows.length) return <EmptyState>這個條件下沒有對局。</EmptyState>

  const table = rows.map((m) => ({
    ...m,
    when: fmtTime(m.game_creation),
    result: m.win ? "勝" : "敗",
    kda_text: `${m.kills} / ${m.deaths} / ${m.assists}`,
    kda: (m.kills + m.assists) / (m.deaths || 1),
    duration_min: m.game_duration / 60,
  }))

  return (
    <div className="space-y-2">
      <AgTable
        columns={COLUMNS}
        rows={table as unknown as Record<string, unknown>[]}
        height={Math.min(460, 120 + rows.length * 38)}
        fileName={fileName}
        onDrill={(_col, _value, row) =>
          setPicked({ platformId: String(row.platform_id), gameId: Number(row.game_id) })
        }
      />
      <p className="text-[11px] text-muted-foreground">雙擊「英雄」或「時間」那一格，看該場的完整戰報。</p>
    </div>
  )
}
