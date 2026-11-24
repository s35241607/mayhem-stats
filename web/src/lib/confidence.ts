/** 勝率「看得出」還是「還在誤差內」：全站同一套判定。
 *
 *  用 Wilson 95% 信賴區間（小樣本比常態近似準）：基準勝率落在區間外才算看得出高／低。
 *  3 場 3 勝的 100% 區間是 44%～100%，和 50% 的基準比是「還在誤差內」——高勝率不再因為場次少就看起來像結論。
 *  好友比較的打法判定看的是貢獻分數的誤差（lib/gap.ts），這裡只管勝率。 */

const Z = 1.96

export function wilson(wins: number, games: number): [number, number] | null {
  if (games <= 0) return null
  const p = wins / games
  const z2 = Z * Z
  const denom = 1 + z2 / games
  const center = (p + z2 / (2 * games)) / denom
  const half = (Z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom
  return [Math.max(0, center - half) * 100, Math.min(1, center + half) * 100]
}

export type Verdict = "high" | "low" | null

/** baseline 是百分比（0～100）。null＝還在誤差內（或資料不足） */
export function judge(wins: number, games: number, baseline: number | null | undefined): Verdict {
  if (baseline == null || !Number.isFinite(baseline)) return null
  const ci = wilson(wins, games)
  if (!ci) return null
  if (ci[0] > baseline) return "high"
  if (ci[1] < baseline) return "low"
  return null
}

export const VERDICT_TEXT = {
  high: "看得出高",
  low: "看得出低",
} as const

/** 給 ⓘ 用的說明 */
export const CONFIDENCE_HINT =
  "▲▼ 是「看得出」：用 95% 信賴區間，這個勝率的區間整段高於（▲）或低於（▼）比較基準才標。\n沒有標的不代表一樣，是差距還在誤差內——場次少的時候，60% 和 40% 都可能只是運氣。"
