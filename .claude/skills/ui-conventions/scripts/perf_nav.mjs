// 切頁流暢度量測：長任務、動畫期間最長停頓、版面跳動、內容就緒時間。每頁量兩次（首次、回訪）。
// 用法：node perf_nav.mjs [輸出.json] [除錯埠]   （服務要先在 127.0.0.1:5057 跑著）
// 改動前後各跑一次比較；同一台機器、同一份資料才有意義。
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const OUT = process.argv[2] || "perf.json"
const PAGES = ["英雄", "增幅裝置", "隊友 / 對手", "時段", "節奏與連敗", "敗因分析", "對局紀錄", "自由探索", "儀表板"]
const port = +(process.argv[3] || 9450)
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", "--remote-debugging-port=" + port, "--window-size=1500,1000",
    "--user-data-dir=" + mkdtempSync(join(tmpdir(), "edge-perf-")), "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break } catch { } await sleep(200) }
const ws = new WebSocket(targets.find((x) => x.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const cdp = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value

const PROBE = `(() => {
  window.__perf = { long: [], shifts: [], gaps: [] }
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.long.push({ t: e.startTime, d: e.duration }))).observe({ type: "longtask", buffered: false })
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__perf.shifts.push({ t: e.startTime, v: e.value }) })).observe({ type: "layout-shift", buffered: false })
  let last = performance.now()
  const tick = (now) => { window.__perf.gaps.push({ t: now, d: now - last }); last = now; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})()`

await cdp("Page.enable"); await cdp("Runtime.enable")
// 無頭分頁跑久了會被當成背景而停掉 rAF（實測量到幀數 0），固定成有焦點
await cdp("Emulation.setFocusEmulationEnabled", { enabled: true }); await cdp("Page.bringToFront")
await cdp("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: PROBE })
await cdp("Page.navigate", { url: "http://127.0.0.1:5057/" })
await sleep(9000)

const results = []
for (const round of ["首次", "回訪"]) {
  for (const page of PAGES) {
    const t0 = await ev(`(() => { const t = performance.now(); [...document.querySelectorAll('[data-sidebar="menu-button"]')].find(b => b.textContent.trim() === ${JSON.stringify(page)}).click(); return t })()`)
    // 就緒：沒有骨架，而且（若頁面有圖表）每個圖表都有 canvas
    let ready = null
    for (let i = 0; i < 120; i++) {
      const ok = await ev(`(() => document.querySelectorAll('main [data-slot="skeleton"]').length === 0 && [...document.querySelectorAll('div[_echarts_instance_]')].every(d => d.querySelector('canvas')) && !!document.querySelector('main [data-slot="card"]'))()`)
      if (ok) { ready = (await ev("performance.now()")) - t0; break }
      await sleep(25)
    }
    await sleep(Math.max(0, 3000 - (ready ?? 0)))
    const p = await ev(`(() => { const t0 = ${t0}; const P = window.__perf; const inWin = (x) => x.t >= t0 && x.t <= t0 + 3000
      const long = P.long.filter(inWin); const gaps = P.gaps.filter(inWin).map(g => g.d); const shifts = P.shifts.filter(inWin)
      const anim = P.gaps.filter(g => g.t >= t0 && g.t <= t0 + 250).map(g => g.d); const animWorst = Math.round(Math.max(0, ...anim)); const animFrames = anim.length
      gaps.sort((a, b) => b - a)
      return { animWorst, animFrames, longCount: long.length, longTotal: Math.round(long.reduce((a, e) => a + e.d, 0)), longMax: Math.round(Math.max(0, ...long.map(e => e.d))),
        worstFrame: Math.round(gaps[0] ?? 0), framesOver50: gaps.filter(g => g > 50).length, cls: +shifts.reduce((a, s) => a + s.v, 0).toFixed(3) } })()`)
    results.push({ round, page, ready: ready === null ? null : Math.round(ready), ...p })
    console.log(round, page.padEnd(8), "ready", String(Math.round(ready ?? -1)).padStart(5), "ms | long", p.longCount, "tot", p.longTotal, "max", p.longMax, "| 動畫期最長", p.animWorst, "(幀數", p.animFrames, ") | worst frame", p.worstFrame, ">50ms", p.framesOver50, "| CLS", p.cls)
  }
}
writeFileSync(OUT, JSON.stringify(results, null, 1))
ws.close(); edge.kill(); process.exit(0)




