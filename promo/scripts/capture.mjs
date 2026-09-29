// 從本機執行中的服務（127.0.0.1:5057）截取影片用的真實畫面 → public/shots/*.png 與 shots.json
//   用法：node scripts/capture.mjs [id,id,...]      預設全部
//
// 每一頁拍「整頁長圖」（把視窗拉到頁面那麼高，不用 captureBeyondViewport——它會拍到空白的 canvas），
// 並量出各張卡片的真實位置寫進 shots.json，影片的鏡頭停靠點就用這些座標，不靠目測。
//
// 這些圖會進公開 repo，所以玩家名稱不能是真的：
//  1. 在頁面載入前包住 window.fetch，把所有 JSON 回應裡「整個字串就是 名稱#tag」的值換成代號。
//     不事後改 DOM——React 會把文字切成多個節點，正規表示式會切到一半。
//  2. 截完再用 /api/accounts 的真實名單反查畫面文字，撞到任何一個就整批作廢、不寫任何檔案。
//  Edge 用無頭模式：內嵌瀏覽器窗格失焦時會被節流到 0.3 fps，圖表畫不出來（見 verify-change skill）。
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "..", "public", "shots")
const BASE = "http://127.0.0.1:5057"
const W = 1600
const H0 = 900
const MAX_H = 1900 // 長圖最高幾 CSS px（×SCALE 就是實際像素）
const SCALE = 1.5 // 2400 寬：影片裡平面寬 1920、鏡頭最多推到約 1.1 倍，仍有餘裕
const ALIAS = "Ashe#TW01" // 與 README 截圖一致的代號

/**
 * 每個畫面：id、側邊欄文字、（選填）進頁後要做的動作、要量的區域。
 * 區域用「卡片標題文字」或「元素文字」找元素，回傳它的外框。找不到會警告，不會中斷。
 * 只挑不會顯示他人名稱的頁面（隊友、好友、對局戰報一律不拍）。
 */
const SHOTS = [
  { id: "dashboard", label: "儀表板", regions: {
    overall: { card: "整體戰績" }, recent: { card: "最近戰績" }, kpi: { rowOf: "每分鐘傷害" },
    trend: { card: "每日勝率趨勢" }, champs: { card: "最常用英雄" },
    loadout: { card: "出裝定位" }, augPicks: { card: "最常選的增幅" }, when: { card: "什麼時候打" },
    collector: { css: '[data-sidebar="footer"]' },
  } },
  { id: "champions", label: "英雄", regions: {
    radar: { echarts: 0, up: 1 }, table: { css: ".ag-root-wrapper" },
  } },
  { id: "augments", label: "增幅裝置", regions: {
    picker: { card: "看某隻英雄上的表現" }, ranking: { card: "勝率排行" }, all: { card: "全部增幅" },
  } },
  { id: "lineups", label: "陣容", regions: {
    matrix: { card: "陣容對陣" }, mine: { card: "我方陣容類型" }, enemy: { card: "遇到的敵方陣容類型" },
  } },
  { id: "time", label: "時段", regions: {
    kpi: { rowOf: "總場次" }, trend: { card: "每天的場次與勝率" }, heat: { card: "星期 × 時段" }, weekday: { card: "星期別勝率" },
  } },
  { id: "losses", label: "敗因分析", regions: {
    kpi: { rowOf: "打不動還是被打爆" }, verdict: { cardWith: "打不動還是被打爆" }, table: { card: "勝局與敗局，數字差在哪" },
  } },
  { id: "tilt", label: "節奏與連敗", regions: {
    kpi: { rowOf: "前一場輸之後" }, prev: { card: "前一場的結果，和這一場的勝率" }, streak: { card: "同一輪連續打到第幾場" },
  } },
  { id: "explore", label: "自由探索", regions: {
    fields: { card: "欄位配置" }, result: { card: "結果" },
  } },
  { id: "explore-bar", label: "自由探索", after: "bar", regions: { result: { card: "結果" } } },
]
const want = (process.argv[2] || SHOTS.map((s) => s.id).join(",")).split(",")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 真實名稱（只留在記憶體，不寫檔、不印出）
const acc = await (await fetch(`${BASE}/api/accounts`)).json()
const realIds = [...(acc.me ?? []), ...(acc.tracked ?? []), ...(acc.others ?? [])].map((p) => p.riot_id).filter(Boolean)
const realNames = [...new Set(realIds.flatMap((id) => [id, id.split("#")[0]]))].filter((s) => s.length >= 2)

const maskSource = "(" + ((alias) => {
  const orig = window.fetch.bind(window)
  const RE = /"([^"\\]{1,32})#([^"\\]{1,24})"/g
  window.fetch = async (...args) => {
    const res = await orig(...args)
    if (!(res.headers.get("content-type") || "").includes("json")) return res
    const text = (await res.text()).replace(RE, `"${alias}"`)
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}).toString() + `)(${JSON.stringify(ALIAS)})`

const PROFILE = mkdtempSync(join(tmpdir(), "edge-promo-"))
const port = 9455
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", `--remote-debugging-port=${port}`, `--window-size=${W},${H0}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" })

let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break } catch { } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const viewport = (h) => cdp("Emulation.setDeviceMetricsOverride", { width: W, height: h, deviceScaleFactor: SCALE, mobile: false })

const READY = `(() => {
  if (document.querySelector('[data-slot="skeleton"]')) return false
  if ([...document.querySelectorAll('div[_echarts_instance_]')].some((c) => !c.querySelector('canvas'))) return false
  return document.body.innerText.length > 200
})()`
const waitReady = async (id) => {
  let ok = false
  for (let i = 0; i < 75 && !ok; i++) { await sleep(400); ok = await ev(READY) }
  if (!ok) throw new Error(`${id}: 內容一直沒就緒`)
}

// 在頁面裡量區域：回傳 [x0, y0, x1, y1]（CSS px，含捲動位移），找不到回 null
const MEASURE = (spec) => `(() => {
  const spec = ${JSON.stringify(spec)}
  const own = (t) => [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.textContent.trim() === t)
  const up = (e, n) => { for (let i = 0; e && i < (n ?? 0); i++) e = e.parentElement; return e }
  let el = null
  if (spec.card) el = own(spec.card).map((e) => e.closest('[data-slot="card"]')).find(Boolean)
  else if (spec.cardWith) el = [...document.querySelectorAll('[data-slot="card"]')].find((c) => c.textContent.includes(spec.cardWith))
  else if (spec.rowOf) {
    el = [...document.querySelectorAll('[data-slot="card"]')].find((c) => c.textContent.includes(spec.rowOf))
    while (el && el.parentElement && el.getBoundingClientRect().width < 1200) el = el.parentElement
  }
  else if (spec.text) el = up(own(spec.text)[0], spec.up)
  else if (spec.echarts !== undefined) el = up(document.querySelectorAll("div[_echarts_instance_]")[spec.echarts], spec.up)
  else if (spec.css) el = document.querySelector(spec.css)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return [r.left, r.top + scrollY, r.right, r.bottom + scrollY].map((v) => Math.round(v * 10) / 10)
})()`

await cdp("Page.enable"); await cdp("Runtime.enable")
await viewport(H0)
await cdp("Emulation.setFocusEmulationEnabled", { enabled: true })
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("mayhem-theme", "neon") } catch {}` })
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: maskSource })

mkdirSync(OUT, { recursive: true })
const shots = []
const manifest = {}
let leaked = null
try {
  await cdp("Page.navigate", { url: BASE + "/" })
  await sleep(2500)
  for (const shot of SHOTS.filter((s) => want.includes(s.id))) {
    await viewport(H0)
    const clicked = await ev(`(() => { const b = [...document.querySelectorAll('[data-sidebar="menu-button"]')].find((x) => x.textContent.trim() === ${JSON.stringify(shot.label)}); if (!b) return false; b.click(); return true })()`)
    if (!clicked) throw new Error(`${shot.id}: 側邊欄找不到「${shot.label}」`)
    await sleep(1500)
    await waitReady(shot.id)
    await sleep(1500)
    if (shot.after === "bar") {
      const ok = await ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "長條"); if (!b) return false; b.click(); return true })()`)
      if (!ok) throw new Error(`${shot.id}: 找不到「長條」按鈕`)
      await sleep(1200)
      await waitReady(shot.id)
    }
    // 拉高視窗到整頁高度，再等版面與圖表重畫。高度可能因此改變（圖表高度跟著視窗），最多量三次收斂。
    let h = H0
    for (let round = 0; round < 3; round++) {
      const need = Math.min(MAX_H, Math.max(H0, await ev("Math.ceil(document.documentElement.scrollHeight)")))
      if (need === h && round > 0) break
      h = need
      await viewport(h)
      await sleep(2200)
      await waitReady(shot.id)
    }
    await sleep(3000) // 進場動畫與圖表生長動畫
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 })
    await sleep(400)

    const text = await ev("document.body.innerText")
    const hit = realNames.find((n) => text.includes(n))
    const tags = [...text.matchAll(/\S+#\S+/g)].map((m) => m[0]).filter((t) => t !== ALIAS)
    if (hit || tags.length) { leaked = `${shot.id}: 畫面文字含真實名稱或未遮罩的 Riot ID 樣式（${hit ? "名單比對" : "#樣式"}）`; break }

    const regions = {}
    for (const [name, spec] of Object.entries(shot.regions)) {
      const r = await ev(MEASURE(spec))
      if (r) regions[name] = r
      else console.warn(`  ⚠ ${shot.id}.${name}: 找不到元素`)
    }
    const png = await cdp("Page.captureScreenshot", { format: "png" })
    shots.push([shot.id, Buffer.from(png.result.data, "base64")])
    manifest[shot.id] = { w: W, h, scale: SCALE, regions }
    console.log(`${shot.id}: ${W}×${h}（${Object.keys(regions).length}/${Object.keys(shot.regions).length} 個區域）`)
  }
} finally {
  ws.close()
  spawnSync("powershell", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${PROFILE.split("\\").pop()}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
    { stdio: "ignore" })
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { }
}

if (leaked) { console.error("作廢，沒有寫入任何檔案 →", leaked); process.exit(1) }
for (const [id, buf] of shots) writeFileSync(join(OUT, `${id}.png`), buf)
// 只拍部分頁面時，保留其他頁面原本的紀錄
let old = {}
try { old = JSON.parse(readFileSync(join(OUT, "shots.json"), "utf8")) } catch { }
writeFileSync(join(OUT, "shots.json"), JSON.stringify({ ...old, ...manifest }, null, 1))
console.log(`寫入 ${shots.length} 張與 shots.json 到 ${OUT}`)
process.exit(0)
