import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { iconUrl, num, type CubeRow } from "@/lib/cube"

/** 樣本數低於這個場次的列會被淡化——3 場 100% 是雜訊，不是洞察。 */
export const SHAKY_SAMPLE = 5

const RARITY_LABEL: Record<string, { label: string; className: string }> = {
  kPrismatic: { label: "Prismatic", className: "bg-prismatic/15 text-prismatic border-prismatic/30" },
  kGold: { label: "Gold", className: "bg-gold/15 text-gold border-gold/30" },
  kSilver: { label: "Silver", className: "bg-silver/15 text-silver border-silver/30" },
}

export type Column = {
  key: string
  title: string
  /** 維度欄（靠左、可帶圖示）或指標欄（靠右、粗體數字） */
  kind?: "dimension" | "metric"
  iconKey?: string
  rarityKey?: string
  format?: (value: number) => string
  suffix?: string
}

type Props = {
  columns: Column[]
  rows: CubeRow[]
  loading?: boolean
  error?: string | null
  emptyHint?: string
  onRowClick?: (row: CubeRow) => void
}

function winrateClass(columnKey: string, value: number | null) {
  if (!columnKey.endsWith("winrate") || value === null) return ""
  return value >= 50 ? "text-win" : "text-loss"
}

export function DataTable({
  columns,
  rows,
  loading,
  error,
  emptyHint,
  onRowClick,
}: Props) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {emptyHint ?? "這個條件下還沒有資料。"}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "whitespace-nowrap text-xs uppercase tracking-wide",
                  col.kind === "metric" && "text-right",
                )}
              >
                {col.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const games = num(row["participants.games"])
            const shaky = games !== null && games < SHAKY_SAMPLE
            return (
              <TableRow
                key={index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  shaky && "opacity-55",
                  onRowClick && "cursor-pointer",
                )}
              >
                {columns.map((col) => {
                  const raw = row[col.key]
                  if (col.kind === "metric") {
                    const value = num(raw)
                    return (
                      <TableCell
                        key={col.key}
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          winrateClass(col.key, value),
                        )}
                      >
                        {value === null
                          ? "—"
                          : `${col.format ? col.format(value) : value}${col.suffix ?? ""}`}
                      </TableCell>
                    )
                  }

                  const icon = col.iconKey ? iconUrl(row[col.iconKey] as string) : undefined
                  const rarity = col.rarityKey ? (row[col.rarityKey] as string) : null
                  const badge = rarity ? RARITY_LABEL[rarity] : null
                  return (
                    <TableCell key={col.key} className="font-medium">
                      <div className="flex items-center gap-2.5">
                        {icon && (
                          <img
                            src={icon}
                            alt=""
                            loading="lazy"
                            className="size-7 shrink-0 rounded-md bg-secondary"
                          />
                        )}
                        <span className="truncate">{(raw as string) ?? "—"}</span>
                        {badge && (
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-[10px]", badge.className)}
                          >
                            {badge.label}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
