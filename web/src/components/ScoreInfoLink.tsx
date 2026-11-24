import { Info } from "lucide-react"
import { useNavigate } from "@/lib/nav"
import { cn } from "@/lib/utils"

/** 分數旁的小 ⓘ：點了換到「分數怎麼算」頁（/score）。放在本場貢獻的數字旁邊。
 *  觸控上放大到 32px（負邊距抵掉，不撐高所在的列），和 Hint 同一套尺寸。 */
export function ScoreInfoLink({ className, label = "分數怎麼算" }: { className?: string; label?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={(e) => {
        // 常放在可點的列或卡片裡，不要連帶觸發外層的展開／下鑽
        e.stopPropagation()
        navigate("score")
      }}
      aria-label={label}
      data-tip={`${label}：本場貢獻（0～100）的計分項目、加扣分與怎麼看差距`}
      className={cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full align-[-3px] text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none max-sm:-my-2 max-sm:size-8",
        className,
      )}
    >
      <Info className="size-3.5" />
    </button>
  )
}
