import { cancelRender, continueRender, delayRender, staticFile } from "remotion"
import manifest from "../public/fonts/fonts.json"

// 字型檔由 scripts/fetch-fonts.mjs 依畫面上實際用到的字下載成切片放在 public/fonts/，
// 這裡只負責在渲染前把它們載進來。網站用 Geist 搭系統中文字；影片改用 Noto Sans TC 補中文，粗體才夠重。
type Entry = { family: string; weight: string; file: string; range: string }

const handle = delayRender("載入字型")
Promise.all(
  (manifest as Entry[]).map(async (m) => {
    const face = new FontFace(m.family, `url(${staticFile(`fonts/${m.file}`)}) format("woff2")`, {
      weight: m.weight,
      unicodeRange: m.range,
      display: "block",
    })
    await face.load()
    document.fonts.add(face)
  }),
).then(
  () => continueRender(handle),
  (e) => cancelRender(e),
)

// 拉丁字母與數字走 Geist，找不到的字（中文）掉到 Noto。
export const FONT = {
  sans: "PromoGeist, PromoNoto, sans-serif",
  mono: "PromoGeistMono, PromoNoto, monospace",
}
