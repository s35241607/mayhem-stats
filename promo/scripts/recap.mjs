// 把「賽季回顧」渲染成 mp4（或抽幾張靜態圖檢查版面）。資料來自正在跑的本機服務。
//
//   node scripts/recap.mjs                          本機帳號、全部期間 → out/recap.mp4
//   node scripts/recap.mjs --from 2026-09-01 --to 2026-09-30
//   node scripts/recap.mjs --puuid <puuid>          指定帳號（預設是標成「我」的那個）
//   node scripts/recap.mjs --names                  保留隊友的真名（預設換成「固定隊友」，因為影片會拿去分享）
//   node scripts/recap.mjs --frames 20,120,400      不渲染影片，只把這幾幀存成 out/recap-stills/*.png
//   node scripts/recap.mjs --json                   只印出撈到的資料，不渲染
//
// 語意層查詢的寫法在 web/src/recap/data.ts，網頁和這支腳本共用同一份，所以兩邊的數字一定一樣。
import { bundle } from "@remotion/bundler"
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer"
import { build } from "esbuild"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dedupeReact } from "../webpack-override.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback
}

const SERVER = opt("server", "http://127.0.0.1:5057")
const QUEUE = opt("queue", "2400")
const FROM = opt("from", null)
const TO = opt("to", null)

// ── 撈資料 ───────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "recap-"))
try {
  await build({
    entryPoints: [join(ROOT, "..", "web", "src", "recap", "data.ts")],
    bundle: true, format: "esm", platform: "node", outfile: join(tmp, "data.mjs"), logLevel: "error",
  })
  const { loadRecap } = await import(pathToFileURL(join(tmp, "data.mjs")).href)

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const query = async (q) => {
    const url = `${SERVER}/api/cube/load?query=${encodeURIComponent(JSON.stringify({ timezone, ...q }))}`
    for (;;) {
      const res = await fetch(url)
      const body = await res.json()
      if (body.error === "Continue wait") continue // Cube 還沒算完，再問一次
      if (!res.ok || body.error) throw new Error(`Cube 查詢失敗：${body.error ?? res.status}`)
      return body.data
    }
  }

  const { players } = await (await fetch(`${SERVER}/api/players`)).json()
  const account = opt("puuid", null) ? players.find((p) => p.puuid === opt("puuid")) : players.find((p) => p.is_me) ?? players[0]
  if (!account) throw new Error("找不到帳號。服務有開嗎？（" + SERVER + "）")

  const data = await loadRecap(query, {
    puuid: account.puuid,
    player: account.riot_id,
    queueId: QUEUE,
    dateRange: FROM && TO ? [FROM, TO] : null,
  })
  if (!data) throw new Error("這個條件下沒有對局，沒有東西可以做回顧。")
  if (data.partner && !flag("names")) data.partner.name = "固定隊友"
  if (flag("json")) {
    console.log(JSON.stringify(data, null, 2))
    process.exit(0)
  }
  console.log(`資料：${data.from} – ${data.to}，${data.games} 場，${data.champions.length} 隻英雄，隊友 ${data.partner ? "有" : "無"}`)

  // ── 渲染 ──────────────────────────────────────────────────────────
  // 色碼與字型和 Root.tsx 註冊的預設值一致；只有資料和圖示網址是這次的。
  const serveUrl = await bundle({
    entryPoint: join(ROOT, "src", "index.ts"),
    publicDir: join(ROOT, "public"),
    webpackOverride: dedupeReact,
  })
  const inputProps = { data, origin: SERVER }
  const composition = await selectComposition({ serveUrl, id: "Recap", inputProps })
  // inputProps 只覆蓋 defaultProps 的 data 與 origin，palette 與 fontFamily 沿用 Root 裡的。
  console.log(`長度 ${composition.durationInFrames} 幀（${(composition.durationInFrames / composition.fps).toFixed(1)} 秒）`)

  const frames = opt("frames", "")
  if (frames) {
    const out = join(ROOT, "out", "recap-stills")
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    for (const [i, frame] of frames.split(",").filter(Boolean).map(Number).entries()) {
      const output = join(out, `r${String(i + 1).padStart(2, "0")}.png`)
      await renderStill({ composition, serveUrl, frame, inputProps, output, scale: Number(opt("scale", "0.5")) })
      console.log(`r${String(i + 1).padStart(2, "0")} = 幀 ${frame}`)
    }
  } else {
    if (!existsSync(join(ROOT, "out"))) mkdirSync(join(ROOT, "out"))
    const outputLocation = join(ROOT, "out", opt("out", "recap.mp4"))
    let last = -1
    await renderMedia({
      composition, serveUrl, inputProps, outputLocation, codec: "h264", muted: true,
      onProgress: ({ progress }) => {
        const pctDone = Math.floor(progress * 10) * 10
        if (pctDone !== last) console.log(`  ${pctDone}%`), (last = pctDone)
      },
    })
    console.log(`完成：${outputLocation}`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(0)
