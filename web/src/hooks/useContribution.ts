import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻分數的查詢與常數。分數的定義只有一份，在語意層（cube/model/cubes/contribution.yml）；
// 畫法在 components/Contribution.tsx。

/** 貢獻（分數 − 50）要偏離多少才算好或差，低於這個值的數字用淡色。
 *  單場分數標準差約 19；好友比較頁拿收縮後的平均分數比，「人 × 出裝」大約落在 ±8 */
export const CONTRIB_GAP = 4

/** 貢獻的六項，順序固定：先「做了多少」再「做得多有效」 */
export const CONTRIB_PARTS = [
  { key: "contribution.dmg_pct", label: "輸出", hint: "對英雄傷害佔隊伍的比例" },
  { key: "contribution.soak_pct", label: "承傷", hint: "承受傷害＋自身減免佔隊伍的比例" },
  { key: "contribution.kp_pct", label: "參團", hint: "(擊殺＋助攻) / 隊伍擊殺" },
  { key: "contribution.cc_pct", label: "控制", hint: "控制敵人的時間佔隊伍的比例" },
  { key: "contribution.kda_pct", label: "KDA", hint: "(擊殺＋助攻) / 死亡" },
  { key: "contribution.eff_pct", label: "效率", hint: "每 1 金錢打出的對英雄傷害" },
] as const
export const CONTRIB_MEASURES = ["contribution.score", ...CONTRIB_PARTS.map((c) => c.key)]

export const contribScore = (r: CubeRow | undefined) => (r ? num(r["contribution.score"]) : null)

/** 一批參賽者（鍵：platform_id:game_id:participant_id）各自的貢獻。
 *  parts＝true 時連六項一起查。一批不要超過 50 個鍵，查詢走 GET，網址才不會太長。 */
export function useContribution(keys: string[], parts = false): Map<string, CubeRow> {
  const res = useCube(
    keys.length
      ? {
          dimensions: ["participants.participant_key"],
          measures: parts ? CONTRIB_MEASURES : ["contribution.score"],
          filters: [{ member: "participants.participant_key", operator: "equals", values: keys }],
          limit: keys.length,
        }
      : null,
  )
  return new Map(res.rows.map((r) => [String(r["participants.participant_key"]), r]))
}
