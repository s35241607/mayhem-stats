import type { ReactNode } from "react"
import { ArrowRight, BarChart3, Gauge, Scale, Sparkles, Ruler } from "lucide-react"
import { WORK_BASE, WORK_GAP, WORK_MODS, WORK_PARTS } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { WORK_SD } from "@/lib/gap"
import { cn } from "@/lib/utils"

/** 「分數怎麼算」頁的圖。全部是內嵌 SVG／HTML：顏色只用主題 token（fill-win、text-muted-foreground…），
 *  不帶圖表庫——這些是說明用的示意圖，不是資料圖表，不需要 hover、縮放與動畫。
 *  定位比重從 WORK_PARTS 的文字解析，名稱與數字只有 hooks/useContribution.ts 一份。 */

// ── 1. 一張圖看懂：五個步驟 ──────────────────────────────

const STEPS: { icon: typeof Gauge; title: string; body: string }[] = [
  { icon: BarChart3, title: "量這場做了什麼", body: "輸出、承傷、參團、控場……九項，全換成每分鐘" },
  { icon: Scale, title: "和同定位比", body: "射手比射手、坦克比坦克：高於常態加分、低於扣分" },
  { icon: Gauge, title: "依定位加權", body: "射手最看輸出、坦克最看參團與承傷" },
  { icon: Sparkles, title: "高光與失誤", body: "多殺、單人拆塔加分；被單抓、隱身扣分" },
  { icon: Ruler, title: "校正成 0～100", body: "從 50 加減，最後裁進 0～100" },
]

export function ScoreFlow() {
  return (
    <ol className="grid gap-1.5 md:grid-cols-[repeat(5,minmax(0,1fr))] md:gap-0">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex flex-col items-stretch md:flex-row md:items-center">
          <div className="flex flex-1 items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2.5 md:h-full md:flex-col md:items-start md:gap-2 md:p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <s.icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">
                <span className="mr-1 font-mono text-primary">{i + 1}</span>
                {s.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{s.body}</span>
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <span className="hidden justify-center text-muted-foreground md:flex md:px-1" aria-hidden>
                            <ArrowRight className="size-4" />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

// ── 2. 分數尺：0～100，50 附近的灰帶是「差不多」 ─────────────

/** 校準時的平均（docs/contribution-scoring.md 2026-11-15 的實測），只當示意 */
const MARKS = [
  { at: 49.5, label: "全體平均", up: true },
  { at: 53.5, label: "坦克・輔助", up: false },
  { at: 47, label: "刺客・法師", up: false },
]

export function ScoreScale() {
  const W = 360
  const x = (v: number) => 12 + (v / 100) * (W - 24)
  return (
    <svg viewBox={`0 0 ${W} 92`} className="mx-auto block w-full max-w-[540px]" role="img" aria-label={`0 到 100 的分數尺，50 是一般水準，和 50 差不到 ${WORK_GAP} 分當作一樣`}>
      {/* 整條 */}
      <rect x={x(0)} y={40} width={x(50) - x(0)} height={10} rx={5} className="fill-loss/35" />
      <rect x={x(50)} y={40} width={x(100) - x(50)} height={10} rx={5} className="fill-win/35" />
      {/* 差不多的灰帶 */}
      <rect x={x(50 - WORK_GAP)} y={36} width={x(50 + WORK_GAP) - x(50 - WORK_GAP)} height={18} rx={3} className="fill-muted-foreground/45" />
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={54} y2={60} className="stroke-muted-foreground" />
          <text x={x(v)} y={72} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            {v}
          </text>
        </g>
      ))}
      {MARKS.map((m) => (
        <g key={m.label}>
          <line x1={x(m.at)} x2={x(m.at)} y1={m.up ? 30 : 50} y2={m.up ? 40 : 82} className="stroke-foreground/60" strokeDasharray={m.up ? undefined : "2 2"} />
          <text
            x={x(m.at) + (m.at > 50 ? 3 : m.at < 49 ? -3 : 0)}
            y={m.up ? 24 : 90}
            textAnchor={m.at > 50 ? "start" : m.at < 49 ? "end" : "middle"}
            className="fill-foreground text-[10px]"
          >
            {m.label} {m.at}
          </text>
        </g>
      ))}
      <text x={x(14)} y={24} textAnchor="middle" className="fill-loss text-[10px] font-semibold">
        低於一般
      </text>
      <text x={x(86)} y={24} textAnchor="middle" className="fill-win text-[10px] font-semibold">
        高於一般
      </text>
    </svg>
  )
}

// ── 3. 和同定位比：鐘形分布、中位數、四分位距、壓縮過的尾端 ────────────

export function BellCompare() {
  const W = 360
  const H = 150
  const base = 112
  const x0 = 20
  const x1 = W - 20
  const mid = (x0 + x1) / 2
  // 常態曲線（示意）
  const pts: string[] = []
  for (let i = 0; i <= 80; i++) {
    const t = -3 + (6 * i) / 80
    const px = mid + (t / 3) * ((x1 - x0) / 2)
    const py = base - 82 * Math.exp((-t * t) / 2)
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`)
  }
  const iqr = ((x1 - x0) / 2) * (0.674 / 3)
  const you = mid + ((x1 - x0) / 2) * (1.3 / 3)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[540px]" role="img" aria-label="和同出裝定位的跨場常態比：高於中位數加分、低於扣分，極端值會被壓縮">
      <rect x={mid - iqr} y={20} width={iqr * 2} height={base - 20} className="fill-primary/10" />
      <polyline points={`${x0},${base} ${pts.join(" ")} ${x1},${base}`} className="fill-primary/15 stroke-primary" strokeWidth={1.5} />
      <line x1={x0} x2={x1} y1={base} y2={base} className="stroke-muted-foreground" />
      <line x1={mid} x2={mid} y1={22} y2={base} className="stroke-foreground/70" strokeDasharray="3 3" />
      <text x={mid} y={14} textAnchor="middle" className="fill-foreground text-[10px]">
        同定位的中位數
      </text>
      <text x={mid - iqr - 2} y={base - 4} textAnchor="end" className="fill-muted-foreground text-[9px]">
        中間一半的人
      </text>
      {/* 你的這一項 */}
      <line x1={you} x2={you} y1={36} y2={base} className="stroke-win" strokeWidth={2} />
      <circle cx={you} cy={36} r={4} className="fill-win" />
      <text x={you + 6} y={40} className="fill-win text-[11px] font-semibold">
        你這場 → 加分
      </text>
      {/* 尾端壓縮 */}
      <text x={x1} y={base - 26} textAnchor="end" className="fill-muted-foreground text-[9px]">
        太極端的會被壓縮
      </text>
      <text x={x0} y={base + 18} className="fill-loss text-[10px]">
        ← 低於常態，扣分
      </text>
      <text x={x1} y={base + 18} textAnchor="end" className="fill-win text-[10px]">
        高於常態，加分 →
      </text>
      <text x={mid} y={base + 34} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        每一項都先換算成每分鐘的量，並以 16.5 分鐘為基準修正對局長短
      </text>
    </svg>
  )
}

// ── 4. 定位比重：六個定位 × 九項的熱力表（解析 WORK_PARTS.weight 的文字） ─────────

const ROLES = [
  { key: "射", label: "射手" },
  { key: "刺", label: "刺客" },
  { key: "法", label: "法師" },
  { key: "鬥", label: "鬥士" },
  { key: "坦", label: "坦克" },
  { key: "輔", label: "輔助" },
] as const

type Cell = { pct: number; note: "" | "+" | "≤" | "≥" } | { unlock: true } | null

/** 「刺 41% · 射/刺 10% · 輔 ≤40% · 鬥 28%+ · 坦/輔高傷解鎖」→ 每個定位一格 */
function parseWeights(text: string): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  for (const m of text.matchAll(/([射刺法鬥坦輔](?:\/[射刺法鬥坦輔])*)\s*([≤≥]?)(\d+)%(\+?)/g)) {
    for (const r of m[1].split("/")) out[r] = { pct: Number(m[3]), note: (m[4] || m[2]) as "" | "+" | "≤" | "≥" }
  }
  for (const m of text.matchAll(/([射刺法鬥坦輔](?:\/[射刺法鬥坦輔])*)高傷解鎖/g)) {
    for (const r of m[1].split("/")) if (!out[r]) out[r] = { unlock: true }
  }
  return out
}

export function RoleWeightMatrix() {
  const rows = WORK_PARTS.filter((p) => /\d+%/.test(p.weight)).map((p) => ({ label: p.label, cells: parseWeights(p.weight) }))
  return (
    <div className="space-y-2">
      <div>
        {/* 等寬欄：手機 390px 也放得下六欄，不用橫拉 */}
        <table className="w-full table-fixed border-separate border-spacing-0.5 text-center text-[11px] sm:text-xs">
          <thead>
            <tr>
              <th className="w-[3.6rem] sm:w-16" />
              {ROLES.map((r) => (
                <th key={r.key} className="pb-1 font-medium text-muted-foreground">
                  <span className="sm:hidden">{r.key}</span>
                  <span className="max-sm:hidden">{r.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th className="truncate pr-1 text-right font-medium">{row.label}</th>
                {ROLES.map((r) => {
                  const c = row.cells[r.key]
                  if (!c) return <td key={r.key} className="h-9 rounded-md bg-muted/20 text-muted-foreground/50">—</td>
                  if ("unlock" in c)
                    return (
                      <td key={r.key} className="h-9 rounded-md border border-dashed border-primary/40 text-[10px] leading-tight text-primary" data-tip="平常不算，這場打出高傷害時才開始算">
                        高傷
                        <br />
                        才算
                      </td>
                    )
                  return (
                    <td
                      key={r.key}
                      className={cn("h-9 rounded-md font-mono tabular-nums", c.pct >= 25 && "font-semibold")}
                      style={{ background: `color-mix(in oklab, var(--primary) ${Math.round(Math.min(c.pct, 45) * 1.6)}%, transparent)` }}
                      data-tip={
                        c.note === "+" ? "打出高傷害時這一項的比重會再加大" : c.note === "≤" ? "最多到這個比重" : c.note === "≥" ? "至少這個比重" : undefined
                      }
                    >
                      {c.note === "≤" || c.note === "≥" ? c.note : ""}
                      {c.pct}%{c.note === "+" ? "+" : ""}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        顏色越深、這個定位越看重那一項。「+」＝打出高傷害時比重再加大；「—」＝這個定位不算這一項。射＝射手、刺＝刺客、法＝法師、鬥＝鬥士、坦＝坦克、輔＝輔助。定位看的是你這場的出裝，不是英雄本身的標籤。
      </p>
    </div>
  )
}

// ── 5. 加分與扣分的範圍 ──────────────────────────────

export function ModRange() {
  const W = 360
  const lo = -18
  const hi = 15
  const x = (v: number) => 16 + ((v - lo) / (hi - lo)) * (W - 32)
  return (
    <svg viewBox={`0 0 ${W} 70`} className="mx-auto block w-full max-w-[540px]" role="img" aria-label="失誤扣分最多扣 18 分，高光加分最多加 15 分">
      <rect x={x(lo)} y={22} width={x(0) - x(lo)} height={14} rx={4} className="fill-loss/70" />
      <rect x={x(0)} y={22} width={x(hi) - x(0)} height={14} rx={4} className="fill-win/70" />
      <line x1={x(0)} x2={x(0)} y1={14} y2={44} className="stroke-foreground" strokeWidth={1.5} />
      <text x={x(lo)} y={14} className="fill-loss text-[11px] font-semibold">
        失誤扣分 最多 −18
      </text>
      <text x={x(hi)} y={14} textAnchor="end" className="fill-win text-[11px] font-semibold">
        高光加分 最多 +15
      </text>
      {[lo, -9, 0, 7, hi].map((v) => (
        <text key={v} x={x(v)} y={58} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
          {v > 0 ? `+${v}` : v}
        </text>
      ))}
    </svg>
  )
}

// ── 6. 差距要多大才算數：誤差帶隨場數變窄 ──────────────────────

export function ErrorFunnel() {
  const W = 360
  const H = 170
  const padL = 30
  const padR = 12
  const top = 14
  const bottom = H - 30
  const N = 100
  // 橫軸用平方根刻度：前面幾場變化最大，拉開來看
  const x = (n: number) => padL + (Math.sqrt(n) / Math.sqrt(N)) * (W - padL - padR)
  const y = (v: number) => top + ((75 - v) / 50) * (bottom - top)
  const half = (n: number) => (1.96 * WORK_SD) / Math.sqrt(n)
  const ns = Array.from({ length: 60 }, (_, i) => 1 + ((N - 1) * i * i) / (59 * 59))
  const upper = ns.map((n) => `${x(n).toFixed(1)},${y(Math.min(75, 50 + half(n))).toFixed(1)}`)
  const lower = [...ns].reverse().map((n) => `${x(n).toFixed(1)},${y(Math.max(25, 50 - half(n))).toFixed(1)}`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[540px]" role="img" aria-label="平均分數的 95% 誤差範圍隨場數變窄：10 場約正負 13 分、30 場約正負 7 分、100 場約正負 4 分">
      <polygon points={[...upper, ...lower].join(" ")} className="fill-primary/15" />
      <polyline points={upper.join(" ")} className="fill-none stroke-primary" strokeWidth={1.5} />
      <polyline points={lower.join(" ")} className="fill-none stroke-primary" strokeWidth={1.5} />
      <line x1={padL} x2={W - padR} y1={y(50)} y2={y(50)} className="stroke-foreground/60" strokeDasharray="3 3" />
      {/* 「差不多」的灰帶 */}
      <rect x={padL} y={y(50 + WORK_GAP)} width={W - padL - padR} height={y(50 - WORK_GAP) - y(50 + WORK_GAP)} className="fill-muted-foreground/15" />
      {[25, 50, 75].map((v) => (
        <text key={v} x={padL - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
          {v}
        </text>
      ))}
      {[10, 30, 100].map((n) => (
        <g key={n}>
          <line x1={x(n)} x2={x(n)} y1={y(50 + half(n))} y2={y(50 - half(n))} className="stroke-foreground" strokeWidth={1.5} />
          <text x={x(n)} y={Math.max(top + 8, y(50 + half(n)) - 5)} textAnchor="middle" className="fill-foreground font-mono text-[10px] font-semibold">
            ±{Math.round(half(n))}
          </text>
          <text x={x(n)} y={H - 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {n} 場
          </text>
        </g>
      ))}
      <text x={x(1.6)} y={H - 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        1 場
      </text>
      <text x={W - padR} y={H - 2} textAnchor="end" className="fill-muted-foreground text-[9px]">
        平均的場數（越多，誤差帶越窄）
      </text>
    </svg>
  )
}

// ── 7. 實際算一場：瀑布圖，從 50 一項一項加減到總分 ──────────────────

const shortSigned = (v: number) => (Math.abs(v) < 0.05 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`)

export function Waterfall({ row, score }: { row: CubeRow; score: number | null }) {
  const steps: { label: string; v: number; kind: "gene" | "mod" | "base" }[] = [
    ...WORK_PARTS.map((p) => ({ label: p.label, v: num(row[p.pts]) ?? 0, kind: "gene" as const })),
    ...WORK_MODS.map((m) => ({ label: m.label, v: num(row[m.pts]) ?? 0, kind: "mod" as const })),
    { label: "校正", v: num(row[WORK_BASE]) ?? 0, kind: "base" as const },
  ]
  let run = 50
  const bars = steps.map((s) => {
    const from = run
    run += s.v
    return { ...s, from, to: run }
  })
  const raw = run
  const final = score ?? raw
  // 刻度只取分數實際走過的範圍（再留一點邊），每一項的長短才看得出來；0～100 全畫的話每條都只剩一點點
  const vals = [50, raw, final, ...bars.flatMap((b) => [b.from, b.to])]
  const lo = Math.floor(Math.min(...vals) - 3)
  const hi = Math.ceil(Math.max(...vals) + 3)
  const ticks = [lo, 50, hi].filter((v, i, a) => a.indexOf(v) === i && v >= lo && v <= hi)
  const W = 360
  const labelW = 64
  const valW = 40
  const plotW = W - labelW - valW
  const x = (v: number) => labelW + ((v - lo) / (hi - lo)) * plotW
  const rowH = 20
  const all = [{ label: "起點", from: 50, to: 50, v: 0, kind: "start" as const }, ...bars, { label: "總分", from: 50, to: final, v: 0, kind: "end" as const }]
  const H = all.length * rowH + 22

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[540px]" role="img" aria-label={`從 50 分開始，九項、高光、失誤與校正一項一項加減，最後是 ${score === null ? "—" : Math.round(score)} 分`}>
      {/* 50 與範圍兩端的參考線 */}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={4} y2={H - 16} className="stroke-muted-foreground/40" strokeDasharray={v === 50 ? "3 3" : undefined} />
          <text x={x(v)} y={H - 4} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
            {v}
          </text>
        </g>
      ))}
      {all.map((b, i) => {
        const yTop = 4 + i * rowH
        const left = Math.min(x(b.from), x(b.to))
        const width = Math.max(1.5, Math.abs(x(b.to) - x(b.from)))
        const isStart = b.kind === "start"
        const isEnd = b.kind === "end"
        const tone = isEnd ? "fill-primary" : isStart ? "fill-foreground" : b.kind === "base" ? "fill-muted-foreground" : b.v >= 0 ? "fill-win" : "fill-loss"
        return (
          <g key={b.label}>
            <text x={labelW - 6} y={yTop + 13} textAnchor="end" className={cn("text-[10px]", isEnd || isStart ? "fill-foreground font-semibold" : "fill-muted-foreground")}>
              {b.label}
            </text>
            {isStart ? (
              <circle cx={x(50)} cy={yTop + 9} r={4} className="fill-foreground" />
            ) : (
              <rect x={left} y={yTop + 3} width={width} height={12} rx={2} className={cn(tone, isEnd && "opacity-80")} />
            )}
            {/* 接到下一列的細線，看得出是一路累加 */}
            {!isEnd && !isStart && i < all.length - 2 && (
              <line x1={x(b.to)} x2={x(b.to)} y1={yTop + 15} y2={yTop + rowH + 3} className="stroke-muted-foreground/50" />
            )}
            <text x={W - 2} y={yTop + 13} textAnchor="end" className={cn("font-mono text-[10px] tabular-nums", isEnd ? "fill-primary font-bold" : "fill-foreground")}>
              {isStart ? "50" : isEnd ? (score === null ? "—" : Math.round(score)) : shortSigned(b.v)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 圖下方的一句註解 */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}
