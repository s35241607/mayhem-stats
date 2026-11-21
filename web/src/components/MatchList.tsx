import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, QueryError } from "@/components/primitives"
import { useCrumb } from "@/lib/breadcrumb"
import { useDataRevision } from "@/lib/revision"
import { useUrlParam, writeParams } from "@/lib/urlState"
import { useCube } from "@/hooks/useCube"
import { useFilters } from "@/lib/filters"
import { MAX_GAME_IDS, type CubeQuery, type CubeRow } from "@/lib/cube"
import { MatchCards, MatchDetail, matchCrumbLabel, type MatchPick, type MatchRow } from "@/pages/Matches"

export { MAX_GAME_IDS }

/** 捲動載入時一次抓幾場（後端單次上限 200）。第一批少一點：它和換頁進場動畫同時渲染，
 *  卡片含裝備圖示，一次 50 張會在動畫期間多出長任務；之後捲動載入的批次就不怕。 */
const FIRST_PAGE = 20
const PAGE = 50

/** 「是哪幾場」交給 Cube 用同一組條件查出來，再送 /api/matches 列出那幾場。
 *
 *  條件的定義因此只留在語意層一份。後端不必為每個維度各寫一套 SQL——
 *  原本節奏頁的「前一場」「當日第幾場」在 app.py 裡有一份手抄的視窗函數，
 *  哪天語意層改了規則（例如 session 改成依休息時間切），那份副本會無聲地對不上。
 *  query 要自己帶 dimensions: [<cube>.game_id]，因為維度屬於哪一家 cube 由呼叫端決定。 */
export function CubeMatchList({
  query,
  gameIdKey,
  listKey,
  params,
  showPlayer,
  rowsToParams,
}: {
  query: CubeQuery | null
  gameIdKey: string
  /** 換條件時強制重新掛載列表（清掉開著的戰報與捲動位置） */
  listKey?: string
  /** 蓋過全域條件的 /api/matches 參數。英雄頁「所有人」用 puuid=* 加 champion，每一列就是玩這隻英雄的那個人 */
  params?: Record<string, string>
  showPlayer?: boolean
  /** 不用 game_ids、改由 Cube 的列自己組出 /api/matches 參數（例如 participants=遊戲:參賽者）。
   *  回傳 null 表示沒有東西可列 */
  rowsToParams?: (rows: CubeRow[]) => { params: Record<string, string>; count: number } | null
}) {
  const { matchParams, account } = useFilters()
  const ids = useCube(query)
  if (ids.loading) return <Skeleton className="h-40 w-full" />
  if (ids.error) return <QueryError error={ids.error} />
  const built = rowsToParams
    ? rowsToParams(ids.rows)
    : ids.rows.length
      ? { params: { game_ids: ids.rows.map((r) => String(r[gameIdKey])).join(",") }, count: ids.rows.length }
      : null
  if (!built || !built.count) return <EmptyState>這個條件下沒有對局。</EmptyState>
  return (
    <div className="space-y-2">
      {built.count >= MAX_GAME_IDS && (
        <p className="text-[11px] text-muted-foreground">
          符合的條件超過 {MAX_GAME_IDS} 場，這裡只列出其中 {MAX_GAME_IDS} 場。縮小期間或再加一個條件就能看全。
        </p>
      )}
      <MatchList
        key={listKey}
        params={{ ...matchParams(), ...params, ...built.params }}
        puuid={account?.puuid}
        showPlayer={showPlayer}
      />
    </div>
  )
}

/** 從圖表下鑽出來的「XX 的每一場」。各頁共用，一律從右邊滑出抽屜（DetailDrawer）：
 *  原頁面留在原位，剛點的那根長條還看得到；關掉（ESC、點遮罩、右上角）就清掉聚焦。
 *  以前是在頁面下方插一塊面板再把頁面捲過去，點了之後畫面整片跳走。
 *  呼叫端照舊「有聚焦才渲染」：`{focus && <DrillPanel … onClose={() => setFocus(null)} />}`。
 *
 *  兩種取得方式擇一：`params` 直接送 /api/matches（帳號、模式、期間、英雄這類後端認得的條件），
 *  或 `query` 先讓 Cube 依語意層的定義查出是哪幾場。新的可下鑽維度一律用後者。 */
export function DrillPanel({
  title,
  params,
  query,
  gameIdKey,
  puuid,
  matchParams,
  showPlayer,
  rowsToParams,
  onClose,
}: {
  title: string
  params?: Record<string, string>
  query?: CubeQuery | null
  gameIdKey?: string
  puuid?: string
  /** 搭配 query：蓋過全域條件的 /api/matches 參數（見 CubeMatchList 的 params） */
  matchParams?: Record<string, string>
  showPlayer?: boolean
  rowsToParams?: (rows: CubeRow[]) => { params: Record<string, string>; count: number } | null
  onClose: () => void
}) {
  return (
    <DetailDrawer open onClose={onClose} title={`${title} 的每一場`}>
      <DrillBody>
        {query !== undefined ? (
          <CubeMatchList
            query={query}
            gameIdKey={gameIdKey!}
            listKey={`${title}|${matchParams?.puuid ?? ""}`}
            params={matchParams}
            showPlayer={showPlayer}
            rowsToParams={rowsToParams}
          />
        ) : (
          <MatchList params={params!} puuid={puuid} />
        )}
      </DrillBody>
    </DetailDrawer>
  )
}

/** 逐場卡片等抽屜滑完再掛（和換頁一樣，重的東西不和進場動畫搶主執行緒） */
function DrillBody({ children }: { children: ReactNode }) {
  return useDrawerSettled() ? children : <Skeleton className="h-40 w-full" />
}

type Loaded = { matches: MatchRow[]; total: number; wins: number; key: string }

/** 逐場列表：卡片樣式和「對局紀錄」頁一樣，點一張看完整戰報。
 *  對局紀錄頁、英雄頁（某隻英雄）、時段頁（某天、某個時段）、隊友頁（和某人同場）等共用。
 *  全部場次都查得到：捲到底自動載入下一批（無限捲動），不設上限。 */
export function MatchList({
  params,
  puuid,
  showPlayer = false,
  headerExtra,
}: {
  /** 直接送給 /api/matches 的查詢參數 */
  params: Record<string, string>
  /** 戰報要以誰為主角標示（列上有玩家時以列上的為準） */
  puuid?: string
  /** 每一列不一定是同一個人時，卡片上標出是誰玩的 */
  showPlayer?: boolean
  /** 卡片標頭右側多放的內容（例如「同場追蹤：A、B」），只在 showPlayer 時有標頭 */
  headerExtra?: (m: MatchRow) => ReactNode
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // 點開的那一場記在網址（match=平台.對局.參賽者）：上一頁就是回到列表，重新整理、貼連結也還在那一場。
  // 只記是哪一列，不放 puuid；主角從列上讀，列還沒載到就先用呼叫端給的
  const [matchParam] = useUrlParam("match")
  const picked = useMemo<MatchPick | null>(() => {
    const [platformId, gameId, participantId] = (matchParam ?? "").split(".")
    return platformId && Number(gameId) ? { platformId, gameId: Number(gameId), participantId: Number(participantId) } : null
  }, [matchParam])
  const setPicked = (m: MatchPick | null) =>
    writeParams({ match: m ? `${m.platformId}.${m.gameId}.${m.participantId}` : null }, m ? "push" : "replace")
  const pickedRow = picked
    ? data?.matches.find((m) => m.platform_id === picked.platformId && m.game_id === picked.gameId && m.participant_id === picked.participantId)
    : undefined
  useCrumb(90, pickedRow ? matchCrumbLabel(pickedRow) : picked ? "單場戰報" : null, () => setPicked(null))
  const key = new URLSearchParams(params).toString()
  const revision = useDataRevision()
  // 換條件時舊清單先留著（淡化），新的第一批回來才換；換了人就不留，免得把前一個人的對局當成現在的
  const stale = !!data && data.key !== key
  const loaded = useRef<{ key: string; puuid?: string } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // 載入中的請求：換條件時中止，並防止同一批被觸發兩次
  const inflight = useRef<AbortController | null>(null)
  // 看戰報前的捲動位置，回到列表時還原（不然捲到第 300 場點進去，回來又在最上面）
  const savedScroll = useRef<number | null>(null)

  const fetchPage = (offset: number, signal: AbortSignal) =>
    fetch(`/api/matches?${new URLSearchParams({ ...params, limit: String(offset === 0 ? FIRST_PAGE : PAGE), offset: String(offset) })}`, { signal })
      .then((r) => r.json())
      .then((d: { matches?: MatchRow[]; total?: number; wins?: number }) => {
        if (!d.matches) throw new Error("讀取對局失敗")
        return d as Omit<Loaded, "key">
      })

  useEffect(() => {
    // 同一組條件、只是採集到新對局：不清畫面、不關戰報，把新的幾場接到最前面
    const sameKey = loaded.current?.key === key
    // 第一次掛載不算「換條件」：網址帶著 match 進來時要留著它
    if (!sameKey && loaded.current) {
      if (loaded.current.puuid !== params.puuid) setData(null)
      setPicked(null)
    }
    setError(null)
    setLoadingMore(false)
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    fetchPage(0, controller.signal)
      .then((d) => {
        loaded.current = { key, puuid: params.puuid }
        setData((cur) => {
          const head = { total: d.total ?? d.matches.length, wins: d.wins ?? 0, key }
          if (!sameKey || !cur || cur.key !== key) return { matches: d.matches, ...head }
          const rowKey = (m: MatchRow) => `${m.platform_id}:${m.game_id}:${m.participant_id}`
          const seen = new Set(cur.matches.map(rowKey))
          return { matches: [...d.matches.filter((m) => !seen.has(rowKey(m))), ...cur.matches], ...head }
        })
        inflight.current = null
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message))
    return () => controller.abort()
    // fetchPage 只依賴 params，而 key 就是 params 的內容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision])

  const hasMore = !!data && !stale && data.matches.length < data.total

  const loadMore = () => {
    if (!data || !hasMore || inflight.current) return
    const controller = new AbortController()
    inflight.current = controller
    setLoadingMore(true)
    fetchPage(data.matches.length, controller.signal)
      .then((d) => {
        // 用函式更新：以目前的列表為準接上去，並略過重複的（兩批之間剛好採集到新對局時，位移會錯開一場）
        setData((cur) => {
          if (!cur) return cur
          // 以參賽者為鍵：「所有人」模式下同一場可能有兩列（兩個人都玩這隻）
          const rowKey = (m: MatchRow) => `${m.platform_id}:${m.game_id}:${m.participant_id}`
          const seen = new Set(cur.matches.map(rowKey))
          const fresh = d.matches.filter((m) => !seen.has(rowKey(m)))
          return { matches: [...cur.matches, ...fresh], total: d.total ?? cur.total, wins: d.wins ?? cur.wins, key: cur.key }
        })
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message))
      .finally(() => {
        if (inflight.current === controller) inflight.current = null
        setLoadingMore(false)
      })
  }

  // 捲到列表底部附近（提前 600px）就載入下一批
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || picked) return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), {
      rootMargin: "600px 0px",
    })
    observer.observe(el)
    return () => observer.disconnect()
    // loadMore 讀的是最新 data；每次 data 變了就重掛，載完一批若底部仍在視窗內會立刻再觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasMore, picked, loadingMore])

  const pick = (m: MatchPick) => {
    savedScroll.current = window.scrollY
    setPicked(m)
    // 戰報從列表頂端開始畫；若列表已經捲很深，要捲回戰報的位置才看得到
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }))
  }

  useLayoutEffect(() => {
    if (picked || savedScroll.current === null) return
    window.scrollTo({ top: savedScroll.current })
    savedScroll.current = null
  }, [picked])

  let body
  if (picked) {
    body = (
      <MatchDetail
        platformId={picked.platformId}
        gameId={picked.gameId}
        puuid={pickedRow?.puuid ?? puuid}
        onBack={() => setPicked(null)}
      />
    )
  } else if (error && !data) {
    body = <QueryError error={error} />
  } else if (!data) {
    body = (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  } else if (!data.matches.length) {
    body = <EmptyState>這個條件下沒有對局。</EmptyState>
  } else {
    const { matches, total, wins } = data
    body = (
      <div className="reveal refreshable space-y-2" aria-busy={stale || undefined}>
        <div className="text-xs text-muted-foreground">
          共 {total} 場・{wins} 勝 {total - wins} 敗・勝率 {((wins / total) * 100).toFixed(1)}%・點任一場看完整戰報
        </div>
        <MatchCards rows={matches} onPick={pick} showPlayer={showPlayer} showDamage={params.sort === "damage" || params.metric === "damage"} headerExtra={headerExtra} />
        <div ref={sentinelRef} />
        {error ? (
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setError(null); loadMore() }}>
            載入失敗，重試
          </Button>
        ) : hasMore ? (
          <div className="space-y-2" aria-live="polite">
            {loadingMore
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
              : (
                <Button size="sm" variant="outline" className="w-full" onClick={loadMore}>
                  載入更多（已載入 {matches.length} / {total} 場）
                </Button>
              )}
          </div>
        ) : (
          total > FIRST_PAGE && <p className="text-center text-[11px] text-muted-foreground">已經是全部 {total} 場</p>
        )}
      </div>
    )
  }

  return <div ref={rootRef} className="scroll-mt-40">{body}</div>
}
