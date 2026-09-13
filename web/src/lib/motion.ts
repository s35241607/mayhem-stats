import { useEffect, useState } from "react"

/** 換頁進場動畫的長度，和 index.css 的 page-enter 一致。 */
export const PAGE_ENTER_MS = 200

let navigatedAt = 0

/** App 換頁時呼叫，讓重元件知道進場動畫什麼時候結束。 */
export function markNavigation() {
  navigatedAt = performance.now()
}

/** 重元件（AG Grid、ECharts）等進場動畫跑完才掛載。
 *
 *  掛載 AG Grid 是一段 60～130ms 的長任務。資料有快取時它會和進場動畫擠在同一段時間，
 *  動畫就在半路停一下——那就是切頁的「卡頓感」。延後到動畫結束才掛，卡的那一下
 *  落在畫面已經靜止的時候，看不出來。資料本來就比動畫慢才到的話，這裡不會多等。
 *  等待期間呼叫端要畫同樣高度的佔位，版面才不會跳。 */
export function useAfterPageEnter() {
  const remaining = () => PAGE_ENTER_MS + 20 - (performance.now() - navigatedAt)
  const [ready, setReady] = useState(() => remaining() <= 0)
  useEffect(() => {
    if (ready) return
    const timer = setTimeout(() => setReady(true), Math.max(0, remaining()))
    return () => clearTimeout(timer)
  }, [ready])
  return ready
}
