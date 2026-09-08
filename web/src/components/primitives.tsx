import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** 儀表板的數字磚。hint 用來放樣本數之類的脈絡，避免只看到一個沒有前提的數字。 */
export function Kpi({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string
  value: string
  hint?: string
  tone?: "win" | "loss" | "neutral"
  loading?: boolean
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-20" />
        ) : (
          <div
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums leading-tight",
              tone === "win" && "text-win",
              tone === "loss" && "text-loss",
            )}
          >
            {value}
          </div>
        )}
        {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

/** 有標題的內容區塊。action 放在標題右側（例如「看全部」）。 */
export function Panel({
  title,
  caption,
  action,
  className,
  children,
}: {
  title?: string
  caption?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn("gap-3", className)}>
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
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
