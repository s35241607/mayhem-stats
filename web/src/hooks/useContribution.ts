import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻的分數只有一個，定義在語意層（cube/model/cubes/contribution.yml，規格見 docs/contribution-scoring.md）；畫法在 components/Contribution.tsx。
// 本場貢獻（contribution.work）：八個基因（輸出、承傷、治療護盾、控場、K/DA、推塔、清兵、功能裝）先各自和同一場的人比，
// 再和同出裝定位的平均比，加權成總分；50＝同出裝定位的人的平均。每個人八項都算，坦克打出高輸出一樣加分。
// 計分板大數字、對局卡片、MVP／ACE、英雄頁、好友比較頁（含「打法」）都用它。

/** 本場貢獻的單場標準差約 20（2026-10-24 全體 19.7），差 4 分以上才上色 */
export const WORK_GAP = 4
export const WORK = "contribution.work"
export const WORK_STATUS = "contribution.score_status"
/** 有本場貢獻的場次（重開局、不完整的對局沒有分數）：算誤差範圍的樣本數 */
export const WORK_GAMES = "contribution.scored_games"

/** 本場貢獻的八個基因：key＝基因分數（0～100，50＝同出裝定位的平均），pts＝這一項讓總分加減幾分，weight＝占總分的權重（%） */
export const WORK_PARTS = [
  { key: "contribution.gene_dmg", pts: "contribution.pts_dmg", label: "輸出", weight: 25, hint: "每分鐘對英雄傷害" },
  { key: "contribution.gene_soak", pts: "contribution.pts_soak", label: "承傷", weight: 20, hint: "每分鐘承受＋自身減免的傷害（護甲、魔抗、護盾擋下的都算）；分不出有效開戰或無效吃傷" },
  { key: "contribution.gene_heal", pts: "contribution.pts_heal", label: "治療護盾", weight: 13, hint: "每分鐘治療＋護盾隊友（不含自補，只有賽後統計有）；沒有賽後統計的場次不計這一項，是暫估" },
  { key: "contribution.gene_cc", pts: "contribution.pts_cc", label: "控場", weight: 12, hint: "每分鐘控制敵人的時間" },
  { key: "contribution.gene_kda", pts: "contribution.pts_kda", label: "K/DA", weight: 12, hint: "參團率（擊殺＋助攻 ÷ 我方擊殺）與存活（死得少）各半；死亡有一半是結果，所以權重不高" },
  { key: "contribution.gene_obj", pts: "contribution.pts_obj", label: "推塔", weight: 8, hint: "每分鐘對建築的傷害；和勝負綁得最緊（拆塔就是贏），所以權重不高" },
  { key: "contribution.gene_wave", pts: "contribution.pts_wave", label: "清兵", weight: 6, hint: "每分鐘對小兵的傷害" },
  { key: "contribution.gene_anti", pts: "contribution.pts_anti", label: "功能裝", weight: 4, hint: "終場帶重創／破盾裝，估計擋掉的敵方治療與護盾；只看有沒有帶，不知道實際命中多少" },
] as const
export const WORK_MEASURES = [WORK, ...WORK_PARTS.flatMap((c) => [c.key, c.pts])]

/** 本場貢獻（0～100，50＝同出裝定位的人的平均） */
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
