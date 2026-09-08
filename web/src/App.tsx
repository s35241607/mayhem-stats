import { useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell, type PageId } from "@/components/AppShell"
import { FilterProvider } from "@/lib/filters"
import { Dashboard } from "@/pages/Dashboard"
import { Champions } from "@/pages/Champions"
import { Augments } from "@/pages/Augments"
import { Players } from "@/pages/Players"
import { TimeAnalysis } from "@/pages/TimeAnalysis"
import { Explore } from "@/pages/Explore"

const PAGES: Record<PageId, () => React.JSX.Element> = {
  dashboard: Dashboard,
  champions: Champions,
  augments: Augments,
  players: Players,
  time: TimeAnalysis,
  explore: Explore,
}

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard")
  const Page = PAGES[page]

  // 側邊欄收合時的標籤靠 Tooltip 顯示，需要這層 Provider（這版 shadcn 不再內建）
  return (
    <TooltipProvider delayDuration={200}>
      <FilterProvider>
        <AppShell page={page} onNavigate={setPage}>
          <Page />
        </AppShell>
      </FilterProvider>
    </TooltipProvider>
  )
}
