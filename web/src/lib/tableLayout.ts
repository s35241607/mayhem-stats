import { useCallback, useState } from "react"

/** 使用者對一張表格做的版面調整：欄位順序、隱藏、凍結、寬度、排序。
 *  存在 localStorage（每張表一個 key），重新整理、換頁回來都還在。
 *  AgTable 存的是 AG Grid 自己的 column state；DataTable 存這個格式。 */
export type TableLayout = {
  order: string[]
  hidden: string[]
  /** 沒有這個欄位＝還沒動過，用欄位定義的預設凍結 */
  pinned?: string[]
  widths: Record<string, number>
  sort: { key: string; dir: "asc" | "desc" } | null
}

export const EMPTY_LAYOUT: TableLayout = { order: [], hidden: [], widths: {}, sort: null }

const PREFIX = "mayhem-table:"

export function readStored<T>(key: string | undefined): T | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeStored(key: string | undefined, value: unknown) {
  if (!key) return
  try {
    if (value === null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 私密視窗或儲存被封鎖：版面調整只在這次有效
  }
}

/** DataTable 用：讀一次存好的版面，之後每次改動都寫回去 */
export function useTableLayout(key: string | undefined) {
  const [layout, setState] = useState<TableLayout>(() => ({ ...EMPTY_LAYOUT, ...readStored<TableLayout>(key) }))
  // key 換了（例如數據總表切換分組）就讀那一組自己的版面
  const [loadedKey, setLoadedKey] = useState(key)
  let current = layout
  if (loadedKey !== key) {
    current = { ...EMPTY_LAYOUT, ...readStored<TableLayout>(key) }
    setLoadedKey(key)
    setState(current)
  }
  const setLayout = useCallback(
    (update: (prev: TableLayout) => TableLayout) =>
      setState((prev) => {
        const next = update(prev)
        writeStored(key, next)
        return next
      }),
    [key],
  )
  const reset = useCallback(() => {
    writeStored(key, null)
    setState(EMPTY_LAYOUT)
  }, [key])
  return { layout: current, setLayout, reset }
}

/** 把 ids 依存好的順序排：存過的照存的順序，新出現的欄位接在原本的相對位置後面 */
export function applyOrder(ids: string[], order: string[]): string[] {
  if (!order.length) return ids
  const known = order.filter((id) => ids.includes(id))
  const result = [...known]
  ids.forEach((id, i) => {
    if (result.includes(id)) return
    // 新欄位放在它原本前一欄的後面
    const prev = ids.slice(0, i).reverse().find((p) => result.includes(p))
    result.splice(prev ? result.indexOf(prev) + 1 : 0, 0, id)
  })
  return result
}

/** 把 id 從原位置移到 target 的位置（拖曳排序共用） */
export function moveId(ids: string[], id: string, target: string): string[] {
  const from = ids.indexOf(id)
  const to = ids.indexOf(target)
  if (from < 0 || to < 0 || from === to) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
