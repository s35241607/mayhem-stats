import React from "react"
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion"
import { BAR, BEAT, C } from "../theme"
import { clamp, easeOut, easeSoft, lerp } from "../motion"
import { Center, MaskUp, Slam, big, glowText, mono } from "../parts/Type"
import { Logo } from "../parts/Logo"

/**
 * 收尾（4 小節 = 8 秒）：
 *   前兩小節：客戶端開著就自動採集、資料留在自己的電腦（各 2 秒，字是一個一個進來，不是一閃而過）
 *   後兩小節：標誌落地、字一行一行升起，停 4 秒，最後淡出。
 */

/** 每一拍長出一圈，往外擴散並淡掉。 */
const Rings: React.FC<{ color: string; strength?: number }> = ({ color, strength = 0.3 }) => {
  const f = useCurrentFrame()
  const born = Math.floor(f / BEAT)
  return (
    <AbsoluteFill>
      {[0, 1, 2].map((k) => {
        const n = born - k
        if (n < 0) return null
        const age = f - n * BEAT
        const r = 90 + age * 34
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: r * 2,
              height: r * 2,
              marginLeft: -r,
              marginTop: -r,
              borderRadius: "50%",
              border: `3px solid ${color}`,
              opacity: Math.max(0, 1 - age / 44) * strength,
            }}
          />
        )
      })}
    </AbsoluteFill>
  )
}

const Auto: React.FC = () => {
  const f = useCurrentFrame()
  const chip = easeSoft(clamp(f / 10))
  const pulse = 0.5 + 0.5 * Math.sin((f / BEAT) * Math.PI * 2)
  return (
    <AbsoluteFill>
      <Rings color={C.primary} />
      <Center gap={6}>
        <div style={{ opacity: chip, display: "flex", alignItems: "center", gap: 20, marginBottom: 26 }}>
          <div style={{ width: 26, height: 26, borderRadius: 13, background: C.primary, boxShadow: `0 0 ${24 + pulse * 40}px ${C.primary}` }} />
          <div style={mono(34, C.primary, { letterSpacing: "0.2em" })}>客戶端已連線</div>
        </div>
        <MaskUp at={4} dur={16} style={big(170, C.fg)}>
          客戶端開著，
        </MaskUp>
        <Slam at={20} from={1.18} dur={12}>
          <div style={{ ...big(330, C.primary), ...glowText(C.primary) }}>自動採集</div>
        </Slam>
      </Center>
    </AbsoluteFill>
  )
}

const Stored: React.FC = () => (
  <AbsoluteFill>
    <Rings color={C.fg} strength={0.16} />
    <Center gap={6}>
      <MaskUp at={4} dur={16} style={big(150, C.muted, { fontWeight: 700 })}>
        資料留在
      </MaskUp>
      <Slam at={20} from={1.18} dur={12}>
        <div style={big(330, C.fg)}>你的電腦</div>
      </Slam>
    </Center>
  </AbsoluteFill>
)

const Brand: React.FC = () => {
  const f = useCurrentFrame()
  const pop = easeOut(clamp(f / 14))
  const wave = clamp(f / 30)
  const out = 1 - easeSoft(clamp((f - (BAR * 2 - 14)) / 14))
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {[0, 1].map((k) => {
        const w = clamp((f - k * 6) / 36)
        const r = 140 + easeOut(w) * 1000
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: "50%",
              top: "38%",
              width: r * 2,
              height: r * 2,
              marginLeft: -r,
              marginTop: -r,
              borderRadius: "50%",
              border: `${lerp(8, 1, w)}px solid ${C.primary}`,
              opacity: (1 - w) * 0.55,
            }}
          />
        )
      })}
      <Center gap={0}>
        <div style={{ transform: `scale(${lerp(1.7, 1, pop)})`, opacity: clamp(f / 4), marginBottom: 44, filter: `brightness(${1 + (1 - wave) * 0.8})` }}>
          <Logo size={230} glow={1.2} />
        </div>
        <MaskUp at={8} dur={20} style={big(190, C.fg)}>
          Mayhem 戰績
        </MaskUp>
        <MaskUp at={26} dur={20} gap={10} style={{ ...big(96, C.primary), ...glowText(C.primary) }}>
          接住每一場。
        </MaskUp>
        <MaskUp at={48} dur={20} gap={34} style={mono(32, C.muted, { letterSpacing: "0.12em", fontWeight: 500 })}>
          ARAM: Mayhem 的本機戰績採集與分析
        </MaskUp>
      </Center>
    </AbsoluteFill>
  )
}

export const Outro: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={BAR}><Auto /></Sequence>
    <Sequence from={BAR} durationInFrames={BAR}><Stored /></Sequence>
    <Sequence from={BAR * 2} durationInFrames={BAR * 2}><Brand /></Sequence>
  </AbsoluteFill>
)
