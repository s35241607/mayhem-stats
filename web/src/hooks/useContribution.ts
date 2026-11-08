import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻的分數只有一個，定義在語意層（cube/model/cubes/contribution.yml，規格見 docs/contribution-scoring.md）；畫法在 components/Contribution.tsx。
// 本場貢獻（contribution.work）：八個計分基因（輸出、承傷、擊殺、治療護盾、控場、推塔、清兵、功能裝）先各自和同一場的人比，
// 基因以同出裝定位為基準，總分以校準資料的整體表現為基準。治療護盾加分也採計實際保人量。
// 計分板大數字、對局卡片、MVP／ACE、英雄頁、好友比較頁（含「打法」）都用它。

/** 本場貢獻的單場標準差約 20（2026-10-24 全體 19.7），差 4 分以上才上色 */
export const WORK_GAP = 4
export const WORK = "contribution.work"
export const WORK_STATUS = "contribution.score_status"
/** 有本場貢獻的場次（重開局、不完整的對局沒有分數）：算誤差範圍的樣本數 */
export const WORK_GAMES = "contribution.scored_games"

/** 本場貢獻的八個計分基因：key＝基因分數（0～100，50＝同出裝定位的平均），pts＝這一項讓總分加減幾分，weight＝占總分的權重（%） */
export const WORK_PARTS = [
  { key: "contribution.gene_dmg", pts: "contribution.pts_dmg", label: "輸出", weight: 23, hint: "每分鐘對英雄傷害。坦克與輔助的輸出只加分，基因分數仍顯示相對於同定位的輸出表現。" },
  { key: "contribution.gene_soak", pts: "contribution.pts_soak", label: "承傷", weight: 19, hint: "每分鐘承受＋自身減免的傷害（護甲、魔抗、護盾擋下的都算）；只加不扣：扛得比同出裝定位多才加分，走位好、吃得少的後排不會被扣。分不出有效開戰或無效吃傷" },
  { key: "contribution.gene_kill", pts: "contribution.pts_kill", label: "擊殺", weight: 14, hint: "擊殺占比（自己擊殺 ÷ 我方擊殺）和輸出取小：殺得多而且打得多才加分，只會尾刀、輸出低的拿不到；只加不扣" },
  { key: "contribution.gene_heal", pts: "contribution.pts_heal", label: "治療護盾", weight: 18, hint: "每分鐘治療＋護盾隊友（不含自補）。加分一半看實際保人量，一半看高於同定位基準的部分。輔助的加分按原值的 5/6 計入。基因分數仍用同定位基準。缺賽後統計時這一項不計分" },
  { key: "contribution.gene_cc", pts: "contribution.pts_cc", label: "控場", weight: 11, hint: "每分鐘控制敵人的時間；只加不扣：控得比同出裝定位多才加分，技能組沒有控場（卡特、易大師）不會被扣" },
  { key: "contribution.gene_obj", pts: "contribution.pts_obj", label: "推塔", weight: 7, hint: "每分鐘對建築的傷害；和勝負綁得最緊（拆塔就是贏），所以權重不高；只加不扣" },
  { key: "contribution.gene_wave", pts: "contribution.pts_wave", label: "清兵", weight: 5, hint: "每分鐘對小兵的傷害；只加不扣" },
  { key: "contribution.gene_anti", pts: "contribution.pts_anti", label: "功能裝", weight: 3, hint: "終場帶重創／破盾裝，估計擋掉的敵方治療與護盾；只加不扣：沒出也不扣。只看有沒有帶，不知道實際命中多少" },
] as const
export const WORK_WEIGHTS_TEXT =
  `一般權重 ${WORK_PARTS.map(({ label, weight }) => `${label} ${weight}%`).join("、")}。\n` +
  "坦克與輔助改用輸出 13%、承傷 25%、控場 15%。這兩個定位的輸出只加分。輔助的承傷高於定位基準半個標準差後，超過的部分按 40% 計分。輔助的治療護盾權重折算為 15%。"
/** 整體校正（每個人一樣、負的）：多數項目只加不扣，扣掉它平均才是 50。加減分加起來再加上它＝總分 − 50 */
export const WORK_BASE = "contribution.pts_base"
export const WORK_MEASURES = [WORK, WORK_BASE, ...WORK_PARTS.flatMap((c) => [c.key, c.pts])]

/** 本場貢獻（0～100，50＝校準時的整體基準） */
export const workScore = (r: CubeRow | undefined) => (r ? num(r[WORK]) : null)
/** 這一列的本場貢獻是不是暫估（沒有賽後統計的治療護盾隊友量） */
export const isEstimate = (r: CubeRow | undefined) => r?.[WORK_STATUS] === "estimate"

/** 一批參賽者（鍵：platform_id:game_id:participant_id）各自的本場貢獻。
 *  parts＝true 時連各項一起查。一批不要超過 50 個鍵，查詢走 GET，網址才不會太長。 */
export function useContribution(keys: string[], parts = false): Map<string, CubeRow> {
  const res = useCube(
    keys.length
      ? {
          dimensions: ["participants.participant_key", WORK_STATUS],
          measures: parts ? WORK_MEASURES : [WORK],
          filters: [{ member: "participants.participant_key", operator: "equals", values: keys }],
          limit: keys.length,
        }
      : null,
  )
  return new Map(res.rows.map((r) => [String(r["participants.participant_key"]), r]))
}

export type ContribTag = "MVP" | "ACE"

/** 這一隊（五個人）裡的本場貢獻最高才有標籤：贏的一隊是 MVP、輸的一隊是 ACE。
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

/** 一批對局卡片（一批不要超過 50 張）上各自的本場貢獻與 MVP／ACE。
 *  標籤要比同隊五個人，卡片只有自己那一列，所以用 matches.game_id 一次查整批的十個人，
 *  隊伍歸屬用卡片帶的 roster 對。team_id 在語意層是私有欄位，不能直接查。 */
export function useCardContribution(
  rows: CardRow[],
): Map<string, { score: number | null; tag?: ContribTag; estimate: boolean }> {
  const gameIds = [...new Set(rows.map((r) => r.game_id))]
  const res = useCube(
    gameIds.length
      ? {
          dimensions: ["participants.participant_key", WORK_STATUS],
          measures: [WORK],
          filters: [{ member: "matches.game_id", operator: "equals", values: gameIds.map(String) }],
          limit: gameIds.length * 10,
        }
      : null,
  )
  const scores = new Map(res.rows.map((r) => [String(r["participants.participant_key"]), workScore(r)]))
  const estimates = new Map(res.rows.map((r) => [String(r["participants.participant_key"]), isEstimate(r)]))
  const key = (m: { platform_id: string; game_id: number }, pid: number) => `${m.platform_id}:${m.game_id}:${pid}`
  return new Map(
    rows.map((m) => {
      const score = scores.get(key(m, m.participant_id)) ?? null
      const team = (m.roster ?? []).filter((p) => p.team_id === m.team_id).map((p) => scores.get(key(m, p.participant_id)) ?? null)
      return [
        key(m, m.participant_id),
        { score, tag: contribTagOf(score, team, m.win === 1), estimate: estimates.get(key(m, m.participant_id)) ?? false },
      ]
    }),
  )
}
