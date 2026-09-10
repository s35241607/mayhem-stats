import { lazy, Suspense, useState, type ComponentType } from "react"
import { AnimatePresence, motion } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell, type PageId } from "@/components/AppShell"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterProvider } from "@/lib/filters"

// 每頁各自成為一個 chunk。表格頁才會載入 AG Grid、圖表頁才會載入 ECharts，
// 全部打包在一起的話首屏要先扛下兩套函式庫（壓縮後將近 900KB）。
const named = <K extends string>(key: K, load: () => Promise<Record<K, ComponentType>>) =>
  lazy(() => load().then((m) => ({ default: m[key] })))

const PAGES: Record<PageId, ComponentType> = {
  dashboard: named("Dashboard", () => import("@/pages/Dashboard")),
  matches: named("Matches", () => import("@/pages/Matches")),
  synergy: named("Synergy", () => import("@/pages/Synergy")),
  tilt: named("Tilt", () => import("@/pages/Tilt")),
  champions: named("Champions", () => import("@/pages/Champions")),
  augments: named("Augments", () => import("@/pages/Augments")),
  players: named("Players", () => import("@/pages/Players")),
  time: named("TimeAnalysis", () => import("@/pages/TimeAnalysis")),
  explore: named("Explore", () => import("@/pages/Explore")),
  tracked: named("Tracked", () => import("@/pages/Tracked")),
}

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard")
  const Page = PAGES[page]

  // 側邊欄收合時的標籤靠 Tooltip 顯示，需要這層 Provider（這版 shadcn 不再內建）
  return (
    <TooltipProvider delayDuration={200}>
      <FilterProvider>
        <AppShell page={page} onNavigate={setPage}>
          {/* 換頁時淡入，避免內容瞬間替換造成的跳動感 */}
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
                <Page />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </AppShell>
      </FilterProvider>
    </TooltipProvider>
  )
}
