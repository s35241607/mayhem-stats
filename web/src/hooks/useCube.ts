import { useEffect, useMemo, useState } from "react"
import { cubeQuery, peekCached, scopeEpoch, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useDataRevision } from "@/lib/revision"

type State = {
  rows: CubeRow[]
  /** 還沒有任何能畫的資料：畫骨架 */
  loading: boolean
  /** 畫面上是上一個條件（或採集前）的資料，新的還在路上：內容留著、淡化即可，不要換回骨架 */
  refreshing: boolean
  error: string | null
}
/** 手上這份結果是為哪個查詢、哪種形狀、看誰的時候算的 */
type Held = { rows: CubeRow[]; error: string | null; key: string | null; subject: string | null; epoch: number; settled: boolean }

/** 全站的「範圍」條件：期間、版本、模式。只有這幾項不同的兩個查詢問的是同一件事，
 *  上一份結果可以先留在畫面上等新的，圖表與數字從舊值變到新值。
 *  其他任何地方不同都不行：
 *  - 換了維度、指標、時間粒度：圖表會拿舊列去讀新欄位，畫出一堆空值；
 *  - 換了「看哪一個」（抽屜裡換一隻英雄、下鑽到某個增幅）：標題已經是新的那個，
 *    底下還留著上一個的數字，會被當成是它的。 */
const AMBIENT_MEMBER = /\.(patch|queue_id)$/
function subjectOf(q: CubeQuery): string {
  return JSON.stringify([
    q.measures ?? [],
    q.dimensions ?? [],
    q.segments ?? [],
    // 沒有粒度的時間維度只是期間篩選（「全部期間」時整個不存在），不算在內
    (q.timeDimensions ?? []).filter((t) => t.granularity).map((t) => [t.dimension, t.granularity]),
    (q.filters ?? []).filter((f) => !AMBIENT_MEMBER.test(f.member)),
    q.order ?? null,
  ])
}

/** 執行一個 Cube 查詢。傳入 null 表示條件還沒備妥，先不要查。
 *
 *  換期間／版本／模式時不退回骨架：快取裡有就同一幀直接給；沒有就先留著上一份（refreshing），
 *  圖表與數字因此是從舊值「變」到新值，而不是拆掉重長。其餘情況照舊回報 loading：
 *  第一次查、問的東西變了（見 subjectOf）、換了帳號（不能讓前一個人的數字留在畫面上）。
 *  採集到新資料時在背景重查，畫面不清空。 */
export function useCube(query: CubeQuery | null): State {
  const key = query ? JSON.stringify(query) : null
  const revision = useDataRevision()
  const epoch = scopeEpoch()
  const [held, setHeld] = useState<Held>(() => {
    const cached = query ? peekCached(query) : null
    return cached
      ? { rows: cached.rows, error: null, key, subject: subjectOf(query!), epoch, settled: true }
      : { rows: [], error: null, key: null, subject: null, epoch, settled: false }
  })

  const state = useMemo<State>(() => {
    if (key === null) return { rows: [], loading: false, refreshing: false, error: null }
    if (held.key === key) {
      return { rows: held.rows, loading: !held.settled, refreshing: false, error: held.error }
    }
    const q = JSON.parse(key) as CubeQuery
    const cached = peekCached(q)
    if (cached) return { rows: cached.rows, loading: false, refreshing: cached.stale, error: null }
    const reusable = held.settled && !held.error && held.epoch === epoch && held.subject === subjectOf(q)
    return reusable
      ? { rows: held.rows, loading: false, refreshing: true, error: null }
      : { rows: [], loading: true, refreshing: false, error: null }
  }, [key, held, epoch])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    // 重查詢可能要輪詢好幾輪，離開頁面時要真的把請求中止，
    // 不然使用者已經切走了，背景還在替一個沒人要看的查詢輪詢。
    const controller = new AbortController()
    const q = JSON.parse(key) as CubeQuery
    const settle = (rows: CubeRow[], error: string | null) =>
      setHeld({ rows, error, key, subject: subjectOf(q), epoch: scopeEpoch(), settled: true })

    cubeQuery(q, controller.signal)
      .then((rows) => {
        // 條件在請求途中被改掉時，丟棄這次的結果，避免舊資料蓋掉新資料
        if (!cancelled) settle(rows, null)
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return
        settle([], err.message)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // revision：採集到新資料時重跑一次。快取已經被標成過期，這次會真的去查；畫面沿用手上的結果直到它回來
  }, [key, revision])

  return state
}

export type CollectorStatus = {
  clientConnected: boolean
  phase: string | null
  totalMatches: number
  mayhemMatches: number
  myMayhemMatches?: number
  trackedCount?: number
  oldestGame: number | null
  newestGame: number | null
  lastRun: { at: number; trigger: string; seen: number; new: number } | null
  lastError: string | null
  /** 對外開放的唯讀模式（後端的 MAYHEM_PUBLIC）：寫入端點會回 403，畫面要把寫入入口收起來 */
  public?: boolean
}

/** 採集器狀態，定期輪詢並在資料變更時立即更新。 */
export function useCollectorStatus(intervalMs = 30000) {
  const [status, setStatus] = useState<CollectorStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/status")
        // 登入過期就重新載入，後端會送出登入頁（這支每 30 秒輪詢，最快發現）
        if (res.status === 401) return location.reload()
        const data = await res.json()
        if (!cancelled) setStatus(data)
      } catch {
        /* 後端還沒起來，下一輪再說 */
      }
    }
    load()
    const timer = setInterval(load, intervalMs)
    window.addEventListener("mayhem:data-changed", load)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener("mayhem:data-changed", load)
    }
  }, [intervalMs])

  return status
}
