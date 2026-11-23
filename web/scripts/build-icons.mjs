// 從 public/app-icon.svg 產生 PWA 需要的 PNG 圖示（改了 SVG 才需要重跑，產物放在 public/ 一起進版控）：
//   node scripts/build-icons.mjs
// 用專案已經有的 Playwright 的 Chromium 截圖，不另外裝影像套件。
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const svg = readFileSync(pub("app-icon.svg"), "utf8")
// maskable：系統會把圖示裁成圓形或圓角方形，安全區是中間 80%，所以底色要滿版、不能有自己的圓角
const maskable = svg.replace('rx="112"', 'rx="0"')

const targets = [
  { file: "icon-192.png", size: 192, src: svg },
  { file: "icon-512.png", size: 512, src: svg },
  { file: "icon-maskable-512.png", size: 512, src: maskable },
  // iOS 會自己裁圓角，給滿版的
  { file: "apple-touch-icon.png", size: 180, src: maskable },
]

// 用系統的 Edge（e2e 也是），不必另外下載 Playwright 的瀏覽器
const browser = await chromium.launch({ channel: "msedge" })
const page = await browser.newPage()
for (const { file, size, src } of targets) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`,
  )
  await page.screenshot({ path: pub(file), omitBackground: true })
  console.log("wrote", file)
}
await browser.close()
