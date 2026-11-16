import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Columns3, GripVertical, Pin, PinOff, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type MenuColumn = {
  id: string
  title: string
  hidden: boolean
  pinned: boolean
  /** 不能藏的欄（例如英雄、玩家這種辨識用的維度欄只剩它一欄時） */
  locked?: boolean
}

/** 表格工具列的「欄位」按鈕：勾選顯示、拖曳換順序、凍結在左邊、還原預設。
 *  AgTable 與 DataTable 共用，兩種表格的操作一樣。 */
export function ColumnMenu({
  columns,
  onToggleHidden,
  onTogglePin,
  onMove,
  onReset,
}: {
  /** 目前的顯示順序（凍結的在前） */
  columns: MenuColumn[]
  onToggleHidden: (id: string) => void
  onTogglePin: (id: string) => void
  /** 把 id 移到 target 的位置 */
  onMove: (id: string, target: string) => void
  onReset: () => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const shown = columns.filter((c) => !c.hidden).length
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) onMove(String(e.active.id), String(e.over.id))
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8" data-testid="column-menu">
          <Columns3 className="size-3.5" />
          欄位
          {shown < columns.length && <span className="text-muted-foreground">{shown}/{columns.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-1.5 p-2">
        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>勾選顯示・拖曳換順序・圖釘凍結</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {columns.map((c) => (
                <MenuRow
                  key={c.id}
                  column={c}
                  // 最後一個看得到的欄不能藏，不然整張表是空的
                  lockHide={c.locked || (!c.hidden && shown <= 1)}
                  onToggleHidden={() => onToggleHidden(c.id)}
                  onTogglePin={() => onTogglePin(c.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <Button size="sm" variant="ghost" className="h-7 justify-start text-xs" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          還原預設（順序、寬度、排序）
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function MenuRow({
  column,
  lockHide,
  onToggleHidden,
  onTogglePin,
}: {
  column: MenuColumn
  lockHide?: boolean
  onToggleHidden: () => void
  onTogglePin: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1.5 rounded-md px-1 py-1 text-xs hover:bg-accent", isDragging && "relative z-10 bg-accent")}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`拖曳「${column.title}」換位置`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <label className={cn("flex min-w-0 flex-1 items-center gap-2", lockHide ? "cursor-not-allowed" : "cursor-pointer")}>
        <input
          type="checkbox"
          checked={!column.hidden}
          disabled={lockHide}
          onChange={onToggleHidden}
          className="accent-primary"
        />
        <span className={cn("truncate", column.hidden && "text-muted-foreground")}>{column.title}</span>
      </label>
      <button
        type="button"
        onClick={onTogglePin}
        disabled={column.hidden}
        aria-label={column.pinned ? `取消凍結「${column.title}」` : `凍結「${column.title}」`}
        data-tip={column.pinned ? "取消凍結" : "凍結在左邊：橫向捲動時留在眼前"}
        className={cn(
          "rounded p-0.5 transition disabled:opacity-30",
          column.pinned ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {column.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
      </button>
    </div>
  )
}
