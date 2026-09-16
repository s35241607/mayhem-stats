import { useCallback } from "react"
import type { CubeFilter, CubeQuery } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import type { Family } from "@/lib/drill"

/** 把全域條件（看誰、模式、期間、全站下鑽）與這頁的片段、自訂篩選套進下鑽查詢。
 *
 *  participants 家族直接走 apply()。teammates 家族不能：apply() 用 participants.puuid 鎖人，
 *  而 teammates 和 participants 之間沒有 join 路徑。這裡改用 subject_puuid 鎖人（隊友頁同樣做法），
 *  並回報哪些條件套不上，畫面要說出來，不能默默忽略。 */
export function useDrillScope({
  family,
  scope,
  segments,
  filters,
}: {
  family: Family
  scope: "account" | "all"
  segments: string[]
  filters: CubeFilter[]
}): { scoped: (query: CubeQuery) => CubeQuery; ignored: string[] } {
  const { apply, account, queueId, timeFilter, drills } = useFilters()

  const scoped = useCallback(
    (query: CubeQuery): CubeQuery => {
      if (family === "participants") {
        return apply(
          {
            ...query,
            ...(segments.length ? { segments } : {}),
            filters: [...filters, ...(query.filters ?? [])],
          },
          scope,
        )
      }
      const base: CubeFilter[] = []
      if (account) base.push({ member: "teammates.subject_puuid", operator: "equals", values: [account.puuid] })
      if (queueId) base.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
      return {
        ...query,
        ...timeFilter("matches.played_at"),
        filters: [...base, ...filters.filter(fitsTeammates), ...(query.filters ?? [])],
      }
    },
    [family, scope, segments, filters, apply, account, queueId, timeFilter],
  )

  const ignored: string[] = []
  if (family === "teammates") {
    if (scope === "all") ignored.push("「全部玩家」（同場關係一定要以某個人為視角，這裡固定看目前帳號）")
    if (segments.length) ignored.push("條件片段")
    if (filters.some((f) => !fitsTeammates(f))) ignored.push("對局表現類的自訂篩選")
    if (drills.length) ignored.push("全站下鑽條件")
  }
  return { scoped, ignored }
}

const fitsTeammates = (f: CubeFilter) => f.member.startsWith("teammates.") || f.member.startsWith("matches.")
