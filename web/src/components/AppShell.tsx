import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
import {
  Calculator,
  LayoutDashboard,
  Swords,
  Sparkles,
  Users,
  CalendarClock,
  Compass,
  Zap,
  RefreshCw,
  X,
  Circle,
  ScrollText,
  Activity,
  Radar,
  TrendingDown,
  ChevronRight,
  Filter,
  GitCompareArrows,
  Shield,
  Clapperboard,
  ChevronDown,
  Settings,
  Link2,
  LayoutGrid,
  SlidersHorizontal,
  Check,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollectorStatus } from "@/hooks/useCube"
import { useIsMobile } from "@/hooks/use-mobile"
import { DATE_RANGES, comparePatch, customRange, dateBounds, isCustomRange, localDate, useFilters } from "@/lib/filters"
import { MAYHEM_QUEUE_ID, inflightCount, subscribeInflight } from "@/lib/cube"
import { AccountSwitcher, ViewingOtherBanner } from "@/components/AccountSwitcher"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { Shortcuts } from "@/components/Shortcuts"
import { Toaster, toast } from "@/lib/toast"
import { EmptyState } from "@/components/primitives"
import { useCrumbs } from "@/lib/breadcrumb"
import { BottomSheet } from "@/components/BottomSheet"
import { cn } from "@/lib/utils"

export type PageId =
  | "dashboard"
  | "matches"
  | "champions"
  | "augments"
  | "lineups"
  | "players"
  | "crew"
  | "time"
  | "tilt"
  | "losses"
  | "explore"
  | "tracked"
  | "recap"
  | "calc"
  | "settings"
  | "logs"

/** ADMIN 分組的頁面：側欄只對管理員（filters 的 canEditDefaults）顯示，直接開網址也擋下。 */
const ADMIN_PAGES = new Set<PageId>(["tracked", "settings", "logs"])

const NAV: { group: string; admin?: boolean; items: { id: PageId; label: string; icon: typeof Zap }[] }[] = [
  {
    group: "總覽",
    items: [
      { id: "dashboard", label: "儀表板", icon: LayoutDashboard },
      { id: "matches", label: "對局紀錄", icon: ScrollText },
    ],
  },
  {
    group: "分析",
    items: [
      { id: "champions", label: "英雄", icon: Swords },
      { id: "augments", label: "增幅裝置", icon: Sparkles },
      { id: "lineups", label: "陣容", icon: Shield },
      { id: "players", label: "隊友 / 對手", icon: Users },
      { id: "crew", label: "好友比較", icon: GitCompareArrows },
      { id: "time", label: "時段", icon: CalendarClock },
      { id: "tilt", label: "節奏與連敗", icon: Activity },
      { id: "losses", label: "敗因分析", icon: TrendingDown },
    ],
  },
  {
    group: "工具",
    items: [
      { id: "calc", label: "出裝計算機", icon: Calculator },
      { id: "recap", label: "賽季回顧", icon: Clapperboard },
      { id: "explore", label: "自由探索", icon: Compass },
    ],
  },
  {
    group: "ADMIN",
    admin: true,
    items: [
      { id: "tracked", label: "追蹤對象", icon: Radar },
      { id: "settings", label: "設定", icon: Settings },
      { id: "logs", label: "系統記錄", icon: ScrollText },
    ],
  },
]

const PAGE_TITLES: Record<PageId, { title: string; caption: string }> = {
  dashboard: { title: "儀表板", caption: "整體表現與趨勢的一頁式總覽" },
  matches: { title: "對局紀錄", caption: "逐場瀏覽，點進去看完整戰報" },
  tilt: { title: "節奏與連敗", caption: "上一場的結果、同一輪連打到第幾場，和勝率的關係" },
  losses: { title: "敗因分析", caption: "輸的時候，哪些數字和贏的時候不一樣" },
  champions: { title: "英雄", caption: "每個英雄的場次、勝率與輸出表現" },
  augments: { title: "增幅裝置", caption: "各增幅的勝率，以及在特定英雄上的契合度" },
  lineups: { title: "陣容", caption: "什麼陣容比較會贏，以及在各種陣容下出什麼裝" },
  players: { title: "隊友 / 對手", caption: "和朋友一起打會不會贏、和誰同隊會贏、遇到誰會輸" },
  crew: { title: "好友比較", caption: "你和追蹤中的好友並排比較：整體戰績、各類型勝率與擅長的英雄" },
  time: { title: "時段", caption: "每天、星期與時段的表現分佈" },
  explore: { title: "自由探索", caption: "自選維度與指標，做任意組合的分析" },
  recap: { title: "賽季回顧", caption: "把這段時間的戰績做成一支可以直接播放的短片" },
  calc: { title: "出裝計算機", caption: "依你現在的面板和對手的雙防，算每件裝備的傷害與坦度效益" },
  tracked: { title: "追蹤對象", caption: "除了自己以外，還要一併採集誰的戰績" },
  settings: { title: "設定", caption: "全站設定，只有管理員看得到" },
  logs: { title: "系統記錄", caption: "請求與限流的 log，只有管理員看得到" },
}

function CollectorPill() {
  const status = useCollectorStatus()
  const [ingesting, setIngesting] = useState(false)

  if (!status) return null

  const ingestNow = async () => {
    setIngesting(true)
    try {
      // 以前不看結果：失敗了按鈕轉一下就停，看不出有沒有成功
      const res = await fetch("/api/ingest", { method: "POST" })
      if (res.ok) toast("已開始採集，有新對局會自動更新畫面")
      else toast(`採集沒有啟動（HTTP ${res.status}）`, "error")
    } catch {
      toast("連不上伺服器，採集沒有啟動", "error")
    } finally {
      setIngesting(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-sidebar-accent/60 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium">
        <Circle
          className={
            status.clientConnected
              ? "size-2 shrink-0 fill-win text-win"
              : "size-2 shrink-0 fill-muted-foreground text-muted-foreground"
          }
        />
        {status.clientConnected ? "客戶端已連線" : "客戶端未執行"}
      </div>
      <div className="text-muted-foreground">
        我的 Mayhem <b className="text-foreground">{status.myMayhemMatches ?? status.mayhemMatches}</b> 場
        <br />
        資料庫共 {status.totalMatches} 場
        {status.trackedCount ? `（追蹤 ${status.trackedCount} 人）` : ""}
      </div>
      {status.lastRun && (
        <div className="text-muted-foreground">
          上次採集{" "}
          {new Date(status.lastRun.at * 1000).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
      {status.public ? (
        <div className="text-[11px] text-muted-foreground">唯讀模式（對外開放中）</div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full text-xs"
          onClick={ingestNow}
          disabled={ingesting}
        >
          <RefreshCw className={ingesting ? "animate-spin" : ""} />
          {ingesting ? "採集中…" : "立即採集"}
        </Button>
      )}
    </div>
  )
}

function versionLabel(versions: string[], versionFrom: string | null) {
  return versionFrom
    ? `${versionFrom} 之後`
    : !versions.length ? "全部版本" : versions.length <= 2 ? versions.join("、") : `${versions[0]} 等 ${versions.length} 個`
}

/** 遊戲版本（主.次）：多選，或「某版本之後」。選項來自資料裡實際有的版本，不受期間篩選影響（選了 7 天也要看得到舊版本）。 */
function VersionFilter({ className }: { className?: string }) {
  const { versions, setVersions, versionFrom, setVersionFrom, versionOptions: options } = useFilters()
  const toggle = (patch: string, on: boolean) => {
    const next = on ? [...versions, patch] : versions.filter((v) => v !== patch)
    setVersions(options.map((o) => o.patch).filter((p) => next.includes(p)))
  }
  const label = versionLabel(versions, versionFrom)
  // 起點以後（含）的場次合計，給子選單每一列看「選這個會剩幾場」
  const gamesFrom = (patch: string) => options.filter((o) => comparePatch(o.patch, patch) >= 0).reduce((a, o) => a + o.games, 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-7 w-[150px] justify-between gap-2 rounded-[min(var(--radius-md),10px)] text-sm font-normal", className)} disabled={!options.length && !versionFrom}>
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>遊戲版本</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setVersions([])} disabled={!versions.length && !versionFrom}>
          全部版本
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={versionFrom ? "text-primary" : undefined}>
            {versionFrom ? `${versionFrom} 之後` : "某版本之後…"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">包含該版本，之後的新版本會自動算進去</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={versionFrom ?? ""} onValueChange={(v) => setVersionFrom(v || null)}>
              {[...options].reverse().map((o) => (
                <DropdownMenuRadioItem key={o.patch} value={o.patch}>
                  <span className="font-mono">{o.patch}</span> 之後
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">{gamesFrom(o.patch)} 場</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">指定版本（可多選）</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.patch}
            checked={versions.includes(o.patch)}
            // 多選時選單不要每點一下就關掉
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => toggle(o.patch, on)}
          >
            <span className="font-mono">{o.patch}</span>
            <span className="ml-auto pl-4 text-xs text-muted-foreground">{o.games} 場</span>
          </DropdownMenuCheckboxItem>
        ))}
        {!options.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">資料裡還沒有版本資訊</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 有 Cube 查詢在跑時，標題列底部滑過一道光。換篩選後內容是淡化等新資料、不再整塊換骨架，
 *  需要一個全站一致的地方說「還在查」。樣式與「延後 150ms 才出現」在 index.css 的 progress-bar。 */
function QueryProgress() {
  const active = useSyncExternalStore(subscribeInflight, () => inflightCount() > 0)
  return (
    <div className="progress-bar pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden" data-active={active} aria-hidden>
      <span />
    </div>
  )
}

/** 自訂區間的起迄日。用原生的日期輸入：鍵盤可以直接打、各平台都有自己的日曆，不必再帶一套日期元件。
 *  兩端都含；起迄填反了會自動對調（customRange）。 */
function CustomRange({ range, onChange }: { range: string; onChange: (range: string) => void }) {
  const [from, to] = dateBounds(range)!
  const today = localDate(new Date())
  const field = "h-8 rounded-md border bg-secondary/50 px-2 text-xs tabular-nums outline-none transition focus-visible:border-primary"
  return (
    <div className="reveal flex items-center gap-1 text-xs text-muted-foreground">
      <input type="date" aria-label="起始日" className={field} value={from} max={today} onChange={(e) => e.target.value && onChange(customRange(e.target.value, to))} />
      <span>–</span>
      <input type="date" aria-label="結束日" className={field} value={to} max={today} onChange={(e) => e.target.value && onChange(customRange(from, e.target.value))} />
    </div>
  )
}

function GlobalFilters() {
  const { queueId, setQueueId, dateRange, setDateRange, compare, canCompare, setCompare } = useFilters()
  const custom = isCustomRange(dateRange)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AccountSwitcher />
      <Select value={queueId ?? "all"} onValueChange={(v) => setQueueId(v === "all" ? null : v)}>
        <SelectTrigger size="sm" className="w-[136px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MAYHEM_QUEUE_ID}>只看 Mayhem</SelectItem>
          <SelectItem value="all">全部模式</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={custom ? "custom" : dateRange}
        onValueChange={(v) => {
          if (v !== "custom") return setDateRange(v)
          // 從目前看的那段開始改（全部期間沒有邊界，就先給最近 30 天）
          const [from, to] = dateBounds(dateRange) ?? dateBounds("last 30 days")!
          setDateRange(customRange(from, to))
        }}
      >
        <SelectTrigger size="sm" className="w-[128px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGES.map((range) => (
            <SelectItem key={range.value} value={range.value}>
              {range.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">自訂區間</SelectItem>
        </SelectContent>
      </Select>
      {custom && <CustomRange range={dateRange} onChange={setDateRange} />}
      {canCompare && (
        <Button
          size="sm"
          variant={compare ? "default" : "outline"}
          aria-pressed={!!compare}
          onClick={() => setCompare(!compare)}
          data-tip={
            compare
              ? `正在對照：${compare.label}（${compare.bounds[0]} ～ ${compare.bounds[1]}）\n接在儀表板、英雄表、增幅表；再按一次關掉`
              : "和緊接在前、一樣長的那一段比較\n（7 天對前 7 天）。接在儀表板、英雄表、增幅表"
          }
        >
          <GitCompareArrows className="size-3.5" />
          {compare ? compare.label : "對照前期"}
        </Button>
      )}

      <VersionFilter />

    </div>
  )
}

/** 麵包屑：頁名 › 全域下鑽（跨頁生效，可個別移除）› 頁面內各層聚焦（登記自 useCrumb）。
 *  點某一層清掉比它深的所有層；點頁名清掉這頁的所有聚焦。取代原本散在各處的篩選標籤。 */
function Breadcrumb({ title, caption }: { title: string; caption: string }) {
  const { drills, removeDrill, clearDrills } = useFilters()
  const crumbs = useCrumbs()
  // 由深到淺清，避免淺層的 clear 觸發重新渲染時深層還在
  const clearFrom = (index: number) => [...crumbs.slice(index)].reverse().forEach((c) => c.clear())
  const empty = !drills.length && !crumbs.length

  return (
    <div className="mr-auto min-w-0">
      <h1 className="truncate text-xl font-bold leading-tight md:text-base md:font-semibold">
        {crumbs.length ? (
          <button onClick={() => clearFrom(0)} className="transition hover:text-primary" title="回到這頁的最上層">
            {title}
          </button>
        ) : (
          title
        )}
      </h1>
      {empty ? (
        // 手機上省掉副標：一行說明換來的是少看一張卡片
        <p className="truncate text-xs text-muted-foreground max-md:hidden">{caption}</p>
      ) : (
        <nav aria-label="目前位置" className="mt-0.5">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
            {drills.map((drill, index) => (
              <li key={`d${index}`} className="slide-in flex items-center gap-1" style={{ "--stagger": `${index * 30}ms` } as CSSProperties}>
                <ChevronRight className="size-3 text-muted-foreground" />
                <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 text-primary">
                  <Filter className="size-3" />
                  <button onClick={() => clearFrom(0)} title="跨頁生效的篩選；點這裡清掉這頁更深的聚焦">
                    {drill.label}
                  </button>
                  <button onClick={() => removeDrill(index)} className="rounded-full p-0.5 opacity-70 transition hover:bg-primary/20 hover:opacity-100" aria-label={`移除篩選 ${drill.label}`}>
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <li key={crumb.id} className="slide-in flex items-center gap-1" style={{ "--stagger": `${(drills.length + index) * 30}ms` } as CSSProperties}>
                  <ChevronRight className="size-3 text-muted-foreground" />
                  {last ? (
                    <span className="font-medium text-foreground" aria-current="location">{crumb.label}</span>
                  ) : (
                    <button onClick={() => clearFrom(index + 1)} className="text-muted-foreground transition hover:text-primary">
                      {crumb.label}
                    </button>
                  )}
                </li>
              )
            })}
            {drills.length + crumbs.length > 1 && (
              <li>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-1 h-6 px-2 text-xs"
                  onClick={() => {
                    clearFrom(0)
                    clearDrills()
                  }}
                >
                  全部清除
                </Button>
              </li>
            )}
          </ol>
        </nav>
      )}
    </div>
  )
}

/** 期間的短標籤：預設期間用原本的名稱，自訂區間只寫月-日 */
function rangeLabel(range: string) {
  const preset = DATE_RANGES.find((r) => r.value === range)
  if (preset) return preset.label
  const bounds = dateBounds(range)
  return bounds ? `${bounds[0].slice(5)}～${bounds[1].slice(5)}` : range
}

/** 手機標題列的第二行：目前的全域條件收成一列標籤，點任何一個都打開篩選面板。
 *  電腦版把一排下拉選單攤在標題列；手機放不下（原本擠成三行、佔掉 23% 的螢幕）。 */
function FilterSummary({ onOpen }: { onOpen: () => void }) {
  const { queueId, dateRange, versions, versionFrom, compare } = useFilters()
  const chips = [
    queueId ? "只看 Mayhem" : "全部模式",
    rangeLabel(dateRange),
    versionLabel(versions, versionFrom),
    ...(compare ? [`對照 ${compare.label}`] : []),
  ]
  const chip = "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-3 text-[13px]"
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
      <button onClick={onOpen} className={cn(chip, "border-primary text-primary")}>
        <SlidersHorizontal className="size-4" />
        篩選
      </button>
      {chips.map((label) => (
        <button key={label} onClick={onOpen} className={chip}>
          {label}
        </button>
      ))}
    </div>
  )
}

function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}

/** 手機的篩選面板：和電腦版標題列是同一組全域條件（filters.tsx），改了立刻生效、寫進網址，
 *  所以沒有「套用」，只有「完成」。帳號在標題列右上角，主題也收在這裡。 */
function FilterSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { queueId, setQueueId, dateRange, setDateRange, compare, canCompare, setCompare } = useFilters()
  const custom = isCustomRange(dateRange)
  const option = (on: boolean) =>
    cn(
      "h-10 rounded-full border px-3.5 text-sm transition",
      on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card",
    )
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="篩選"
      footer={
        <Button className="h-12 w-full text-base" onClick={() => onOpenChange(false)}>
          完成
        </Button>
      }
    >
      <div className="space-y-6 pt-2">
        <SheetSection label="模式">
          <div className="grid grid-cols-2 gap-1 rounded-xl border bg-background p-1">
            {[
              { value: MAYHEM_QUEUE_ID, label: "只看 Mayhem" },
              { value: null, label: "全部模式" },
            ].map((o) => (
              <button
                key={o.label}
                aria-pressed={queueId === o.value}
                onClick={() => setQueueId(o.value)}
                className={cn(
                  "h-10 rounded-lg text-sm transition",
                  queueId === o.value ? "bg-primary font-bold text-primary-foreground" : "text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </SheetSection>

        <SheetSection label="期間">
          <div className="flex flex-wrap gap-2">
            {DATE_RANGES.map((range) => (
              <button key={range.value} aria-pressed={dateRange === range.value} onClick={() => setDateRange(range.value)} className={option(dateRange === range.value)}>
                {range.label}
              </button>
            ))}
            <button
              aria-pressed={custom}
              className={option(custom)}
              onClick={() => {
                if (custom) return
                const [from, to] = dateBounds(dateRange) ?? dateBounds("last 30 days")!
                setDateRange(customRange(from, to))
              }}
            >
              自訂區間
            </button>
          </div>
          {custom && <CustomRange range={dateRange} onChange={setDateRange} />}
          {canCompare && (
            <button
              role="switch"
              aria-checked={!!compare}
              onClick={() => setCompare(!compare)}
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[15px]"
            >
              <span>
                對照前一段同長的期間
                {compare && <span className="block text-xs text-muted-foreground">{compare.label}（{compare.bounds[0]} ～ {compare.bounds[1]}）</span>}
              </span>
              <span className={cn("relative h-7 w-12 shrink-0 rounded-full border transition", compare ? "border-primary bg-primary" : "bg-secondary")}>
                <span className={cn("absolute top-[3px] size-5 rounded-full transition-transform", compare ? "translate-x-[23px] bg-primary-foreground" : "translate-x-[3px] bg-muted-foreground")} />
              </span>
            </button>
          )}
        </SheetSection>

        <SheetSection label="版本">
          <VersionFilter className="h-12 w-full rounded-xl px-3.5 text-[15px]" />
        </SheetSection>

        <SheetSection label="主題">
          <ThemeSwitcher className="h-12 w-full justify-start rounded-xl px-3.5 text-[15px]" />
        </SheetSection>
      </div>
    </BottomSheet>
  )
}

/** 手機底部的分頁列：最常用的四頁＋「更多」。其餘頁面（和管理員頁）收在「更多」面板。 */
const TAB_PAGES: { id: PageId; label: string; icon: typeof Zap }[] = [
  { id: "dashboard", label: "儀表板", icon: LayoutDashboard },
  { id: "matches", label: "對局", icon: ScrollText },
  { id: "champions", label: "英雄", icon: Swords },
  { id: "crew", label: "好友", icon: GitCompareArrows },
]

function MobileTabBar({ page, onNavigate, onMore }: { page: PageId; onNavigate: (page: PageId) => void; onMore: () => void }) {
  const inTabs = TAB_PAGES.some((t) => t.id === page)
  const tab = (on: boolean) =>
    cn("flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] transition", on ? "text-primary" : "text-muted-foreground")
  return (
    <nav
      aria-label="主要頁面"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-sidebar/95 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
    >
      {TAB_PAGES.map((t) => (
        <button key={t.id} className={tab(page === t.id)} aria-current={page === t.id ? "page" : undefined} onClick={() => onNavigate(t.id)}>
          <t.icon className="size-[22px]" />
          {t.label}
        </button>
      ))}
      {/* 正在看收在「更多」裡的頁面時，這一格顯示那一頁的名字，才知道自己在哪 */}
      <button className={tab(!inTabs)} aria-current={!inTabs ? "page" : undefined} onClick={onMore}>
        <LayoutGrid className="size-[22px]" />
        <span className="max-w-full truncate px-0.5">{inTabs ? "更多" : PAGE_TITLES[page].title}</span>
      </button>
    </nav>
  )
}

function MoreSheet({ open, onOpenChange, page, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; page: PageId; onNavigate: (page: PageId) => void }) {
  const { canEditDefaults } = useFilters()
  const tabIds = new Set(TAB_PAGES.map((t) => t.id))
  const go = (id: PageId) => {
    onNavigate(id)
    onOpenChange(false)
  }
  const row = "flex min-h-[50px] w-full items-center gap-3 border-b px-3.5 text-left text-[15px] last:border-b-0"
  const tile = "flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="更多">
      <div className="space-y-5 pt-1">
        {NAV.filter((section) => !section.admin || canEditDefaults).map((section) => {
          const items = section.items.filter((item) => !tabIds.has(item.id))
          if (!items.length) return null
          return (
            <section key={section.group}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground">{section.group}</h3>
              <div className="overflow-hidden rounded-2xl border bg-card">
                {items.map((item) => (
                  <button key={item.id} onClick={() => go(item.id)} aria-current={page === item.id ? "page" : undefined} className={row}>
                    <span className={tile}>
                      <item.icon className="size-[18px]" />
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {item.id === "explore" && <span className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">建議用電腦</span>}
                    {page === item.id && <Check className="size-4 text-primary" />}
                  </button>
                ))}
              </div>
            </section>
          )
        })}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground">這個畫面</h3>
          <div className="overflow-hidden rounded-2xl border bg-card">
            <button
              className={row}
              onClick={() =>
                navigator.clipboard.writeText(window.location.href).then(
                  () => toast("已複製這個畫面的連結"),
                  () => toast("複製失敗，請直接複製網址列", "error"),
                )
              }
            >
              <span className={tile}>
                <Link2 className="size-[18px]" />
              </span>
              複製這個畫面的連結
            </button>
          </div>
        </section>
        <CollectorPill />
      </div>
    </BottomSheet>
  )
}

function NavSections({
  page,
  onNavigate,
}: {
  page: PageId
  onNavigate: (page: PageId) => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const { canEditDefaults } = useFilters()

  const go = (id: PageId) => {
    onNavigate(id)
    // 窄螢幕時側邊欄是覆蓋式抽屜，選完不關的話遮罩會擋住底下的操作
    if (isMobile) setOpenMobile(false)
  }

  return (
    <>
      {NAV.filter((section) => !section.admin || canEditDefaults).map((section) => (
        <SidebarGroup key={section.group}>
          <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={page === item.id}
                    tooltip={item.label}
                    onClick={() => go(item.id)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

export function AppShell({
  page,
  onNavigate,
  children,
}: {
  page: PageId
  onNavigate: (page: PageId) => void
  children: ReactNode
}) {
  const meta = PAGE_TITLES[page]
  const { ready, canEditDefaults } = useFilters()
  // 768px 以下：底部分頁列＋篩選面板取代側欄與標題列的下拉選單（與 shadcn 側欄同一個斷點）
  const isMobile = useIsMobile()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // 分頁標題跟著「現在在看什麼」：頁名加上最深的一層（某隻英雄、某一場），開好幾個分頁時分得出來
  const crumbs = useCrumbs()
  const deepest = crumbs[crumbs.length - 1]?.label
  useEffect(() => {
    document.title = [deepest, meta.title, "Mayhem 戰績"].filter(Boolean).join("｜")
  }, [deepest, meta.title])

  // 側欄目前頁的標記：量出選中那一項在側欄裡的位置，寫成 CSS 變數，標記用 transform 滑過去（index.css 的 nav-slider）。
  // 直接改 style、不走 state：只是把一個元素移到另一個位置，不必讓整個外殼重新渲染
  const navRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const slider = sliderRef.current
    if (!nav || !slider) return
    const place = () => {
      const active = nav.querySelector<HTMLElement>('[data-sidebar="menu-button"][data-active="true"]')
      if (!active) return void slider.style.setProperty("opacity", "0")
      const box = active.getBoundingClientRect()
      const host = nav.getBoundingClientRect()
      const inset = box.height * 0.22
      slider.style.setProperty("--nav-y", `${box.top - host.top + nav.scrollTop + inset}px`)
      slider.style.setProperty("--nav-h", `${box.height - inset * 2}px`)
      slider.style.setProperty("opacity", "1")
    }
    place()
    // 側欄收合／展開、管理員那組出現時位置會變，重新量
    const observer = new ResizeObserver(place)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [page, canEditDefaults, ready])
  // 權限要等 /api/config 回來才知道（ready 包含它）；在那之前不掛 ADMIN 頁，免得非管理員先看到一閃、頁面先打了 API
  const adminPage = ADMIN_PAGES.has(page)
  const content = !adminPage || canEditDefaults
    ? children
    : ready
      ? <EmptyState>這一頁只有管理員看得到。</EmptyState>
      : null

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15">
              <Zap className="size-4 text-primary" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold leading-tight">Mayhem 戰績</div>
              <div className="truncate text-[11px] text-muted-foreground">本機 BI</div>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent ref={navRef} className="relative">
          <span ref={sliderRef} className="nav-slider opacity-0" aria-hidden />
          <NavSections page={page} onNavigate={onNavigate} />
        </SidebarContent>

        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <CollectorPill />
        </SidebarFooter>
      </Sidebar>

      {/* 透明底：讓 body 的主題光暈與格線透出來 */}
      {/* min-w-0：flex 子元素預設 min-width: auto，內容一寬就把整塊推出視窗（768px 寬時對局紀錄、好友比較橫向溢出） */}
      <SidebarInset className="min-w-0 bg-transparent">
        {/* id 給好友比較的分頁列量高度：標題列會換行，分頁列要貼在它正下方 */}
        {/* 手機：標題＋帳號一行、條件摘要一行；頂端讓出瀏海（加到主畫面全螢幕時） */}
        <header id="app-header" className="sticky top-0 z-20 flex flex-col gap-2.5 border-b bg-background/85 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur md:gap-3 md:px-5 md:py-3">
          <div className="flex flex-wrap items-center gap-3">
            {!isMobile && (
              <>
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="!h-5" />
              </>
            )}
            <Breadcrumb title={meta.title} caption={meta.caption} />
            {isMobile ? (
              <AccountSwitcher />
            ) : (
              <>
                <GlobalFilters />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="複製這個畫面的連結"
                  data-tip={"複製這個畫面的連結\n篩選、分頁、點開的那一層都在網址裡，貼給別人或自己存書籤都是同一個畫面"}
                  onClick={() =>
                    navigator.clipboard.writeText(window.location.href).then(
                      () => toast("已複製這個畫面的連結"),
                      () => toast("複製失敗，請直接複製網址列", "error"),
                    )
                  }
                >
                  <Link2 className="size-4" />
                </Button>
                <ThemeSwitcher />
              </>
            )}
          </div>
          {isMobile && <FilterSummary onOpen={() => setFiltersOpen(true)} />}
          <QueryProgress />
        </header>

        {/* 手機底部有分頁列，內容底部讓出它的高度 */}
        <main className="min-w-0 flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-5">
          <Shortcuts onNavigate={onNavigate} />
          <Toaster />
          <ViewingOtherBanner />
          {content}
        </main>
        {isMobile && (
          <>
            <MobileTabBar page={page} onNavigate={onNavigate} onMore={() => setMoreOpen(true)} />
            <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} />
            <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} page={page} onNavigate={onNavigate} />
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
