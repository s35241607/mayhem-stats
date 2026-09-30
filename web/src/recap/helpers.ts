import { Easing } from "remotion"
import type { CSSProperties } from "react"

/** 畫面幀數的純函式與版面常數。不含任何元件，元件在 kit.tsx。 */

export const W = 1920
export const H = 1080
export const FPS = 30

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1)
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** 從 `at` 幀開始、`dur` 幀內由 0 走到 1 的進度（已套 easeOut）。 */
export const progress = (frame: number, at: number, dur: number) => easeOut(clamp01((frame - at) / dur))

/** 半透明版本的主題色。palette 給的可能是 `var(--win)` 也可能是色碼，color-mix 兩者都吃。 */
export const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

export const WEEKDAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

export const fmt = (value: number, decimals = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** 一段文字的字級與粗細。畫面上的字級都從這裡取，場景之間才一致。 */
export const type = {
  eyebrow: { fontSize: 34, fontWeight: 600, letterSpacing: "0.08em" },
  title: { fontSize: 64, fontWeight: 800, lineHeight: 1.15 },
  hero: { fontSize: 260, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" as const },
  big: { fontSize: 120, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" as const },
  body: { fontSize: 42, fontWeight: 500, lineHeight: 1.35 },
  small: { fontSize: 30, fontWeight: 500 },
} satisfies Record<string, CSSProperties>
