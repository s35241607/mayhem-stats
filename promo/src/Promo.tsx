import React from "react"
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion"
import { CameraMotionBlur } from "@remotion/motion-blur"
import { BAR, C, bars } from "./theme"
import { clamp, easeOut } from "./motion"
import { Backdrop, type Glow } from "./parts/Backdrop"
import { FEATURES } from "./features"
import { FeatureScene, LEAD } from "./scenes/Feature"
import { Intro } from "./scenes/Intro"
import { Wall } from "./scenes/Wall"
import { Outro } from "./scenes/Outro"
import TL from "./timeline.json"

/**
 * 時間軸（一格 = 一小節 = 60 幀 = 2 秒，120 BPM）。音軌 scripts/make-audio.mjs 用同一張表，改這裡要同步改那裡。
 * 每個功能場景 6 秒（儀表板 8 秒）：兩個停靠點各停約 2 秒，加上進場與收尾，才有時間把字讀完。
 */
type Span = { from: number; dur: number }
const span = (from: number, n: number): Span => ({ from: bars(from), dur: bars(n) })

let cursor = TL.introBars
const featureSpans: Span[] = TL.featureBars.map((n) => {
  const s = span(cursor, n)
  cursor += n
  return s
})
export const TIMELINE = {
  intro: span(0, TL.introBars),
  features: featureSpans,
  wall: span(cursor, TL.wallBars),
  outro: span(cursor + TL.wallBars, TL.outroBars),
}
export const DURATION = bars(cursor + TL.wallBars + TL.outroBars)

/** 上升、持平、下降的梯形：[起, 滿, 開始退, 退完]。 */
const trap = (f: number, [a, b, c, d]: number[]) => clamp((f - a) / (b - a)) * (1 - clamp((f - c) / (d - c)))

/** 每個場景的主色光，跟著功能的代表色走，切場景時交疊淡入淡出。 */
const glows = (f: number): Glow[] => {
  const t = TIMELINE
  const one = (s: Span, color: string, x: number, y: number, o = 0.85): Glow => ({
    color,
    o: trap(f, [s.from - 24, s.from + 12, s.from + s.dur - 12, s.from + s.dur + 24]) * o,
    x,
    y,
  })
  return [
    one(t.intro, C.data, 50, 46, 0.7),
    ...FEATURES.map((ft, i) => one(t.features[i], ft.accent, ft.side === "left" ? 72 : 28, 50, 0.7)),
    one(t.wall, C.data, 50, 40, 0.8),
    one(t.outro, C.primary, 50, 42, 0.8),
  ]
}

/** 最後標誌落地那一刻的閃光。開場的閃光在 Intro 裡。 */
const flash = (f: number): number => {
  const at = TIMELINE.outro.from + BAR * 2
  return f >= at ? 0.4 * (1 - easeOut(clamp((f - at) / 16))) : 0
}

const FadeOut: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame()
  return <AbsoluteFill style={{ opacity: clamp((dur - f) / LEAD) }}>{children}</AbsoluteFill>
}

const Frame: React.FC = () => {
  const f = useCurrentFrame()
  const t = TIMELINE
  return (
    <AbsoluteFill>
      <Backdrop frame={f} glows={glows(f)} />
      <Sequence from={t.intro.from} durationInFrames={t.intro.dur}>
        <FadeOut dur={t.intro.dur}><Intro /></FadeOut>
      </Sequence>
      {FEATURES.map((ft, i) => (
        <Sequence key={ft.title} from={t.features[i].from - LEAD} durationInFrames={t.features[i].dur + LEAD}>
          <FeatureScene feature={ft} index={i} dur={t.features[i].dur} />
        </Sequence>
      ))}
      <Sequence from={t.wall.from - LEAD} durationInFrames={t.wall.dur + LEAD}>
        <Wall dur={t.wall.dur} />
      </Sequence>
      <Sequence from={t.outro.from} durationInFrames={t.outro.dur}><Outro /></Sequence>
      <AbsoluteFill style={{ background: "#d6fbff", opacity: flash(f), pointerEvents: "none" }} />
    </AbsoluteFill>
  )
}

/**
 * 動態模糊：每幀取 5 個子幀平均（快門 180°）。
 * 不能靠加子幀換平順：每個子幀層是 8-bit、不透明度 1/n，深色（背景 #070b16 的紅色 7/n）會被四捨五入掉，
 * n 一大整個暗部就偏色（試過 24：發綠、出現色塊；n ≤ 10 才安全）。鏡頭夠慢，5 個就不會梳齒。
 */
export const Promo: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    <CameraMotionBlur shutterAngle={180} samples={5}>
      <Frame />
    </CameraMotionBlur>
    {audio ? <Audio src={staticFile("audio/track.wav")} /> : null}
  </AbsoluteFill>
)

export { BAR }
