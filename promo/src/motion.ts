import { Easing } from "remotion"

// CameraMotionBlur 會用小數幀重複渲染（子幀），所以這裡所有函式都要吃小數，
// 而且只能是 frame 的純函式——不能用 Math.random 或累加狀態。

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 重擊：一下就到位，尾端很軟。文字與鏡頭的主力曲線。 */
export const easeSoft = Easing.bezier(0.16, 1, 0.3, 1)
/** 更猛的衝出去再煞住，給硬切後的第一個動作。 */
export const easeOut = Easing.out(Easing.exp)
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1)
/** 鏡頭移動：緩起步、緩收尾，峰值速度約為平均的 2 倍（easeSoft 是 6 倍）——
 *  速度太快時動態模糊的子幀會一格一格分開，變成殘影而不是拖影。 */
export const easeCam = Easing.bezier(0.42, 0, 0.18, 1)
/** 硬切／閃光之後的進場：比 easeCam 衝一點，因為前幾幀被閃光蓋住。 */
export const easeEnter = Easing.bezier(0.2, 0.65, 0.2, 1)
export const easeIn = Easing.bezier(0.5, 0, 0.9, 0.4)

// ── 攝影機 ───────────────────────────────────────────────────────────
// 世界座標：平面中心在原點，x 向右、y 向下、z 朝觀眾。
// x/y = 畫面正中央對準的世界點；s = 放大倍率；rx/ry/rz = 以該點為軸心的環繞角度；
// a = 旋轉木馬的方位角（只有 Carousel 場景用）。
export type Pose = { x: number; y: number; s: number; rx: number; ry: number; rz: number; a: number }
export const POSE0: Pose = { x: 0, y: 0, s: 1, rx: 0, ry: 0, rz: 0, a: 0 }

const mix = (p: Pose, q: Pose, t: number): Pose => ({
  x: lerp(p.x, q.x, t),
  y: lerp(p.y, q.y, t),
  s: Math.exp(lerp(Math.log(p.s), Math.log(q.s), t)), // 倍率在對數空間內插，推近的速度才會均勻
  rx: lerp(p.rx, q.rx, t),
  ry: lerp(p.ry, q.ry, t),
  rz: lerp(p.rz, q.rz, t),
  a: lerp(p.a, q.a, t),
})

export type Step = { at: number; pose: Partial<Pose>; dur?: number; ease?: (t: number) => number }

/** 鏡頭腳本：在指定幀開始往新姿勢移動，之前的姿勢維持到那一刻。
 *  easeCam 起步緩，所以 at 要比拍點早 2 幀，視覺上的起步才會落在拍點上。
 *  步驟可以重疊：新的一步從「前一步在這一刻所在的姿勢」接著走，不會等前一步走完。 */
export function steps(f: number, initial: Pose, list: Step[]): Pose {
  const targets: Pose[] = []
  let cur = initial
  for (const s of list) {
    cur = { ...cur, ...s.pose }
    targets.push(cur)
  }
  // 只看前 n 步、在時間 t 的姿勢
  const at = (t: number, n: number): Pose => {
    let i = n - 1
    while (i >= 0 && t < list[i].at) i--
    if (i < 0) return initial
    const s = list[i]
    const k = clamp((t - s.at) / (s.dur ?? 26))
    return mix(at(s.at, i), targets[i], (s.ease ?? easeCam)(k))
  }
  return at(f, list.length)
}

/** 保持「不是靜止」的微幅漂移，疊在鏡頭腳本上。 */
export const drift = (p: Pose, f: number): Pose => ({
  ...p,
  ry: p.ry + Math.sin(f / 46) * 0.9,
  rx: p.rx + Math.sin(f / 61 + 1) * 0.5,
  rz: p.rz + Math.sin(f / 53 + 2) * 0.25,
  s: p.s * (1 + f * 0.00018),
})
