import { useEffect, useRef, useState } from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/** 全站共用的滑過提示：任何元素加上 data-tip="…"，滑過或用鍵盤聚焦就在它上方（放不下改下方）顯示主題配色的提示框，
 *  取代瀏覽器內建的 title（延遲久、樣式不能改、深色主題下是一塊白框）。
 *
 *  為什麼不是每個元素各包一個 Radix Tooltip：好友比較一頁就有兩三百個要提示的點（出裝條、英雄頭像、搭檔格子），
 *  各掛一個 Tooltip 根元件很重；這裡整頁只有一個監聽器和一個提示框，用事件委派找最近的 [data-tip]。
 *  內容是純文字，\n 會換行。 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const show = (el: Element) => {
      const text = el.getAttribute("data-tip")
      if (!text) return
      const r = el.getBoundingClientRect()
      // 上方留得下約 80px 就放上方，否則放下方
      const below = r.top < 90
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below })
    }
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null
      if (el === current.current) return
      current.current = el
      window.clearTimeout(timer.current)
      if (!el) {
        setTip(null)
        return
      }
      timer.current = window.setTimeout(() => show(el), e.type === "focusin" ? 0 : 120)
    }
    const hide = () => {
      window.clearTimeout(timer.current)
      current.current = null
      setTip(null)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && hide()
    document.addEventListener("pointerover", over)
    document.addEventListener("focusin", over)
    document.addEventListener("focusout", hide)
    document.addEventListener("pointerdown", hide)
    window.addEventListener("scroll", hide, true)
    window.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerover", over)
      document.removeEventListener("focusin", over)
      document.removeEventListener("focusout", hide)
      document.removeEventListener("pointerdown", hide)
      window.removeEventListener("scroll", hide, true)
      window.removeEventListener("keydown", esc)
    }
  }, [])

  // 量到提示框寬度之後再夾進視窗內（左右各留 8px）
  const [shift, setShift] = useState(0)
  useEffect(() => {
    if (!tip || !box.current) return
    const w = box.current.offsetWidth
    const left = tip.x - w / 2
    setShift(left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0)
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      role="tooltip"
      data-testid="tip-layer"
      className={cn(
        // 用彈出層的底色（深色主題是深底淺字），不用反白：大段說明在反白底上很刺眼、難讀
        "reveal pointer-events-none fixed z-[100] w-max max-w-[22rem] rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] leading-6 text-popover-foreground shadow-xl shadow-black/30",
      )}
      style={{
        left: tip.x + shift,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "8px" : "calc(-100% - 8px)"})`,
      }}
    >
      {/* 第一行當標題（粗體），之後每行一段，段落之間留一點距離；只有一行時就是一般字 */}
      {tip.text.split("\n").map((line, i, all) => (
        <p key={i} className={cn(all.length > 1 && i === 0 ? "mb-1 font-semibold" : "text-popover-foreground/85", i > 1 && "mt-1")}>
          {line}
        </p>
      ))}
      <span
        className={cn("absolute size-2.5 rotate-45 border-border bg-popover", tip.below ? "border-t border-l" : "border-r border-b")}
        style={{ left: `calc(50% - ${shift}px)`, [tip.below ? "top" : "bottom"]: -5.5, marginLeft: -5 }}
      />
    </div>
  )
}

/** 說明的小圖示：滑過或聚焦顯示 text。版面上只留一句話，細節收進這裡 */
export function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      data-tip={text}
      data-testid="hint"
      className={cn(
        "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full align-[-3px] text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none",
        className,
      )}
    >
      <Info className="size-3.5" />
    </span>
  )
}
