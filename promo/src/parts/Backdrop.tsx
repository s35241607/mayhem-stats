import React from "react"
import { AbsoluteFill, staticFile } from "remotion"
import { C } from "../theme"

export type Glow = { color: string; o: number; x: number; y: number }

/** 全片共用的底：深藍黑 + 緩慢漂移的格線 + 色光 + 暗角 + 抖色噪點（防 H.264 在暗部出現色帶）。 */
export const Backdrop: React.FC<{ frame: number; glows: Glow[] }> = ({ frame, glows }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    {glows.map((g, i) => (
      <AbsoluteFill
        key={i}
        style={{
          opacity: g.o,
          background: `radial-gradient(58% 62% at ${g.x}% ${g.y}%, ${g.color}38 0%, ${g.color}10 42%, transparent 72%)`,
        }}
      />
    ))}
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
        backgroundSize: "72px 72px",
        backgroundPosition: `${-frame * 0.35}px ${-frame * 0.2}px`,
        maskImage: "radial-gradient(70% 70% at 50% 50%, black 30%, transparent 100%)",
      }}
    />
    <AbsoluteFill style={{ background: "radial-gradient(75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    <AbsoluteFill style={{ backgroundImage: `url(${staticFile("noise.png")})`, backgroundSize: "256px 256px", opacity: 0.9 }} />
  </AbsoluteFill>
)
