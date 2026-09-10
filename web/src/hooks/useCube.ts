import { useEffect, useState } from "react"
import { cubeQuery, type CubeQuery, type CubeRow } from "@/lib/cube"

type State = {
  rows: CubeRow[]
  loading: boolean
  error: string | null
}

/** 執行一個 Cube 查詢。傳入 null 表示條件還沒備妥，先不要查。 */
export function useCube(query: CubeQuery | null): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null })
  const key = query ? JSON.stringify(query) : null

  useEffect(() => {
    if (!key) {
      // 條件還沒備妥。這裡若直接 return，state 會永遠停在初始的 loading:true，
      // 呼叫端就會看到一個永遠轉不完的骨架或「查詢中…」。
      setState({ rows: [], loading: false, error: null })
      return
    }
    let cancelled = false
    // 重查詢可能要輪詢好幾輪，離開頁面時要真的把請求中止，
    // 不然使用者已經切走了，背景還在替一個沒人要看的查詢輪詢。
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))

    cubeQuery(JSON.parse(key) as CubeQuery, controller.signal)
      .then((rows) => {
        // 條件在請求途中被改掉時，丟棄這次的結果，避免舊資料蓋掉新資料
        if (!cancelled) setState({ rows, loading: false, error: null })
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return
        setState({ rows: [], loading: false, error: err.message })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key])

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
}

/** 採集器狀態，定期輪詢。 */
export function useCollectorStatus(intervalMs = 30000) {
  const [status, setStatus] = useState<CollectorStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/status")
        const data = await res.json()
        if (!cancelled) setStatus(data)
      } catch {
        /* 後端還沒起來，下一輪再說 */
      }
    }
    load()
    const timer = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [intervalMs])

  return status
}
