import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useInView } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** 數字跑動。單純的視覺回饋，讓數值變化被注意到而不是無聲替換。
 *  非數字（例如「42 勝 56 敗」）就直接顯示，不硬套動畫。 */
function useCountUp(target: number | null, durationMs = 650) {
  const [value, setValue] = useState(target ?? 0)
  const from = useRef(target ?? 0)

  useEffect(() => {
    if (target === null) return
    const start = performance.now()
    const origin = from.current
    const delta = target - origin
    if (delta === 0) return

    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1)
      // easeOutCubic：開頭快、結尾穩，讀數字時不會覺得拖
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(origin + delta * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return target === null ? null : value
}

function AnimatedValue({ text }: { text: string }) {
  // 抓出開頭的數字（含小數與千分位），其餘原樣保留
  const match = text.match(/^(-?[\d,]+\.?\d*)(.*)$/)
  const target = match ? Number(match[1].replace(/,/g, "")) : null
  const suffix = match ? match[2] : ""
  const decimals = match?.[1].includes(".") ? (match[1].split(".")[1]?.length ?? 0) : 0
  const animated = useCountUp(Number.isFinite(target as number) ? target : null)

  if (animated === null) return <>{text}</>
  const shown =
    decimals > 0 ? animated.toFixed(decimals) : Math.round(animated).toLocaleString()
  return (
    <>
      {shown}
      {suffix}
    </>
  )
}

/** 卡片上緣一道由中間往兩側淡出的主題色細光，科技感的點綴。不裁切內容（不設 overflow-hidden），
 *  表格的篩選浮層才不會被卡片切掉。 */
function EdgeLight() {
  return (
    <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
  )
}

export function Kpi({
  label,
  value,
  hint,
  tone,
  loading,
  index = 0,
}: {
  label: string
  value: string
  hint?: string
  tone?: "win" | "loss" | "neutral"
  loading?: boolean
  index?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-40px" })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      // 依序浮現，讓一整排數字看起來是「長出來」而不是同時砸下來
      transition={{ duration: 0.32, delay: Math.min(index * 0.045, 0.4), ease: "easeOut" }}
    >
      <Card
        className={cn(
          "group relative gap-0 overflow-hidden py-4 transition-colors duration-200",
          "hover:border-primary/30",
        )}
      >
        {/* 滑過時左上角透出一層極淡的主色，作為觸覺回饋 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.07] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <EdgeLight />
        <CardContent className="relative px-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-20" />
          ) : (
            <div
              className={cn(
                "mt-1 font-mono text-2xl font-bold tabular-nums leading-tight tracking-tight",
                tone === "win" && "text-win",
                tone === "loss" && "text-loss",
              )}
            >
              <AnimatedValue text={value} />
            </div>
          )}
          {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function Panel({
  title,
  caption,
  action,
  className,
  children,
  index = 0,
}: {
  title?: string
  caption?: string
  action?: ReactNode
  className?: string
  children: ReactNode
  index?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
      className={className}
    >
      <Card className="relative h-full gap-3">
        <EdgeLight />
        {title && (
          <CardHeader className="pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold">{title}</CardTitle>
                {caption && (
                  <p className="mt-0.5 text-xs font-normal text-muted-foreground">{caption}</p>
                )}
              </div>
              {action}
            </div>
          </CardHeader>
        )}
        <CardContent className="min-w-0">{children}</CardContent>
      </Card>
    </motion.div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
