import { useCallback, useMemo, useSyncExternalStore } from "react"

/** 把畫面狀態放進網址的查詢字串：重新整理不掉、複製網址就是同一個畫面、上一頁退得回去。
 *
 *  路由是手寫的（App.tsx 用 pushState 換頁名），所以這裡也自己來，不引入路由或網址狀態套件。
 *  規則：
 *  - 預設值不寫進網址——網址只記「和預設不一樣的地方」，預設改了（例如站台預設期間）舊連結跟著走。
 *  - 篩選類用 replace（預設）：連點幾次篩選不該讓上一頁變成一格一格退。
 *  - 「進到更細一層」用 push（開抽屜、看單場戰報）：上一頁就是退一層。
 *  - 換頁時只留全站的參數（GLOBAL_KEYS），頁內的丟掉——不同頁可以用同一個短名字而不互相干擾。
 */

/** 換頁後要留著的參數：看誰、模式、期間、版本、全域下鑽、「看誰」切換 */
export const GLOBAL_KEYS = ["acct", "mode", "range", "v", "vf", "drill", "who", "cmp"] as const

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

if (typeof window !== "undefined") window.addEventListener("popstate", emit)

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function readParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

function href(pathname: string, params: URLSearchParams) {
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** 一次改多個參數（null = 拿掉）。沒有實際變化就什麼都不做，免得 push 出一格一模一樣的歷史。 */
export function writeParams(patch: Record<string, string | null>, mode: "replace" | "push" = "replace") {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") params.delete(key)
    else params.set(key, value)
  }
  const next = href(window.location.pathname, params)
  if (next === window.location.pathname + window.location.search) return
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", next)
  emit()
}

/** 換頁用的網址：頁名換掉，只帶全站參數過去。extra 是要一併帶給新頁的頁內參數
 *  （指令面板選一隻英雄 = 跳到英雄頁並帶 champ=）。 */
export function pageHref(page: string, extra?: Record<string, string>): string {
  const current = new URLSearchParams(window.location.search)
  const kept = new URLSearchParams()
  for (const key of GLOBAL_KEYS) {
    const value = current.get(key)
    if (value !== null) kept.set(key, value)
  }
  for (const [key, value] of Object.entries(extra ?? {})) kept.set(key, value)
  return href(`/${page}`, kept)
}

/** 換頁後通知所有讀網址的 hook（App 自己 pushState 之後呼叫） */
export const notifyUrlChanged = emit

/** 讀寫一個原始字串參數 */
export function useUrlParam(key: string, mode: "replace" | "push" = "replace"): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => readParam(key))
  const set = useCallback((next: string | null) => writeParams({ [key]: next }, mode), [key, mode])
  return [value, set]
}

export type Codec<T> = { parse: (raw: string) => T | undefined; format: (value: T) => string }

export const stringCodec: Codec<string> = { parse: (raw) => raw, format: (v) => v }
export const numberCodec: Codec<number> = {
  parse: (raw) => (raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined),
  format: String,
}
export const boolCodec: Codec<boolean> = { parse: (raw) => raw === "1", format: (v) => (v ? "1" : "0") }
/** 逗號分隔的字串清單（值本身不能有逗號） */
export const listCodec: Codec<string[]> = {
  parse: (raw) => (raw ? raw.split(",") : []),
  format: (v) => v.join(","),
}
/** 只收指定的幾個值，其他（手改網址、舊連結）當作沒給 */
export function oneOf<T extends string>(...values: T[]): Codec<T> {
  return { parse: (raw) => (values.includes(raw as T) ? (raw as T) : undefined), format: (v) => v }
}
/** 任意可序列化的值。用在整包配置（自由探索）；網址會長，但還是一個參數 */
export function jsonCodec<T>(): Codec<T> {
  return {
    parse: (raw) => {
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    format: (v) => JSON.stringify(v),
  }
}

/** useState 的網址版。fallback 是預設值：等於預設時參數會從網址拿掉。
 *  傳 null 當 fallback 表示「預設沒有值」（例如沒選任何英雄）。 */
export function useUrlState<T>(
  key: string,
  fallback: T,
  codec: Codec<NonNullable<T>>,
  mode: "replace" | "push" = "replace",
): [T, (value: T) => void] {
  const [raw, setRaw] = useUrlParam(key, mode)
  const fallbackKey = fallback == null ? null : codec.format(fallback as NonNullable<T>)
  const value = useMemo<T>(() => {
    if (raw === null) return fallback
    const parsed = codec.parse(raw)
    return parsed === undefined ? fallback : parsed
    // fallback 用它的字串形式比，每次渲染都是新陣列／物件的預設值才不會讓結果一直變
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, fallbackKey, codec])
  const set = useCallback(
    (next: T) => {
      const formatted = next == null ? null : codec.format(next as NonNullable<T>)
      setRaw(formatted === fallbackKey ? null : formatted)
    },
    [setRaw, codec, fallbackKey],
  )
  return [value, set]
}
