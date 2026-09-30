// 配色取自 web/src/index.css 的「霓虹」主題（網站預設主題），影片和網站維持同一個調性。
// 這是獨立的 Remotion 專案，讀不到網站的 CSS 變數，所以複製一份；網站改預設主題時請一併更新。
export const C = {
  bg: "#070b16",
  fg: "#e6f0ff",
  card: "#0d1526",
  muted: "#8397b9",
  primary: "#22d3ee",
  win: "#129bc9",
  loss: "#e3437c",
  data: "#8272f2",
  prismatic: "#b58cff",
  gold: "#f2c14e",
  border: "rgba(125, 185, 255, 0.13)",
  grid: "rgba(125, 185, 255, 0.045)",
} as const

// 120 BPM：一拍 15 幀、一小節 60 幀。所有剪接與鏡頭移動都落在拍點上，音軌也照同一張表合成。
export const FPS = 30
export const BPM = 120
export const BEAT = (FPS * 60) / BPM
export const BAR = BEAT * 4
export const W = 1920
export const H = 1080
export const bars = (n: number) => n * BAR

// 賽季回顧（web/src/recap）的配色。網頁那邊傳的是 var(--win) 這類主題變數，
// 影片渲染讀不到網站的 CSS，所以在這裡給實際色碼：同樣取自霓虹主題。
export const RECAP_PALETTE = {
  bg: C.bg,
  card: C.card,
  fg: C.fg,
  muted: C.muted,
  primary: C.primary,
  win: C.win,
  loss: C.loss,
  data: C.data,
  gold: C.gold,
  border: C.border,
  tile: "#152036", // 霓虹主題的 --icon-tile（= --secondary）
} as const
