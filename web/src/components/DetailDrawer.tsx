import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { prefersReducedMotion } from "@/lib/motion"

/** 點了某個東西（一隻英雄、一天、一場對局）之後，從右邊滑出來的詳細抽屜。
 *
 *  原本各頁是在頁面最上方或最下方插一塊 Panel 再把頁面捲過去：剛點的東西瞬間不見、
 *  畫面整片跳走，使用者要自己找「剛剛點的跑去哪了」。抽屜蓋在原頁面上、原頁面留在原位，
 *  關掉（ESC、點遮罩、右上角）就回到剛才的位置。
 *
 *  用 Radix Dialog 拿到焦點鎖定與 ESC；動畫用 index.css 的 drawer-in / drawer-overlay，
 *  不用 shadcn Sheet 內建的 tw-animate 類別（規則是版面動畫只走 index.css 的 utility）。
 *  不做離場動畫。 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** 標題左邊的圖示（英雄頭像之類） */
  icon?: string
  /** 關閉鈕左邊的操作按鈕 */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs" />
        <DialogPrimitive.Content
          className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl sm:w-[min(980px,92vw)]"
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-3 border-b px-5 py-3">
            {icon && <img src={icon} alt="" className="size-10 shrink-0 rounded-lg bg-icon-tile ring-1 ring-border" />}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
              {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            {actions}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="關閉">
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{open && children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** 抽屜滑完了沒。逐場卡片、戰報這種重的內容等它變 true 才掛：
 *  和換頁一樣，重的東西不要和進場動畫搶主執行緒。等待期間畫同高度的佔位。
 *  要放在抽屜「裡面」的元件呼叫——抽屜每次打開內容都重新掛載，計時才會重來。 */
export function useDrawerSettled() {
  const [settled, setSettled] = useState(prefersReducedMotion())
  useEffect(() => {
    if (settled) return
    const timer = setTimeout(() => setSettled(true), 300)
    return () => clearTimeout(timer)
  }, [settled])
  return settled
}
