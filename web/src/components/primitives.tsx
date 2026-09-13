import { type CSSProperties, type ReactNode } from "react"
import { CountUp } from "@/components/CountUp"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"


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
  return (
    // 依序浮現，讓一整排數字看起來是「長出來」而不是同時砸下來。CSS 動畫，理由見 index.css
    <div className="rise" style={{ "--stagger": `${index * 40}ms` } as CSSProperties}>
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
              <CountUp text={value} />
            </div>
          )}
          {hint && <CountUp text={hint} className="mt-1 block text-[11px] text-muted-foreground" />}
        </CardContent>
      </Card>
    </div>
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
  return (
    <div className={cn("rise", className)} style={{ "--stagger": `${index * 50}ms` } as CSSProperties}>
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
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
