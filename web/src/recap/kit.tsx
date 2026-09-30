import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill, Img, useCurrentFrame } from "remotion"
import type { RecapPalette } from "./types.ts"
import { clamp01, fmt, mix, progress, type } from "./helpers.ts"

/** 場景共用的小零件。全部是「畫面幀數」的純函式，不放任何狀態，Player 拖時間軸與逐幀渲染都不會錯位。 */

/** 場景外框：淡入、淡出，並在進場時輕輕浮起。淡出留在最後 10 幀。 */
export function SceneFrame({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame()
  const enter = progress(frame, 0, 16)
  const leave = clamp01((duration - frame) / 10)
  return (
    <AbsoluteFill style={{ opacity: enter * leave, transform: `translateY(${(1 - enter) * 24}px)` }}>
      {children}
    </AbsoluteFill>
  )
}

/** 從下方浮現的一塊內容。`at` 是本場景內的幀數，錯開它就有依序出場的節奏。 */
export function Rise({ at = 0, dur = 22, distance = 36, style, children }: {
  at?: number
  dur?: number
  distance?: number
  style?: CSSProperties
  children: ReactNode
}) {
  const p = progress(useCurrentFrame(), at, dur)
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>
}

/** 數字從 0 跑到目標值。 */
export function Num({ value, at = 0, dur = 36, decimals = 0, suffix = "" }: {
  value: number
  at?: number
  dur?: number
  decimals?: number
  suffix?: string
}) {
  const p = progress(useCurrentFrame(), at, dur)
  return <>{fmt(value * p, decimals)}{suffix}</>
}

/** 每個場景左上角的小標，和大標題分開，這樣所有場景的閱讀起點一致。 */
export function Heading({ eyebrow, title, palette }: { eyebrow: string; title: ReactNode; palette: RecapPalette }) {
  return (
    <div style={{ position: "absolute", left: 120, top: 100 }}>
      <Rise>
        <div style={{ ...type.eyebrow, color: palette.primary }}>{eyebrow}</div>
      </Rise>
      <Rise at={4}>
        <div style={{ ...type.title, color: palette.fg, marginTop: 14 }}>{title}</div>
      </Rise>
    </div>
  )
}

/** 英雄／增幅圖示。增幅圖示是白色線條的透明圖，一律墊主題的圖示底塊。 */
export function Icon({ path, origin, size, palette, radius = 20 }: {
  path: string | null
  origin: string
  size: number
  palette: RecapPalette
  radius?: number
}) {
  const box: CSSProperties = { width: size, height: size, borderRadius: radius, background: palette.tile, overflow: "hidden", flexShrink: 0 }
  if (!path) return <div style={box} />
  return (
    <div style={box}>
      <Img src={`${origin}/api/icon?path=${encodeURIComponent(path)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  )
}

/** 一格「數字＋說明」的卡片。 */
export function Tile({ palette, children, style }: { palette: RecapPalette; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: palette.card,
        border: `2px solid ${palette.border}`,
        borderRadius: 32,
        padding: "44px 48px",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Backdrop({ palette }: { palette: RecapPalette }) {
  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 620px at 82% 12%, ${mix(palette.primary, 16)}, transparent 70%),
                       radial-gradient(800px 560px at 8% 96%, ${mix(palette.data, 14)}, transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  )
}

/** 由左向右長出的橫條。`ratio` 是最終長度佔軌道的比例。 */
export function Meter({ ratio, at, color, palette, height = 18 }: {
  ratio: number
  at: number
  color: string
  palette: RecapPalette
  height?: number
}) {
  const p = progress(useCurrentFrame(), at, 30)
  return (
    <div style={{ height, borderRadius: height, background: mix(palette.muted, 22), overflow: "hidden" }}>
      <div style={{ width: `${clamp01(ratio) * p * 100}%`, height: "100%", borderRadius: height, background: color }} />
    </div>
  )
}

