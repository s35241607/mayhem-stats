import { ChevronDown } from "lucide-react"
import { WORK_BASE, WORK_GAP, WORK_MODS, WORK_PARTS, type ContribTag } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { cn } from "@/lib/utils"

// 貢獻分數的呈現。分數只有一個（本場貢獻），定義在語意層（contribution.yml，規格見 docs/contribution-scoring.md）；
// 這裡只負責畫（常數與查詢在 hooks/useContribution.ts）：好友比較頁、單場計分板、對局卡片共用同一套數字與橫條。

/** 貢獻的數字：0～100，50＝校準時的整體基準；差距不到門檻（WORK_GAP）的用淡色 */
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

/** 九個計分基因與高光／失誤加減分的橫條：條和右邊的數字都是這一項讓總分加減幾分（中線 0）；基因分數（50＝同出裝定位基準）在滑過的提示裡。
 *  compact：好友比較全員一覽每人一欄用的小尺寸；放的是多場平均，半條代表 6 分 */
export function ContribBars({ row, className, compact }: { row: CubeRow | undefined; className?: string; compact?: boolean }) {
  return (
    <div className={className ?? (compact ? "space-y-[3px]" : "space-y-1.5")}>
      {WORK_PARTS.map((c) => {
        const v = row ? num(row[c.key]) : null
        const pts = row ? num(row[c.pts]) : null
        const tip =
          (pts === null ? "" : `{{lab|總分}}{{${pts >= 0 ? "win" : "loss"}|${signed(pts)}}} 分（${c.weight}；橫條畫的就是它）\n`) +
          `{{lab|${c.label}}}{{big|${v === null ? "—" : Math.round(v)}}} 基因分數，50＝同出裝定位的平均\n> ${c.hint}`
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
      {WORK_MODS.map((m) => {
        const pts = row ? num(row[m.pts]) : null
        if (row && pts === null) return null
        const tip =
          (pts === null ? "" : `{{lab|總分}}{{${pts >= 0 ? "win" : "loss"}|${signed(pts)}}} 分\n`) +
          `{{lab|${m.label}}}\n> ${m.hint}`
        return (
          <div
            key={m.pts}
            className={cn("grid items-center", compact ? "grid-cols-[3rem_minmax(0,1fr)_2.25rem] gap-1.5" : "grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] gap-2")}
            data-tip={tip}
          >
            <span className={compact ? "text-[10px] leading-[13px] text-muted-foreground" : "text-[12px]"}>{m.label}</span>
            <DivergingBar pts={pts} className={compact ? "h-1.5" : "h-2"} full={compact ? 6 : 15} />
            <span
              className={cn(
                "text-right font-mono tabular-nums",
                compact ? "text-[10px] leading-[13px]" : "text-[12px]",
                pts === null || Math.abs(pts) < 0.05 ? "text-muted-foreground" : pts > 0 ? "text-win" : "text-loss",
              )}
            >
              {pts === null ? "—" : signed(pts)}
            </span>
          </div>
        )
      })}
      {/* 全局基準補償：依該場是否有賽後統計決定（EOG −11.3／暫估 −9.6），不對定位強制歸 50；列出來，上面的加減分才加得回總分 */}
      {row && num(row[WORK_BASE]) !== null && (
        <div
          className={cn("grid items-center border-t border-border/50", compact ? "grid-cols-[3rem_minmax(0,1fr)_2.25rem] gap-1.5 pt-[3px]" : "grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] gap-2 pt-1.5")}
          data-tip={"{{lab|整體校正}}依賽後統計是否齊全固定的全局基準補償（不強制各定位歸 50）\n> 上面九個維度＋高光加分＋失誤扣分，再加上這一行，即等於總分 − 50（夾 0～100 之前）"}
        >
          <span className={compact ? "text-[10px] leading-[13px] text-muted-foreground" : "text-[12px] text-muted-foreground"}>校正</span>
          <span className="text-[10px] text-muted-foreground">{compact ? "" : "全局 EOG 補償"}</span>
          <span className={cn("text-right font-mono tabular-nums text-muted-foreground", compact ? "text-[10px] leading-[13px]" : "text-[12px]")}>
            {signed(num(row[WORK_BASE])!)}
          </span>
        </div>
      )}
    </div>
  )
}

const WORK_TITLE =
  "本場貢獻（0～100，v5.4）：跨場絕對尺度（依時長、敵方前排數與血腥度校正，非主 C 高傷享動態轉型加成），含九大維度、高光加分（+15）與失誤扣分（−18），不強制各定位歸 50。"
const ESTIMATE_NOTE = "*暫估：這場缺少賽後統計的護盾量，治療乘 h_scale 估算、輔助護盾依英雄未捕獲先驗＋輔助裝估算並微調參團／控場權重；破盾裝不含敵方護盾"

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

/** 計分板每列：大數字（本場貢獻，暫估加「*」）＋ 以 50 為中線的橫條；點了展開各基因與加減分。 */
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
      data-tip={`${WORK_TITLE}${estimate ? `\n${ESTIMATE_NOTE}` : ""}\n點一下看各基因與加減分${tag === "MVP" ? "\nMVP：贏的一隊本場貢獻最高" : tag === "ACE" ? "\nACE：輸的一隊本場貢獻最高" : ""}`}
      className="flex w-[126px] shrink-0 flex-col gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-secondary/60"
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
