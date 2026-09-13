/** 表格的複合格子：一格放一個主數字 + 補充資訊 + 迷你圖。
 *
 *  搭配 AgTable 的 `cell`：那一欄的 key 是主數字（排序、篩選照它），被合併進來的
 *  原始欄位另外以 `hide: true` 保留，匯出 CSV 時仍會帶出。顏色只用主題 token。 */
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`

/** 戰績：勝率大字、勝敗比例條、「4勝6敗」。 */
export function RecordCell({
  winrate,
  wins,
  losses,
}: {
  winrate: number | null
  wins: number
  losses: number
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
      {/* 勝／敗兩段，中間 2px 縫隙；長度是場次比例，不是勝率刻度 */}
      <div className="flex h-1.5 gap-0.5">
        {wins > 0 && <span className="bar-grow rounded-full bg-win" style={{ flexGrow: wins }} />}
        {losses > 0 && <span className="bar-grow rounded-full bg-loss" style={{ flexGrow: losses }} />}
      </div>
    </div>
  )
}

/** 主數字 + 一兩行補充。 */
export function StatCell({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col justify-center gap-0.5">
      <span className="font-mono text-sm font-semibold tabular-nums">{main}</span>
      {sub && (
        <span className="truncate text-[11px] tabular-nums text-muted-foreground" title={typeof sub === "string" ? sub : undefined}>
          {sub}
        </span>
      )}
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
      {sub && (
        <span className="truncate text-[11px] tabular-nums text-muted-foreground" title={typeof sub === "string" ? sub : undefined}>
          {sub}
        </span>
      )}
    </div>
  )
}
