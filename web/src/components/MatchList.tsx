import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/primitives"
import { MatchCards, MatchDetail, type MatchRow } from "@/pages/Matches"

const PAGE = 20

/** 圖表下鑽用的逐場列表：卡片樣式和「對局紀錄」頁一樣，點一張看完整戰報。
 *  英雄頁（某隻英雄）、時段頁（某天、某個時段）、隊友頁（和某人同場）共用。 */
export function MatchList({
  params,
  puuid,
}: {
  /** 直接送給 /api/matches 的查詢參數 */
  params: Record<string, string>
  /** 戰報要以誰為主角標示 */
  puuid?: string
}) {
  const [data, setData] = useState<{ matches: MatchRow[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ platformId: string; gameId: number } | null>(null)
  const [shown, setShown] = useState(PAGE)
  const key = new URLSearchParams({ limit: "200", ...params }).toString()

  useEffect(() => {
    setData(null)
    setError(null)
    setPicked(null)
    setShown(PAGE)
    const controller = new AbortController()
    fetch(`/api/matches?${key}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { matches?: MatchRow[]; total?: number; detail?: unknown }) => {
        if (!d.matches) throw new Error("讀取對局失敗")
        setData({ matches: d.matches, total: d.total ?? d.matches.length })
      })
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
  if (!data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  const { matches, total } = data
  if (!matches.length) return <EmptyState>這個條件下沒有對局。</EmptyState>

  // 一次最多抓 200 場；超過時勝敗只能算已載入的部分，就不顯示以免誤導
  const complete = matches.length === total
  const wins = matches.filter((m) => m.win).length

  return (
    <div className="reveal space-y-2">
      <div className="text-xs text-muted-foreground">
        共 {total} 場
        {complete && (
          <>
            ・{wins} 勝 {total - wins} 敗・勝率 {((wins / total) * 100).toFixed(1)}%
          </>
        )}
        ・點任一場看完整戰報
      </div>
      <MatchCards rows={matches.slice(0, shown)} onPick={setPicked} />
      {shown < matches.length && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => setShown(shown + PAGE)}>
          再顯示 {Math.min(PAGE, matches.length - shown)} 場（還有 {matches.length - shown} 場）
        </Button>
      )}
      {!complete && shown >= matches.length && (
        <p className="text-center text-[11px] text-muted-foreground">
          只列出最近 {matches.length} 場，完整的請到「對局紀錄」頁。
        </p>
      )}
    </div>
  )
}
