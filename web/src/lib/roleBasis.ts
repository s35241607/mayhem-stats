import { useCallback, useEffect, useState } from "react"
import type { CubeFilter } from "@/lib/cube"
import { BUILD_ROLES, PRIMARY_ONLY, ROLES } from "@/pages/shared"

/** 英雄類型用哪一種定義分組。
 *  - primary：英雄的官方主定位（客戶端列的第一個），每場只算一類
 *  - all：官方定位含次定位，雙定位的英雄兩類都算
 *  - build：依終場出裝判斷的定位（builds.build_role），同一隻英雄不同場可能不一樣
 *  官方定位看的是「這隻英雄是什麼」，出裝定位看的是「這場實際怎麼玩」，兩個都保留讓使用者切換。 */
export type RoleBasis = "primary" | "all" | "build"

export type RoleSpec = {
  basis: RoleBasis
  /** 分組用的 Cube 維度 */
  dimension: string
  /** 六邊形的頂點（固定順序，形狀才能跨篩選比較） */
  labels: string[]
  /** 依類型分組時一律要帶的條件 */
  base: CubeFilter[]
  /** 篩某一類時的條件 */
  filterFor: (role: string) => CubeFilter[]
  /** 標籤上的簡稱，例如「坦克（主定位）」 */
  tag: string
  /** 說明文字 */
  caption: string
}

export function roleSpec(basis: RoleBasis): RoleSpec {
  if (basis === "build") {
    return {
      basis,
      dimension: "builds.build_role",
      labels: BUILD_ROLES,
      base: [],
      filterFor: (role) => [{ member: "builds.build_role", operator: "equals", values: [role] }],
      tag: "出裝",
      caption: "依每場終場出裝判斷（AD 輸出、AP 輸出、坦克、AD 鬥士、AP 坦、輔助），同一隻英雄不同場可能不一樣；太早結束沒成裝的場次不列入",
    }
  }
  const primary = basis === "primary"
  return {
    basis,
    dimension: "champion_roles.name",
    labels: ROLES,
    base: primary ? PRIMARY_ONLY : [],
    filterFor: (role) => [{ member: "champion_roles.name", operator: "equals", values: [role] }, ...(primary ? PRIMARY_ONLY : [])],
    tag: primary ? "主定位" : "含次定位",
    caption: primary
      ? "英雄的官方定位，每場只算主定位（客戶端列出的第一個），六類加起來就是總場次"
      : "英雄的官方定位，雙定位的英雄兩類都算（例如蓋倫同時算鬥士和坦克），佔比加起來會超過 100%",
  }
}

const KEY = "mayhem-role-basis"
const EVENT = "mayhem-role-basis"

const read = (): RoleBasis => {
  try {
    const v = localStorage.getItem(KEY)
    return v === "all" || v === "build" ? v : "primary"
  } catch {
    return "primary"
  }
}

/** 定位依據，英雄頁與儀表板共用：在一頁切了，另一頁也跟著換（記在這台瀏覽器）。 */
export function useRoleBasis(): [RoleBasis, (basis: RoleBasis) => void] {
  const [basis, setBasis] = useState<RoleBasis>(read)
  useEffect(() => {
    const sync = () => setBasis(read())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  const update = useCallback((next: RoleBasis) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* 存不了就只在這一頁生效 */
    }
    setBasis(next)
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [basis, update]
}
