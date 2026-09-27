// 瀏覽器端「等連線」的時間：HTTP/1.1 每個網域 6 條連線，一頁同時送出超過 6 個請求時，
// 後面的會在瀏覽器裡排隊。要評估 HTTP/2 值不值得、或某頁是不是請求太多，就看這個。
// 用法：node stall.mjs            （服務要先在 127.0.0.1:5057 跑著）
//
// 每頁量兩輪，同一個瀏覽器：第一輪是全新設定檔（圖示都要下載），第二輪圖示已快取＝平常使用的情況。
// 每輪開始前都先讓查詢快取失效（重建衍生表，和入庫後一樣），等 Cube 發現版本變了才開始。
// 等連線 = 發起請求 → 真正送出（含排隊、停頓、建立連線）；伺服器 = 送出 → 收到回應標頭。
// 從瀏覽器快取拿的回應不算（CDP 一樣會送 responseReceived，不排除的話圖示會被重複計入）。
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..")
const PAGES = ["好友比較", "英雄", "增幅裝置", "隊友 / 對手", "儀表板"]
const port = 9460
const PROFILE = mkdtempSync(join(tmpdir(), "edge-stall-"))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function invalidate() {
  spawnSync(join(ROOT, ".venv/Scripts/python.exe"), ["features.py"], { cwd: ROOT })
  return sleep(20000) // refresh key 變了之後約 15 秒內的第一個請求會先回舊結果
}

spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", "--remote-debugging-port=" + port, "--window-size=1500,1000",
    "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" })
let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break } catch { } await sleep(200) }
const ws = new WebSocket(targets.find((x) => x.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pend = new Map(), sent = new Map(), fromCache = new Set(), rows = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === "Network.requestWillBeSent") sent.set(d.params.requestId, { url: d.params.request.url, t: d.params.timestamp })
  if (d.method === "Network.requestServedFromCache") fromCache.add(d.params.requestId)
  if (d.method === "Network.responseReceived") {
    const r = d.params.response, s = sent.get(d.params.requestId), tm = r.timing
    if (r.fromDiskCache || r.fromPrefetchCache || fromCache.has(d.params.requestId)) return
    if (s && tm && s.url.includes("/api/")) {
      rows.push({
        icon: new URL(s.url).pathname === "/api/icon",
        queued: (tm.requestTime - s.t) * 1000 + tm.sendStart,
        server: tm.receiveHeadersEnd - tm.sendEnd,
        proto: r.protocol,
      })
    }
  }
}
const cdp = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (e) => (await cdp("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value

const sorted = (a) => [...a].sort((x, y) => x - y)
const med = (a) => (sorted(a)[Math.floor(a.length / 2)] ?? 0).toFixed(0).padStart(4)
const max = (a) => (sorted(a)[a.length - 1] ?? 0).toFixed(0).padStart(5)
function report(label) {
  const data = rows.filter((r) => !r.icon), icons = rows.filter((r) => r.icon)
  console.log(`${label.padEnd(10)} 資料請求 ${String(data.length).padStart(2)}：等連線 中位數 ${med(data.map((r) => r.queued))} 最大 ${max(data.map((r) => r.queued))} ms，` +
    `伺服器 中位數 ${med(data.map((r) => r.server))} ms | 圖示 ${String(icons.length).padStart(2)} 個 | ${[...new Set(rows.map((r) => r.proto))]}`)
  rows.length = 0
}

await cdp("Network.enable"); await cdp("Page.enable")
await cdp("Emulation.setFocusEmulationEnabled", { enabled: true })
for (const round of ["第一輪（沒有圖示快取）", "第二輪（圖示已快取）"]) {
  await invalidate()
  console.log(`---- ${round} ----`)
  if (round.startsWith("第一輪")) {
    await cdp("Page.navigate", { url: "http://127.0.0.1:5057/" })
    await sleep(6000)
    report("進站")
  }
  for (const page of PAGES) {
    await ev(`[...document.querySelectorAll('[data-sidebar="menu-button"]')].find(b => b.textContent.trim() === ${JSON.stringify(page)}).click()`)
    await sleep(4000)
    report(page)
  }
}

// 收掉這次開的 Edge 行程（理由見 ui-conventions 的 perf_nav.mjs 結尾）
ws.close()
spawnSync("powershell", ["-NoProfile", "-Command",
  `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${PROFILE.split("\\").pop()}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
  { stdio: "ignore" })
process.exit(0)
