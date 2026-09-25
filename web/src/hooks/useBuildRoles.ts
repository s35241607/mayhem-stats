import { useCube } from "@/hooks/useCube"

/** 參賽者鍵：platform_id:game_id:participant_id，對應語意層的 participants.participant_key */
export const participantKey = (platformId: string, gameId: number, participantId: number) => `${platformId}:${gameId}:${participantId}`

/** 一批參賽者各自的出裝定位。資料來自 /api/matches、/api/match 的畫面都用它：
 *  定位的規則只在語意層有一份（builds.yml），拿參賽者鍵回頭向 Cube 查，不在後端另抄一份。
 *  查詢走 GET，呼叫端一批不要超過 50 個鍵，網址才不會太長。 */
export function useBuildRoles(keys: string[]): Map<string, string> {
  const roles = useCube(
    keys.length
      ? {
          dimensions: ["participants.participant_key", "builds.build_role"],
          filters: [{ member: "participants.participant_key", operator: "equals", values: keys }],
          limit: keys.length,
        }
      : null,
  )
  return new Map(roles.rows.map((r) => [String(r["participants.participant_key"]), String(r["builds.build_role"])]))
}
