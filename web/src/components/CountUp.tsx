import { useLayoutEffect, useRef } from "react"
import { COUNT_UP_MS, prefersReducedMotion, useAfterPageEnter } from "@/lib/motion"

// 字串裡的每個數字（含千分位與小數）。「58 勝 70 敗」「17.0 / 15.1 分」這種多個數字的一起跑。
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g
// 時間、日期、區間不能跑：「21:00」會從 0:00 跑上去，「0-5」會出現負號。
const NOT_A_QUANTITY = /\d[:\-/]\d|\d{4}-\d{2}/

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

function format(value: number, sample: string) {
  const decimals = sample.includes(".") ? (sample.split(".")[1]?.length ?? 0) : 0
  const fixed = value.toFixed(decimals)
  if (!sample.includes(",")) return fixed
  const [int, frac] = fixed.split(".")
  return Number(int).toLocaleString("en-US") + (frac ? `.${frac}` : "")
}

/** 數字從 0（或上一次的值）跑到目標值。
 *
 *  逐幀直接改 textContent，不走 React state：一排七個 KPI 各跑 60 幀，走 state 就是
 *  420 次重新渲染，全擠在頁面剛出現的那段時間。也等換頁進場動畫結束才開始跑，
 *  和卡片浮現錯開，數字才看得清楚是從哪裡長上來的。 */
export function CountUp({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number[] | null>(null)
  const enterDone = useAfterPageEnter()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const samples = text.match(NUMBER)
    if (!samples || NOT_A_QUANTITY.test(text)) {
      el.textContent = text
      shown.current = null
      return
    }
    const targets = samples.map((s) => Number(s.replace(/,/g, "")))
    const from = shown.current && shown.current.length === targets.length ? shown.current : targets.map(() => 0)
    const render = (values: number[]) => {
      let i = 0
      el.textContent = text.replace(NUMBER, (s) => format(values[i++], s))
    }

    if (prefersReducedMotion()) {
      render(targets)
      shown.current = targets
      return
    }
    // 進場動畫還沒結束：先停在起點，等一下再從這裡跑上去
    render(from)
    if (!enterDone) return

    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = easeOutExpo(Math.min((now - start) / COUNT_UP_MS, 1))
      const values = targets.map((t, i) => from[i] + (t - from[i]) * k)
      render(values)
      shown.current = values
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, enterDone])

  return <span ref={ref} className={className} />
}
