import React from "react"
import { useCurrentFrame } from "remotion"
import { C } from "../theme"
import { FONT } from "../fonts"
import { clamp, easeOut, easeSoft } from "../motion"

type Base = { at?: number; children: React.ReactNode; style?: React.CSSProperties }

/** 重擊：從 1.28 倍縮到定位、前兩幀淡入。一個詞對應一次鼓點。 */
export const Slam: React.FC<Base & { from?: number; dur?: number }> = ({ at = 0, from = 1.28, dur = 7, children, style }) => {
  const f = useCurrentFrame() - at
  if (f < 0) return null
  const k = easeOut(clamp(f / dur))
  return <div style={{ transform: `scale(${from + (1 - from) * k})`, opacity: clamp(f / 2), ...style }}>{children}</div>
}

/** 遮罩四周多留的空間。overflow: hidden 會把 text-shadow 的外發光切成方塊，所以遮罩要比文字大一圈，
 *  再用等量的負 margin 抵銷，版面位置不變；文字位移量也要加上這一圈，才會真的從遮罩外進來。 */
const PAD = 110

/** 從遮罩底下滑上來；給了 until 就在那之後往上滑出去。gap = 與上一個元素的視覺間距（不要自己傳 margin，會蓋掉抵銷用的負值）。 */
export const MaskUp: React.FC<Base & { until?: number; dur?: number; gap?: number }> = ({ at = 0, until, dur = 12, gap = 0, children, style }) => {
  const f = useCurrentFrame()
  const inK = easeSoft(clamp((f - at) / dur))
  const outK = until === undefined ? 0 : easeSoft(clamp((f - until) / 10))
  const away = 1 - inK - outK // 1 = 藏在下方，0 = 定位，-1 = 藏在上方
  return (
    <div style={{ overflow: "hidden", padding: PAD, margin: -PAD, marginTop: gap - PAD, ...style }}>
      <div style={{ transform: `translateY(calc(${away * 108}% + ${away * PAD * 2}px))` }}>{children}</div>
    </div>
  )
}

/** 粗體大字的共用樣式。size 以 px 計。 */
export const big = (size: number, color: string = C.fg, extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: FONT.sans,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 1.04,
  letterSpacing: "-0.02em",
  color,
  whiteSpace: "nowrap",
  ...extra,
})

export const mono = (size: number, color: string = C.muted, extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: FONT.mono,
  fontWeight: 500,
  fontSize: size,
  letterSpacing: "0.22em",
  color,
  whiteSpace: "nowrap",
  ...extra,
})

/** 全螢幕置中。 */
export const Center: React.FC<{ children: React.ReactNode; gap?: number; style?: React.CSSProperties }> = ({ children, gap = 0, style }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap, ...style }}>
    {children}
  </div>
)

/** 青色高亮字：帶一點外發光。 */
export const glowText = (color: string): React.CSSProperties => ({ color, textShadow: `0 0 60px ${color}66, 0 0 140px ${color}33` })
