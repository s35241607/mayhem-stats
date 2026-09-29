// 抽幀預覽：把指定的幀各渲一張靜態圖到 out/stills/s###.jpg（幀號對照見輸出）。
//   用法：node scripts/stills.mjs 5,20,40,70,... [縮放，預設 0.5]
// 只 bundle 一次、共用同一個瀏覽器，比逐張跑 `remotion still` 快很多。
// 動態模糊照常生效（CameraMotionBlur 也會套在單張上），所以看到的就是成片會有的樣子。
import { bundle } from "@remotion/bundler"
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "out", "stills")
const frames = (process.argv[2] || "").split(",").filter(Boolean).map(Number)
if (!frames.length) { console.error("給幀號，例如：node scripts/stills.mjs 5,20,40"); process.exit(1) }
const scale = Number(process.argv[3] || 0.5)

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") })
const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } })
const inputProps = { audio: false }
const composition = await selectComposition({ serveUrl, id: "Promo", puppeteerInstance: browser, inputProps })
for (const [i, frame] of frames.entries()) {
  await renderStill({
    composition, serveUrl, frame, inputProps, puppeteerInstance: browser, scale,
    output: join(OUT, `s${String(i + 1).padStart(3, "0")}.jpg`), imageFormat: "jpeg", jpegQuality: 88,
  })
  console.log(`s${String(i + 1).padStart(3, "0")} = 幀 ${frame} (${(frame / 30).toFixed(2)}s)`)
}
await browser.close({ silent: true })

process.exit(0)
