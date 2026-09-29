import React from "react"
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { C } from "../theme"
import { FONT } from "../fonts"
import { clamp, drift, easeOut, easeSoft, steps, type Pose } from "../motion"
import { Plane, Stage } from "../parts/Stage"
import { MaskUp, big } from "../parts/Type"
import { LEAD } from "./Feature"

/** 功能總覽（2 小節 = 4 秒）：八個頁面排成一面牆，緩緩推進；底下是「12 個分析頁面」與沒有單獨介紹的頁面。 */

const GRID = ["dashboard", "champions", "augments", "lineups", "time", "losses", "tilt", "explore"]
const COLS = 4
const PLANE_S = 0.36
const CROP = 1080 // 長圖只取上半，接近 16:9
const GAP_X = 800
const GAP_Y = 500

// 其餘頁面：資料裡有他人名稱，不放進畫面，只列名稱
const MORE = ["對局紀錄", "隊友 / 對手", "好友比較", "追蹤對象", "節奏與連敗"]

const START: Pose = { x: 0, y: 190, s: 0.5, rx: 8, ry: -10, rz: -2, a: 0 }

export const Wall: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame()
  const t = f - LEAD
  const pose = drift(
    steps(f, START, [{ at: 0, dur: dur + LEAD, ease: (x) => x, pose: { x: 120, y: 170, s: 0.66, rx: 6, ry: -7, rz: -1 } }]),
    f * 0.5,
  )
  const n = Math.round(12 * easeOut(clamp((Math.floor(t) - 8) / 22)))
  const fade = clamp(f / LEAD) * clamp((dur + LEAD - f) / LEAD)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Stage pose={pose}>
        {GRID.map((shot, i) => {
          const col = i % COLS
          const row = Math.floor(i / COLS)
          const appear = easeSoft(clamp((t - i * 3) / 22))
          return (
            <Plane
              key={shot}
              shot={shot}
              crop={CROP}
              scale={PLANE_S}
              x={(col - (COLS - 1) / 2) * GAP_X}
              y={(row - 0.5) * GAP_Y}
              z={(col % 2 ? -90 : 0) + (1 - appear) * -500}
              ry={-8}
              opacity={appear}
            />
          )
        })}
      </Stage>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 470, background: `linear-gradient(to top, ${C.bg} 20%, ${C.bg}d0 60%, transparent)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <MaskUp at={LEAD + 4} dur={18} style={{ ...big(112), display: "flex", alignItems: "baseline", gap: 24 }}>
          <span style={{ color: C.primary, textShadow: `0 0 60px ${C.primary}66`, fontVariantNumeric: "tabular-nums" }}>{n}</span>
          <span>個分析頁面</span>
        </MaskUp>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 32, color: C.muted, marginRight: 8, opacity: easeSoft(clamp((t - 34) / 12)) }}>還有</div>
          {MORE.map((name, i) => {
            const k = easeSoft(clamp((t - 38 - i * 6) / 14))
            return (
              <div
                key={name}
                style={{
                  fontFamily: FONT.sans,
                  fontWeight: 700,
                  fontSize: 36,
                  color: C.fg,
                  padding: "10px 26px",
                  borderRadius: 999,
                  border: `2px solid ${C.border}`,
                  background: "rgba(13,21,38,0.85)",
                  opacity: k,
                  transform: `translateY(${(1 - k) * 24}px)`,
                }}
              >
                {name}
              </div>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}
