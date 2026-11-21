import { useMemo, useState } from "react"
import { Database, Plus, Rows3, Search, Sigma } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState, Panel } from "@/components/primitives"
import { useCube } from "@/hooks/useCube"
import { label, type CubeMeta, type Member } from "@/hooks/useCubeMeta"
import { displayValue } from "@/lib/drill"
import { cn } from "@/lib/utils"
import { useScoped } from "./data"
import { DATASETS, fitsDataset, type Dataset } from "./spec"

const TYPE_LABEL: Record<string, string> = { string: "文字", number: "數字", boolean: "是／否", time: "時間" }

/** 某個維度實際出現過的值（展開那一列才查） */
function SampleValues({ member, dataset }: { member: string; dataset: Dataset }) {
  const { scoped } = useScoped(dataset, "all")
  const res = useCube(scoped({ dimensions: [member], limit: 40 }))
  if (res.loading) return <span className="text-muted-foreground">讀取中…</span>
  if (res.error) return <span className="text-muted-foreground">讀不到範例值</span>
  const values = res.rows.map((r) => r[member]).filter((v) => v !== null && v !== "")
  if (!values.length) return <span className="text-muted-foreground">目前的模式與期間下沒有值</span>
  return (
    <span className="flex flex-wrap gap-1">
      {values.slice(0, 24).map((v) => (
        <span key={String(v)} className="rounded border bg-secondary/40 px-1.5 py-0.5">
          {displayValue(member, v)}
        </span>
      ))}
      {values.length > 24 && <span className="text-muted-foreground">…還有更多</span>}
    </span>
  )
}

/** 資料目錄：這個站有哪些資料可以拿來分析。
 *
 *  內容全部從語意層的 /meta 來（cube 的標題與說明、每個欄位的標題、型別、單位、說明），
 *  這裡不另外寫一份欄位清單——在 yml 加一個指標，這頁就多一列。
 *  每個資料集講清楚「一列代表什麼」，因為那決定了哪些欄位能放在一起、數字該怎麼讀。 */
export function Catalog({ meta, onUse }: { meta: CubeMeta; onUse: (member: string, kind: "dimension" | "measure") => void }) {
  const [dataset, setDataset] = useState<Dataset>("participants")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(
    () =>
      Object.fromEntries(
        DATASETS.map((d) => [
          d.id,
          { dims: meta.dimensions.filter((m) => fitsDataset(m.name, d.id)).length, measures: meta.measures.filter((m) => fitsDataset(m.name, d.id)).length },
        ]),
      ),
    [meta],
  )

  const sections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const hit = (m: Member) =>
      fitsDataset(m.name, dataset) &&
      (!needle || [label(m, m.name), m.description ?? "", m.name, m.meta?.group ?? ""].some((t) => t.toLowerCase().includes(needle)))
    return meta.cubes
      .map((cube) => ({
        cube,
        dims: meta.dimensions.filter((m) => m.name.startsWith(cube.name + ".") && hit(m)),
        measures: meta.measures.filter((m) => m.name.startsWith(cube.name + ".") && hit(m)),
      }))
      .filter((s) => s.dims.length || s.measures.length)
  }, [meta, dataset, search])

  const row = (m: Member, kind: "dimension" | "measure") => {
    const expanded = open === m.name
    return (
      <div key={m.name} className="border-t border-border/60 first:border-t-0">
        <div className="flex items-start gap-2 px-2 py-1.5 text-xs">
          {kind === "dimension" ? <Rows3 className="mt-0.5 size-3.5 shrink-0 text-primary" /> : <Sigma className="mt-0.5 size-3.5 shrink-0 text-data" />}
          <button type="button" onClick={() => setOpen(expanded ? null : m.name)} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
            <span className="font-medium">{label(m, m.name)}</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {kind === "dimension" ? "維度" : "指標"}・{TYPE_LABEL[m.type] ?? m.type}
              {m.meta?.unit ? `・單位 ${m.meta.unit}` : ""}
              {m.meta?.group ? `・${m.meta.group}` : ""}
            </span>
            {m.description && <span className={cn("mt-0.5 block text-[11px] leading-relaxed text-muted-foreground", !expanded && "line-clamp-1")}>{m.description}</span>}
          </button>
          <Button size="sm" variant="ghost" onClick={() => onUse(m.name, kind)} aria-label={`把 ${label(m, m.name)} 加到工作台`} data-tip="加到工作台">
            <Plus className="size-3.5" />
          </Button>
        </div>
        {expanded && (
          <div className="reveal space-y-1.5 px-8 pb-2 text-[11px]">
            <div className="font-mono text-muted-foreground">{m.name}</div>
            {kind === "dimension" && m.type !== "time" && <SampleValues member={m.name} dataset={dataset} />}
            {kind === "measure" && m.meta?.higherIsBetter !== undefined && (
              <div className="text-muted-foreground">{m.meta.higherIsBetter ? "越高越好" : "越低越好"}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {DATASETS.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDataset(d.id)}
            aria-pressed={dataset === d.id}
            style={{ "--stagger": `${i * 50}ms` } as React.CSSProperties}
            className={cn(
              "rise pressable rounded-xl border bg-card p-4 text-left transition-colors",
              dataset === d.id ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4 text-primary" />
              {d.title}
              <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground">
                {counts[d.id].dims} 維度・{counts[d.id].measures} 指標
              </span>
            </div>
            <div className="mt-1 text-xs font-medium text-foreground/90">{d.grain}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d.note}</p>
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋欄位名稱、說明、分類…" aria-label="搜尋欄位" className="h-9 pl-8 text-sm" />
      </div>

      {!sections.length ? (
        <EmptyState>沒有符合的欄位。</EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sections.map(({ cube, dims, measures }, i) => (
            <Panel key={cube.name} index={Math.min(i, 5)} title={cube.title} caption={`${dims.length} 個維度・${measures.length} 個指標`} hint={cube.description || undefined}>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border">
                {dims.map((m) => row(m, "dimension"))}
                {measures.map((m) => row(m, "measure"))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
