import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻的分數，定義只有一份，在語意層（規格見 docs/contribution-scoring.md）；畫法在 components/Contribution.tsx：
//   本場貢獻（contribution_v2.work，cube/model/cubes/contribution_v2.yml）：這場可觀測的工作量，只和同一場另外九個人比，
//     權重依終場裝備的連續比例，再把實際打出來的最好表現算進去（v2.3）；最後扣掉同樣裝備組成的平均，50＝所有人的平均。
//     計分板大數字、對局卡片、MVP／ACE、好友比較頁、英雄頁都用它，沒有別的分數。
//   表現（perf，contribution.yml）：舊的當局表現分。只剩好友比較頁的「打法」（六項各自和同類型比）還在用。

/** 舊表現分的六項（好友比較頁的「打法」用）：每分鐘的實際數值，和同類型、同時長帶的人比 */
export const PERF_PARTS = [
  { key: "contribution.perf_dmg", label: "輸出", hint: "考慮死亡的傷害：對英雄傷害 ÷ √（死亡＋1），死得多會打折" },
  { key: "contribution.perf_soak", label: "承傷", hint: "扛傷效率：（承受＋自身減免）÷ √（死亡＋1），死得多會打折" },
  { key: "contribution.perf_minion", label: "清兵", hint: "每分鐘對小兵的傷害（估計＝總輸出 − 對英雄 − 對建築）" },
  { key: "contribution.perf_obj", label: "推塔", hint: "每分鐘對建築的傷害（有一半是結果：贏的一隊才拆得到塔）" },
  { key: "contribution.perf_cc", label: "控場", hint: "每分鐘控制敵人的時間" },
  { key: "contribution.perf_heal", label: "治療護盾", hint: "每分鐘有效治療＋護盾隊友，只在有治療或護盾隊友的場次計（舊場次沒有護盾的量，改用含自補的治療量）" },
] as const
export const PERF_MEASURES = ["contribution.perf", ...PERF_PARTS.map((c) => c.key)]

/** 本場貢獻 v2 的單場標準差約 20（2026-10-17 全體 19.7），門檻和表現分一樣用 4 */
export const WORK_GAP = 4
export const WORK = "contribution_v2.work"
export const WORK_STATUS = "contribution_v2.score_status"
/** 有本場貢獻的場次（重開局、不完整的對局沒有分數）：算誤差範圍的樣本數 */
export const WORK_GAMES = "contribution_v2.scored_games"

/** 本場貢獻的四項：每項 0～100，等於本場參考量是 50（治療護盾是固定換算，每分鐘 1250 是 50） */
export const WORK_PARTS = [
  { key: "contribution_v2.part_dmg", label: "輸出", hint: "每分鐘對英雄傷害，和本場參考量比（其他九人的量依裝備職責分到你的份）" },
  { key: "contribution_v2.part_soak", label: "承傷", hint: "每分鐘承受＋自身減免，和本場參考量比；只是承傷量，分不出有效開戰或無效吃傷" },
  { key: "contribution_v2.part_cc", label: "控場", hint: "每分鐘控制敵人的時間，和本場參考量比" },
  { key: "contribution_v2.part_heal", label: "治療護盾", hint: "每分鐘治療＋護盾隊友（固定換算，每分鐘 1250 是 50）；沒有賽後統計的場次改用含自補的治療量，是暫估" },
] as const
export const WORK_MEASURES = [WORK, ...WORK_PARTS.map((c) => c.key), "contribution_v2.base", "contribution_v2.cross_role", "contribution_v2.progress"]

/** 本場貢獻 v2（0～100，50＝所有人的平均；各種裝備組成的平均也都接近 50） */
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
