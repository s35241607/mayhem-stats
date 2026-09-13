import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const THEME = process.argv[2]
const PAGES = (process.argv[3] || "儀表板,時段").split(",")
// 用法：node theme_check.mjs <主題 id> ["頁面,頁面"]   輸出 th_<主題>_<序號>.png 與 hover 例外數
// 主題 id 見 web/src/lib/theme.tsx。四個以上同時跑會互搶 CPU，最多兩三個平行。
const port = 9420 + Math.max(0, ["neon", "matrix", "lava", "violet", "daylight", "mint", "sakura", "sand"].indexOf(THEME))
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", "--remote-debugging-port=" + port, "--window-size=1500,1000",
    "--user-data-dir=" + mkdtempSync(join(tmpdir(), "edge-th-")), "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break } catch { } await sleep(200) }
const ws = new WebSocket(targets.find((x) => x.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map(); const errors = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === "Runtime.exceptionThrown") errors.push((d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).split("\n")[0])
}
const cdp = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value
await cdp("Page.enable"); await cdp("Runtime.enable")
await cdp("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("mayhem-theme", ${JSON.stringify(THEME)}) } catch {}` })
await cdp("Page.navigate", { url: "http://127.0.0.1:5057/" })
await sleep(7000)
const report = { theme: await ev(`document.documentElement.dataset.theme`), pages: {} }
for (const page of PAGES) {
  await ev(`[...document.querySelectorAll('[data-sidebar="menu-button"]')].find(b => b.textContent.trim() === ${JSON.stringify(page)}).click()`)
  await sleep(6000)
  await sleep(1500)
  const before = errors.length
  // 每張圖掃一排 hover
  const n = await ev(`document.querySelectorAll('div[_echarts_instance_]').length`)
  for (let i = 0; i < n; i++) {
    const r = await ev(`(() => { const e = document.querySelectorAll('div[_echarts_instance_]')[${i}]; e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()`)
    for (const fx of [0.2, 0.5, 0.8, 0.95]) for (const fy of [0.3, 0.6, 0.85])
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(r[0] + r[2] * fx), y: Math.round(r[1] + r[3] * fy) })
  }
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 })
  await ev(`window.scrollTo(0, 0)`); await sleep(900)
  const shot = await cdp("Page.captureScreenshot", { format: "png" })
  writeFileSync(`th_${THEME}_${PAGES.indexOf(page)}.png`, Buffer.from(shot.result.data, "base64"))
  report.pages[page] = { charts: n, hoverErrors: errors.length - before }
}
report.errors = [...new Set(errors)]
console.log(JSON.stringify(report))
ws.close(); edge.kill(); process.exit(0)


