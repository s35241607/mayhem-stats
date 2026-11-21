import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"

/** 輕量的操作回饋：畫面右下角冒一句話，幾秒後自己消失。
 *
 *  給「按了但畫面上看不出發生什麼」的操作用——立即採集、複製連結、下載檔案。
 *  不引入 toast 套件：一個模組層的清單加一個固定的顯示層就夠，動畫用 index.css 的 rise。
 *  用法：任何地方 `toast("已複製連結")`；失敗用 `toast("…", "error")`。 */
type Toast = { id: number; text: string; tone: "info" | "error" }

const SHOW_MS = 3200
let items: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = nextId++
  // 最多同時三句，舊的先走
  items = [...items.slice(-2), { id, text, tone }]
  emit()
  setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, SHOW_MS)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** 顯示層，全站掛一個（AppShell）。aria-live 讓螢幕閱讀器也聽得到 */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items)
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "rise rounded-lg border bg-card px-4 py-2 text-sm shadow-2xl",
            t.tone === "error" ? "border-destructive/50 text-destructive" : "border-primary/40",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
