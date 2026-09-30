/** 賽季回顧的資料與外觀。
 *
 *  這個資料夾（web/src/recap）同時被網頁的 @remotion/player 和 promo/ 的 Remotion 渲染使用，
 *  所以裡面不能碰 `@/` 別名、Tailwind、React context 或任何瀏覽器全域：只有相對路徑的 import。 */

export type RecapItem = {
  name: string
  /** 客戶端資源路徑（icon_path），要經過 /api/icon 才拿得到圖 */
  icon: string | null
  games: number
  /** 0–100，樣本 0 場時為 null */
  winrate: number | null
}

export type RecapData = {
  /** 幫誰做的回顧（Riot ID）。公開鏡像上是登入者自己的帳號，本人的名稱不遮。 */
  player: string | null
  /** 第一場與最後一場的本地日期 YYYY-MM-DD */
  from: string
  to: string
  games: number
  wins: number
  /** 累計對局時間（小時） */
  hours: number
  kills: number
  deaths: number
  assists: number
  multikills: number
  pentas: number
  /** 依時間排序後，最長的連勝 */
  longestWinStreak: number
  longestLossStreak: number
  /** 最常用的英雄，最多三個 */
  champions: RecapItem[]
  /** 最常拿的增幅 */
  augmentMostPicked: RecapItem | null
  /** 場次夠多的增幅裡勝率最高的 */
  augmentBest: RecapItem | null
  /** 星期日到星期六，各自的場次與勝場 */
  weekdays: { games: number; wins: number }[]
  /** 場次最多的（星期 × 時段）格子 */
  peak: { weekday: number; block: string; games: number; wins: number } | null
  /** 勝率最高的時段（場次夠多才算） */
  bestBlock: { block: string; games: number; wins: number } | null
  /** 同隊最多場的隊友。名稱在公開鏡像上會被伺服器換成代號；匯出影片時可以再遮一次 */
  partner: { name: string; games: number; wins: number } | null
}

/** 影片用到的顏色。網頁傳 `var(--win)` 這種主題變數，影片渲染時傳實際色碼。
 *  合成裡不寫任何色碼，這樣主題怎麼換，回顧都跟著換。 */
export type RecapPalette = {
  bg: string
  card: string
  fg: string
  muted: string
  primary: string
  win: string
  loss: string
  data: string
  gold: string
  border: string
  /** 增幅圖示底塊：圖示是白線條透明圖，亮色主題也要墊深色 */
  tile: string
}

export type RecapProps = {
  data: RecapData
  palette: RecapPalette
  fontFamily: string
  /** 圖示網址的前綴：網頁裡是空字串（同源），影片渲染時是 http://127.0.0.1:5057 */
  origin: string
}
