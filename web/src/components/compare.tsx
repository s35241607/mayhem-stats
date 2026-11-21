import { useMemo } from "react"
import { useCube } from "@/hooks/useCube"
import { num, type CubeQuery, type CubeRow } from "@/lib/cube"
import type { GridColumn } from "@/components/AgTable"
import { cn } from "@/lib/utils"

/** 「對照前期」接到表格：同一張表用對照期間再查一次（只要場次與勝場），依名稱併回每一列。
 *
 *  query 傳 `applyCompare(…)` 的結果——沒開對照時是 null，不查、也不加欄位。
 *  併回的欄位：cmp.games、cmp.winrate、cmp.delta（本期勝率 − 前期勝率，前期沒打過是 null）。
 *  勝率一律用 wins／games 自己除：不同期間的勝率不能拿平均來比。 */
export function useComparedRows(rows: CubeRow[], nameKey: string, query: CubeQuery | null, cube = "participants"): CubeRow[] {
  const prev = useCube(query)
  const active = !!query
  return useMemo(() => {
    if (!active) return rows
    const before = new Map(prev.rows.map((r) => [String(r[nameKey]), r]))
    return rows.map((r) => {
      const p = before.get(String(r[nameKey]))
      const games = num(p?.[`${cube}.games`]) ?? 0
      const wins = num(p?.[`${cube}.wins`]) ?? 0
      const winrate = games ? (100 * wins) / games : null
      const now = num(r[`${cube}.winrate`]) ?? (num(r[`${cube}.games`]) ? (100 * (num(r[`${cube}.wins`]) ?? 0)) / num(r[`${cube}.games`])! : null)
      return { ...r, "cmp.games": games, "cmp.winrate": winrate, "cmp.delta": winrate !== null && now !== null ? now - winrate : null }
    })
  }, [rows, prev.rows, nameKey, cube, active])
}

/** 對照欄：主數字是勝率差（pp），下面一行是前期的勝率與場次。label 寫明比的是哪一段（filters 的 compare.label）。
 *  放在 useMemo 的欄位陣列裡，沒開對照時不要加。 */
export function compareColumns(label: string): GridColumn[] {
  return [
    {
      key: "cmp.delta",
      title: `對照${label}`,
      kind: "metric",
      minWidth: 150,
      cell: (r) => {
        const delta = r["cmp.delta"] as number | null
        const games = (r["cmp.games"] as number | null) ?? 0
        const winrate = r["cmp.winrate"] as number | null
        if (!games || winrate === null) return <span className="text-xs text-muted-foreground">前期沒打過</span>
        return (
          <span className="flex flex-col items-end leading-tight">
            <span className={cn("font-mono font-semibold tabular-nums", delta === null ? "" : delta >= 0 ? "text-win" : "text-loss")}>
              {delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}pp`}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              前期 {winrate.toFixed(0)}%・{games} 場
            </span>
          </span>
        )
      },
    },
    { key: "cmp.winrate", title: "前期勝率", kind: "metric", hide: true, format: (n) => n.toFixed(1), suffix: "%" },
    { key: "cmp.games", title: "前期場次", kind: "metric", hide: true },
  ]
}
