import React from "react"
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion"
import { BAR, C } from "../theme"
import { clamp, easeOut, easeSoft, lerp } from "../motion"
import { Center, MaskUp, big, glowText, mono } from "../parts/Type"
import { Logo } from "../parts/Logo"
import TL from "../timeline.json"

/** 開場（3 小節 = 6 秒）：三個問題，各停約一秒半；接著品牌與一句話。每個問題都是功能場景會回答的。 */

const QUESTIONS: { at: number; parts: [string, string?, string?]; color: string }[] = [
  { at: TL.questionAt[0], parts: ["", "勝率", "多少？"], color: C.primary },
  { at: TL.questionAt[1], parts: ["哪個", "增幅", "最強？"], color: C.prismatic },
  { at: TL.questionAt[2], parts: ["什麼", "時候", "最會贏？"], color: C.gold },
]
const Q_END = BAR * 2 - 4 // 第 116 幀開始，問題往上滑出

const Questions: React.FC = () => (
  <Center gap={18}>
    <MaskUp at={2} until={Q_END} style={mono(28, C.muted, { letterSpacing: "0.3em" })}>
      ARAM: MAYHEM
    </MaskUp>
    {QUESTIONS.map((q, i) => (
      <MaskUp key={i} at={q.at} until={Q_END + i * 3} dur={18} style={big(160, C.fg)}>
        {q.parts[0]}
        <span style={{ color: q.color, textShadow: `0 0 70px ${q.color}66` }}>{q.parts[1]}</span>
        {q.parts[2]}
      </MaskUp>
    ))}
  </Center>
)

const Brand: React.FC = () => {
  const f = useCurrentFrame()
  const pop = easeOut(clamp(f / 12))
  return (
    <Center gap={0}>
      <div style={{ transform: `scale(${lerp(1.6, 1, pop)})`, opacity: clamp(f / 4), marginBottom: 40 }}>
        <Logo size={210} glow={1.2} />
      </div>
      <MaskUp at={5} dur={18} style={big(176, C.fg)}>
        Mayhem 戰績
      </MaskUp>
      <MaskUp at={20} dur={18} gap={6} style={{ ...big(72, C.primary), ...glowText(C.primary) }}>
        把每一場都記下來，再一次看懂。
      </MaskUp>
    </Center>
  )
}

export const Intro: React.FC = () => {
  const f = useCurrentFrame()
  // 問題 → 品牌的轉場：一道青色閃光
  const flash = f < BAR * 2 ? clamp((f - (BAR * 2 - 10)) / 10) * 0.55 : 0.55 * (1 - easeSoft(clamp((f - BAR * 2) / 16)))
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={BAR * 2}><Questions /></Sequence>
      <Sequence from={BAR * 2} durationInFrames={BAR}><Brand /></Sequence>
      <AbsoluteFill style={{ background: "#d6fbff", opacity: flash, pointerEvents: "none" }} />
    </AbsoluteFill>
  )
}
