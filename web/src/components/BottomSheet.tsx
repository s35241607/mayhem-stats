import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"

/** 手機的底部面板（篩選、更多）。和 DetailDrawer 一樣用 Radix Dialog 拿焦點鎖定與 ESC，
 *  動畫走 index.css 的 sheet-up / drawer-overlay，不做離場動畫。
 *  底部留 safe-area：加到主畫面全螢幕時，iPhone 的橫條不會蓋住按鈕。 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** 固定在底部、不跟著內容捲動（套用鈕之類） */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/55" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // 打開時不要把焦點丟到第一顆按鈕（右上角的關閉鈕會亮一圈焦點框）；焦點仍鎖在面板裡
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).focus()
          }}
          className="sheet-up outline-none fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex justify-center pt-2" aria-hidden>
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="flex items-center justify-between py-1 pl-5 pr-2">
            <DialogPrimitive.Title className="text-lg font-bold">{title}</DialogPrimitive.Title>
            <Button size="icon" variant="ghost" className="size-11" onClick={() => onOpenChange(false)} aria-label="關閉">
              <X className="size-5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{open && children}</div>
          {footer && <div className="border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
          {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
