/** 存在伺服器的分析卡片與儀表板（/api/explore/items，後端存成 BASE_DIR 下的一個 JSON 檔）。
 *  本機一律可寫；對外的唯讀鏡像只有管理員能寫，其他人看得到、改不了（canEdit）。 */
import { useCallback, useEffect, useState } from "react"
import type { Spec } from "./spec"

/** 儀表板上的一格：哪張卡片、佔幾欄（12 欄制）、多高 */
export type Tile = { card: string; w: 4 | 6 | 8 | 12; h: 260 | 340 | 440 }
export type BoardSpec = { v: 1; tiles: Tile[] }

export type CardItem = { id: string; kind: "card"; name: string; spec: Spec; updated: number }
export type BoardItem = { id: string; kind: "board"; name: string; spec: BoardSpec; updated: number }
export type Item = CardItem | BoardItem

type State = { items: Item[]; canEdit: boolean; loading: boolean; error: string | null }

let cache: State | null = null
const listeners = new Set<(s: State) => void>()
const publish = (next: State) => {
  cache = next
  listeners.forEach((fn) => fn(next))
}

async function load() {
  try {
    const res = await fetch("/api/explore/items")
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? "讀取失敗")
    publish({ items: body.items ?? [], canEdit: !!body.canEdit, loading: false, error: null })
  } catch (e) {
    publish({ items: cache?.items ?? [], canEdit: cache?.canEdit ?? false, loading: false, error: (e as Error).message })
  }
}

/** 全頁共用一份清單：工作台存了一張卡片，儀表板分頁馬上看得到，不必各自重抓 */
export function useItems() {
  const [state, setState] = useState<State>(cache ?? { items: [], canEdit: false, loading: true, error: null })
  useEffect(() => {
    listeners.add(setState)
    if (!cache) void load()
    else setState(cache)
    return () => void listeners.delete(setState)
  }, [])

  /** 存一筆（有 id 就是覆寫）。成功回存好的項目，失敗丟 Error（訊息是後端給的中文） */
  const save = useCallback(async (item: { id?: string; kind: Item["kind"]; name: string; spec: Spec | BoardSpec }): Promise<Item> => {
    const res = await fetch("/api/explore/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? "儲存失敗")
    const saved = body.item as Item
    const prev = cache?.items ?? []
    publish({
      items: prev.some((i) => i.id === saved.id) ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved],
      canEdit: cache?.canEdit ?? true,
      loading: false,
      error: null,
    })
    return saved
  }, [])

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/explore/items/${encodeURIComponent(id)}`, { method: "DELETE" })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? "刪除失敗")
    publish({ items: (cache?.items ?? []).filter((i) => i.id !== id), canEdit: cache?.canEdit ?? true, loading: false, error: null })
  }, [])

  const cards = state.items.filter((i): i is CardItem => i.kind === "card")
  const boards = state.items.filter((i): i is BoardItem => i.kind === "board")
  return { ...state, cards, boards, save, remove }
}
