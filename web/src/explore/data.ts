/** 工作台的取數：把規格變成 Cube 查詢、套上全域條件、把計算欄位算進每一列。 */
import { useCallback, useMemo } from "react"
import { useCube } from "@/hooks/useCube"
import { num, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { evaluate, parse } from "./calc"
import { MAX_COLS, MAX_ROWS, isCalc, specDataset, specQuery, type Dataset, type Spec } from "./spec"

/** 把全域條件（看誰、模式、期間、版本、全站下鑽）套進查詢。每個資料集鎖人的欄位不同：
 *  對局表現與增幅組合走 filters 的 apply()；同場玩家和 participants 之間沒有 join 路徑，
 *  要用 subject_puuid 鎖人、自己補模式／版本／期間。套不上的條件列在 ignored，畫面要講出來。 */
export function useScoped(dataset: Dataset, scope: Spec["scope"]): { scoped: (q: CubeQuery) => CubeQuery; ignored: string[] } {
  const { apply, account, queueId, activeVersions, timeFilter, drills } = useFilters()
  const scoped = useCallback(
    (q: CubeQuery): CubeQuery => {
      if (dataset !== "teammates") return apply(q, scope, dataset)
      const base: CubeFilter[] = []
      if (account) base.push({ member: "teammates.subject_puuid", operator: "equals", values: [account.puuid] })
      if (queueId) base.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
      if (activeVersions.length) base.push({ member: "matches.patch", operator: "equals", values: activeVersions })
      const { segments: _dropped, ...rest } = q
      void _dropped
      return { ...rest, ...timeFilter("matches.played_at"), filters: [...base, ...(q.filters ?? [])] }
    },
    [dataset, scope, apply, account, queueId, activeVersions, timeFilter],
  )
  const ignored: string[] = []
  if (dataset === "teammates") {
    if (scope === "all") ignored.push("「全部玩家」（同場關係一定以某個人為視角，固定看目前帳號）")
    if (drills.length) ignored.push("全站下鑽條件")
  }
  return { scoped, ignored }
}

/** 把計算欄位算進每一列（鍵是 calc:<id>）。公式壞掉的那一欄整欄是 null，其他欄不受影響。
 *  佔比、排名是對「這一組列」算的，所以樞紐表每個層級各自呼叫一次。 */
export function withCalcs(spec: Spec, rows: CubeRow[]): CubeRow[] {
  const used = spec.calcs.filter((c) => spec.values.includes(`calc:${c.id}`))
  if (!used.length || !rows.length) return rows
  const columns = used.map((c) => {
    try {
      return evaluate(parse(c.formula), rows.length, (i, title) => num(rows[i][c.refs[title] ?? ""]))
    } catch {
      return rows.map(() => null)
    }
  })
  return rows.map((r, i) => {
    const out: CubeRow = { ...r }
    used.forEach((c, k) => (out[`calc:${c.id}`] = columns[k][i]))
    return out
  })
}

function sortAndLimit(spec: Spec, rows: CubeRow[], limit: number): CubeRow[] {
  let out = rows
  // 依計算欄位排序只能在前端做（Cube 不知道它）；其餘的排序已經在查詢裡
  if (spec.sort && isCalc(spec.sort.by)) {
    const key = spec.sort.by
    const dir = spec.sort.dir === "asc" ? 1 : -1
    out = [...rows].sort((a, b) => dir * ((num(a[key]) ?? -Infinity) - (num(b[key]) ?? -Infinity)))
  }
  return limit > 0 && out.length > limit ? out.slice(0, limit) : out
}

export type SpecResult = { rows: CubeRow[]; loading: boolean; refreshing: boolean; error: string | null; query: CubeQuery | null; ignored: string[] }

/** 平面結果：一個查詢，維度是呼叫端指定的那幾個（表格是列＋欄＋顏色，圖表是類別＋顏色）。
 *  enabled 為 false 時不查（規格還畫不出東西、或這個元件現在不需要平面結果）。 */
export function useSpecRows(spec: Spec, dims: string[], enabled = true): SpecResult {
  const dataset = specDataset(spec)
  const { scoped, ignored } = useScoped(dataset, spec.scope)
  const dimsKey = dims.join("|")
  const ready = enabled && spec.values.length > 0
  const query = useMemo(
    () => (ready ? scoped(specQuery(spec, dimsKey ? dimsKey.split("|") : [])) : null),
    [ready, scoped, spec, dimsKey],
  )
  const res = useCube(query)
  const rows = useMemo(() => sortAndLimit(spec, withCalcs(spec, res.rows), spec.limit), [spec, res.rows])
  return { rows, loading: res.loading, refreshing: res.refreshing, error: res.error, query, ignored }
}

/** 樞紐表一個層級的結果：列維度取前 r 個、欄維度取前 c 個 */
export type PivotLevel = { r: number; c: number; rows: CubeRow[] }
export type PivotResult = { levels: Map<string, PivotLevel>; loading: boolean; refreshing: boolean; error: string | null; ignored: string[]; queries: number }
export const levelKey = (r: number, c: number) => `${r}:${c}`

/** 樞紐表的資料：每個「列前綴 × 欄前綴」各查一次。
 *
 *  小計與總計不能拿下一層的數字加總——勝率、平均、不重複計數都不是可加的，
 *  以增幅或裝備分組時連場次都會重複算。所以每一層都讓語意層自己算一次（同一組條件、少幾個維度）。
 *  hook 的數量必須固定，所以一律開 (MAX_ROWS+1)×(MAX_COLS+1) 個槽，用不到的傳 null（不查）。
 *  關掉小計只是不顯示：列與欄的結構（有哪些組、怎麼排）仍然要靠各層的結果。 */
export function usePivot(spec: Spec, enabled = true): PivotResult {
  const dataset = specDataset(spec)
  const { scoped, ignored } = useScoped(dataset, spec.scope)
  const R = Math.min(spec.rows.length, MAX_ROWS)
  const C = Math.min(spec.cols.length, MAX_COLS)
  const ready = enabled && spec.values.length > 0

  const slot = (r: number, c: number): CubeQuery | null => {
    if (!ready || r > R || c > C) return null
    return scoped(specQuery(spec, [...spec.rows.slice(0, r), ...spec.cols.slice(0, c)], { sort: false }))
  }
  // 固定 12 個槽（4 × 3）。順序不能變
  const s00 = useCube(slot(0, 0)), s01 = useCube(slot(0, 1)), s02 = useCube(slot(0, 2))
  const s10 = useCube(slot(1, 0)), s11 = useCube(slot(1, 1)), s12 = useCube(slot(1, 2))
  const s20 = useCube(slot(2, 0)), s21 = useCube(slot(2, 1)), s22 = useCube(slot(2, 2))
  const s30 = useCube(slot(3, 0)), s31 = useCube(slot(3, 1)), s32 = useCube(slot(3, 2))
  const grid = [[s00, s01, s02], [s10, s11, s12], [s20, s21, s22], [s30, s31, s32]]

  const active: { r: number; c: number; res: ReturnType<typeof useCube> }[] = []
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) if (slot(r, c)) active.push({ r, c, res: grid[r][c] })
  // 依賴陣列的長度要固定：放全部 12 個槽的 rows，不是只放有在用的
  const stamp = grid.flat().map((g) => g.rows)

  const levels = useMemo(() => {
    const map = new Map<string, PivotLevel>()
    for (const a of active) map.set(levelKey(a.r, a.c), { r: a.r, c: a.c, rows: withCalcs(spec, a.res.rows) })
    return map
    // active 每次渲染都是新陣列；真正會變的是各槽回來的 rows（stamp）與規格
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, ready, ...stamp])

  return {
    levels,
    loading: active.some((a) => a.res.loading),
    refreshing: active.some((a) => a.res.refreshing),
    error: active.find((a) => a.res.error)?.res.error ?? null,
    ignored,
    queries: active.length,
  }
}
