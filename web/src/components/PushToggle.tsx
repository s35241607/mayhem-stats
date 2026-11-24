import { useEffect, useState } from "react"
import { BellRing } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { pushState, subscribe, unsubscribe, type PushState } from "@/lib/push"

const NOTE: Partial<Record<PushState, string>> = {
  "needs-install": "iPhone／iPad 要先在 Safari 按「分享 → 加入主畫面」，再從主畫面的圖示打開，才能開啟通知",
  unsupported: "這個瀏覽器不支援通知",
  denied: "通知已被瀏覽器封鎖，要到瀏覽器（或系統）的網站設定裡改成允許",
}

/** 一列「新對局通知」開關：採集到你的帳號有新的大亂鬥對局時，推送「你有 N 場新對局」。
 *  不支援或 iOS 未加到主畫面時開關停用，下方一句說明怎麼辦。 */
export function PushToggle({ className }: { className?: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    pushState().then((s) => alive && setState(s)).catch(() => alive && setState("unsupported"))
    return () => {
      alive = false
    }
  }, [])

  const on = state === "on"
  const usable = state === "on" || state === "off"
  const note = state ? NOTE[state] : undefined

  const toggle = async () => {
    if (!usable || busy) return
    setBusy(true)
    try {
      const next = on ? await unsubscribe() : await subscribe()
      setState(next)
      if (next === "on") toast("已開啟新對局通知")
      else if (next === "denied") toast("通知被瀏覽器封鎖了", "error")
    } catch (e) {
      toast(e instanceof Error ? e.message : "開啟通知失敗", "error")
      setState(await pushState().catch(() => "unsupported" as const))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={!usable || busy}
      onClick={toggle}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 text-left text-[15px]",
        !usable && "cursor-not-allowed",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-2.5">
        <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          新對局通知
          <span className="block text-xs text-muted-foreground">
            {note ?? "採集到你的新對局時推送「你有 N 場新對局」"}
          </span>
        </span>
      </span>
      <span
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full border transition",
          on ? "border-primary bg-primary" : "bg-secondary",
          (!usable || busy) && "opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-5 rounded-full transition-transform",
            on ? "translate-x-[23px] bg-primary-foreground" : "translate-x-[3px] bg-muted-foreground",
          )}
        />
      </span>
    </button>
  )
}
