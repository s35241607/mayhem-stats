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
    id: "2026-11-25.5",
    date: "2026-11-25",
    title: "側欄的收合按鈕固定在左上角",
    items: [
      "收合／展開側欄的按鈕搬到側欄左上角，展開和收合時都在同一個位置，按完不用再移滑鼠（Ctrl+B 也可以）",
      "按鈕上的箭頭會跟著狀態換方向：朝左是收起來、朝右是打開",
      "側欄收合後，最上面不再有一個歪掉的標誌",
      "網站的閃電標誌放大了：瀏覽器分頁和手機主畫面上的小圖示比較看得出形狀（已經加到主畫面的要重新加一次才會換）",
    ],
  },
  {
    id: "2026-11-25.4",
    date: "2026-11-25",
    title: "好友比較：行為習慣；數據總表不再截字",
    page: "crew",
    items: [
      "「打法」分頁下面多一張「行為習慣」：每個人的擊殺有多少是單殺、死亡有多少是落單被抓、有多少死在打贏的團戰裡、擊殺參與有多少發生在後期",
      "每一格都和同出裝定位的玩家比，看得出差別的才上色；點欄名可以排序",
      "數據總表的欄名和數字不再被截成「…」，欄位多的時候改成左右捲動（之前自己調過的欄寬、欄位順序會回到預設一次）",
    ],
  },
  {
    id: "2026-11-25.3",
    date: "2026-11-25",
    title: "好友比較：新增「打法」分頁",
    page: "crew",
    items: [
      "好友比較多一個「打法」分頁：一張表列出每個人在輸出、承傷、擊殺、參團、控場等十項上，比同出裝定位的玩家做得多還是少",
      "橫著看是一個人的打法輪廓，直著看是這件事隊上誰最常做；點欄名可以依那一項排序",
      "實心的格子是看得出差別的，虛線是有差但還在誤差內，灰字是差不多",
    ],
  },
  {
    id: "2026-11-25.2",
    date: "2026-11-25",
    title: "陣容頁新增重點；新對局更快出現",
    page: "lineups",
    items: [
      "陣容頁最上面多一塊「重點」：哪些陣容比較會贏、比較會輸，哪些對陣有相剋，並標出是看得出還是只有傾向",
      "打完一場後，新對局出現在網站上的等待時間少了約 20 秒",
    ],
  },
  {
    id: "2026-11-25.1",
    date: "2026-11-25",
    title: "好友比較：等級圖例精簡",
    page: "crew",
    items: ["等級圖例收成五組（看得出高、偏高、差不多、偏低、看得出低），點開才是全部 19 級"],
  },
  {
    id: "2026-11-24.2",
    date: "2026-11-24",
    title: "「分數怎麼算」改成圖解",
    page: "score",
    items: [
      "用圖說明一場的分數怎麼從 50 分加加減減算出來，各定位最看重哪幾項一眼看得出",
      "差距要多大才算真的不一樣，改用誤差帶的圖來看",
    ],
  },
  {
    id: "2026-11-24.1",
    date: "2026-11-24",
    title: "分數說明、更新紀錄、勝率「看得出」",
    page: "score",
    items: [
      "新的「分數怎麼算」：用白話說明本場貢獻怎麼算、怎麼看",
      "新的「更新紀錄」：網站改了什麼都寫在這裡，有新的會亮小紅點",
      "勝率旁標出 ▲▼「看得出」，場次少的高勝率不再看起來像結論；英雄、增幅頁上方多一句結論",
      "時段、節奏與連敗、敗因分析收成「習慣」一組，頁面頂端可以互相切換",
      "戰報可以分享：手機上叫出系統的分享選單，丟到 Discord 或 LINE",
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
