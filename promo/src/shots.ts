import manifest from "../public/shots/shots.json"

// scripts/capture.mjs 拍的整頁長圖與各卡片的真實位置（CSS px）。
// 平面一律寬 1920，高度依原圖比例；區域座標換算成「以平面中心為原點」給鏡頭用。
export const PLANE_W = 1920

type Raw = { w: number; h: number; regions: Record<string, [number, number, number, number]> }
const M = manifest as unknown as Record<string, Raw>

/** 平面座標下的一塊區域。left/top 以平面左上角為原點（放標示用）；x/y 是中心相對平面中心（鏡頭對準用）。 */
export type Box = { left: number; top: number; w: number; h: number; x: number; y: number }

export function shotInfo(id: string) {
  const s = M[id]
  if (!s) throw new Error(`shots.json 沒有「${id}」，先跑 npm run shots`)
  const K = PLANE_W / s.w
  const H = s.h * K
  /** 幾個區域的聯集，四周多留 pad。 */
  const box = (names: string[], pad = 14): Box => {
    const rs = names.map((n) => {
      const r = s.regions[n]
      if (!r) throw new Error(`${id} 沒有區域「${n}」，重跑 npm run shots 或檢查名稱`)
      return r
    })
    const left = Math.min(...rs.map((r) => r[0])) * K - pad
    const top = Math.min(...rs.map((r) => r[1])) * K - pad
    const right = Math.max(...rs.map((r) => r[2])) * K + pad
    const bottom = Math.max(...rs.map((r) => r[3])) * K + pad
    const w = right - left
    const h = bottom - top
    return { left, top, w, h, x: left + w / 2 - PLANE_W / 2, y: top + h / 2 - H / 2 }
  }
  return { id, W: PLANE_W, H, box }
}
