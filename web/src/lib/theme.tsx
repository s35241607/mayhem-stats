import { createContext, useContext, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"

// 色票依序是：底色、介面強調、勝、敗。勝敗兩極與資料色都跑過 dataviz 的配色驗證（見 index.css 開頭）。
export const THEMES = [
  { id: "neon", label: "霓虹", hint: "深藍黑、青色光", dark: true, swatch: ["#070b16", "#22d3ee", "#129bc9", "#e3437c"] },
  { id: "matrix", label: "終端", hint: "黑綠、螢光綠", dark: true, swatch: ["#040906", "#3ee08f", "#17a874", "#df5f2e"] },
  { id: "lava", label: "熔岩", hint: "深灰藍、橘色（原本的配色）", dark: true, swatch: ["#131a26", "#f07a3c", "#20a3a8", "#e0564e"] },
  { id: "violet", label: "紫電", hint: "深紫、紫光", dark: true, swatch: ["#0a0714", "#c084fc", "#2f9fd8", "#e0508f"] },
  { id: "daylight", label: "晨光", hint: "冷白、寶藍", dark: false, swatch: ["#f3f6fb", "#2563eb", "#1f6fd1", "#d6395f"] },
  { id: "mint", label: "薄荷", hint: "淡綠白、翠綠", dark: false, swatch: ["#eef7f3", "#0f9d77", "#0088ab", "#d4502e"] },
  { id: "sakura", label: "櫻花", hint: "淡粉白、桃紅", dark: false, swatch: ["#fbf1f5", "#db2777", "#2a6fc9", "#d0461f"] },
  { id: "sand", label: "沙丘", hint: "米白、琥珀", dark: false, swatch: ["#f6f1e7", "#b45309", "#1d6fb8", "#c2410c"] },
] as const

export const THEME_GROUPS = [
  { label: "暗色", dark: true },
  { label: "亮色", dark: false },
] as const

export type ThemeId = (typeof THEMES)[number]["id"]

const STORAGE_KEY = "mayhem-theme"
const DEFAULT: ThemeId = "neon"

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : DEFAULT
  } catch {
    return DEFAULT
  }
}

/** 直接寫到 <html>。必須在 React 重新渲染「之前」做：圖表是在渲染時用
 *  getComputedStyle 讀 CSS 變數取色的，晚一步寫就會讀到上一個主題的顏色。 */
function apply(id: ThemeId) {
  document.documentElement.dataset.theme = id
}

type ThemeState = { theme: ThemeId; setTheme: (id: ThemeId) => void; isDark: boolean }

const ThemeContext = createContext<ThemeState>({ theme: DEFAULT, setTheme: () => {}, isDark: true })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const id = readStored()
    apply(id)
    return id
  })

  const setTheme = (id: ThemeId) => {
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* 無痕模式等情況存不了就算了，這次仍然生效 */
    }
    const run = () => {
      apply(id)
      // View Transition 在 callback 結束時拍新畫面，React 必須同步重畫完，不然拍到的還是舊主題
      flushSync(() => setThemeState(id))
    }
    // 整頁交叉淡化，不是所有顏色同一幀硬換。瀏覽器不支援或使用者要求減少動態時直接換
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (document.startViewTransition && !reduce) document.startViewTransition(run)
    else run()
  }

  const isDark = THEMES.find((t) => t.id === theme)?.dark ?? true
  return <ThemeContext.Provider value={{ theme, setTheme, isDark }}>{children}</ThemeContext.Provider>
}

export function useThemeName() {
  return useContext(ThemeContext)
}
