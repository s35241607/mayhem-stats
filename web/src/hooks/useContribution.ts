import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻分數的查詢與常數。分數的定義只有一份，在語意層（cube/model/cubes/contribution.yml，規格見 docs/contribution-scoring.md）；
// 畫法在 components/Contribution.tsx。

/** 貢獻（分數 − 50）要偏離多少才算好或差，低於這個值的數字用淡色。
 *  分數是同類型內的名次百分位，單場標準差約 29（舊版加權平均約 19，門檻 4，按同樣比例放大成 6）。
 *  好友比較頁拿收縮後的平均分數比，「人 × 出裝」的差距也跟著放大約 1.5 倍 */
export const CONTRIB_GAP = 6

/** 貢獻的六項，順序固定：先「做了多少」（輸出、承傷）再「撐住」（存活）再「參與與幫忙」（參團、控場、治療護盾）。
 *  治療護盾只在有治療或護盾隊友的場次才有值，其他場次是空值（雷達圖會略過那個頂點）。 */
export const CONTRIB_PARTS = [
  { key: "contribution.dmg_pct", label: "輸出", hint: "對英雄傷害佔隊伍的比例（除以依陣容算的期望份額）" },
  { key: "contribution.soak_pct", label: "承傷", hint: "承受傷害＋自身減免佔隊伍的比例（除以依陣容算的期望份額）" },
  { key: "contribution.surv_pct", label: "存活", hint: "死亡佔隊伍死亡的比例，越低越好（分數越高代表死得越少）" },
  { key: "contribution.kp_pct", label: "參團", hint: "(擊殺＋助攻) / 隊伍擊殺" },
  { key: "contribution.cc_pct", label: "控場", hint: "每分鐘控制敵人的時間（Combo Breaker 讓控場邊際遞減，權重中等）" },
  { key: "contribution.heal_pct", label: "治療護盾", hint: "每分鐘有效治療＋護盾隊友，只在有治療或護盾隊友的場次計（不分定位排名；舊場次沒有護盾的量，改用含自補的治療量）" },
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

export type ContribTag = "MVP" | "ACE"

/** 這一隊（五個人）裡的最高分才有標籤：贏的一隊是 MVP、輸的一隊是 ACE。
 *  五個人的分數沒到齊就不標，免得資料還沒回來時誤標。 */
export function contribTagOf(score: number | null, teamScores: (number | null)[], won: boolean): ContribTag | undefined {
  if (score === null || teamScores.length === 0 || teamScores.some((v) => v === null)) return undefined
  return score === Math.max(...(teamScores as number[])) ? (won ? "MVP" : "ACE") : undefined
}

type CardRow = {
  platform_id: string
  game_id: number
  participant_id: number
  team_id: number
  win: number
  roster?: { participant_id: number; team_id: number }[]
}

/** 一批對局卡片（一批不要超過 50 張）上各自的貢獻分數與 MVP／ACE。
 *  標籤要比同隊五個人，卡片只有自己那一列，所以用 matches.game_id 一次查整批的十個人，
 *  隊伍歸屬用卡片帶的 roster 對。team_id 在語意層是私有欄位，不能直接查。 */
export function useCardContribution(rows: CardRow[]): Map<string, { score: number | null; tag?: ContribTag }> {
  const gameIds = [...new Set(rows.map((r) => r.game_id))]
  const res = useCube(
    gameIds.length
      ? {
          dimensions: ["participants.participant_key"],
          measures: ["contribution.score"],
          filters: [{ member: "matches.game_id", operator: "equals", values: gameIds.map(String) }],
          limit: gameIds.length * 10,
        }
      : null,
  )
  const scores = new Map(res.rows.map((r) => [String(r["participants.participant_key"]), contribScore(r)]))
  const key = (m: { platform_id: string; game_id: number }, pid: number) => `${m.platform_id}:${m.game_id}:${pid}`
  return new Map(
    rows.map((m) => {
      const score = scores.get(key(m, m.participant_id)) ?? null
      const team = (m.roster ?? []).filter((p) => p.team_id === m.team_id).map((p) => scores.get(key(m, p.participant_id)) ?? null)
      return [key(m, m.participant_id), { score, tag: contribTagOf(score, team, m.win === 1) }]
    }),
  )
}
