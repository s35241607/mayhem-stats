/** Cube 語意層的查詢客戶端。
 *
 * 一律走 FastAPI 的 /api/cube 代理，不直接連 Cube 的 4000 埠——Cube 沒有繫結
 * 位址的設定，它的埠開在所有網路介面上且開發模式不驗證身分。
 */

export type CubeFilter = {
  member: string
  operator: string
  values: string[]
}

export type CubeQuery = {
  measures?: string[]
  dimensions?: string[]
  /** 模型裡定義好的具名篩選，前端只送名稱。 */
  segments?: string[]
  // dateRange 兩種都收：["2026-09-01","2026-09-08"] 這種絕對區間，
  // 或 "last 7 days" 這種 Cube 自己解析的相對區間。
  timeDimensions?: {
    dimension: string
    granularity?: string
    dateRange?: string | string[]
  }[]
  filters?: CubeFilter[]
  order?: Record<string, "asc" | "desc">
  limit?: number
  timezone?: string
}

export type CubeRow = Record<string, string | number | null>

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei"

// Cube 對「還沒算完」的查詢會回 HTTP 200 加上這個字串、而且沒有 data 欄位。
// 它不是失敗，語意是「再問一次」——Cube 官方客戶端就是這樣輪詢的。
const CONTINUE_WAIT = "Continue wait"
// 每次輪詢 Cube 自己會先在伺服器端等大約十秒才回覆，所以這裡不必再自己 sleep。
const MAX_WAIT_MS = 90_000

// 會讓一場對局展開成多列的 cube（一個人四個增幅、六格裝備、一隻英雄兩個定位）。
const FAN_OUT_CUBES = new Set(["augments", "items", "champion_roles"])
// 這三個指標在每個 cube 裡都是 count_distinct，而 winrate 一律定義成 100 * wins / games。
const COUNT_DISTINCT = new Set(["games", "wins", "losses", "match_count"])

/** 勝率在一對多 join 的查詢裡改成「查 wins + games、在這裡除」。
 *
 * winrate 是 number 型的衍生指標，Cube 無法確定它在一對多 join 下不會重複計算，
 * 於是改走「先撈每一列主鍵再 join 回本表」的算法；wins 和 games 是 count_distinct，
 * 天生不怕重複列，不會觸發那條路。實測增幅類查詢 17–46ms -> 7–13ms，
 * 隊友定位拆解 530ms -> 0.5ms。
 *
 * 只有在「改寫後真的能避開回連」時才改：同一個查詢裡若還有 KDA、DPM 這種平均類
 * 指標，照樣會走回連，改了也沒用，就保持原樣（也保留和其他查詢共用的快取鍵）。
 * 依勝率排序或篩選的查詢不能改，排序和 limit 必須在伺服器端做。
 */
function splitWinrate(query: CubeQuery): { query: CubeQuery; winrates: string[] } | null {
  const measures = query.measures ?? []
  const winrates = measures.filter((m) => m.endsWith(".winrate"))
  if (!winrates.length) return null

  const members = [
    ...(query.dimensions ?? []),
    ...(query.filters ?? []).map((f) => f.member),
    ...(query.segments ?? []),
  ]
  if (!members.some((m) => FAN_OUT_CUBES.has(m.split(".")[0]))) return null
  if (!measures.every((m) => m.endsWith(".winrate") || COUNT_DISTINCT.has(m.split(".")[1]))) return null
  if (winrates.some((m) => m in (query.order ?? {}))) return null
  if ((query.filters ?? []).some((f) => winrates.includes(f.member))) return null

  const next = new Set(measures.filter((m) => !m.endsWith(".winrate")))
  for (const m of winrates) {
    const cube = m.split(".")[0]
    next.add(`${cube}.wins`)
    next.add(`${cube}.games`)
  }
  return { query: { ...query, measures: [...next] }, winrates }
}

export async function cubeQuery(query: CubeQuery, signal?: AbortSignal): Promise<CubeRow[]> {
  const split = splitWinrate(query)
  if (!split) return fetchShared(query, signal)

  const rows = await fetchShared(split.query, signal)
  const asked = new Set(query.measures)
  return rows.map((row) => {
    const out: CubeRow = { ...row }
    for (const m of split.winrates) {
      const cube = m.split(".")[0]
      const wins = num(row[`${cube}.wins`])
      const games = num(row[`${cube}.games`])
      out[m] = wins !== null && games ? (100 * wins) / games : null
    }
    // 呼叫端沒要的欄位拿掉，回傳的形狀和沒改寫時一模一樣
    for (const key of Object.keys(out)) {
      if (key.endsWith(".wins") || key.endsWith(".games")) {
        if (!asked.has(key)) delete out[key]
      }
    }
    return out
  })
}

/** 429（查詢太頻繁）時最多自動重試幾次；每次等後端給的 Retry-After，上限 15 秒 */
const MAX_RATE_RETRIES = 3
const MAX_RATE_WAIT_S = 15
/** 同一個查詢在這段時間內重複發出時，共用上一次的結果（或還在進行的請求） */
const SHARE_TTL_MS = 10_000

type Shared = { at: number; promise: Promise<CubeRow[]>; controller: AbortController; refs: number }
const shared = new Map<string, Shared>()

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** 同一個查詢（參數完全相同）只送一次：進行中的請求或 10 秒內的結果直接共用。
 *  每個等待的人離開時只減自己的參考數；全部離開才真的中止 Cube 的輪詢。 */
function fetchShared(query: CubeQuery, signal?: AbortSignal): Promise<CubeRow[]> {
  const key = JSON.stringify({ timezone: TIMEZONE, ...query })
  let entry = shared.get(key)
  if (!entry || Date.now() - entry.at > SHARE_TTL_MS) {
    const controller = new AbortController()
    const created: Shared = { at: Date.now(), controller, refs: 0, promise: load(query, controller.signal) }
    created.promise.catch(() => {
      if (shared.get(key) === created) shared.delete(key)
    })
    shared.set(key, created)
    entry = created
  }
  const e = entry
  e.refs++
  return new Promise((resolve, reject) => {
    let done = false
    const onAbort = () => {
      if (done) return
      done = true
      e.refs--
      if (e.refs <= 0) {
        e.controller.abort()
        if (shared.get(key) === e) shared.delete(key)
      }
      reject(new DOMException("aborted", "AbortError"))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    e.promise.then(
      (rows) => {
        if (done) return
        done = true
        signal?.removeEventListener("abort", onAbort)
        e.refs--
        resolve(rows)
      },
      (err: unknown) => {
        if (done) return
        done = true
        signal?.removeEventListener("abort", onAbort)
        e.refs--
        reject(err)
      },
    )
  })
}

async function load(query: CubeQuery, signal?: AbortSignal): Promise<CubeRow[]> {
  const params = new URLSearchParams({
    query: JSON.stringify({ timezone: TIMEZONE, ...query }),
  })
  const deadline = Date.now() + MAX_WAIT_MS
  let rateRetries = 0

  for (;;) {
    const res = await fetch(`/api/cube/load?${params}`, { signal })
    // 公開模式的登入過期（或伺服器重啟）：重新載入就會拿到登入頁，
    // 不要在畫面上冒出一堆「請先登入」的查詢錯誤
    if (res.status === 401) {
      location.reload()
      throw new Error("請先登入")
    }
    const payload = await res.json()

    if (res.ok && payload.error === CONTINUE_WAIT) {
      // 這裡若直接當錯誤丟出去，畫面會冒出「Continue wait」這串英文，
      // 而查詢其實還在跑；再問一次就會拿到結果。
      if (Date.now() > deadline) {
        throw new Error("查詢時間過長，請縮小範圍或減少維度。")
      }
      continue
    }

    // 429：照後端給的 Retry-After 等一下再試，試幾次還是被擋才當錯誤顯示
    if (res.status === 429) {
      if (rateRetries < MAX_RATE_RETRIES) {
        rateRetries++
        const hinted = Number(res.headers.get("Retry-After"))
        const wait = Math.min(MAX_RATE_WAIT_S, Math.max(1, Number.isFinite(hinted) && hinted > 0 ? hinted : 2))
        await sleep(wait * 1000, signal)
        continue
      }
      throw new Error(typeof payload.error === "string" ? payload.error : "查詢太頻繁，請稍後再試。")
    }

    if (!res.ok || payload.error) {
      throw new Error(typeof payload.error === "string" ? payload.error : "查詢失敗")
    }
    return payload.data ?? []
  }
}

/** 客戶端圖示要經過後端帶認證代理，瀏覽器本身沒有 LCU 的憑證。 */
export function iconUrl(path: string | null | undefined): string | undefined {
  return path ? `/api/icon?path=${encodeURIComponent(path)}` : undefined
}

export const MAYHEM_QUEUE_ID = "2400"

/** 下鑽走到底時一次最多列出幾場，和後端 /api/matches 的上限一致。
 *  放在這裡而不是 MatchList：儀表板要用，但 MatchList 是延後載入的 chunk。 */
export const MAX_GAME_IDS = 1000

/** 幾乎每個查詢都要：只看自己、只看指定模式。 */
export function baseFilters(queueId: string | null): CubeFilter[] {
  const filters: CubeFilter[] = [
    { member: "participants.is_me", operator: "equals", values: ["true"] },
  ]
  if (queueId) {
    filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
  }
  return filters
}

export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
