import { useSyncExternalStore } from "react"
import type { PageId } from "@/components/AppShell"

/** 給使用者看的更新紀錄。
 *
 *  不是 commit 訊息：commit 寫給開發者（「多 cube 指標的接合改用 IS」），這裡寫朋友看得懂的「改了什麼、去哪裡看」。
 *  使用者看得到的改動，commit 時一併在最上面補一筆（CLAUDE.md 有這條規則）。
 *  repo 是公開的：內容不能出現其他玩家的名稱。
 *
 *  id 要唯一且越新越大（日期＋當天序號），「有沒有看過」用它比。 */
export type ChangelogEntry = {
  id: string
  date: string
  title: string
  items: string[]
  /** 「去看看」連到哪一頁 */
  page?: PageId
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-11-24.1",
    date: "2026-11-24",
    title: "首頁改成戰報、選角助手、個人頁",
    page: "feed",
    items: [
      "首頁換成「戰報」：每一輪開打一張卡，看那輪幾勝幾敗、最佳與最慘的一場、和誰一起打",
      "新的「選角助手」：選到英雄時快速查你和大家用它的戰績、常勝的增幅與出裝、朋友誰玩得好",
      "好友比較、隊友頁可以點進某個人的「個人頁」，不用切換整個網站的帳號",
      "戰報可以分享：手機上叫出系統的分享選單，丟到 Discord 或 LINE",
      "加到主畫面後可以開「新對局通知」",
      "新的「分數怎麼算」：用白話說明本場貢獻怎麼算、怎麼看",
      "勝率旁標出「看得出」或「還在誤差內」，場次少的高勝率不再看起來像結論",
      "時段、節奏與連敗、敗因分析收成「習慣」一組，頁面頂端可以互相切換",
    ],
  },
  {
    id: "2026-11-23.2",
    date: "2026-11-23",
    title: "質感更新：玻璃外殼與動畫",
    items: [
      "標題列、側欄、面板與選單改成半透明玻璃，卡片加上細反光",
      "手機分頁列換頁時，目前頁的底塊會滑過去",
    ],
  },
  {
    id: "2026-11-23.1",
    date: "2026-11-23",
    title: "手機版大改版，可以加到主畫面",
    items: [
      "手機上改成底部分頁列，篩選條件收成一列，點了從底部拉出設定",
      "表格在手機上自動變成卡片，點一張看細項",
      "可以「加到主畫面」當成 App 用，離線時會提示",
      "對局卡片點下去會展開成戰報",
    ],
  },
  {
    id: "2026-11-21.1",
    date: "2026-11-21",
    title: "自由探索工作台、對照前期、網址可分享",
    page: "explore",
    items: [
      "自由探索改成工作台：自己拖欄位做樞紐表、圖表，可以存成卡片與儀表板",
      "標題列的「對照前期」：和前一段一樣長的期間比較",
      "篩選、分頁、點開的那一層都在網址裡，貼給別人就是同一個畫面",
      "看明細一律從右邊滑出抽屜，原頁面留在原位",
    ],
  },
  {
    id: "2026-11-16.1",
    date: "2026-11-16",
    title: "表格升級與好友比較的打法判定",
    items: [
      "表格可以排序、拖曳換欄、選要顯示哪些欄位，版面會記住",
      "好友比較的「打法」改成和同出裝定位的人比",
    ],
  },
  {
    id: "2026-11-15.1",
    date: "2026-11-15",
    title: "本場貢獻升級到 v5.4",
    page: "score",
    items: ["貢獻分數納入擊殺時間軸、單人拆塔、關鍵失誤等加減分", "對局戰報加上時間軸"],
  },
]

export const LATEST_ID = CHANGELOG[0].id

// ── 看過到哪一筆：存在各自的瀏覽器，沒有就當全部沒看過（第一次來的人除外，見 markFirstVisit） ──
const KEY = "mayhem-changelog-seen"
const listeners = new Set<() => void>()
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return LATEST_ID
  }
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function markChangelogSeen() {
  try {
    localStorage.setItem(KEY, LATEST_ID)
  } catch {
    /* 私密模式之類存不了：小紅點就一直在，不影響使用 */
  }
  listeners.forEach((fn) => fn())
}

export const isChangelogUnread = () => {
  const seen = read()
  return seen !== null && seen < LATEST_ID
}

/** 有沒有還沒看過的更新（側欄、「更多」的小紅點） */
export function useChangelogUnread() {
  const seen = useSyncExternalStore(subscribe, read)
  return seen !== null && seen < LATEST_ID
}

/** 第一次來的人不需要看歷史更新：直接記成已看過，之後有新的才亮紅點 */
export function markFirstVisit() {
  if (read() === null) markChangelogSeen()
}

/** 改版後第一次載入：App 偵測到新版會重新整理，重新整理前留一個記號，載入後依它跳一次提示 */
const UPDATED_KEY = "mayhem-just-updated"
export function flagJustUpdated() {
  try {
    sessionStorage.setItem(UPDATED_KEY, "1")
  } catch {
    /* 存不了就不提示 */
  }
}
export function takeJustUpdated() {
  try {
    const on = sessionStorage.getItem(UPDATED_KEY) === "1"
    sessionStorage.removeItem(UPDATED_KEY)
    return on
  } catch {
    return false
  }
}
