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
  { value: "all", label: "全部期間", days: 0 },
  { value: "last 7 days", label: "最近 7 天", days: 7 },
  { value: "last 14 days", label: "最近 14 天", days: 14 },
  { value: "last 30 days", label: "最近 30 天", days: 30 },
  { value: "last 90 days", label: "最近 90 天", days: 90 },
] as const

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** 期間換成「含今天」的本地日期區間 [起, 迄]。
 *
 *  不能直接把 "last 7 days" 丟給 Cube：它解析成「昨天往回 7 天」，不含今天
 *  （實測 9/13 查到的是 9/6～9/12）——今天剛打完的場次在任何期間篩選下都會消失。
 *  每次呼叫都重算，畫面開著跨過午夜也不會停在前一天。 */
export function dateBounds(range: string): [string, string] | null {
  const days = DATE_RANGES.find((r) => r.value === range)?.days ?? 0
  if (!days) return null
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))
  return [localDate(from), localDate(today)]
}

type FilterState = {
  /** 帳號清單載入完成（或確定載不到）之前是 false。
   *  這段期間 account 還是 null，apply() 組出來的查詢會少了帳號篩選，
   *  查到的是資料庫裡所有玩家的合計——頁面必須等它變 true 才能開始查。 */
  ready: boolean
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
  /** 不走 apply() 的查詢用這個套期間：回傳要展開進查詢的 timeDimensions。 */
  timeFilter: (dimension: string) => Pick<CubeQuery, "timeDimensions">
  /** 逐場列表（/api/matches）用的期間參數，和 Cube 那邊是同一個區間。 */
  matchParams: () => Record<string, string>
}

const FilterContext = createContext<FilterState | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [account, setAccount] = useState<Player | null>(null)
  const [queueId, setQueueId] = useState<string | null>(MAYHEM_QUEUE_ID)
  const [dateRange, setDateRange] = useState<string>("all")
  const [drills, setDrills] = useState<Drill[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((d: { players: Player[] }) => {
        setPlayers(d.players)
        // 預設看自己
        setAccount((current) => current ?? d.players.find((p) => p.is_me) ?? d.players[0] ?? null)
      })
      .catch(() => undefined)
      // 載不到也要放行，否則後端一掛整個畫面就永遠停在骨架
      .finally(() => setReady(true))
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
      ready,
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

      timeFilter: (dimension) => {
        const bounds = dateBounds(dateRange)
        return bounds ? { timeDimensions: [{ dimension, dateRange: bounds }] } : {}
      },

      matchParams: () => {
        const bounds = dateBounds(dateRange)
        const params: Record<string, string> = {}
        if (account) params.puuid = account.puuid
        if (queueId) params.queue = queueId
        if (bounds) {
          params.date_from = bounds[0]
          params.date_to = bounds[1]
        }
        return params
      },

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

        const bounds = dateBounds(dateRange)
        if (bounds) {
          const existing = query.timeDimensions ?? []
          // 已經有時間維度（例如趨勢圖要按天分組）就補上區間，否則另外加一個純篩選用的
          merged.timeDimensions = existing.length
            ? existing.map((td) => ({ ...td, dateRange: bounds }))
            : [{ dimension: "matches.played_at", dateRange: bounds }]
        }

        return merged
      },
    }
  }, [ready, account, players, queueId, dateRange, drills])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const context = useContext(FilterContext)
  if (!context) throw new Error("useFilters 必須在 FilterProvider 內使用")
  return context
}
