// 把影片用到的字形切片下載到 public/fonts/，之後渲染不再連網，也不必每個分頁抓 300 個字型檔。
//   用法：node scripts/fetch-fonts.mjs        （改了 src 裡的文字後重跑，缺的字會補進來）
// 做法：掃 src/**/*.tsx 裡出現過的所有字元 → 對照 Google Fonts 各切片的 Unicode 範圍 → 只下載命中的切片。
// 字型授權為 OFL（Noto Sans TC、Geist、Geist Mono），可以隨 repo 散布。
import { createRequire } from "node:module"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "public", "fonts")
mkdirSync(OUT, { recursive: true })

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const used = new Set()
// 註解裡的中文不會出現在畫面上，先剔掉，否則會多下載一堆用不到的切片。
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
for (const file of walk(join(ROOT, "src")).filter((p) => /\.tsx?$/.test(p))) for (const ch of stripComments(readFileSync(file, "utf8"))) used.add(ch.codePointAt(0))
// 數字與基本標點永遠帶著（動畫裡的計數會用到）
for (let c = 0x20; c < 0x7f; c++) used.add(c)

const parseRange = (s) => s.split(",").map((r) => r.trim().replace(/^U\+/i, "")).map((r) => {
  const [a, b] = r.split("-")
  return [parseInt(a, 16), parseInt(b ?? a, 16)]
})
const hit = (ranges) => ranges.some(([a, b]) => [...used].some((c) => c >= a && c <= b))

const FAMILIES = [
  { pkg: "NotoSansTC", name: "PromoNoto", weights: ["700", "900"] },
  { pkg: "Geist", name: "PromoGeist", weights: ["500", "700", "800", "900"] },
  { pkg: "GeistMono", name: "PromoGeistMono", weights: ["500", "700", "800"] },
]

const manifest = []
for (const fam of FAMILIES) {
  const info = require(`@remotion/google-fonts/${fam.pkg}`).getInfo()
  for (const w of fam.weights) {
    for (const [key, url] of Object.entries(info.fonts.normal[w])) {
      const range = info.unicodeRanges[key]
      if (!range || !hit(parseRange(range))) continue
      const file = `${fam.name}-${w}-${key.replace(/[^a-z0-9]/gi, "")}.woff2`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url} → ${res.status}`)
      writeFileSync(join(OUT, file), Buffer.from(await res.arrayBuffer()))
      manifest.push({ family: fam.name, weight: w, file, range })
    }
  }
  console.log(fam.name, manifest.filter((m) => m.family === fam.name).length, "個切片")
}
writeFileSync(join(OUT, "fonts.json"), JSON.stringify(manifest, null, 1))
const bytes = manifest.reduce((n, m) => n + statSync(join(OUT, m.file)).size, 0)
console.log(`共 ${manifest.length} 個檔、${(bytes / 1024).toFixed(0)} KB → ${OUT}`)
