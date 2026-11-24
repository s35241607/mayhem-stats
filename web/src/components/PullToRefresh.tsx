import { useEffect, useRef } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "@/lib/toast"

/** 加到主畫面後沒有瀏覽器的重新整理鈕：在頁面最上方往下拉、放開就重查。
 *
 *  只在「從主畫面開啟」（display-mode: standalone）時啟用——一般瀏覽器自己有下拉重新整理，兩個疊在一起會打架。
 *  重查走全站同一個事件（mayhem:data-changed）：快取（lib/cube）和各個直接抓資料的地方都聽它，畫面不重掛、捲動位置不丟。
 *  拉的過程直接改 style（transform／opacity），不逐幀 setState。 */
const TRIGGER = 72
const MAX = 110

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function PullToRefresh() {
  const pill = useRef<HTMLDivElement>(null)
  const icon = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!standalone()) return
    let startY: number | null = null
    let dist = 0
    const paint = (d: number, settling = false) => {
      const el = pill.current
      if (!el) return
      el.style.transition = settling ? "transform 220ms ease-out, opacity 220ms ease-out" : "none"
      el.style.transform = `translate(-50%, ${Math.min(d, MAX) - 48}px)`
      el.style.opacity = String(Math.min(1, d / TRIGGER))
      if (icon.current) icon.current.style.transform = `rotate(${d * 3}deg)`
      el.dataset.ready = d >= TRIGGER ? "1" : "0"
    }
    const start = (e: TouchEvent) => {
      // 只有在最上方、而且不是在抽屜或面板裡才算
      if (window.scrollY > 0 || (e.target as Element).closest?.('[role="dialog"]')) return
      startY = e.touches[0].clientY
      dist = 0
    }
    const move = (e: TouchEvent) => {
      if (startY === null) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0 || window.scrollY > 0) {
        dist = 0
        paint(0)
        return
      }
      // 越拉越緊
      dist = dy * 0.55
      paint(dist)
    }
    const end = () => {
      if (startY === null) return
      startY = null
      if (dist >= TRIGGER) {
        window.dispatchEvent(new Event("mayhem:data-changed"))
        toast("已重新整理")
      }
      dist = 0
      paint(0, true)
    }
    window.addEventListener("touchstart", start, { passive: true })
    window.addEventListener("touchmove", move, { passive: true })
    window.addEventListener("touchend", end)
    window.addEventListener("touchcancel", end)
    return () => {
      window.removeEventListener("touchstart", start)
      window.removeEventListener("touchmove", move)
      window.removeEventListener("touchend", end)
      window.removeEventListener("touchcancel", end)
    }
  }, [])

  return (
    <div
      ref={pill}
      aria-hidden
      className="glass pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-40 flex size-10 items-center justify-center rounded-full border opacity-0 data-[ready=1]:border-primary data-[ready=1]:text-primary"
      style={{ transform: "translate(-50%, -48px)" }}
    >
      <RefreshCw ref={icon} className="size-5" />
    </div>
  )
}
