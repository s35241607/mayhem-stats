/** 表格的複合格子：一格放一個主數字 + 補充資訊 + 迷你圖。
 *
 *  搭配 AgTable 的 `cell`：那一欄的 key 是主數字（排序、篩選照它），被合併進來的
 *  原始欄位另外以 `hide: true` 保留，匯出 CSV 時仍會帶出。顏色只用主題 token。 */
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`

type AnyRow = Record<string, unknown>

/** 取欄位數字；Cube 回的是字串。 */
export const numOf = (r: AnyRow, key: string): number | null => {
  const v = r[key]
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
export const num0 = (r: AnyRow, key: string) => numOf(r, key) ?? 0

/** 資料條的最大值：只看場次夠（minGames）的列，免得一場的極端值把整欄壓扁。 */
export function solidMax(rows: AnyRow[], key: string, gamesKey: string, minGames: number) {
  const solid = rows.filter((r) => num0(r, gamesKey) >= minGames)
  return Math.max(1e-9, ...(solid.length ? solid : rows).map((r) => num0(r, key)))
}

/** 依場次加權的平均，拿來畫「平均」刻度線。 */
export function weightedAvg(rows: AnyRow[], key: string, gamesKey: string) {
  const total = rows.reduce((a, r) => a + num0(r, gamesKey), 0)
  return total ? rows.reduce((a, r) => a + num0(r, key) * num0(r, gamesKey), 0) / total : null
}

/** 戰績：勝率大字、勝敗比例條、「4勝6敗」。
 *  勝段佔整條的比例就是勝率，所以可以在同一條上用刻度線標出比較基準（例如你的整體勝率）。 */
export function RecordCell({
  winrate,
  wins,
  losses,
  baseline,
}: {
  winrate: number | null
  wins: number
  losses: number
  /** 比較基準勝率（0～100），畫成刻度線；不給就不畫 */
  baseline?: number | null
}) {
  return (
    <div className="flex w-full flex-col justify-center gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            winrate === null ? "text-muted-foreground" : winrate >= 50 ? "text-win" : "text-loss",
          )}
        >
          {winrate === null ? "—" : `${winrate.toFixed(1)}%`}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {wins} 勝 {losses} 敗
        </span>
      </div>
      {/* 勝／敗兩段，中間 2px 縫隙 */}
      <div className="relative flex h-1.5 gap-0.5">
        {wins > 0 && <span className="bar-grow rounded-full bg-win" style={{ flexGrow: wins }} />}
        {losses > 0 && <span className="bar-grow rounded-full bg-loss" style={{ flexGrow: losses }} />}
        {baseline != null && wins + losses > 0 && (
          <span
            className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
            style={{ left: `calc(${pct(baseline / 100)} - 1px)` }}
          />
        )}
      </div>
    </div>
  )
}

/** 契合度（子彈圖）：條是這個條件下的勝率，刻度線是基準勝率，差距就是加成。
 *  條與刻度都用 0～100% 的刻度，所以不同列之間也能直接比。 */
export function LiftCell({
  winrate,
  base,
  sub,
}: {
  winrate: number | null
  base: number | null
  sub?: ReactNode
}) {
  const lift = winrate !== null && base !== null ? winrate - base : null
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-1">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "w-16 shrink-0 font-mono text-sm font-semibold tabular-nums",
            lift === null || Math.abs(lift) < 1 ? "text-muted-foreground" : lift > 0 ? "text-win" : "text-loss",
          )}
        >
          {lift === null ? "—" : `${lift > 0 ? "+" : ""}${lift.toFixed(1)}pp`}
        </span>
        <div className="relative h-1.5 flex-1 rounded-full bg-muted">
          {winrate !== null && (
            <span
              className={cn("bar-grow absolute inset-y-0 left-0 rounded-full", lift !== null && lift >= 0 ? "bg-win" : "bg-loss")}
              style={{ width: pct(winrate / 100) }}
            />
          )}
          {base !== null && (
            <span
              className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
              style={{ left: `calc(${pct(base / 100)} - 1px)` }}
            />
          )}
        </div>
      </div>
      {sub && <SubLine>{sub}</SubLine>}
    </div>
  )
}

/** 勝局 vs 敗局：兩條細條共用同一個刻度（兩者較大值），加上相對差。
 *  好壞方向由呼叫端決定——敵方傷害變高是壞事，我的 KDA 變高是好事。 */
export function ContrastCell({
  win,
  loss,
  format,
  diffPct,
  tone,
}: {
  win: number | null
  loss: number | null
  format: (n: number) => string
  diffPct: number | null
  tone: "good" | "bad" | null
}) {
  const max = Math.max(Math.abs(win ?? 0), Math.abs(loss ?? 0), 1e-9)
  const row = (label: string, v: number | null, color: string) => (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        {v !== null && <span className={cn("bar-grow block h-full rounded-full", color)} style={{ width: pct(Math.abs(v) / max) }} />}
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums">{v === null ? "—" : format(v)}</span>
    </div>
  )
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row("勝", win, "bg-win")}
        {row("敗", loss, "bg-loss")}
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-sm font-semibold tabular-nums",
          tone === "good" ? "text-win" : tone === "bad" ? "text-loss" : "text-muted-foreground",
        )}
      >
        {diffPct === null ? "—" : `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%`}
      </span>
    </div>
  )
}

function SubLine({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-[11px] tabular-nums text-muted-foreground" title={typeof children === "string" ? children : undefined}>
      {children}
    </span>
  )
}

/** 主數字 + 一兩行補充。 */
export function StatCell({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-0.5">
      <span className="font-mono text-sm font-semibold tabular-nums">{main}</span>
      {sub && <SubLine>{sub}</SubLine>}
    </div>
  )
}

/** 資料條：長度對應同欄最大值，細刻度線標出平均，一眼看出高於或低於水準。 */
export function BarCell({
  value,
  max,
  reference,
  label,
  sub,
}: {
  value: number | null
  max: number
  /** 平均線的位置（和 value 同單位），不給就不畫 */
  reference?: number | null
  label: ReactNode
  sub?: ReactNode
}) {
  const ratio = value !== null && max > 0 ? value / max : 0
  const refRatio = reference != null && max > 0 ? reference / max : null
  // 數字和條同一行、補充另起一行：補充放在數字旁邊的話，欄位一窄就被截掉
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-1">
      <div className="flex items-center gap-2.5">
        <span className="w-14 shrink-0 font-mono text-sm font-semibold tabular-nums">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-muted">
        <span
          className={cn(
            "bar-grow absolute inset-y-0 left-0 rounded-full",
            refRatio !== null && ratio >= refRatio ? "bg-data" : "bg-data/55",
          )}
          style={{ width: pct(ratio) } as CSSProperties}
        />
        {refRatio !== null && (
          <span
            className="absolute -inset-y-1 w-0.5 rounded-full bg-primary"
            style={{ left: `calc(${pct(refRatio)} - 1px)` }}
          />
        )}
      </div>
      </div>
      {sub && <SubLine>{sub}</SubLine>}
    </div>
  )
}
