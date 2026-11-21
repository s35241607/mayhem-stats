import { useSyncExternalStore } from "react"
// 先載入 cube：它的監聽器（把快取標成過期）要排在這裡的前面，重查時才不會又拿到舊結果
import "@/lib/cube"

/** 資料版本：每次採集入庫（或 SSE 重新連線）加一。
 *
 *  以前是 App 用它當頁面的 key，資料一變整頁重掛——頁面裡的排序、選取、捲動位置全部歸零。
 *  現在頁面留著，各個抓資料的地方把它放進 effect 的依賴，自己在背景重抓：
 *  useCube 已經內建；直接 fetch 的地方（逐場列表、儀表板近況……）用 useDataRevision()。 */
let revision = 0
const listeners = new Set<() => void>()

if (typeof window !== "undefined") {
  window.addEventListener("mayhem:data-changed", () => {
    revision++
    listeners.forEach((fn) => fn())
  })
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function useDataRevision(): number {
  return useSyncExternalStore(subscribe, () => revision)
}
