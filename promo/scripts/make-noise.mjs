// 產生 public/noise.png：256×256 的低透明度灰階噪點，疊在深色背景上抖色，
// 避免 H.264 在暗部漸層出現色帶。用固定種子，重跑會得到同一張圖。
import { deflateSync } from "node:zlib"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const N = 256
let seed = 20260929
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

const raw = Buffer.alloc(N * (1 + N * 4))
for (let y = 0; y < N; y++) {
  const row = y * (1 + N * 4)
  raw[row] = 0
  for (let x = 0; x < N; x++) {
    const v = Math.round(rnd() * 255)
    const o = row + 1 + x * 4
    raw[o] = raw[o + 1] = raw[o + 2] = v
    raw[o + 3] = 11 // 約 4% 不透明
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "noise.png")
writeFileSync(out, png)
console.log("noise.png", png.length, "bytes")
