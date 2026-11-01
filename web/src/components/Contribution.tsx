import { ChevronDown } from "lucide-react"
import { WORK_BASE, WORK_GAP, WORK_PARTS, type ContribTag } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { cn } from "@/lib/utils"

// 貢獻分數的呈現。分數只有一個（本場貢獻），定義在語意層（contribution.yml，規格見 docs/contribution-scoring.md）；
// 這裡只負責畫（常數與查詢在 hooks/useContribution.ts）：好友比較頁、單場計分板、對局卡片共用同一套數字與橫條。

/** 貢獻的數字：0～100，50＝同出裝定位的平均；差距不到門檻（WORK_GAP）的用淡色 */
export function ContribScore({ dev: d, className, gap = WORK_GAP }: { dev: number | null; className?: string; gap?: number }) {
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

/** 以 0 為中線的橫條：這一項讓總分加減幾分，往右加分、往左扣分。
 *  畫的是加減分而不是基因分數：只加不扣的項目（承傷、擊殺、控場……）低於平均時基因在 50 以下、加減分卻是 0，
 *  多場平均時甚至會「基因平均 43、加減分平均 +2」（有幾場加分、其他場是 0）。條和右邊的數字畫同一個東西才不會一紅一藍。
 *  full：半條代表幾分（單場 15 分、多場平均 6 分），超過的截在兩端 */
function DivergingBar({ pts, className, full = 15 }: { pts: number | null; className?: string; full?: number }) {
  const d = pts === null ? null : Math.max(-50, Math.min(50, (pts / full) * 50))
  return (
    <span className={cn("relative block rounded-full bg-muted/50", className)}>
      {d !== null && Math.abs(d) >= 0.5 && (
        <span
          className={cn("absolute inset-y-0 rounded-full", d >= 0 ? "bg-win/70" : "bg-loss/70")}
          style={d >= 0 ? { left: "50%", width: `${d}%` } : { left: `${50 + d}%`, width: `${-d}%` }}
        />
      )}
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-muted-foreground/60" />
    </span>
  )
}

const signed = (v: number) => (Math.abs(v) < 0.05 ? "0.0" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`)

/** 八個計分基因的橫條：條和右邊的數字都是這一項讓總分加減幾分（中線 0）；基因分數（50＝同出裝定位的平均）在滑過的提示裡。
 *  compact：好友比較全員一覽每人一欄用的小尺寸；放的是多場平均，半條代表 6 分 */
export function ContribBars({ row, className, compact }: { row: CubeRow | undefined; className?: string; compact?: boolean }) {
  return (
    <div className={className ?? (compact ? "space-y-[3px]" : "space-y-1.5")}>
      {WORK_PARTS.map((c) => {
        const v = row ? num(row[c.key]) : null
        const pts = row ? num(row[c.pts]) : null
        const tip =
          (pts === null ? "" : `{{lab|總分}}{{${pts >= 0 ? "win" : "loss"}|${signed(pts)}}} 分（這一項占 ${c.weight}%；橫條畫的就是它）\n`) +
          `{{lab|${c.label}}}{{big|${v === null ? "—" : Math.round(v)}}} 基因分數，50＝同出裝定位的平均\n> ${c.hint}` +
          (c.key === "contribution.gene_dmg" ? "" : "\n> 只加不扣：基因低於 50 的場次這一項是 0，所以多場平均時基因可能低於 50、加減分仍是正的")
        return (
          <div
            key={c.key}
            className={cn("grid items-center", compact ? "grid-cols-[3rem_minmax(0,1fr)_2.25rem] gap-1.5" : "grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] gap-2")}
            data-tip={tip}
          >
            <span className={compact ? "text-[10px] leading-[13px] text-muted-foreground" : "text-[12px]"}>{c.label}</span>
            <DivergingBar pts={pts} className={compact ? "h-1.5" : "h-2"} full={compact ? 6 : 15} />
            <span
              className={cn(
                "text-right font-mono tabular-nums",
                compact ? "text-[10px] leading-[13px]" : "text-[12px]",
                pts === null || Math.abs(pts) < 1 ? "text-muted-foreground" : pts > 0 ? "text-win" : "text-loss",
              )}
            >
              {pts === null ? "—" : signed(pts)}
            </span>
          </div>
        )
      })}
      {/* 整體校正：每個人一樣。多數項目只加不扣，不扣掉它平均會高於 50；列出來，上面的加減分才加得回總分 */}
      {row && num(row[WORK_BASE]) !== null && (
        <div
          className={cn("grid items-center border-t border-border/50", compact ? "grid-cols-[3rem_minmax(0,1fr)_2.25rem] gap-1.5 pt-[3px]" : "grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] gap-2 pt-1.5")}
          data-tip={"{{lab|整體校正}}每個人一樣\n> 八項裡除了輸出都只加不扣（承傷、擊殺、治療護盾、控場、推塔、清兵、功能裝），不扣掉這一點，全站平均會高於 50。上面的加減分加起來再加上它，就是總分 − 50"}
        >
          <span className={compact ? "text-[10px] leading-[13px] text-muted-foreground" : "text-[12px] text-muted-foreground"}>校正</span>
          <span className="text-[10px] text-muted-foreground">{compact ? "" : "每個人一樣"}</span>
          <span className={cn("text-right font-mono tabular-nums text-muted-foreground", compact ? "text-[10px] leading-[13px]" : "text-[12px]")}>
            {signed(num(row[WORK_BASE])!)}
          </span>
        </div>
      )}
    </div>
  )
}

const WORK_TITLE =
  "本場貢獻（0～100）：輸出、承傷、擊殺、治療護盾、控場、推塔、清兵、功能裝八項，先和同一場的人比、再和同出裝定位的平均比，加權成總分。50＝同出裝定位的平均"
const ESTIMATE_NOTE = "*暫估：這場沒有賽後統計，治療護盾隊友不計分（這一項視為平均）"

/** 對局卡片裡的一個小數字：「貢獻 62」；暫估的場次數字後面加「*」 */
export function ContribInline({ score, estimate }: { score: number | null; estimate?: boolean }) {
  if (score === null) return null
  return (
    <span
      className="whitespace-nowrap"
      data-tip={`${WORK_TITLE}${estimate ? `\n${ESTIMATE_NOTE}` : ""}`}
    >
      貢獻 <ContribScore dev={score - 50} gap={WORK_GAP} className="font-semibold" />
      {estimate && <span className="text-muted-foreground">*</span>}
    </span>
  )
}

/** MVP／ACE 標籤：MVP＝贏的那隊本場貢獻最高、ACE＝輸的那隊本場貢獻最高（兩隊各自取最高） */
export function ContribTagBadge({ tag, className }: { tag: ContribTag; className?: string }) {
  return (
    <span
      data-tip={tag === "MVP" ? "MVP：贏的一隊本場貢獻最高" : "ACE：輸的一隊本場貢獻最高"}
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

/** 計分板每列：大數字（本場貢獻，暫估加「*」）＋ 以 50 為中線的橫條；點了展開八個基因。 */
export function ContribMeter({
  score,
  tag,
  estimate,
  expanded,
  onToggle,
}: {
  score: number | null
  tag?: ContribTag
  estimate?: boolean
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-tip={`${WORK_TITLE}${estimate ? `\n${ESTIMATE_NOTE}` : ""}\n點一下看八個基因${tag === "MVP" ? "\nMVP：贏的一隊本場貢獻最高" : tag === "ACE" ? "\nACE：輸的一隊本場貢獻最高" : ""}`}
      className="flex w-[150px] shrink-0 flex-col gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-secondary/60"
    >
      <span className="flex items-center gap-1.5">
        <ContribScore dev={score === null ? null : score - 50} gap={WORK_GAP} className="text-base font-bold leading-none" />
        {estimate && score !== null && <span className="-ml-1 text-[11px] leading-none text-muted-foreground">*</span>}
        {tag && <ContribTagBadge tag={tag} />}
        <ChevronDown className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </span>
      {/* 總分以 50 為中線：差距 50 分是半條，等於把 score − 50 當加減分畫 */}
      <DivergingBar pts={score === null ? null : score - 50} full={50} className="h-1.5" />
    </button>
  )
}
