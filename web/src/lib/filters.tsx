import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { MAYHEM_QUEUE_ID, type CubeFilter, type CubeQuery } from "@/lib/cube"

export type Drill = CubeFilter & { label: string }

export const DATE_RANGES = [
  { value: "all", label: "全部期間" },
  { value: "last 7 days", label: "最近 7 天" },
  { value: "last 14 days", label: "最近 14 天" },
  { value: "last 30 days", label: "最近 30 天" },
  { value: "last 90 days", label: "最近 90 天" },
] as const

type FilterState = {
  queueId: string | null
  setQueueId: (id: string | null) => void
  dateRange: string
  setDateRange: (range: string) => void
  drills: Drill[]
  addDrill: (drill: Drill) => void
  removeDrill: (index: number) => void
  clearDrills: () => void
  /** 把全域條件套進一個 Cube 查詢。頁面只描述自己要什麼，不必重覆組篩選。 */
  apply: (query: CubeQuery) => CubeQuery
}

const FilterContext = createContext<FilterState | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [queueId, setQueueId] = useState<string | null>(MAYHEM_QUEUE_ID)
  const [dateRange, setDateRange] = useState<string>("all")
  const [drills, setDrills] = useState<Drill[]>([])

  const value = useMemo<FilterState>(() => {
    const baseline: CubeFilter[] = [
      { member: "participants.is_me", operator: "equals", values: ["true"] },
    ]
    if (queueId) {
      baseline.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
    }

    return {
      queueId,
      setQueueId,
      dateRange,
      setDateRange,
      drills,
      addDrill: (drill) =>
        setDrills((prev) =>
          prev.some((d) => d.member === drill.member && d.values[0] === drill.values[0])
            ? prev
            : [...prev, drill],
        ),
      removeDrill: (index) => setDrills((prev) => prev.filter((_, i) => i !== index)),
      clearDrills: () => setDrills([]),

      apply: (query) => {
        const merged: CubeQuery = {
          ...query,
          filters: [
            ...baseline,
            ...drills.map(({ member, operator, values }) => ({ member, operator, values })),
            ...(query.filters ?? []),
          ],
        }

        if (dateRange !== "all") {
          const existing = query.timeDimensions ?? []
          // 已經有時間維度（例如趨勢圖要按天分組）就補上區間，否則另外加一個純篩選用的
          merged.timeDimensions = existing.length
            ? existing.map((td) => ({ ...td, dateRange }))
            : [{ dimension: "matches.played_at", dateRange }]
        }

        return merged
      },
    }
  }, [queueId, dateRange, drills])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const context = useContext(FilterContext)
  if (!context) throw new Error("useFilters 必須在 FilterProvider 內使用")
  return context
}
