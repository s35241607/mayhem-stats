import { lazy, Suspense, useEffect, useState, type ComponentType } from "react"
import { motion } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell, type PageId } from "@/components/AppShell"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterProvider, useFilters } from "@/lib/filters"
import { Dashboard } from "@/pages/Dashboard"

// 每頁各自成為一個 chunk。表格頁才會載入 AG Grid、圖表頁才會載入 ECharts，
// 全部打包在一起的話首屏要先扛下兩套函式庫（壓縮後將近 900KB）。
const LOADERS = {
  // 儀表板是每次開啟的第一頁，直接打包進主程式，不走延遲載入。
  dashboard: () => Promise.resolve(Dashboard),
  matches: () => import("@/pages/Matches").then((m) => m.Matches),
  synergy: () => import("@/pages/Synergy").then((m) => m.Synergy),
  tilt: () => import("@/pages/Tilt").then((m) => m.Tilt),
  champions: () => import("@/pages/Champions").then((m) => m.Champions),
  augments: () => import("@/pages/Augments").then((m) => m.Augments),
  players: () => import("@/pages/Players").then((m) => m.Players),
  time: () => import("@/pages/TimeAnalysis").then((m) => m.TimeAnalysis),
  explore: () => import("@/pages/Explore").then((m) => m.Explore),
  tracked: () => import("@/pages/Tracked").then((m) => m.Tracked),
} satisfies Record<PageId, () => Promise<ComponentType>>

// 已經載入完成的頁面元件。有的話直接渲染，不經過 lazy()。
// React 19 的 Suspense 只要畫過一次 fallback，就會至少等 300ms 才換成內容（避免閃爍）；
// 就算 chunk 早就預載好了，經過 lazy() 的第一次渲染仍會暫停一下而吃到這 300ms。
const RESOLVED: Partial<Record<PageId, ComponentType>> = { dashboard: Dashboard }

const PAGES = {} as Record<PageId, ComponentType>
for (const [id, load] of Object.entries(LOADERS) as [PageId, () => Promise<ComponentType>][]) {
  PAGES[id] = lazy(() => load().then((c) => ({ default: (RESOLVED[id] = c) })))
}

/** 首頁顯示完、瀏覽器閒下來之後，把其他頁的 chunk 先抓好。
 *  否則第一次點進表格頁，要先等 1.1MB 的 AG Grid 下載並解析完才開始查詢。 */
function usePrefetchPages() {
  useEffect(() => {
    const run = () =>
      (Object.entries(LOADERS) as [PageId, () => Promise<ComponentType>][]).forEach(([id, load]) =>
        load().then((c) => (RESOLVED[id] = c), () => {}),
      )
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(run, 1500)
    return () => clearTimeout(id)
  }, [])
}

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard")
  const Page = RESOLVED[page] ?? PAGES[page]
  usePrefetchPages()

  // 側邊欄收合時的標籤靠 Tooltip 顯示，需要這層 Provider（這版 shadcn 不再內建）
  return (
    <TooltipProvider delayDuration={200}>
      <FilterProvider>
        <AppShell page={page} onNavigate={setPage}>
          {/* 換頁只做淡入，不做離場動畫。
              原本用 AnimatePresence mode="wait"：新頁要等舊頁的離場動畫跑完才會掛載，
              查詢也就晚了這麼久才送出。實測回訪一頁總共約 280ms，其中 214ms 是在等動畫。
              分頁在背景、動畫幀被瀏覽器節流時，這段等待還會拉長到好幾秒。 */}
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
              <AfterAccountReady>
                <Page />
              </AfterAccountReady>
            </Suspense>
          </motion.div>
        </AppShell>
      </FilterProvider>
    </TooltipProvider>
  )
}

/** 帳號確定之前不掛載頁面，理由見 FilterState.ready。 */
function AfterAccountReady({ children }: { children: React.ReactNode }) {
  const { ready } = useFilters()
  return ready ? children : <Skeleton className="h-[420px] w-full" />
}
