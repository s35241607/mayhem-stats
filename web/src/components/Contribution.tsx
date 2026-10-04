import { ChevronDown } from "lucide-react"
import { CONTRIB_GAP, CONTRIB_PARTS, PERF_GAP, PERF_PARTS, type ContribTag } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { cn } from "@/lib/utils"

// 貢獻分數的呈現。分數的定義只有一份，在語意層（cube/model/cubes/contribution.yml，規格見 docs/contribution-scoring.md），有兩個：
//   表現（perf，計分板、對局卡片）：這場打得有多好——每分鐘的輸出、承傷、存活、參團、控場（有治療或護盾隊友時再加治療護盾）
//     和「同類型 × 同時長帶」的所有人比百分位，依出裝定位加權平均、不再排名；全隊都打得好可以全隊都高於 50。
//   隊內（rank，好友比較頁、計分板上的小字）：在隊裡扛的份量，占全隊的比例再在同類型內排名；各隊平均都在 50 附近。
// 這裡只負責畫（常數與查詢在 hooks/useContribution.ts）：好友比較頁、單場計分板、對局卡片共用同一套數字與橫條。

/** 貢獻的數字：0～100，50＝中位數；差距不到門檻的用淡色。gap 預設是隊內排名的門檻，表現分傳 PERF_GAP */
export function ContribScore({ dev: d, className, gap = CONTRIB_GAP }: { dev: number | null; className?: string; gap?: number }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        d === null || Math.abs(d) < gap ? "text-muted-foreground" : d > 0 ? "text-win" : "text-loss",
        className,
      )}
    >
      {d === null ? "—" : Math.round(50 + d)}
    </span>
  )
}

/** 以 50 為中線的橫條：往右是比中位數高，往左是比中位數低 */
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

/** 六項的橫條：每項是百分位，中間的刻度是 50（中位數），往右是比較多；沒有值的項目（例如沒有治療或護盾隊友的場次）顯示「—」。
 *  kind＝perf：每分鐘的實際數值，和同類型、同時長帶的人比；rank（預設）：占全隊的比例，和同類型的人比 */
export function ContribBars({ row, className, kind = "rank" }: { row: CubeRow | undefined; className?: string; kind?: "perf" | "rank" }) {
  const parts = kind === "perf" ? PERF_PARTS : CONTRIB_PARTS
  const gap = kind === "perf" ? PERF_GAP : CONTRIB_GAP
  const basis = kind === "perf" ? "在同類型、同時長帶的人裡的百分位" : "在同類型的人裡的百分位"
  return (
    <div className={className ?? "space-y-1.5"}>
      {parts.map((c) => {
        const v = row ? num(row[c.key]) : null
        return (
          <div key={c.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-2" title={`${c.label}：${c.hint}\n${basis}，50＝中位數`}>
            <span className="text-[12px]">{c.label}</span>
            <DivergingBar v={v} className="h-2" />
            <ContribScore dev={v === null ? null : v - 50} gap={gap} className="text-right text-[12px]" />
          </div>
        )
      })}
    </div>
  )
}

/** 對局卡片裡的一個小數字：「表現 62」 */
export function ContribInline({ score, rank }: { score: number | null; rank?: number | null }) {
  if (score === null) return null
  return (
    <span
      className="whitespace-nowrap"
      title={`當局表現分（0～100，50＝同類型、同時長帶的中位數）${rank != null ? `\n隊內排名 ${Math.round(rank)}（在隊裡扛的份量，50＝同類型的中位數）` : ""}`}
    >
      表現 <ContribScore dev={score - 50} gap={PERF_GAP} className="font-semibold" />
    </span>
  )
}

/** MVP／ACE 標籤：MVP＝贏的那隊表現最高、ACE＝輸的那隊表現最高（表現分和勝負相關，所以兩隊各自取最高） */
export function ContribTagBadge({ tag, className }: { tag: ContribTag; className?: string }) {
  return (
    <span
      title={tag === "MVP" ? "MVP：贏的一隊表現最高" : "ACE：輸的一隊表現最高"}
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

/** 計分板每列的表現：大數字（當局表現分）＋ 小字「隊內 78」＋ 以 50 為中線的橫條；點了展開六項。
 */
export function ContribMeter({
  score,
  rank,
  tag,
  expanded,
  onToggle,
}: {
  score: number | null
  rank: number | null
  tag?: ContribTag
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={`當局表現分：這場每分鐘的實際表現，和同類型、同時長帶的人比（50＝中位數）。${rank === null ? "" : `\n隊內 ${Math.round(rank)}：在隊裡扛的份量（占全隊的比例，和同類型的人排名）。`}\n點一下看六項明細${tag === "MVP" ? "\nMVP：贏的一隊表現最高" : tag === "ACE" ? "\nACE：輸的一隊表現最高" : ""}`}
      className="flex w-[150px] shrink-0 flex-col gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-secondary/60"
    >
      <span className="flex items-center gap-1.5">
        <ContribScore dev={score === null ? null : score - 50} gap={PERF_GAP} className="text-base font-bold leading-none" />
        {tag && <ContribTagBadge tag={tag} />}
        {rank !== null && <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">隊內 {Math.round(rank)}</span>}
        <ChevronDown className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </span>
      <DivergingBar v={score} className="h-1.5" />
    </button>
  )
}
