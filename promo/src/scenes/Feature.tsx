import React from "react"
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { C } from "../theme"
import { FONT } from "../fonts"
import { clamp, drift, easeEnter, easeSoft, steps, type Pose, type Step } from "../motion"
import { Plane, Spotlight, Stage } from "../parts/Stage"
import { MaskUp, big, mono } from "../parts/Type"
import { PLANE_W, shotInfo, type Box } from "../shots"

/**
 * 功能介紹場景的共用範本。左邊固定一欄文字（功能名、一句話、要點），右邊是那一頁的整頁長圖，
 * 鏡頭在幾個「停靠點」各停約 2 秒：圈出那塊區域、其餘畫面壓暗，左邊對應的要點同步亮起。
 * 版面刻意固定，看完一個功能就知道下一個功能要看哪裡，不必重新適應。
 */

/** 場景之間交疊淡入淡出的幀數：每個 Sequence 比標稱起點早開始這麼多。 */
export const LEAD = 10

export type Stop = {
  /** 鏡頭出發的標稱幀（相對場景標稱起點）。停靠點光圈在這之後約 14 幀出現。 */
  at: number
  regions: string[]
  /** 要點：短標題（一行放得下）＋一行小字說明。 */
  bullet: string
  sub: string
  /** 這個停靠點最多放大到幾倍。預設 1.1；小區域（單張卡片）可以放大一點，但別超過截圖解析度的餘裕。 */
  maxS?: number
}
export type Feature = {
  shot: string
  title: string
  tagline: string
  accent: string
  /** 文字欄在哪一側；相鄰場景交替，畫面才不會一直往同一邊擠。 */
  side: "left" | "right"
  stops: Stop[]
  /** 某一刻換成另一張同版面的圖（自由探索切換圖表型態）。 */
  swap?: { shot: string; at: number }
}

export const NAV = ["儀表板", "英雄", "增幅裝置", "陣容", "時段", "敗因分析", "自由探索"]

const STAGE_W = 1180 // 文字欄之外，舞台能容納的寬高
const STAGE_H = 900
const DX = 330 // 舞台中心偏離畫面中心多少（文字欄佔掉的那一側）
const NAV_H = 30 // 導覽列佔掉的高度，區域中心要往下讓一點

/** 把一個區域框到舞台中央。 */
function fit(box: Box, sgn: number, maxS = 1.1) {
  const s = clamp(Math.min(STAGE_W / box.w, STAGE_H / box.h), 0.4, maxS)
  return { x: box.x - (DX * sgn) / s, y: box.y - NAV_H / s, s }
}

export const FeatureNav: React.FC<{ active: number; accent: string }> = ({ active, accent }) => (
  <div style={{ position: "absolute", top: 36, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12 }}>
    {NAV.map((name, i) => {
      const on = i === active
      return (
        <div
          key={name}
          style={{
            fontFamily: FONT.sans,
            fontWeight: 700,
            fontSize: 27,
            padding: "8px 22px",
            borderRadius: 999,
            color: on ? C.fg : C.muted,
            opacity: on ? 1 : 0.55,
            background: on ? `${accent}26` : "rgba(13,21,38,0.6)",
            border: `2px solid ${on ? accent : C.border}`,
            boxShadow: on ? `0 0 30px ${accent}44` : "none",
          }}
        >
          {name}
        </div>
      )
    })}
  </div>
)

const Bullet: React.FC<{ text: string; sub: string; appear: number; active: number; accent: string; side: "left" | "right" }> = ({ text, sub, appear, active, accent, side }) => {
  const k = easeSoft(clamp(appear))
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 20,
        opacity: k * (0.32 + 0.68 * active),
        transform: `translateX(${(1 - k) * 40 * (side === "left" ? -1 : 1)}px)`,
      }}
    >
      <div
        style={{
          marginTop: 15,
          width: 16,
          height: 16,
          flex: "none",
          borderRadius: 8,
          background: active > 0.5 ? accent : C.muted,
          boxShadow: active > 0.5 ? `0 0 ${10 + 18 * active}px ${accent}` : "none",
          transform: `scale(${1 + 0.35 * active})`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontFamily: FONT.sans, fontWeight: 900, fontSize: 46, lineHeight: 1.2, color: C.fg, whiteSpace: "nowrap" }}>{text}</div>
        <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 31, lineHeight: 1.3, color: C.muted, whiteSpace: "nowrap" }}>{sub}</div>
      </div>
    </div>
  )
}

export const FeatureScene: React.FC<{ feature: Feature; index: number; dur: number }> = ({ feature, index, dur }) => {
  const f = useCurrentFrame()
  const t = f - LEAD // 標稱時間：0 = 場景在時間軸上的起點
  const sgn = feature.side === "left" ? 1 : -1
  const info = shotInfo(feature.shot)
  const alt = feature.swap ? shotInfo(feature.swap.shot) : null

  const overview = {
    x: -(DX * sgn) / Math.min(STAGE_W / PLANE_W, 960 / info.H),
    y: -NAV_H / Math.min(STAGE_W / PLANE_W, 960 / info.H),
    s: Math.min(STAGE_W / PLANE_W, 960 / info.H),
    rx: 4,
    ry: -11 * sgn,
    rz: -1 * sgn,
    a: 0,
  }
  const start: Pose = { ...overview, x: overview.x + 420 * sgn, s: overview.s * 0.78, rx: 14, ry: -34 * sgn, rz: -5 * sgn }
  const list: Step[] = [
    { at: 0, dur: 58, ease: easeEnter, pose: overview },
    ...feature.stops.map((st, i): Step => ({
      at: LEAD + st.at - 8,
      dur: 48,
      pose: { ...fit(info.box(st.regions), sgn, st.maxS), rx: 2, ry: (i % 2 ? 3 : -3) * sgn, rz: 0 },
    })),
  ]
  const pose = drift(steps(f, start, list), f * 0.6)

  const spot = (i: number) => {
    const st = feature.stops[i]
    const nextAt = feature.stops[i + 1]?.at ?? Infinity
    return easeSoft(clamp((t - st.at - 14) / 14)) * (1 - easeSoft(clamp((t - nextAt + 8) / 10)))
  }
  const activeOf = (i: number) => {
    const st = feature.stops[i]
    const nextAt = feature.stops[i + 1]?.at ?? Infinity
    return clamp((t - st.at) / 10) * (1 - clamp((t - nextAt) / 10))
  }
  const swapK = feature.swap ? clamp((t - feature.swap.at) / 14) : 0
  const fade = clamp(f / LEAD) * clamp((dur + LEAD - f) / LEAD)

  const panel: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    [feature.side]: 0,
    width: 800,
    background: `linear-gradient(to ${feature.side === "left" ? "right" : "left"}, ${C.bg} 0%, ${C.bg}f2 60%, transparent 100%)`,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 22,
    padding: feature.side === "left" ? "40px 90px 0 96px" : "40px 96px 0 90px",
    alignItems: feature.side === "left" ? "flex-start" : "flex-end",
    textAlign: feature.side === "left" ? "left" : "right",
  }

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Stage pose={pose}>
        <Plane shot={feature.shot} opacity={1 - swapK}>
          {feature.stops.map((st, i) => (
            <Spotlight key={i} r={info.box(st.regions)} k={spot(i) * (1 - swapK)} color={feature.accent} />
          ))}
        </Plane>
        {feature.swap && alt ? (
          <Plane shot={feature.swap.shot} opacity={swapK}>
            <Spotlight r={alt.box(feature.stops[feature.stops.length - 1].regions)} k={spot(feature.stops.length - 1) * swapK} color={feature.accent} />
          </Plane>
        ) : null}
      </Stage>

      <div style={panel}>
        <MaskUp at={LEAD + 2} dur={16} style={mono(28, feature.accent, { letterSpacing: "0.2em" })}>
          {`功能 ${String(index + 1).padStart(2, "0")} / ${String(NAV.length).padStart(2, "0")}`}
        </MaskUp>
        <MaskUp at={LEAD + 8} dur={20} gap={-8} style={big(132, C.fg, { textShadow: `0 0 80px ${feature.accent}44` })}>
          {feature.title}
        </MaskUp>
        <MaskUp at={LEAD + 22} dur={18} gap={6} style={big(50, C.muted, { fontWeight: 700 })}>
          {feature.tagline}
        </MaskUp>
        <div style={{ height: 14, width: 96, borderRadius: 8, background: feature.accent, boxShadow: `0 0 30px ${feature.accent}` , opacity: easeSoft(clamp((t - 24) / 14)), transformOrigin: feature.side === "left" ? "left" : "right", transform: `scaleX(${easeSoft(clamp((t - 24) / 14))})` }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 8 }}>
          {feature.stops.map((st, i) => (
            <Bullet key={i} text={st.bullet} sub={st.sub} appear={(t - 34 - i * 9) / 16} active={activeOf(i)} accent={feature.accent} side={feature.side} />
          ))}
        </div>
      </div>

      <FeatureNav active={index} accent={feature.accent} />
    </AbsoluteFill>
  )
}
