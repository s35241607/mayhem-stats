import React from "react"
import { C } from "../theme"

/** 網站側邊欄的標誌：圓角方塊裡放 lucide 的 Zap。 */
export const Logo: React.FC<{ size: number; glow?: number }> = ({ size, glow = 1 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.27,
      background: `linear-gradient(150deg, ${C.primary}38, ${C.primary}0f)`,
      border: `${Math.max(2, size * 0.014)}px solid ${C.primary}66`,
      display: "grid",
      placeItems: "center",
      boxShadow: `0 0 ${size * 0.7 * glow}px ${C.primary}55, inset 0 0 ${size * 0.3}px ${C.primary}22`,
    }}
  >
    <svg viewBox="0 0 24 24" width={size * 0.54} height={size * 0.54} fill="none" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  </div>
)
