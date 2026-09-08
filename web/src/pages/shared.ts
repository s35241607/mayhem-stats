import type { Filters } from "@/App"
import { baseFilters, type CubeFilter } from "@/lib/cube"

export type PageProps = { filters: Filters }

/** 全域條件（只看自己 + 模式）加上使用者點出來的下鑽條件。 */
export function allFilters(filters: Filters): CubeFilter[] {
  return [
    ...baseFilters(filters.queueId),
    ...filters.drills.map(({ member, operator, values }) => ({ member, operator, values })),
  ]
}

export const round1 = (value: number) => value.toFixed(1)
export const round0 = (value: number) => Math.round(value).toLocaleString()
export const round2 = (value: number) => value.toFixed(2)
