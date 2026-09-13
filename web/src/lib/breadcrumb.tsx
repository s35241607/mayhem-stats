import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"

/** 頁面內的「目前鑽到哪」路徑。
 *
 *  各頁把自己的聚焦狀態登記成一層（點了某隻英雄、某個時段、某一場戰報…），
 *  AppShell 的標題列統一畫成麵包屑。點某一層 = 清掉比它更深的所有層。
 *  離開頁面時元件卸載，登記自動移除，不會殘留到別頁。 */
export type Crumb = {
  id: string
  /** 深度，越大越深。建議：頁面第一層 10、第二層 20、單場戰報 90 */
  order: number
  label: string
  clear: () => void
}

type Actions = {
  upsert: (c: Crumb) => void
  remove: (id: string) => void
}

const CrumbsContext = createContext<Crumb[]>([])
const ActionsContext = createContext<Actions>({ upsert: () => {}, remove: () => {} })

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  // actions 必須是穩定的物件：頁面只拿 actions，登記時才不會讓整頁跟著重新渲染
  const actions = useMemo<Actions>(
    () => ({
      upsert: (c) =>
        setCrumbs((prev) => {
          const i = prev.findIndex((x) => x.id === c.id)
          if (i >= 0 && prev[i].label === c.label && prev[i].order === c.order) return prev
          const next = i >= 0 ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]
          return next.sort((a, b) => a.order - b.order)
        }),
      remove: (id) => setCrumbs((prev) => (prev.some((x) => x.id === id) ? prev.filter((x) => x.id !== id) : prev)),
    }),
    [],
  )
  return (
    <ActionsContext.Provider value={actions}>
      <CrumbsContext.Provider value={crumbs}>{children}</CrumbsContext.Provider>
    </ActionsContext.Provider>
  )
}

/** 登記一層。label 為 null 表示目前沒有聚焦在這一層。 */
export function useCrumb(order: number, label: string | null, clear: () => void) {
  const id = useId()
  const { upsert, remove } = useContext(ActionsContext)
  // clear 每次渲染都是新函式，存在 ref 裡，登記的永遠呼叫最新的那個
  const clearRef = useRef(clear)
  clearRef.current = clear
  useEffect(() => {
    if (label === null) {
      remove(id)
      return
    }
    upsert({ id, order, label, clear: () => clearRef.current() })
  }, [id, order, label, upsert, remove])
  useEffect(() => () => remove(id), [id, remove])
}

export function useCrumbs() {
  return useContext(CrumbsContext)
}
