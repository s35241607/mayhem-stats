import { useEffect, useMemo, useState } from "react"
import { Player } from "@remotion/player"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, Panel, QueryError } from "@/components/primitives"
import { cubeQuery } from "@/lib/cube"
import { dateBounds, useFilters } from "@/lib/filters"
import { useAfterPageEnter } from "@/lib/motion"
import { Recap as RecapVideo } from "@/recap/Recap"
import { RECAP_SIZE, recapDuration } from "@/recap/timeline"
import { loadRecap } from "@/recap/data"
import type { RecapData, RecapPalette } from "@/recap/types"

/** 影片的顏色就是目前主題的 CSS 變數：切主題時回顧跟著換，這裡不寫任何色碼。 */
const PALETTE: RecapPalette = {
  bg: "var(--background)",
  card: "var(--card)",
  fg: "var(--foreground)",
  muted: "var(--muted-foreground)",
  primary: "var(--primary)",
  win: "var(--win)",
  loss: "var(--loss)",
  data: "var(--data)",
  gold: "var(--gold)",
  border: "var(--border)",
  tile: "var(--icon-tile)",
}

type State = { key: string; data: RecapData | null; error: string | null }

export function Recap() {
  const { ready, account, queueId, dateRange, viewer } = useFilters()
  const enterDone = useAfterPageEnter()
  const [state, setState] = useState<State>({ key: "", data: null, error: null })

  const bounds = dateBounds(dateRange)
  const key = account ? JSON.stringify([account.puuid, queueId, bounds]) : null

  useEffect(() => {
    if (!ready || !account || !key) return
    const controller = new AbortController()
    loadRecap((q) => cubeQuery(q, controller.signal), {
      puuid: account.puuid,
      player: account.riot_id,
      queueId,
      dateRange: bounds,
    })
      .then((data) => setState({ key, data, error: null }))
      .catch((err: Error) => err.name !== "AbortError" && setState({ key, data: null, error: err.message }))
    return () => controller.abort()
    // bounds 已經包在 key 裡，換一天才重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key])

  const current = state.key === key ? state : null
  const inputProps = useMemo(
    () => (current?.data ? { data: current.data, palette: PALETTE, fontFamily: "inherit", origin: "" } : null),
    [current?.data],
  )

  let body
  if (current?.error) body = <QueryError error={current.error} />
  else if (current && !current.data) body = <EmptyState>這個條件下還沒有對局，沒有東西可以回顧。</EmptyState>
  else if (!inputProps || !current?.data || !enterDone) body = <Skeleton className="aspect-video w-full" />
  else {
    body = (
      <Player
        component={RecapVideo}
        inputProps={inputProps}
        durationInFrames={recapDuration(current.data)}
        compositionWidth={RECAP_SIZE.width}
        compositionHeight={RECAP_SIZE.height}
        fps={RECAP_SIZE.fps}
        controls
        autoPlay
        clickToPlay
        style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: "var(--radius)", overflow: "hidden" }}
      />
    )
  }

  return (
    <div>
      <Panel title="賽季回顧" caption="依上方選的帳號、模式與期間，把這段時間的戰績整理成一支短片">
        {body}
        {/* 渲染要在跑服務的那台電腦上做，公開鏡像的訪客用不到 */}
        {!viewer?.public && (
          <p className="mt-3 text-xs text-muted-foreground">
            要存成影片檔（mp4）分享給朋友：在專案的 <code className="font-mono">promo</code> 資料夾執行{" "}
            <code className="font-mono">npm run recap</code>，用法見 <code className="font-mono">promo/README.md</code>。
          </p>
        )}
      </Panel>
    </div>
  )
}
