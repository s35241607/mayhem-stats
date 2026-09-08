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
  timeDimensions?: { dimension: string; granularity?: string; dateRange?: string[] }[]
  filters?: CubeFilter[]
  order?: Record<string, "asc" | "desc">
  limit?: number
  timezone?: string
}

export type CubeRow = Record<string, string | number | null>

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei"

export async function cubeQuery(query: CubeQuery): Promise<CubeRow[]> {
  const params = new URLSearchParams({
    query: JSON.stringify({ timezone: TIMEZONE, ...query }),
  })
  const res = await fetch(`/api/cube/load?${params}`)
  const payload = await res.json()
  if (!res.ok || payload.error) {
    throw new Error(typeof payload.error === "string" ? payload.error : "查詢失敗")
  }
  return payload.data ?? []
}

/** 客戶端圖示要經過後端帶認證代理，瀏覽器本身沒有 LCU 的憑證。 */
export function iconUrl(path: string | null | undefined): string | undefined {
  return path ? `/api/icon?path=${encodeURIComponent(path)}` : undefined
}

export const MAYHEM_QUEUE_ID = "2400"

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
