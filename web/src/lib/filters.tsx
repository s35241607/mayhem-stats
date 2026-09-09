import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { MAYHEM_QUEUE_ID, type CubeFilter, type CubeQuery } from "@/lib/cube"

export type Drill = CubeFilter & { label: string }

export type Player = {
  puuid: string
  riot_id: string | null
  games: number
  is_me: number
  tracked: number
}

export const DATE_RANGES = [
  { value: "all", label: "全部期間" },
  { value: "last 7 days", label: "最近 7 天" },
  { value: "last 14 days", label: "最近 14 天" },
  { value: "last 30 days", label: "最近 30 天" },
  { value: "last 90 days", label: "最近 90 天" },
] as const

type FilterState = {
  /** 目前在看誰的數據。預設是本機帳號，可切換成任何出現過的玩家。 */
  account: Player | null
  setAccount: (player: Player) => void
  players: Player[]
  isMe: boolean
  queueId: string | null
  setQueueId: (id: string | null) => void
  dateRange: string
  setDateRange: (range: string) => void
  drills: Drill[]
  addDrill: (drill: Drill) => void
  removeDrill: (index: number) => void
  clearDrills: () => void
  /** 把全域條件套進 Cube 查詢：看誰、哪個模式、哪段期間、下鑽了什麼。
   *  scope 為 "all" 時不鎖定帳號——自由探索需要跨玩家聚合，
   *  否則「玩家」這個維度永遠只會回傳一列。 */
  apply: (query: CubeQuery, scope?: "account" | "all") => CubeQuery
  /** 以 participants 以外的 cube 查詢時，用這個取得「主角」的篩選條件。 */
  subjectFilter: (member: string) => CubeFilter[]
}

const FilterContext = createContext<FilterState | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [account, setAccount] = useState<Player | null>(null)
  const [queueId, setQueueId] = useState<string | null>(MAYHEM_QUEUE_ID)
  const [dateRange, setDateRange] = useState<string>("all")
  const [drills, setDrills] = useState<Drill[]>([])

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((d: { players: Player[] }) => {
        setPlayers(d.players)
        // 預設看自己
        setAccount((current) => current ?? d.players.find((p) => p.is_me) ?? d.players[0] ?? null)
      })
      .catch(() => undefined)
  }, [])

  const value = useMemo<FilterState>(() => {
    const baseline: CubeFilter[] = []
    if (account) {
      baseline.push({
        member: "participants.puuid",
        operator: "equals",
        values: [account.puuid],
      })
    }
    if (queueId) {
      baseline.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
    }

    return {
      account,
      setAccount: (player) => {
        setAccount(player)
        setDrills([]) // 換人看的時候，前一個人的下鑽條件留著只會造成誤解
      },
      players,
      isMe: !!account?.is_me,
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

      subjectFilter: (member) =>
        account ? [{ member, operator: "equals", values: [account.puuid] }] : [],

      apply: (query, scope = "account") => {
        const scoped = scope === "all" ? baseline.filter((f) => f.member !== "participants.puuid") : baseline
        const merged: CubeQuery = {
          ...query,
          filters: [
            ...scoped,
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
  }, [account, players, queueId, dateRange, drills])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const context = useContext(FilterContext)
  if (!context) throw new Error("useFilters 必須在 FilterProvider 內使用")
  return context
}
