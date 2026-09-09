import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell, type PageId } from "@/components/AppShell"
import { FilterProvider } from "@/lib/filters"
import { Dashboard } from "@/pages/Dashboard"
import { Champions } from "@/pages/Champions"
import { Augments } from "@/pages/Augments"
import { Players } from "@/pages/Players"
import { TimeAnalysis } from "@/pages/TimeAnalysis"
import { Explore } from "@/pages/Explore"
import { Matches } from "@/pages/Matches"
import { Synergy } from "@/pages/Synergy"
import { Tilt } from "@/pages/Tilt"
import { Tracked } from "@/pages/Tracked"

const PAGES: Record<PageId, () => React.JSX.Element> = {
  dashboard: Dashboard,
  matches: Matches,
  synergy: Synergy,
  tilt: Tilt,
  champions: Champions,
  augments: Augments,
  players: Players,
  time: TimeAnalysis,
  explore: Explore,
  tracked: Tracked,
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
              <Page />
            </motion.div>
          </AnimatePresence>
        </AppShell>
      </FilterProvider>
    </TooltipProvider>
  )
}
