import { createContext, useContext, useState, type ReactNode } from "react"

export const THEMES = [
  { id: "neon", label: "霓虹", hint: "深藍黑、青色光", dark: true, swatch: ["#070b16", "#22d3ee", "#129bc9", "#e3437c"] },
  { id: "matrix", label: "終端", hint: "黑綠、螢光綠", dark: true, swatch: ["#040906", "#3ee08f", "#17a874", "#df5f2e"] },
  { id: "lava", label: "熔岩", hint: "原本的橘色", dark: true, swatch: ["#131a26", "#f07a3c", "#20a3a8", "#e0564e"] },
  { id: "daylight", label: "晨光", hint: "淺色", dark: false, swatch: ["#f3f6fb", "#2563eb", "#1f6fd1", "#d6395f"] },
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
    apply(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* 無痕模式等情況存不了就算了，這次仍然生效 */
    }
    setThemeState(id)
  }

  const isDark = THEMES.find((t) => t.id === theme)?.dark ?? true
  return <ThemeContext.Provider value={{ theme, setTheme, isDark }}>{children}</ThemeContext.Provider>
}

export function useThemeName() {
  return useContext(ThemeContext)
}
