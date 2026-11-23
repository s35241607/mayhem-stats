import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // 第一次渲染就給正確值：預設 false 的話手機上會先畫一次電腦版外殼再換掉（閃一下、查詢也多跑一輪）
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
