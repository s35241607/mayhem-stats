import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"
import { C } from "../theme"
import { PLANE_W, shotInfo, type Box } from "../shots"
import type { Pose } from "../motion"

const PERSPECTIVE = 1800

/** 攝影機。把整個世界反向移動／旋轉，就等於鏡頭在動。 */
export const Stage: React.FC<{ pose: Pose; children: React.ReactNode }> = ({ pose, children }) => {
  // 放大倍率 → 沿 z 拉近的距離：在 z=0 的物體，畫面大小 = P / (P - zoom)。
  const zoom = PERSPECTIVE * (1 - 1 / pose.s)
  return (
    <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: "50% 50%" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 0,
          height: 0,
          transformStyle: "preserve-3d",
          transform: `translateZ(${zoom}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) translate3d(${-pose.x}px, ${-pose.y}px, 0)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  )
}

type PlaneProps = {
  shot: string
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  scale?: number
  opacity?: number
  /** 只顯示上半部這麼高（平面像素）。總覽牆用，長圖裁成接近 16:9。 */
  crop?: number
  children?: React.ReactNode
}

/** 一張真實畫面截圖，當成 3D 空間裡的一塊平面。children 用平面座標（左上角為原點）放標示。 */
export const Plane: React.FC<PlaneProps> = ({ shot, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1, opacity = 1, crop, children }) => {
  const { H } = shotInfo(shot)
  const h = crop ?? H
  return (
    <div
      style={{
        position: "absolute",
        width: PLANE_W,
        height: h,
        left: -PLANE_W / 2,
        top: -h / 2,
        opacity,
        transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
        borderRadius: 22,
        boxShadow: `0 70px 180px rgba(0,0,0,0.65), 0 0 140px ${C.primary}1a`,
        overflow: "hidden", // 聚光的大範圍陰影不能溢出平面
        background: C.card,
      }}
    >
      <Img src={staticFile(`shots/${shot}.png`)} style={{ position: "absolute", left: 0, top: 0, width: PLANE_W, height: H, display: "block" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: 22, boxShadow: `inset 0 0 0 2px rgba(125,185,255,0.22)` }} />
      {children}
    </div>
  )
}

/** 聚光：圈出正在講的區域、把其餘畫面壓暗。k：0→1 的出現進度。 */
export const Spotlight: React.FC<{ r: Box; k: number; color?: string; dim?: number }> = ({ r, k, color = C.primary, dim = 0.6 }) => {
  if (k <= 0.001) return null
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: r.left,
          top: r.top,
          width: r.w,
          height: r.h,
          borderRadius: 22,
          boxShadow: `0 0 0 6000px rgba(7,11,22,${dim * k})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: r.left,
          top: r.top,
          width: r.w,
          height: r.h,
          borderRadius: 22,
          border: `4px solid ${color}`,
          boxShadow: `0 0 50px ${color}88, inset 0 0 40px ${color}1a`,
          opacity: k,
          transform: `scale(${1 + (1 - k) * 0.03})`,
        }}
      />
    </>
  )
}
