import { ChevronDown } from "lucide-react"
import { CONTRIB_GAP, CONTRIB_PARTS, type ContribTag } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { cn } from "@/lib/utils"

// 貢獻分數的呈現。分數的定義只有一份，在語意層（cube/model/cubes/contribution.yml）：
// 六項指標各自和「同出裝定位、同勝負」的人比成百分位，再依定位加權。50＝一般人。
// 這裡只負責畫（常數與查詢在 hooks/useContribution.ts）：好友比較頁、單場計分板、對局卡片共用同一套數字與橫條。

/** 綜合貢獻的數字：0～100，50＝同定位、同勝負的一般人；差距不到門檻的用淡色 */
export function ContribScore({ dev: d, className }: { dev: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        d === null || Math.abs(d) < CONTRIB_GAP ? "text-muted-foreground" : d > 0 ? "text-win" : "text-loss",
        className,
      )}
    >
      {d === null ? "—" : Math.round(50 + d)}
    </span>
  )
}

/** 以 50 為中線的橫條：往右是比一般人多，往左是比一般人少 */
function DivergingBar({ v, className }: { v: number | null; className?: string }) {
  const d = v === null ? null : v - 50
  return (
    <span className={cn("relative block rounded-full bg-muted/50", className)}>
      {v !== null && d !== null && (
        <span
          className={cn("absolute inset-y-0 rounded-full", d >= 0 ? "bg-win/70" : "bg-loss/70")}
          style={d >= 0 ? { left: "50%", width: `${d}%` } : { left: `${v}%`, width: `${50 - v}%` }}
        />
      )}
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-muted-foreground/60" />
    </span>
  )
}

/** 六項貢獻的橫條：每項是百分位，中間的刻度是 50（一般人），往右是做得比一般人多 */
export function ContribBars({ row, className }: { row: CubeRow | undefined; className?: string }) {
  return (
    <div className={className ?? "space-y-1.5"}>
      {CONTRIB_PARTS.map((c) => {
        const v = row ? num(row[c.key]) : null
        return (
          <div key={c.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] items-center gap-2" title={`${c.label}：${c.hint}\n在同出裝定位、同勝負的人裡的百分位，50＝一般人`}>
            <span className="text-[12px]">{c.label}</span>
            <DivergingBar v={v} className="h-2" />
            <ContribScore dev={v === null ? null : v - 50} className="text-right text-[12px]" />
          </div>
        )
      })}
    </div>
  )
}

/** 對局卡片裡的一個小數字：「貢獻 62」 */
export function ContribInline({ score }: { score: number | null }) {
  if (score === null) return null
  return (
    <span className="whitespace-nowrap" title="貢獻分數（0～100，50＝同出裝定位、同勝負的一般人）">
      貢獻 <ContribScore dev={score - 50} className="font-semibold" />
    </span>
  )
}

/** MVP／ACE 標籤：MVP＝贏的那隊貢獻最高、ACE＝輸的那隊貢獻最高（比較基準是「同勝負的人」，兩隊的最高分可以並列看） */
export function ContribTagBadge({ tag, className }: { tag: ContribTag; className?: string }) {
  return (
    <span
      title={tag === "MVP" ? "MVP：贏的一隊貢獻最高" : "ACE：輸的一隊貢獻最高"}
      className={cn(
        "rounded px-1 py-px text-[10px] font-bold leading-none",
        tag === "MVP" ? "bg-gold/20 text-gold" : "bg-primary/15 text-primary",
        className,
      )}
    >
      {tag}
    </span>
  )
}

/** 計分板每列的貢獻：大數字 ＋ 以 50 為中線的橫條；點了展開六項。
 */
export function ContribMeter({
  score,
  tag,
  expanded,
  onToggle,
}: {
  score: number | null
  tag?: ContribTag
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={`貢獻分數：和同出裝定位、同勝負的人比（50＝一般人）。點一下看六項明細${tag === "MVP" ? "\nMVP：贏的一隊貢獻最高" : tag === "ACE" ? "\nACE：輸的一隊貢獻最高" : ""}`}
      className="flex w-[124px] shrink-0 flex-col gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-secondary/60"
    >
      <span className="flex items-center gap-1.5">
        <ContribScore dev={score === null ? null : score - 50} className="text-base font-bold leading-none" />
        {tag && <ContribTagBadge tag={tag} />}
        <ChevronDown className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </span>
      <DivergingBar v={score} className="h-1.5" />
    </button>
  )
}
