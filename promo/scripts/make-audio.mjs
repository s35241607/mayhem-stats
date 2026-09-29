// 程序合成影片的配樂與音效 → public/audio/track.wav（44.1 kHz 立體聲 16-bit）。
//   用法：node scripts/make-audio.mjs       不需要任何音源素材，也沒有版權問題。
//
// 畫面事件的時間全部從 src/timeline.json 算出來（場景長度、鏡頭停靠點、換圖表、開場問題），
// 改了時間軸只要重跑這支，不用手動對拍點。合成完量測響度，用純線性增益拉到約 -14 LUFS（真峰值不超過 -1.5 dBTP）。
//
// 編曲（A 小調、120 BPM、一小節 2 秒）：
//   開場       心跳式低頻 + 每個問題一記重擊（音高逐次上升）→ 品牌落地 → 一小節的蓄力（鼓組過門、升調）
//   儀表板起   進鼓：四拍底鼓、反拍貝斯、16 分音符琶音、鋪底和弦，第二小節起加拍手
//   後續功能   逐段加料：主旋律、切分和弦、搖沙；每個場景結尾一個鼓組過門；損失分析轉成暗一點的和弦
//   總覽牆     全部疊滿 + 鈸
//   收尾       抽掉鼓，只剩脈衝與和弦 → 標誌落地（全片最大一擊）→ 和弦餘韻淡出
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TL = JSON.parse(readFileSync(join(ROOT, "src", "timeline.json"), "utf8"))
const OUT_DIR = join(ROOT, "public", "audio")
mkdirSync(OUT_DIR, { recursive: true })

const SR = 44100
const FPS = TL.fps
const BEAT = 60 / TL.bpm // 0.5 秒
const BAR = BEAT * 4 // 2 秒
const LEAD = 10 // 與 src/scenes/Feature.tsx 的 LEAD 相同：場景比標稱起點早這麼多幀開始淡入
const f2t = (f) => f / FPS

// ── 時間軸（秒）────────────────────────────────────────────────────────
let cur = TL.introBars
const scenes = TL.featureBars.map((n, i) => {
  const s = { from: cur * BAR, dur: n * BAR, bars: n, firstBar: cur, stops: TL.stopAt[i] }
  cur += n
  return s
})
const wall = { from: cur * BAR, firstBar: cur }
const outro = { from: (cur + TL.wallBars) * BAR, firstBar: cur + TL.wallBars }
const TOTAL_BARS = cur + TL.wallBars + TL.outroBars
const TOTAL = TOTAL_BARS * BAR
const N = Math.ceil(TOTAL * SR)
const brandAt = outro.from + 2 * BAR // 標誌落地

// ── 基礎 ──────────────────────────────────────────────────────────────
let seed = 987654321
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)
const TAU = Math.PI * 2
const mk = () => new Float32Array(N)
const bus = () => ({ L: mk(), R: mk() })
const dry = bus() // 鼓與音效（不被側鏈壓）
const music = bus() // 貝斯、和弦、琶音、旋律（被鼓側鏈壓）
const wet = mk() // 送進殘響的單聲道訊號
const kicks = [] // 側鏈用：所有底鼓時間

/** 在 t0 秒開始，畫 dur 秒；fn(t) 回傳單聲道取樣。pan -1..1；send = 送殘響的比例。 */
function voice(target, t0, dur, gain, pan, fn, send = 0) {
  const i0 = Math.max(0, Math.floor(t0 * SR))
  const n = Math.floor(dur * SR)
  const a = ((pan + 1) * Math.PI) / 4
  const gl = gain * Math.cos(a)
  const gr = gain * Math.sin(a)
  for (let k = 0; k < n && i0 + k < N; k++) {
    const v = fn(k / SR, k)
    target.L[i0 + k] += v * gl
    target.R[i0 + k] += v * gr
    if (send) wet[i0 + k] += v * gain * send
  }
}

// ── 鼓與音效 ───────────────────────────────────────────────────────────
function kick(t0, gain = 1) {
  kicks.push(t0)
  voice(dry, t0, 0.5, gain, 0, (t) => {
    const phase = TAU * (46 * t + 140 * 0.04 * (1 - Math.exp(-t / 0.04)))
    const body = Math.sin(phase) * Math.exp(-t / 0.22)
    const click = rnd() * Math.exp(-t / 0.0028) * 0.4
    return (body + click) * 0.95
  })
}

/** 低頻衝擊：往下滑的正弦 + 一小段噪音。 */
function impact(t0, gain = 1, freq = 52, tail = 1.1, air = 0.4) {
  voice(dry, t0, tail, gain, 0, (t) => {
    const phase = TAU * (freq * 0.72 * t + freq * 0.28 * 0.35 * (1 - Math.exp(-t / 0.35)))
    return Math.sin(phase) * Math.exp(-t / (tail * 0.32)) * 0.95 + rnd() * Math.exp(-t / 0.05) * air
  }, 0.12)
}

function whoosh(t0, dur, gain, f0, f1, pan0 = 0, pan1 = 0, peak = 0.55) {
  const i0 = Math.floor(t0 * SR)
  const n = Math.floor(dur * SR)
  let low = 0
  let band = 0
  for (let k = 0; k < n && i0 + k < N; k++) {
    const p = k / n
    const fc = f0 * (f1 / f0) ** p
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR * 0.4)) / SR)
    const high = rnd() - low - 0.28 * band
    band += f * high
    low += f * band
    const env = p < peak ? (p / peak) ** 2 : (1 - (p - peak) / (1 - peak)) ** 1.6
    const a = (((pan0 + (pan1 - pan0) * p) + 1) * Math.PI) / 4
    const v = band * env * gain
    dry.L[i0 + k] += v * Math.cos(a)
    dry.R[i0 + k] += v * Math.sin(a)
    wet[i0 + k] += v * 0.25
  }
}

const clap = (t0, gain = 0.6) =>
  voice(dry, t0, 0.3, gain, 0, (t) => rnd() * ((t < 0.009 ? 1 : 0) + (t >= 0.011 && t < 0.02 ? 0.9 : 0) + (t >= 0.022 ? Math.exp(-(t - 0.022) / 0.07) : 0)), 0.22)

const snare = (t0, gain = 0.5) => {
  let prev = 0
  voice(dry, t0, 0.22, gain, 0, (t) => {
    const x = rnd()
    const hp = x - 0.6 * prev
    prev = x
    return hp * Math.exp(-t / 0.07) * 0.8 + Math.sin(TAU * 190 * t) * Math.exp(-t / 0.05) * 0.5
  }, 0.15)
}

const hat = (t0, gain = 0.25, open = false, pan = 0.15) => {
  let prev = 0
  voice(dry, t0, open ? 0.35 : 0.08, gain, pan, (t) => {
    const x = rnd()
    const hp = x - prev
    prev = x
    return hp * Math.exp(-t / (open ? 0.12 : 0.02))
  }, open ? 0.12 : 0.03)
}

const shaker = (t0, gain = 0.06, pan = -0.2) => {
  let prev = 0
  voice(dry, t0, 0.06, gain, pan, (t) => {
    const x = rnd()
    const hp = x - 0.5 * prev
    prev = x
    return hp * Math.exp(-t / 0.014)
  })
}

const tick = (t0, gain = 0.3, f = 2600) => voice(dry, t0, 0.06, gain, 0, (t) => Math.sin(TAU * f * t) * Math.exp(-t / 0.011), 0.3)

const bell = (t0, f, gain = 0.25, decay = 1.4, pan = 0) =>
  voice(dry, t0, decay * 3, gain, pan, (t) => Math.sin(TAU * f * t + 3 * Math.exp(-t / 0.5) * Math.sin(TAU * f * 3.5 * t)) * Math.exp(-t / decay), 0.55)

const crash = (t0, gain = 0.4, dur = 1.8) => {
  let prev = 0
  voice(dry, t0, dur, gain, 0, (t) => {
    const x = rnd()
    const hp = x - 0.9 * prev
    prev = x
    return hp * Math.exp(-t / (dur * 0.3))
  }, 0.4)
}

/** 反向鈸／升調蓄力：噪音掃頻 + 上升的正弦。 */
function riser(t0, dur, gain = 0.5) {
  whoosh(t0, dur, gain, 300, 9000, 0, 0, 0.98)
  voice(dry, t0, dur, gain * 0.22, 0, (t) => Math.sin(TAU * (220 * t + (700 / dur) * t * t)) * (t / dur), 0.3)
}

/** 鼓組過門：從 t0 到 t1 之間的 16 分 → 32 分音符小鼓，音量逐漸增強。 */
function fill(t0, t1, gain = 0.5) {
  const n = 8
  for (let k = 0; k < n; k++) {
    const p = k / n
    const dt = (t1 - t0) * (1 - (1 - p) ** 1.6) // 越來越密
    snare(t0 + dt, gain * (0.4 + 0.6 * p))
  }
}

// ── 音色：琶音、貝斯、和弦、旋律 ────────────────────────────────────────────
function pluck(t0, midi, dur, gain, pan) {
  const f = hz(midi)
  voice(music, t0, dur, gain, pan, (t) => {
    let s = 0
    for (let h = 1; h <= 7; h++) s += (Math.sin(TAU * f * h * t) / h) * Math.exp(-t * (7 + 4 * h))
    return s
  }, 0.3)
}

function bass(t0, midi, dur, gain) {
  const f = hz(midi)
  voice(music, t0, dur, gain, 0, (t) => {
    let s = 0
    for (let h = 1; h <= 10; h++) s += (Math.sin(TAU * f * h * t) / h) * Math.exp(-t * h * 3.2)
    return (s * 0.6 + Math.sin(TAU * f * t) * 0.7) * Math.min(1, t / 0.004) * Math.exp(-t / (dur * 0.7))
  })
}

function pad(t0, midis, dur, gain, attack = 0.5, send = 0.45) {
  for (const m of midis) {
    const f = hz(m)
    for (const det of [-0.06, 0.06]) {
      voice(music, t0, dur, gain / midis.length, det > 0 ? 0.4 : -0.4, (t) => {
        const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / 0.4)
        const vib = 1 + 0.002 * Math.sin(TAU * 4.6 * t)
        let s = 0
        for (const h of [1, 3, 5]) s += Math.sin(TAU * (f + det) * vib * h * t) / (h * h)
        return s * env
      }, send)
    }
  }
}

/** 短促的和弦（切分節奏用）。 */
function stab(t0, midis, gain, pan) {
  for (const m of midis) {
    const f = hz(m)
    voice(music, t0, 0.2, gain / midis.length, pan, (t) => {
      let s = 0
      for (let h = 1; h <= 6; h++) s += (Math.sin(TAU * f * h * t) / h) * Math.exp(-t * (10 + 5 * h))
      return s * Math.min(1, t / 0.003)
    }, 0.25)
  }
}

/** 主旋律：鋸齒 + 方波，帶一點顫音，起音快、尾巴短。 */
function lead(t0, midi, dur, gain, pan = 0.1) {
  const f = hz(midi)
  voice(music, t0, dur + 0.15, gain, pan, (t) => {
    const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.2)
    let s = 0
    for (let h = 1; h <= 8; h++) s += (Math.sin(TAU * f * vib * h * t) / h) * (h % 2 ? 1 : 0.5) * Math.exp(-t * h * 0.9)
    const env = Math.min(1, t / 0.008) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.05))
    return s * env
  }, 0.4)
}

const drone = (t0, dur, gain, fs) =>
  voice(dry, t0, dur, gain, 0, (t) => fs.reduce((s, f) => s + Math.sin(TAU * f * t), 0) * Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.5), 0.3)

// ── 和弦與旋律（A 小調）────────────────────────────────────────────────────
const AM = { root: 33, tri: [57, 60, 64, 69], gesture: [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 69, 1]] }
const F = { root: 29, tri: [53, 57, 60, 65], gesture: [[0, 77, 1.5], [1.5, 76, 0.5], [2, 72, 1], [3, 69, 1]] }
const C = { root: 36, tri: [60, 64, 67, 72], gesture: [[0, 79, 1.5], [1.5, 76, 0.5], [2, 74, 1], [3, 72, 1]] }
const G = { root: 31, tri: [55, 59, 62, 67], gesture: [[0, 79, 1.5], [1.5, 74, 0.5], [2, 71, 1], [3, 67, 1]] }
const DM = { root: 38, tri: [50, 53, 57, 62], gesture: [[0, 74, 1.5], [1.5, 72, 0.5], [2, 69, 1], [3, 65, 1]] }
const E = { root: 28, tri: [52, 56, 59, 64], gesture: [[0, 76, 1.5], [1.5, 74, 0.5], [2, 71, 1], [3, 68, 1]] }
const BRIGHT = [AM, F, C, G]
const DARK = [DM, F, AM, E]

/** 每一小節「疊哪些層」。b = 小節序號（從 0 起）。 */
function plan(b) {
  const groove0 = scenes[0].firstBar
  const off = (k) => scenes[k].firstBar
  const base = { kick: 0, clap: 0, hat: 0, bass: 0, arp: 0, pad: 0, lead: 0, stab: 0, shaker: 0, chords: BRIGHT, ci: b }
  if (b < TL.introBars - 1) return { ...base, sub: 1 } // 開場：只有心跳與低鳴
  if (b === TL.introBars - 1) return { ...base, pad: 1, arp: 0.6, kick: 0.5 } // 品牌：柔和
  if (b < scenes[1].firstBar) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: b > groove0 ? 1 : 0, ci: b - groove0 } // 儀表板
  if (b < off(2)) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1, ci: b - off(1) } // 英雄
  if (b < off(3)) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1, stab: 1, shaker: 1, ci: b - off(2) } // 增幅
  if (b < off(4)) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1.5, stab: 1, shaker: 1, ci: b - off(3) } // 陣容
  if (b < off(5)) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1, stab: 1, shaker: 1, ci: b - off(4) } // 時段
  if (b < off(6)) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1, stab: 1, shaker: 1, chords: DARK, ci: b - off(5) } // 敗因分析（暗一點）
  if (b < wall.firstBar) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1.5, stab: 1, shaker: 1, ci: b - off(6) } // 自由探索
  if (b < outro.firstBar) return { ...base, kick: 1, hat: 1, bass: 1, arp: 1, pad: 1, clap: 1, lead: 1.5, stab: 1, shaker: 1, ci: b - wall.firstBar } // 總覽牆
  if (b === outro.firstBar) return { ...base, kick: 0.7, bass: 1, arp: 1, pad: 1, ci: 0 } // 自動採集：抽掉拍手與高帽
  if (b === outro.firstBar + 1) return { ...base, kick: 0.5, bass: 1, arp: 0.7, pad: 1, ci: 1 } // 資料留在你的電腦：更空
  return { ...base } // 標誌與收尾：只有下面明確放的 Am(add9) 和弦與鈴聲，不再疊別的和弦
}

// ── 編曲：逐小節 ───────────────────────────────────────────────────────
const STAB_STEPS = [0, 3, 6, 8, 11, 14] // 3+3+2 的切分節奏（16 分音符格）
const lastGrooveBar = outro.firstBar - 1
for (let b = 0; b < TOTAL_BARS; b++) {
  const t = b * BAR
  const p = plan(b)
  const ch = p.chords[((p.ci % 4) + 4) % 4]
  if (p.sub) {
    // 心跳：每兩拍一下低頻，逐漸變重
    for (const beat of [0, 2]) kick(t + beat * BEAT, 0.28 + 0.18 * b)
    if (b === 0) drone(0, 3 * BAR, 0.06, [55, 82.4, 110])
  }
  if (p.pad) pad(t, ch.tri.slice(0, 3), BAR, 0.16 * (b >= outro.firstBar + 2 ? 1.5 : 1), 0.45)
  for (let beat = 0; beat < 4; beat++) {
    const tb = t + beat * BEAT
    if (p.kick && !(b === wall.firstBar + TL.wallBars - 1 && beat === 3) && !(b === outro.firstBar + 1 && beat >= 2)) kick(tb, 0.9 * Math.min(1, p.kick))
    if (p.clap && (beat === 1 || beat === 3)) clap(tb, 0.5)
    if (p.hat) {
      hat(tb + BEAT / 2, 0.2 + (beat % 2) * 0.04)
      hat(tb + BEAT / 4, 0.07, false, -0.2)
      hat(tb + (BEAT * 3) / 4, 0.09, false, 0.3)
    }
    if (p.bass) {
      bass(tb + BEAT / 2, ch.root, 0.24, 0.42)
      if (p.shaker && beat % 2) bass(tb + BEAT * 0.75, ch.root + 12, 0.14, 0.2) // 偶爾跳八度，讓貝斯有律動
    }
  }
  if (p.hat) hat(t + BAR - BEAT / 4, 0.22, true)
  if (p.shaker) for (let s = 0; s < 16; s++) shaker(t + s * (BEAT / 4), s % 4 === 2 ? 0.09 : 0.05, s % 2 ? 0.3 : -0.3)
  if (p.arp) {
    const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2]
    for (let s = 0; s < 16; s++) pluck(t + s * (BEAT / 4), ch.tri[order[s]] + 12, 0.3, 0.085 * Math.min(1, p.arp), s % 2 ? 0.45 : -0.45)
  }
  if (p.stab) for (const s of STAB_STEPS) stab(t + s * (BEAT / 4), ch.tri.slice(0, 3).map((m) => m + 12), 0.2, s % 2 ? 0.4 : -0.4)
  if (p.lead) for (const [beat, m, len] of ch.gesture) lead(t + beat * BEAT, m + (p.lead > 1 ? 12 : 0), len * BEAT - 0.05, 0.11 * Math.min(1, p.lead))
}

// ── 場景轉場與每一個畫面事件 ────────────────────────────────────────────────
// 開場：問題落在拍點上，音高逐次上升
const QNOTES = [69, 72, 76]
TL.questionAt.forEach((f, i) => {
  const t = f2t(f)
  impact(t, 0.75 + 0.1 * i, 56 + i * 4, 0.8, 0.45)
  bell(t, hz(QNOTES[i] + 12), 0.2, 1.1, (i - 1) * 0.3)
  whoosh(t - 0.06, 0.2, 0.22, 1500, 6500)
})
whoosh(f2t(2), 0.18, 0.12, 2000, 7000)
whoosh(f2t(116) - 0.05, 0.35, 0.3, 6000, 500, 0, 0, 0.2) // 問題往上滑出
riser(3.0, 1.0, 0.45)
fill(3.5, 3.98, 0.45)
// 品牌落地（第 3 小節起點）
const brandStart = (TL.introBars - 1) * BAR
impact(brandStart, 1.0, 46, 1.4, 0.55)
crash(brandStart, 0.35, 1.8)
pad(brandStart, [57, 60, 64, 71], BAR, 0.28, 0.08, 0.7)
for (const [dt, m, g] of [[0, 81, 0.18], [0.09, 84, 0.14], [0.18, 88, 0.14]]) bell(brandStart + dt, hz(m), g, 1.5, dt ? 0.3 : -0.3)
whoosh(brandStart + 0.15, 0.2, 0.12, 2000, 7000)
whoosh(brandStart + 0.6, 0.2, 0.12, 2000, 7000)
// 進儀表板前的蓄力：最後一小節的後半
riser(brandStart + BAR - 1.0, 1.0, 0.55)
fill(brandStart + BAR - 0.5, brandStart + BAR - 0.02, 0.5)

scenes.forEach((s, i) => {
  const S = s.from
  const leadT = LEAD / FPS
  if (i === 0) {
    impact(S, 1.0, 48, 1.4, 0.55) // 落鼓
    crash(S, 0.45, 2.0)
  } else {
    whoosh(S - leadT - 0.35, 0.5, 0.35, 300, 6000, -0.4, 0.4, 0.9)
    impact(S, 0.7, 54, 0.9, 0.4)
    crash(S, 0.22, 1.4)
  }
  // 鼓組過門：場景最後半拍
  if (i > 0) fill(S - BEAT, S - 0.02, 0.4)
  whoosh(S + 8 / FPS, 0.16, 0.14, 2500, 9000) // 標題
  // 要點出現
  s.stops.forEach((_, j) => tick(S + (34 + j * 9 + 16) / FPS, 0.12, 2000 + j * 300))
  // 鏡頭停靠點：先一道掃頻，光圈出現時一聲清脆的叮
  s.stops.forEach((at, j) => {
    whoosh(S + (at - 8) / FPS, 0.5, 0.3, 500, 5000, j % 2 ? 0.5 : -0.5, j % 2 ? -0.5 : 0.5, 0.4)
    const t = S + (at + 14) / FPS
    tick(t, 0.26, 3100)
    bell(t, hz(93 + j * 2), 0.09, 0.8, 0)
  })
  // 換圖表
  if (i === scenes.length - 1) {
    const t = S + TL.swapAt / FPS
    whoosh(t - 0.05, 0.3, 0.3, 800, 7000)
    tick(t + 0.05, 0.25, 2400)
    tick(t + 0.13, 0.2, 3000)
  }
})

// 總覽牆：全部疊滿，數字跳動與五個標籤
{
  const S = wall.from
  whoosh(S - leadT() - 0.35, 0.5, 0.4, 300, 7000, -0.5, 0.5, 0.9)
  impact(S, 0.8, 52, 1.0, 0.45)
  crash(S, 0.4, 2.0)
  for (let k = 1; k <= 12; k++) {
    const tau = -Math.log2(1 - (k - 0.5) / 12) / 10 // Wall.tsx：n = 12 * (1 - 2^(-10t))
    tick(S + (8 + 22 * tau) / FPS, 0.2, 1500 + k * 150)
  }
  for (let i = 0; i < 5; i++) tick(S + (38 + i * 6 + 6) / FPS, 0.16, 2400 + i * 160)
  riser(outro.from - 1.2, 1.2, 0.5)
  fill(outro.from - 0.5, outro.from - 0.02, 0.5)
}
function leadT() { return LEAD / FPS }

// 收尾
{
  const S = outro.from
  impact(S, 0.8, 54, 0.8, 0.45)
  whoosh(S + 4 / FPS, 0.18, 0.15, 2500, 9000)
  impact(S + 20 / FPS, 0.9, 50, 1.0, 0.5)
  bell(S + 20 / FPS, hz(93), 0.14, 1.0)
  const S2 = S + BAR
  impact(S2, 0.7, 54, 0.8, 0.45)
  whoosh(S2 + 4 / FPS, 0.18, 0.15, 2500, 9000)
  impact(S2 + 20 / FPS, 0.9, 48, 1.0, 0.5)
  riser(brandAt - 1.0, 1.0, 0.5)
  // 標誌落地：全片最大一擊
  impact(brandAt, 1.0, 44, 2.4, 0.6)
  crash(brandAt, 0.5, 2.8)
  pad(brandAt, [57, 60, 64, 71], 2 * BAR, 0.34, 0.08, 0.7) // Am(add9)
  for (const [dt, m, g] of [[0, 81, 0.2], [0.09, 84, 0.16], [0.18, 88, 0.16], [0.32, 93, 0.12]]) bell(brandAt + dt, hz(m), g, 1.8, dt ? 0.3 : -0.3)
  whoosh(brandAt + 8 / FPS, 0.2, 0.14, 2500, 9000)
  bell(brandAt + 26 / FPS, hz(88), 0.12, 1.0)
  tick(brandAt + 48 / FPS, 0.18, 3200)
}

// ── 殘響 ──────────────────────────────────────────────────────────────
function reverb(input, delays, fb, damp) {
  const out = mk()
  const combs = delays.map((d) => ({ buf: new Float32Array(Math.floor((d / 1000) * SR)), i: 0, lp: 0 }))
  const aps = [5.0, 1.7].map((d) => ({ buf: new Float32Array(Math.floor((d / 1000) * SR)), i: 0 }))
  for (let n = 0; n < N; n++) {
    let s = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.lp = y * (1 - damp) + c.lp * damp
      c.buf[c.i] = input[n] + c.lp * fb
      c.i = (c.i + 1) % c.buf.length
      s += y
    }
    s *= 0.25
    for (const a of aps) {
      const y = a.buf[a.i]
      const v = s + y * -0.7
      a.buf[a.i] = s + y * 0.7
      a.i = (a.i + 1) % a.buf.length
      s = y + v * 0.7
    }
    out[n] = s
  }
  return out
}
const verbL = reverb(wet, [29.7, 37.1, 41.1, 43.7], 0.82, 0.35)
const verbR = reverb(wet, [31.3, 38.9, 42.7, 46.1], 0.82, 0.35)

// ── 混音：側鏈壓縮、殘響、軟削波、淡出 ─────────────────────────────────────────
const duck = new Float32Array(N).fill(1)
for (const kt of kicks) {
  const i0 = Math.floor(kt * SR)
  for (let k = 0; k < 0.3 * SR && i0 + k < N; k++) duck[i0 + k] = Math.min(duck[i0 + k], 1 - 0.72 * Math.exp(-k / SR / 0.11))
}
// 段落音量：開場壓低（蓄力），進鼓那一刻跳一階，總覽牆再推高，收尾前收一下，標誌落地最響。
// 響度最後會被 loudnorm 統一校正到 -14 LUFS，所以這裡要的是「段落之間的對比」，不是絕對音量。
const J = 0.02 // 瞬間跳階用的過渡秒數
const ENV = [
  [0, 0.42], [brandStart - J, 0.5], [brandStart, 0.78], // 開場 → 品牌落地
  [scenes[0].from - J, 0.8], [scenes[0].from, 1.0], // 進鼓
  [wall.from - J, 1.0], [wall.from, 1.16], // 總覽牆
  [outro.from - J, 1.16], [outro.from, 0.8], // 收尾前收一下
  [brandAt - J, 0.8], [brandAt, 1.12], [TOTAL, 1.12],
]
const envAt = (t) => {
  if (t <= ENV[0][0]) return ENV[0][1]
  for (let i = 1; i < ENV.length; i++) if (t <= ENV[i][0]) return ENV[i - 1][1] + ((ENV[i][1] - ENV[i - 1][1]) * (t - ENV[i - 1][0])) / (ENV[i][0] - ENV[i - 1][0])
  return ENV[ENV.length - 1][1]
}
const L = mk()
const R = mk()
for (let n = 0; n < N; n++) {
  const t = n / SR
  const g = envAt(t) * Math.min(1, Math.max(0, (TOTAL - t) / 0.6))
  L[n] = Math.tanh((dry.L[n] + music.L[n] * duck[n] + verbL[n] * 0.45) * 0.9 * g) / Math.tanh(0.9)
  R[n] = Math.tanh((dry.R[n] + music.R[n] * duck[n] + verbR[n] * 0.45) * 0.9 * g) / Math.tanh(0.9)
}

function wav(l, r, gain = 1) {
  const buf = Buffer.alloc(44 + N * 4)
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write("data", 36); buf.writeUInt32LE(N * 4, 40)
  for (let n = 0; n < N; n++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[n] * gain * 32767))), 44 + n * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[n] * gain * 32767))), 46 + n * 4)
  }
  return buf
}

// 先把峰值拉到 -3 dBFS，再交給 ffmpeg loudnorm 校正響度。
let peak = 0
for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]))
const raw = join(OUT_DIR, "_raw.wav")
const final = join(OUT_DIR, "track.wav")
writeFileSync(raw, wav(L, R, 0.708 / peak))

const ff = (args) => spawnSync("npx", ["remotion", "ffmpeg", "-hide_banner", "-nostats", ...args], { cwd: ROOT, shell: true, encoding: "utf8" })
const target = { I: -14, TP: -1.5 }
// 只量測，不用 loudnorm 處理：它的「線性模式」在量測值超出範圍時會悄悄改成動態模式，
// 把安靜的段落拉高，段落之間的音量對比就被抹掉了。這裡自己算一個純線性增益：
// 拉到目標響度，但不能讓真峰值超過 -1.5 dBTP。
const pass1 = ff(["-i", raw, "-af", `loudnorm=I=${target.I}:TP=${target.TP}:print_format=json`, "-f", "null", "-"])
const json = /\{[\s\S]*"target_offset"[\s\S]*?\}/.exec(pass1.stderr + pass1.stdout)
if (!json) {
  console.warn("響度量測失敗，改用峰值正規化的版本")
  writeFileSync(final, readFileSync(raw))
} else {
  const m = JSON.parse(json[0])
  const gainDb = Math.min(target.I - Number(m.input_i), target.TP - Number(m.input_tp))
  console.log(`量測：${m.input_i} LUFS、真峰值 ${m.input_tp} dBTP、響度範圍 ${m.input_lra} LU → 線性增益 ${gainDb.toFixed(2)} dB（約 ${(Number(m.input_i) + gainDb).toFixed(1)} LUFS）`)
  const pass2 = ff(["-y", "-i", raw, "-af", `volume=${gainDb}dB`, "-ar", String(SR), "-c:a", "pcm_s16le", final])
  if (pass2.status !== 0) { console.error(pass2.stderr); process.exit(1) }
}
unlinkSync(raw)
console.log(`→ ${final}（${TOTAL.toFixed(1)} 秒，${TOTAL_BARS} 小節）`)
