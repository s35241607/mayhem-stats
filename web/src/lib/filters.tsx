import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { MAYHEM_QUEUE_ID, cubeQuery, type CubeFilter, type CubeQuery } from "@/lib/cube"

export type Drill = CubeFilter & { label: string }

export type Player = {
  puuid: string
  riot_id: string | null
  games: number
  is_me: number
  tracked: number
  /** 好友比較頁要並排的人：站長自己、追蹤中的好友、登入者自己綁定的帳號（見 /api/players） */
  crew: number
}

/** 誰在看。公開鏡像用 Discord 登入時，「我」是他自己綁定的帳號。 */
export type Viewer = {
  public: boolean
  name: string | null
  /** 只有公開模式的 Discord 登入可以綁定「這是我」 */
  canLink: boolean
  linked: string[]
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

/** 版號照數字比（16.9 在 16.10 前面），字串比會錯 */
export function comparePatch(a: string, b: string) {
  const [am, an] = a.split(".").map(Number)
  const [bm, bn] = b.split(".").map(Number)
  return am - bm || an - bn
}

export type VersionOption = { patch: string; games: number }

/** 全站的預設查詢區間（/api/config）。只有管理員能改；打開頁面時套用，之後每個人可以自己換，換了不存回去。 */
export type SiteDefaults = { queue: string | null; dateRange: string; versionFrom: string | null }

const BUILTIN_DEFAULTS: SiteDefaults = { queue: MAYHEM_QUEUE_ID, dateRange: "all", versionFrom: null }

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
  viewer: Viewer | null
  /** 把帳號標成（或取消標成）「我」。成功回 null，失敗回錯誤訊息。 */
  setLinked: (puuid: string, linked: boolean) => Promise<string | null>
  queueId: string | null
  setQueueId: (id: string | null) => void
  dateRange: string
  setDateRange: (range: string) => void
  /** 手動勾選的遊戲版本（主.次，例如 16.17）。多選；空陣列且沒有 versionFrom = 全部版本。 */
  versions: string[]
  setVersions: (versions: string[]) => void
  /** 「這個版本（含）之後」。設了就以它為準、忽略 versions；之後出的新版本會自動包含進來。 */
  versionFrom: string | null
  setVersionFrom: (patch: string | null) => void
  /** 資料裡實際有的版本（只看 Mayhem、不受期間影響），由舊到新 */
  versionOptions: VersionOption[]
  /** 實際送出的版本條件：versionFrom 展開成具體版本，或手動勾選的那幾個；空陣列 = 不限 */
  activeVersions: string[]
  siteDefaults: SiteDefaults
  /** 這個人能不能改全站預設（本機，或鏡像上 admins 名單裡的 Discord 帳號） */
  canEditDefaults: boolean
  /** 存成全站預設。成功回 null，失敗回錯誤訊息。 */
  saveSiteDefaults: (next: SiteDefaults) => Promise<string | null>
  drills: Drill[]
  addDrill: (drill: Drill) => void
  removeDrill: (index: number) => void
  clearDrills: () => void
  /** 把全域條件套進 Cube 查詢：看誰、哪個模式、哪段期間、下鑽了什麼。
   *  scope 為 "all" 時不鎖定帳號——自由探索需要跨玩家聚合，
   *  否則「玩家」這個維度永遠只會回傳一列。 */
  apply: (query: CubeQuery, scope?: "account" | "all", cube?: string) => CubeQuery
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
  const [versions, setVersions] = useState<string[]>([])
  const [versionFrom, setVersionFrom] = useState<string | null>(null)
  const [versionOptions, setVersionOptions] = useState<VersionOption[]>([])
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [siteDefaults, setSiteDefaults] = useState<SiteDefaults>(BUILTIN_DEFAULTS)
  const [canEditDefaults, setCanEditDefaults] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [drills, setDrills] = useState<Drill[]>([])
  const [playersLoaded, setPlayersLoaded] = useState(false)
  const [viewer, setViewer] = useState<Viewer | null>(null)

  // 預設條件要在第一個查詢送出之前就定好，否則頁面會先用內建預設查一輪、再換條件重查
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d: { defaults: SiteDefaults; canEdit: boolean }) => {
        setSiteDefaults(d.defaults)
        setCanEditDefaults(d.canEdit)
        setQueueId(d.defaults.queue)
        setDateRange(d.defaults.dateRange)
        setVersionFrom(d.defaults.versionFrom)
      })
      .catch(() => undefined)
      .finally(() => setConfigLoaded(true))
  }, [])

  // 版本選項放在這裡而不是選單元件裡：「某版本之後」要先知道有哪些版本才能展開成查詢條件
  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      cubeQuery(
        {
          measures: ["matches.count"],
          dimensions: ["matches.patch"],
          filters: [{ member: "matches.queue_id", operator: "equals", values: [MAYHEM_QUEUE_ID] }],
          limit: 100,
        },
        controller.signal,
      )
        .then((rows) =>
          setVersionOptions(
            rows
              .map((r) => ({ patch: String(r["matches.patch"]), games: Number(r["matches.count"] ?? 0) }))
              .filter((o) => /^\d+\.\d+$/.test(o.patch))
              .sort((a, b) => comparePatch(a.patch, b.patch)),
          ),
        )
        .catch(() => undefined)
        .finally(() => setVersionsLoaded(true))
    void load()
    // 新版本的第一場進來時，「某版本之後」要自動把它算進去
    window.addEventListener("mayhem:data-changed", load)
    return () => {
      controller.abort()
      window.removeEventListener("mayhem:data-changed", load)
    }
  }, [])

  // 「某版本之後」還沒拿到版本清單時展開不出條件，先等，不要用「全部版本」查一輪
  const ready = playersLoaded && configLoaded && (!versionFrom || versionsLoaded)
  const activeVersions = useMemo(() => {
    if (!versionFrom) return versions
    const later = versionOptions.map((o) => o.patch).filter((p) => comparePatch(p, versionFrom) >= 0)
    // 起點比資料裡所有版本都新：照字面送出，查到 0 場才是對的（空陣列會變成「不限版本」）
    return later.length ? later : [versionFrom]
  }, [versionFrom, versions, versionOptions])

  const saveSiteDefaults = async (next: SiteDefaults) => {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return (body.error as string) ?? "儲存失敗"
    setSiteDefaults(body.defaults)
    return null
  }

  useEffect(() => {
    const loadPlayers = () => fetch("/api/players")
      .then((r) => r.json())
      .then((d: { players: Player[] }) => {
        setPlayers(d.players)
        // 資料更新後保留正在看的帳號，並取回最新場次與追蹤標記。
        setAccount((current) => d.players.find((p) => p.puuid === current?.puuid)
          ?? d.players.find((p) => p.is_me) ?? d.players[0] ?? null)
      })
      .catch(() => undefined)
      // 載不到也要放行，否則後端一掛整個畫面就永遠停在骨架
      .finally(() => setPlayersLoaded(true))
    void loadPlayers()
    window.addEventListener("mayhem:data-changed", loadPlayers)
    fetch("/api/me")
      .then((r) => r.json())
      .then(setViewer)
      .catch(() => undefined)
    return () => window.removeEventListener("mayhem:data-changed", loadPlayers)
  }, [])

  const setLinked = async (puuid: string, linked: boolean) => {
    const res = await fetch("/api/me/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puuid, linked }),
    })
    const body = await res.json()
    if (!res.ok) return (body.error as string) ?? "綁定失敗"
    setViewer(body)
    // is_me 只影響標示與排序，查詢條件是 puuid，所以就地改、不必重新載入整份清單
    const mine = new Set<string>(body.linked)
    const next = players
      .map((p) => ({ ...p, is_me: mine.has(p.puuid) ? 1 : 0 }))
      .sort((a, b) => b.is_me - a.is_me)
    setPlayers(next)
    setAccount((current) => (current ? (next.find((p) => p.puuid === current.puuid) ?? current) : current))
    return null
  }

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
    if (activeVersions.length) {
      baseline.push({ member: "matches.patch", operator: "equals", values: activeVersions })
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
      viewer,
      setLinked,
      queueId,
      setQueueId,
      dateRange,
      setDateRange,
      versions,
      // 手動勾選和「某版本之後」互斥：勾了就是在指定版本，起點清掉
      setVersions: (next) => {
        setVersions(next)
        setVersionFrom(null)
      },
      versionFrom,
      setVersionFrom: (patch) => {
        setVersionFrom(patch)
        setVersions([])
      },
      versionOptions,
      activeVersions,
      siteDefaults,
      canEditDefaults,
      saveSiteDefaults,
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
        if (activeVersions.length) params.patch = activeVersions.join(",")
        if (bounds) {
          params.date_from = bounds[0]
          params.date_to = bounds[1]
        }
        return params
      },

      apply: (query, scope = "account", cube = "participants") => {
        const remap = (member: string) => {
          if (cube === "augment_pairs" && member === "participants.puuid") return "augment_pairs.puuid"
          if (cube === "augment_pairs" && member === "matches.queue_id") return "augment_pairs.queue_id"
          if (cube === "augment_pairs" && member === "matches.patch") return "augment_pairs.patch"
          return member
        }
        const scoped = (scope === "all" ? baseline.filter((f) => f.member !== "participants.puuid") : baseline)
          .map((filter) => ({ ...filter, member: remap(filter.member) }))
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
          const timeDimension = cube === "augment_pairs" ? "augment_pairs.local_date" : "matches.played_at"
          merged.timeDimensions = existing.length
            ? existing.map((td) => ({
                ...td,
                dimension: cube === "augment_pairs" && td.dimension === "matches.played_at" ? timeDimension : td.dimension,
                dateRange: bounds,
              }))
            : [{ dimension: timeDimension, dateRange: bounds }]
        }

        return merged
      },
    }
    // setLinked 每次渲染都是新函式，但它讀的 players 已經在依賴裡
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, account, players, viewer, queueId, dateRange, versions, versionFrom, versionOptions, activeVersions, siteDefaults, canEditDefaults, drills])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const context = useContext(FilterContext)
  if (!context) throw new Error("useFilters 必須在 FilterProvider 內使用")
  return context
}
