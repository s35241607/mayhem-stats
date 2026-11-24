import { useEffect, useRef, useState } from "react"
import type { PageId } from "@/components/AppShell"

/** g 之後按哪個字母到哪一頁。字母取頁面英文名的開頭，撞到的換一個好記的 */
const GO: { key: string; page: PageId; label: string }[] = [
  { key: "d", page: "dashboard", label: "儀表板" },
  { key: "m", page: "matches", label: "對局紀錄" },
  { key: "c", page: "champions", label: "英雄" },
  { key: "a", page: "augments", label: "增幅裝置" },
  { key: "l", page: "lineups", label: "陣容" },
  { key: "p", page: "players", label: "隊友 / 對手" },
  { key: "f", page: "crew", label: "好友比較" },
  { key: "t", page: "time", label: "時段" },
  { key: "r", page: "tilt", label: "節奏與連敗" },
  { key: "o", page: "losses", label: "敗因分析" },
  { key: "e", page: "explore", label: "自由探索" },
]
/** 按了 g 之後多久內要按第二個鍵 */
const CHORD_MS = 1200

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
}

/** 全站鍵盤快捷鍵：g＋字母換頁、/ 跳到這頁的搜尋框、? 看清單。
 *  正在打字、按著 Ctrl/Alt/⌘、或有對話框（抽屜、帳號切換）開著時都不作用，免得搶走輸入。
 *  Ctrl/⌘+K（換帳號）在 AccountSwitcher，不在這裡。 */
export function Shortcuts({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [help, setHelp] = useState(false)
  const armed = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (e.key === "Escape") return setHelp(false)
      if (document.querySelector('[role="dialog"]')) return
      if (performance.now() - armed.current < CHORD_MS) {
        armed.current = 0
        const hit = GO.find((g) => g.key === e.key.toLowerCase())
        if (hit) {
          e.preventDefault()
          setHelp(false)
          onNavigate(hit.page)
        }
        return
      }
      if (e.key === "g") {
        armed.current = performance.now()
      } else if (e.key === "/") {
        const box = document.querySelector<HTMLInputElement>('main input[type="search"], main input[placeholder*="搜尋"], main input[placeholder*="搜"]')
        if (box) {
          e.preventDefault()
          box.focus()
          box.select()
        }
      } else if (e.key === "?") {
        setHelp((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onNavigate])

  if (!help) return null
  const kbd = "rounded border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground"
  return (
    <div
      className="reveal fixed bottom-4 right-4 z-40 w-72 rounded-xl border bg-card p-4 text-xs shadow-2xl"
      role="note"
      aria-label="鍵盤快捷鍵"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">鍵盤快捷鍵</span>
        <span className="text-muted-foreground">
          <kbd className={kbd}>?</kbd> 或 <kbd className={kbd}>Esc</kbd> 關閉
        </span>
      </div>
      <ul className="space-y-1 text-muted-foreground">
        <li className="flex justify-between">
          <span>換帳號</span>
          <kbd className={kbd}>Ctrl K</kbd>
        </li>
        <li className="flex justify-between">
          <span>跳到這頁的搜尋框</span>
          <kbd className={kbd}>/</kbd>
        </li>
        {GO.map((g) => (
          <li key={g.key} className="flex justify-between">
            <span>{g.label}</span>
            <span>
              <kbd className={kbd}>g</kbd> <kbd className={kbd}>{g.key}</kbd>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
