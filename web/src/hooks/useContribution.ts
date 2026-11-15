import { useCube } from "@/hooks/useCube"
import { num, type CubeRow } from "@/lib/cube"

// 貢獻的分數只有一個，定義在語意層（cube/model/cubes/contribution.yml，規格見 docs/contribution-scoring.md）；畫法在 components/Contribution.tsx。
// 本場貢獻（contribution.work，v5.4 / v5-B 修訂版）：100% 跨場絕對尺度（依對局時長 16.5 分鐘、敵方前排數與對局血腥度校正），
// 依出裝定位加總九個基因維度（非主 C 定位高傷害享動態轉型加成與以攻代守副軸豁免，含擊殺／拆建築時間軸與經濟效率高光加分／失誤扣分），且不再強制各定位或各玩家歸 50。
// 計分板大數字、對局卡片、MVP／ACE、英雄頁、好友比較頁（含「打法」）都用它。

/** 本場貢獻與各基因的顏色區分門檻：差 4 分以上才上勝／敗色 */
export const WORK_GAP = 4
export const WORK = "contribution.work"
export const WORK_STATUS = "contribution.score_status"
/** 有本場貢獻的場次（重開局、不完整的對局沒有分數）：算誤差範圍的樣本數 */
export const WORK_GAMES = "contribution.scored_games"

/** 本場貢獻的九個計分基因：key＝基因分數（0～100，50＝同出裝定位基準），pts＝這一項讓總分加減幾分，weight＝說明用的定位比重 */
export const WORK_PARTS = [
  { key: "contribution.gene_dmg", pts: "contribution.pts_dmg", label: "輸出", weight: "刺 41% · 射 40% · 法 38% · 鬥 28%+ · 坦 10%+ · 輔 12%+", hint: "經時長冪次、敵方前排硬度（0～5 人）與對局血腥度校正的每分鐘對英雄傷害。非主 C 定位（鬥／坦／輔）打出高傷害時，邊際比重自動遞增至 38%～40% 並享跨界高光獎勵。" },
  { key: "contribution.gene_soak", pts: "contribution.pts_soak", label: "承傷", weight: "坦 30% · 鬥 20% · 輔 ≤27%（高輸出享免扣）", hint: "經時長冪次校正的有效承傷（0.62×減免＋0.38×承受）。坦／鬥納入核心（若打出高輸出，負向承傷可獲以攻代守豁免），輔助依有效承傷平滑混入坦克承傷。" },
  { key: "contribution.gene_kill", pts: "contribution.pts_kill", label: "擊殺", weight: "刺 17% · 射 15% · 法 13% · 鬥 11%+ · 坦/輔高傷解鎖", hint: "每分鐘擊殺數經 spow 標準化，計分時與輸出基準連動取 min(zr_k, zr_d + 0.4)，避免低輸出純尾刀灌水；坦克與輔助在有高輸出支撐時亦解鎖有效擊殺加分。" },
  { key: "contribution.gene_ka", pts: "contribution.pts_ka", label: "參團", weight: "坦 32% · 輔 ≥32% · 射/刺 29% · 法 28% · 鬥 27%", hint: "經時長、敵方前排數與他方擊殺血腥度校正的每分鐘擊殺＋助攻與 65% 對局時間後的後期關鍵參團（輔助採 70% 同定位＋30% 全局混合，暫估局再提高比重補救無護盾資訊）。" },
  { key: "contribution.gene_heal", pts: "contribution.pts_heal", label: "治療護盾", weight: "輔 ≤40%（暫估補護盾先驗）· 非輔 EOG 順手補血", hint: "每分鐘治療＋護盾隊友。缺 EOG 統計的暫估局對治療乘 h_scale 對齊，輔助另依同英雄未捕獲護盾先驗＋輔助裝數量與參團度估算護盾（硬控／開戰與高傷輔助享坦度／控場／輸出保底）；非坦輔僅於 EOG 實測局超過 +500/分計順手保人獎。" },
  { key: "contribution.gene_cc", pts: "contribution.pts_cc", label: "控場", weight: "坦 20% · 輔 ≥10% · 法 8% · 鬥 7% · 射/刺正向加分", hint: "每分鐘控制人數時間與累計控場時長混合（0.65×zr_c＋0.35×max(zr_c, zr_ccdur)）。射/刺 0 控場不扣分，坦/鬥/法/輔打出高輸出（或高承傷）時亦豁免負向控場扣分；射/刺/法/鬥/輔 zr_cc > 0.65 再享功能控場獎。" },
  { key: "contribution.gene_obj", pts: "contribution.pts_obj", label: "推塔", weight: "射/刺 10% · 法/坦 8% · 鬥 7% · 輔 6%", hint: "經時長校正的每分鐘對建築傷害（turret_dmg，混入跨場全局尺度）；單純靠對建築傷害與獨自單人拆塔另併入高光加分（不含首塔與多人分攤）。" },
  { key: "contribution.gene_wave", pts: "contribution.pts_wave", label: "清兵", weight: "射 6% · 法 5% · 刺 3%", hint: "每分鐘對小兵傷害（總輸出 − 對英雄 − 對建築，隨對局時長等比校正），適度計入輸出清線定位核心。" },
  { key: "contribution.gene_anti", pts: "contribution.pts_anti", label: "功能裝", weight: "額外高光加分（0～+2.5）", hint: "終場帶重創／破盾裝估計擋掉的敵方治療與護盾，併入高光加分（只加不扣）。僅依終場裝備估算，不代表實際命中率。" },
] as const

/** 核心之外的事件與節奏修飾項：高光加分（≥ 0）與失誤扣分（≤ 0） */
export const WORK_MODS = [
  { pts: "contribution.pts_bonus", label: "高光加分", hint: "超出定位常態的多殺／輔助團戰連鎖、推塔傷害（zr_o > 0.5）與獨自一人拆毀建築、±10 秒團戰換命優勢與單殺／輔助後期關鍵在場、每千金傷害／綜合影響力（不含首殺、首塔與終結；含功能裝與單項工具獎合計上限 +15）" },
  { pts: "contribution.pts_penalty", label: "失誤扣分", hint: "純單抓孤立死亡（±10 秒內友方無擊殺且無其他友軍死亡，且占比 > 25%）、65% 後後期孤死、極低存在感隱身（上限 −18）" },
] as const

export const WORK_WEIGHTS_TEXT =
  "核心定位比重（100% 跨場尺度＋時長／前排／血腥度校正＋高傷動態轉型）：\n" +
  "・射手：輸出 40%（高傷 +4%）、參團 29%（含後期 12%）、擊殺 15%、推塔 10%、清兵 6%（高控場僅加分）\n" +
  "・刺客：輸出 41%（高傷 +4%）、參團 29%（含後期 12%）、擊殺 17%、推塔 10%、清兵 3%（高控場僅加分）\n" +
  "・法師：輸出 38%（高傷 +5%）、參團 28%（含後期 12%）、擊殺 13%、控場 8%（高傷免扣負控場）、推塔 8%、清兵 5%\n" +
  "・鬥士：輸出 28%（高傷邊際 40%）、參團 27%、承傷 20%（高傷免扣負承傷）、擊殺 11%（高傷 15%）、推塔 7%、控場 7%\n" +
  "・坦克：參團 32%、承傷 30%、控場 20%（高傷／高坦免扣負控場）、輸出 10%（高傷邊際 38%+跨界獎）、擊殺（高傷解鎖 10%）、推塔 8%\n" +
  "・輔助：EOG 局治療護盾與承傷依有效坦度共占 40%（最高承傷 27%）、參團 32%（含後期 10%）、輸出 12%（高傷邊際 40%+跨界獎）、控場 10%、擊殺（高傷解鎖 9%）、推塔 6%\n" +
  "核心超過 +15 分後按 1.18 倍拉開強弱，再加高光加分（上限 +15）與失誤扣分（上限 −18），不強制各定位歸 50。"

/** 全局基準偏移（僅依 EOG／暫估資料來源固定校正）：全部加減分（含高光／失誤）加上它＝總分 − 50 */
export const WORK_BASE = "contribution.pts_base"
export const WORK_MEASURES = [WORK, WORK_BASE, ...WORK_PARTS.flatMap((c) => [c.key, c.pts]), ...WORK_MODS.map((m) => m.pts)]

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
