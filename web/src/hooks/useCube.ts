import { useEffect, useState } from "react"
import { cubeQuery, type CubeQuery, type CubeRow } from "@/lib/cube"

type State = {
  rows: CubeRow[]
  loading: boolean
  error: string | null
}
/** 內部多記一份「這份結果是為哪個查詢算的」，key 換了但結果還沒回來的那一幀也要回報 loading */
type Held = State & { key: string | null }

/** 執行一個 Cube 查詢。傳入 null 表示條件還沒備妥，先不要查。 */
export function useCube(query: CubeQuery | null): State {
  const key = query ? JSON.stringify(query) : null
  const [held, setHeld] = useState<Held>({ rows: [], loading: true, error: null, key })
  // 條件從 null 變成有值（例如切到要用它的分頁）時，結果還是上一個條件的：這一幀就算 loading，
  // 不然呼叫端會先畫一幀「沒有資料」的空狀態，下一幀才變成載入中
  const state: State = key !== null && held.key !== key ? { ...held, loading: true } : held

  useEffect(() => {
    if (!key) {
      // 條件還沒備妥。這裡若直接 return，state 會永遠停在初始的 loading:true，
      // 呼叫端就會看到一個永遠轉不完的骨架或「查詢中…」。
      setHeld({ rows: [], loading: false, error: null, key })
      return
    }
    let cancelled = false
    // 重查詢可能要輪詢好幾輪，離開頁面時要真的把請求中止，
    // 不然使用者已經切走了，背景還在替一個沒人要看的查詢輪詢。
    const controller = new AbortController()
    setHeld((prev) => ({ ...prev, key, loading: true, error: null }))

    cubeQuery(JSON.parse(key) as CubeQuery, controller.signal)
      .then((rows) => {
        // 條件在請求途中被改掉時，丟棄這次的結果，避免舊資料蓋掉新資料
        if (!cancelled) setHeld({ rows, loading: false, error: null, key })
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return
        setHeld({ rows: [], loading: false, error: err.message, key })
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
