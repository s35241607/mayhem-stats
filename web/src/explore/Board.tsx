import { useState } from "react"
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, LayoutDashboard, Maximize2, Plus, Save, SquarePen, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState, LoadingBlock, Panel } from "@/components/primitives"
import type { CubeMeta } from "@/hooks/useCubeMeta"
import { toast } from "@/lib/toast"
import { stringCodec, useUrlState } from "@/lib/urlState"
import { cn } from "@/lib/utils"
import { SpecView } from "./SpecView"
import { VIZ_LABEL } from "./spec"
import { useItems, type BoardSpec, type CardItem, type Tile } from "./store"

const WIDTHS: { w: Tile["w"]; label: string }[] = [
  { w: 4, label: "1/3" },
  { w: 6, label: "1/2" },
  { w: 8, label: "2/3" },
  { w: 12, label: "整排" },
]
const HEIGHTS: Tile["h"][] = [260, 340, 440]
// 寫成完整的 class 字串，Tailwind 才掃得到
const SPAN: Record<Tile["w"], string> = { 4: "xl:col-span-4", 6: "xl:col-span-6", 8: "xl:col-span-8", 12: "xl:col-span-12" }

/** 儀表板上的一格。編輯模式下可以拖把手換位置、調寬度與高度、移除 */
function TileCard({ id, tile, card, meta, editing, onChange, onRemove, onOpen }: {
  id: string
  tile: Tile
  card: CardItem | undefined
  meta: CubeMeta
  editing: boolean
  onChange: (t: Tile) => void
  onRemove: () => void
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing })
  return (
    <div
      ref={setNodeRef}
      // 拖曳中的位移由 dnd-kit 用 transform 算（只動 transform，不觸發排版）
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("col-span-12 min-w-0", SPAN[tile.w], isDragging && "z-10 opacity-70")}
    >
      <Panel
        title={card?.name ?? "（卡片已刪除）"}
        caption={card ? VIZ_LABEL[card.spec.viz] : undefined}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <Select value={String(tile.w)} onValueChange={(v) => onChange({ ...tile, w: Number(v) as Tile["w"] })}>
                  <SelectTrigger size="sm" className="w-[76px]" aria-label="寬度">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WIDTHS.map((o) => (
                      <SelectItem key={o.w} value={String(o.w)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon-sm" variant="ghost" aria-label="調整高度" data-tip="切換高度（矮／中／高）" onClick={() => onChange({ ...tile, h: HEIGHTS[(HEIGHTS.indexOf(tile.h) + 1) % HEIGHTS.length] })}>
                  <Maximize2 className="size-3.5" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="移除這一格" onClick={onRemove}>
                  <X className="size-3.5" />
                </Button>
                <button type="button" {...listeners} {...attributes} aria-label="拖曳換位置" className="cursor-grab rounded p-1 text-muted-foreground transition hover:bg-accent active:cursor-grabbing">
                  <GripVertical className="size-4" />
                </button>
              </>
            ) : (
              card && (
                <Button size="icon-sm" variant="ghost" aria-label="在工作台打開" data-tip="在工作台打開這張卡片" onClick={onOpen}>
                  <SquarePen className="size-3.5" />
                </Button>
              )
            )}
          </div>
        }
      >
        {card ? <SpecView spec={card.spec} meta={meta} height={tile.h} /> : <EmptyState>這張卡片已經被刪掉了，編輯儀表板把這一格移除。</EmptyState>}
      </Panel>
    </div>
  )
}

/** 自訂儀表板：把存好的卡片排在 12 欄的格線上。
 *  每一格只記「哪張卡片、多寬、多高」，內容永遠是那張卡片現在的規格——在工作台改了卡片，這裡跟著變。
 *  標題列的全域篩選（帳號、模式、期間、版本）對所有格子同時生效，所以它就是這個儀表板的共用篩選。 */
export function Board({ meta, onOpenCard }: { meta: CubeMeta; onOpenCard: (card: CardItem) => void }) {
  const items = useItems()
  const [boardId, setBoardId] = useUrlState<string | null>("board", null, stringCodec)
  const board = items.boards.find((b) => b.id === boardId) ?? items.boards[0]
  const [draft, setDraft] = useState<{ id?: string; name: string; tiles: (Tile & { key: string })[] } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const cardOf = (id: string) => items.cards.find((c) => c.id === id)
  const keyed = (tiles: Tile[]) => tiles.map((t, i) => ({ ...t, key: `${t.card}-${i}-${Math.random().toString(36).slice(2, 6)}` }))

  const startEdit = () => board && setDraft({ id: board.id, name: board.name, tiles: keyed(board.spec.tiles) })
  const startNew = () => setDraft({ name: "", tiles: [] })
  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) return toast("先幫儀表板取個名字", "error")
    const spec: BoardSpec = { v: 1, tiles: draft.tiles.map(({ card, w, h }) => ({ card, w, h })) }
    try {
      const saved = await items.save({ id: draft.id, kind: "board", name: draft.name.trim(), spec })
      setBoardId(saved.id)
      setDraft(null)
      toast(`已儲存儀表板「${saved.name}」`)
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }
  const remove = async () => {
    if (!board) return
    try {
      await items.remove(board.id)
      setBoardId(null)
      setDraft(null)
      toast(`已刪除儀表板「${board.name}」`)
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return
    const from = draft.tiles.findIndex((t) => t.key === e.active.id)
    const to = draft.tiles.findIndex((t) => t.key === e.over!.id)
    if (from >= 0 && to >= 0) setDraft({ ...draft, tiles: arrayMove(draft.tiles, from, to) })
  }

  if (items.loading) return <LoadingBlock height={320} label="讀取儀表板…" />

  const editing = !!draft
  const tiles: (Tile & { key: string })[] = draft ? draft.tiles : (board?.spec.tiles ?? []).map((t, i) => ({ ...t, key: `${t.card}-${i}` }))
  const unused = items.cards.filter((c) => !tiles.some((t) => t.card === c.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <LayoutDashboard className="size-4 text-primary" />
        {editing ? (
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="儀表板名稱…" aria-label="儀表板名稱" autoFocus className="h-8 w-64 text-sm" />
        ) : items.boards.length ? (
          <Select value={board?.id ?? ""} onValueChange={setBoardId}>
            <SelectTrigger size="sm" className="w-64" aria-label="選擇儀表板">
              <SelectValue placeholder="選擇儀表板" />
            </SelectTrigger>
            <SelectContent>
              {items.boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">還沒有儀表板</span>
        )}
        <span className="text-xs text-muted-foreground">標題列的帳號、模式、期間、版本對每一格同時生效</span>
        <span className="ml-auto flex gap-2">
          {editing ? (
            <>
              {draft.id && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove()}>
                  <Trash2 className="size-3.5" />
                  刪除儀表板
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>取消</Button>
              <Button size="sm" onClick={() => void save()}>
                <Save className="size-3.5" />
                儲存
              </Button>
            </>
          ) : (
            items.canEdit && (
              <>
                {board && (
                  <Button size="sm" variant="outline" onClick={startEdit}>
                    <SquarePen className="size-3.5" />
                    編輯版面
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={startNew}>
                  <Plus className="size-3.5" />
                  新儀表板
                </Button>
              </>
            )
          )}
        </span>
      </div>

      {editing && (
        <Panel title="加入卡片" caption={items.cards.length ? "點一張加到版面最後；卡片在「工作台」分頁建立與修改" : undefined}>
          {items.cards.length ? (
            <div className="flex flex-wrap gap-1.5">
              {(unused.length ? unused : items.cards).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, tiles: [...draft.tiles, ...keyed([{ card: c.id, w: c.spec.viz === "kpi" ? 4 : 6, h: 340 }])] })}
                  className="pressable rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
                >
                  <Plus className="mr-1 inline size-3" />
                  {c.name}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{VIZ_LABEL[c.spec.viz]}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">還沒有任何卡片。先到「工作台」組一個分析，在左下角「我的卡片」命名存檔，再回來把它放上來。</p>
          )}
        </Panel>
      )}

      {!tiles.length ? (
        <EmptyState>
          {editing
            ? "這個儀表板還是空的，從上面加幾張卡片。"
            : items.canEdit
              ? "還沒有儀表板。按右上角「新儀表板」，把在工作台存好的卡片排成一頁。"
              : "這裡還沒有儀表板。"}
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tiles.map((t) => t.key)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-12 gap-4">
              {tiles.map((t) => (
                <TileCard
                  key={t.key}
                  id={t.key}
                  tile={t}
                  card={cardOf(t.card)}
                  meta={meta}
                  editing={editing}
                  onChange={(next) => draft && setDraft({ ...draft, tiles: draft.tiles.map((x) => (x.key === t.key ? { ...next, key: t.key } : x)) })}
                  onRemove={() => draft && setDraft({ ...draft, tiles: draft.tiles.filter((x) => x.key !== t.key) })}
                  onOpen={() => cardOf(t.card) && onOpenCard(cardOf(t.card)!)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
