import { useState } from "react"
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { GripVertical, X, Rows3, Sigma } from "lucide-react"
import { Input } from "@/components/ui/input"
import { groupBy, label, type Member } from "@/hooks/useCubeMeta"
import { cn } from "@/lib/utils"

type Zone = "dimensions" | "measures"

function DraggableField({
  member,
  zone,
  onActivate,
}: {
  member: Member
  zone: Zone | "pool"
  onActivate?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${zone}:${member.name}`,
    data: { name: member.name, from: zone },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-label={`${label(member, member.name)}${onActivate ? "，按 Enter 加入" : ""}`}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (onActivate && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          onActivate()
        }
      }}
      title={member.description}
      className={cn(
        "inline-flex cursor-grab items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors active:cursor-grabbing",
        zone === "pool"
          ? "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          : "border-primary/40 bg-primary/10 text-primary",
        isDragging && "opacity-40",
      )}
    >
      <GripVertical className="size-3 opacity-50" />
      {label(member, member.name)}
    </div>
  )
}

function DropZone({
  id,
  title,
  icon: Icon,
  hint,
  members,
  onRemove,
}: {
  id: Zone
  title: string
  icon: typeof Rows3
  hint: string
  members: Member[]
  onRemove: (name: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-dashed p-2.5 transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-border bg-secondary/30",
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
        <span className="ml-auto font-normal normal-case">{members.length}</span>
      </div>
      {members.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-muted-foreground/70">{hint}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <span key={m.name} className="inline-flex items-center">
              <DraggableField member={m} zone={id} />
              <button
                onClick={() => onRemove(m.name)}
                className="-ml-1 rounded-sm p-1 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100"
                aria-label={`移除${label(m, m.name)}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 拖曳式欄位配置。左邊是可用欄位，拖進上方的兩個區塊就成為分組或指標——
 *  比一長串核取方塊更直覺，也看得出目前的查詢是怎麼組成的。 */
export function FieldBuilder({
  dimensions,
  measures,
  selectedDims,
  selectedMeasures,
  onChange,
}: {
  dimensions: Member[]
  measures: Member[]
  selectedDims: string[]
  selectedMeasures: string[]
  onChange: (dims: string[], measures: string[]) => void
}) {
  const [search, setSearch] = useState("")
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const byName = new Map([...dimensions, ...measures].map((m) => [m.name, m]))
  const dimMembers = selectedDims.map((n) => byName.get(n)).filter(Boolean) as Member[]
  const measureMembers = selectedMeasures.map((n) => byName.get(n)).filter(Boolean) as Member[]

  const matches = (m: Member) =>
    !search || label(m, m.name).toLowerCase().includes(search.toLowerCase())
  const poolDims = dimensions.filter((m) => !selectedDims.includes(m.name) && matches(m))
  const poolMeasures = measures.filter((m) => !selectedMeasures.includes(m.name) && matches(m))

  const handleDragEnd = (event: DragEndEvent) => {
    const name = event.active.data.current?.name as string | undefined
    const from = event.active.data.current?.from as Zone | "pool" | undefined
    const to = event.over?.id as Zone | undefined
    if (!name || !to) return

    const isDimension = dimensions.some((d) => d.name === name)
    // 維度只能進維度區、指標只能進指標區，否則查詢一定失敗
    if ((to === "dimensions") !== isDimension) return
    if (from === to) return

    if (to === "dimensions" && !selectedDims.includes(name)) {
      onChange([...selectedDims, name], selectedMeasures)
    } else if (to === "measures" && !selectedMeasures.includes(name)) {
      onChange(selectedDims, [...selectedMeasures, name])
    }
  }

  const remove = (zone: Zone) => (name: string) => {
    if (zone === "dimensions") onChange(selectedDims.filter((n) => n !== name), selectedMeasures)
    else onChange(selectedDims, selectedMeasures.filter((n) => n !== name))
  }

  const addByClick = (m: Member) => {
    const isDimension = dimensions.some((d) => d.name === m.name)
    if (isDimension) onChange([...selectedDims, m.name], selectedMeasures)
    else onChange(selectedDims, [...selectedMeasures, m.name])
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-3">
        <DropZone
          id="dimensions"
          title="分組維度"
          icon={Rows3}
          hint="把欄位拖進來，資料就會依它切開"
          members={dimMembers}
          onRemove={remove("dimensions")}
        />
        <DropZone
          id="measures"
          title="指標"
          icon={Sigma}
          hint="拖進來的第一個指標會用來排序與畫圖"
          members={measureMembers}
          onRemove={remove("measures")}
        />

        <div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋欄位…"
            aria-label="搜尋欄位"
            className="mb-2 h-8 text-xs"
          />
          <div className="max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
            {[
              ["維度", poolDims],
              ["指標", poolMeasures],
            ].map(([kind, list]) => {
              const items = list as Member[]
              if (!items.length) return null
              return (
                <div key={kind as string}>
                  {[...groupBy(items).entries()].map(([group, members]) => (
                    <div key={group} className="mb-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        {kind as string} · {group}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => (
                            <DraggableField
                              key={m.name}
                              member={m}
                              zone="pool"
                              onActivate={() => addByClick(m)}
                            />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            拖曳加入，或點擊／按 Enter 直接加入到對應區塊。
          </p>
        </div>
      </div>
    </DndContext>
  )
}
