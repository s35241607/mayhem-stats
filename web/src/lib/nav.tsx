import { createContext, useContext } from "react"
import type { PageId } from "@/components/AppShell"

/** 頁面裡的「看全部 →」要能換頁。換頁狀態在 App 最上層，用 context 往下傳，
 *  免得每一頁都要多收一個 onNavigate 參數。 */
export const NavContext = createContext<(page: PageId) => void>(() => {})

export function useNavigate() {
  return useContext(NavContext)
}
