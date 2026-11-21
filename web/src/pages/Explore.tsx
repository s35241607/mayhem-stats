import { useState } from "react"
import { BookOpen, GitFork, LayoutDashboard, SlidersHorizontal } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { QueryError } from "@/components/primitives"
import { useCubeMeta } from "@/hooks/useCubeMeta"
import { oneOf, useUrlState, writeParams } from "@/lib/urlState"
import { Board } from "@/explore/Board"
import { Catalog } from "@/explore/Catalog"
import { Workbench } from "@/explore/Workbench"
import { specCodec } from "@/explore/spec"
import { ExploreClassic } from "./ExploreClassic"

const TABS = [
  { id: "bench", label: "工作台", icon: SlidersHorizontal, hint: "把欄位拖到列／欄／數值／顏色／篩選，即時出表或出圖" },
  { id: "board", label: "儀表板", icon: LayoutDashboard, hint: "把存好的卡片排成一頁" },
  { id: "catalog", label: "資料目錄", icon: BookOpen, hint: "有哪些資料集、每個欄位的定義與範例值" },
  { id: "classic", label: "下鑽路徑", icon: GitFork, hint: "原本的自由探索：預設路徑一層一層往下鑽、兩個維度的交叉矩陣" },
] as const
type Tab = (typeof TABS)[number]["id"]
const tabCodec = oneOf<Tab>("bench", "board", "catalog", "classic")

/** 自由探索：語意層上面的自助分析。
 *
 *  四個分頁共用同一份語意層的 meta（/api/cube/meta）：
 *  工作台組一個分析 → 存成卡片 → 儀表板把卡片排成一頁；資料目錄說明有什麼可以用。
 *  所有欄位、指標定義、資料集之間能不能一起查，都是語意層說了算，這裡沒有第二份定義。 */
export function Explore() {
  const { meta, loading, error } = useCubeMeta()
  const [tab, setTab] = useUrlState<Tab>("view", "bench", tabCodec)
  const [pending, setPending] = useState<{ name: string; kind: "dimension" | "measure" } | null>(null)

  if (error) return <QueryError error={`讀不到語意層模型：${error}`} />

  return (
    <div className="space-y-4">
      <ToggleGroup type="single" size="sm" variant="outline" value={tab} onValueChange={(v) => v && setTab(v as Tab)}>
        {TABS.map((t) => (
          <ToggleGroupItem key={t.id} value={t.id} className="px-3" data-tip={t.hint}>
            <t.icon className="size-3.5" />
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {tab === "classic" ? (
        <ExploreClassic />
      ) : loading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : tab === "bench" ? (
        <Workbench meta={meta} pending={pending} onPendingDone={() => setPending(null)} />
      ) : tab === "board" ? (
        <Board
          meta={meta}
          // 規格、卡片 id、分頁三個參數一次換，才不會先用舊規格畫一幀
          onOpenCard={(card) => writeParams({ a: specCodec.format(card.spec), card: card.id, view: null }, "push")}
        />
      ) : (
        <Catalog
          meta={meta}
          onUse={(name, kind) => {
            setPending({ name, kind })
            setTab("bench")
          }}
        />
      )}
    </div>
  )
}
