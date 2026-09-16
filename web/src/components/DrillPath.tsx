import { useMemo, useState } from "react"
import { Check, ChevronRight, Globe, List, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState, Panel } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { RecordCell } from "@/components/cells"
import { DimensionSelect } from "@/components/DimensionSelect"
import { MatchList } from "@/components/MatchList"
import { useCube } from "@/hooks/useCube"
import { label, type CubeMeta } from "@/hooks/useCubeMeta"
import type { CubeQuery, CubeRow } from "@/lib/cube"
import { num } from "@/lib/cube"
import { useCrumb } from "@/lib/breadcrumb"
import { useFilters } from "@/lib/filters"
import {
  COMPANION,
  MAX_LEVELS,
  dimensionsOf,
  displayValue,
  extraMeasuresOf,
  familyOf,
  levelQuery,
  n0,
  pickFilter,
  pickLabel,
  recordMeasures,
  sortRows,
  type DrillPick,
} from "@/lib/drill"
import { cn } from "@/lib/utils"
import { round0 } from "@/pages/shared"

/** 下鑽走到底時，一次最多列出幾場（和後端 /api/matches 的 MAX_GAME_IDS 一致） */
const MAX_GAME_IDS = 1000
const TABLE_H = 460
const NONE = "__none__"

export function DrillPath({
  meta,
  path,
  onPathChange,
  picks,
  onPicksChange,
  extraMeasure,
  onExtraMeasureChange,
  scoped,
  ignored,
  scopeAll,
}: {
  meta: CubeMeta
  path: string[]
  onPathChange: (path: string[]) => void
  picks: DrillPick[]
  onPicksChange: (picks: DrillPick[]) => void
  extraMeasure: string
  onExtraMeasureChange: (name: string) => void
  scoped: (query: CubeQuery) => CubeQuery
  ignored: string[]
  scopeAll: boolean
}) {
  const { addDrill } = useFilters()
  const family = familyOf(path[0] ?? "participants.")
  const level = picks.length
  const atLeaf = path.length > 0 && level >= path.length
  const dim = atLeaf ? null : path[level]
  const extraOptions = extraMeasuresOf(meta, family)
  const extra = extraOptions.some((m) => m.name === extraMeasure) ? [extraMeasure] : []

  // 麵包屑：每一層登記一次。hook 數量要固定，所以登記滿 MAX_LEVELS 層，沒點到的傳 null。
  const crumbLabels = Array.from({ length: MAX_LEVELS }, (_, i) => (picks[i] ? pickLabel(meta, picks[i]) : null))
  const truncate = (n: number) => () => onPicksChange(picks.slice(0, n))
  useCrumb(10, crumbLabels[0], truncate(0))
  useCrumb(20, crumbLabels[1], truncate(1))
  useCrumb(30, crumbLabels[2], truncate(2))
  useCrumb(40, crumbLabels[3], truncate(3))
  useCrumb(50, crumbLabels[4], truncate(4))

  // 比較基準是「上一層條件下」的勝率。上一層被點的那一列已經有數字就直接用，
  // 沒有（第一層，或從交叉矩陣點進來）才另外查一次
  const parent = picks[level - 1]
  const known = parent && parent.games !== null && parent.wins !== null
  const totals = useCube(
    dim && !known ? scoped({ measures: recordMeasures(family), filters: picks.map(pickFilter) }) : null,
  )
  const baseline = known
    ? parent.games
      ? (100 * parent.wins!) / parent.games
      : null
    : num(totals.rows[0]?.[`${family}.winrate`])
  const baselineLabel = parent ? `上一層（${pickLabel(meta, parent)}）的勝率` : "目前條件的整體勝率"

  const { rows: raw, loading, error } = useCube(dim ? scoped(levelQuery(family, [dim], picks, extra)) : null)

  const rows = useMemo(
    () => (dim ? sortRows(dim, raw).map((r) => ({ ...r, __label: displayValue(dim, r[dim]) })) : []),
    [dim, raw],
  )

  const columns = useMemo<GridColumn[]>(() => {
    if (!dim) return []
    const extraMember = extra[0] ? meta.byName.get(extra[0]) : undefined
    return [
      {
        key: "__label",
        title: label(meta.byName.get(dim), dim),
        kind: "dimension",
        iconKey: COMPANION[dim]?.icon,
        rarityKey: COMPANION[dim]?.rarity,
        flex: 1.6,
        minWidth: 160,
      },
      { key: `${family}.games`, title: "場次", kind: "metric", format: round0, flex: 0.6, minWidth: 80 },
      {
        key: `${family}.winrate`,
        title: "戰績",
        kind: "metric",
        flex: 1.5,
        minWidth: 170,
        cell: (r) => (
          <RecordCell
            winrate={num(r[`${family}.winrate`] as string | number | null)}
            wins={n0(r as CubeRow, `${family}.wins`)}
            losses={n0(r as CubeRow, `${family}.games`) - n0(r as CubeRow, `${family}.wins`)}
            baseline={baseline}
            baselineLabel={baselineLabel}
          />
        ),
      },
      { key: `${family}.wins`, title: "勝場", kind: "metric", format: round0, hide: true },
      { key: dim, title: `${label(meta.byName.get(dim), dim)}（原始值）`, kind: "dimension", hide: true },
      ...(extraMember
        ? [
            {
              key: extraMember.name,
              title: label(extraMember, extraMember.name),
              kind: "metric" as const,
              flex: 0.8,
              minWidth: 110,
              format: (n: number) =>
                (extraMember.meta?.decimals ?? 1) === 0 ? Math.round(n).toLocaleString() : n.toFixed(extraMember.meta?.decimals ?? 1),
              suffix: extraMember.meta?.unit,
            },
          ]
        : []),
    ]
    // extra 每次渲染都是新陣列，依它的內容而不是參照
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim, family, meta, baseline, baselineLabel, extra[0]])

  const drill = (row: Record<string, unknown>) => {
    if (!dim) return
    const value = row[dim]
    onPicksChange([
      ...picks,
      {
        member: dim,
        value: value === null || value === undefined ? null : String(value),
        games: n0(row as CubeRow, `${family}.games`),
        wins: n0(row as CubeRow, `${family}.wins`),
      },
    ])
  }

  // 這一層能換成哪些維度：同一家、還沒被上面幾層用掉的。第一層還沒有條件，可以換到另一家。
  const usedAbove = new Set(path.slice(0, level))
  const swapOptions = (level === 0
    ? [...dimensionsOf(meta, "participants"), ...dimensionsOf(meta, "teammates")].filter(
        (d, i, all) => all.findIndex((x) => x.name === d.name) === i,
      )
    : dimensionsOf(meta, family)
  ).filter((d) => !usedAbove.has(d.name))
  const addOptions = dimensionsOf(meta, family).filter((d) => !path.includes(d.name))

  const swapLevel = (name: string) => {
    const next = path.slice()
    next[level] = name
    // 換到另一家時，後面幾層多半接不上，只留第一層
    if (familyOf(name) !== family) return onPathChange([name])
    // 同一個維度不要出現兩次：把後面重複的那層拿掉
    onPathChange(next.filter((d, i) => i <= level || d !== name))
  }

  const promote = () => {
    for (const p of picks) addDrill({ ...pickFilter(p), label: pickLabel(meta, p) })
    onPicksChange([])
  }

  return (
    <Panel
      title="下鑽路徑"
      caption="點一列往下一層；點上方的條件回到那一層。最後一層之後列出每一場"
      action={
        extraOptions.length > 0 && (
          <Select value={extra[0] ?? NONE} onValueChange={(v) => onExtraMeasureChange(v === NONE ? "" : v)}>
            <SelectTrigger size="sm" className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={NONE}>不加附加指標</SelectItem>
              {extraOptions.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  {label(m, m.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      <div className="space-y-3">
        {/* 路徑本身：做完的打勾、目前這層亮起、還沒到的可以拿掉 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {path.map((d, i) => (
            <span key={d} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                  i < level && "border-border text-muted-foreground",
                  i === level && "border-primary/50 bg-primary/15 text-primary",
                  i > level && "border-dashed border-border text-muted-foreground",
                )}
              >
                <span className="font-mono text-[10px] opacity-70">{i + 1}</span>
                {label(meta.byName.get(d), d)}
                {i < level && <Check className="size-3" />}
                {i > level && (
                  <button
                    onClick={() => onPathChange(path.filter((_, j) => j !== i))}
                    className="opacity-60 transition hover:opacity-100"
                    aria-label="拿掉這一層"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
              <ChevronRight className="size-3 text-muted-foreground" />
            </span>
          ))}
          {path.length < MAX_LEVELS && addOptions.length > 0 && (
            <DimensionSelect
              value=""
              options={addOptions}
              onChange={(name) => onPathChange([...path, name])}
              placeholder="＋ 加一層"
              className="h-7 w-[110px] border-dashed text-xs"
            />
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
              atLeaf ? "border-primary/50 bg-primary/15 text-primary" : "border-dashed border-border text-muted-foreground",
            )}
          >
            <List className="size-3" />
            逐場
          </span>
        </div>

        {/* 目前的條件 + 這一層換維度 */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
            <button
              onClick={() => onPicksChange([])}
              className={cn("rounded px-1 transition hover:bg-accent", level === 0 ? "font-semibold" : "text-primary")}
            >
              全部
            </button>
            {picks.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="size-3 text-muted-foreground" />
                <button
                  onClick={() => onPicksChange(picks.slice(0, i + 1))}
                  className={cn("rounded px-1 transition hover:bg-accent", i === level - 1 ? "font-semibold" : "text-primary")}
                >
                  {pickLabel(meta, p)}
                </button>
              </span>
            ))}
          </div>
          {level > 0 && family === "participants" && (
            <Button size="sm" variant="ghost" onClick={promote} title="把這些條件變成全站下鑽，切到其他分頁也只看這些">
              <Globe className="size-3.5" />
              套用到全站
            </Button>
          )}
          {dim && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">這一層改用</span>
              <DimensionSelect value={dim} options={swapOptions} onChange={swapLevel} className="w-[150px]" />
            </div>
          )}
        </div>

        {ignored.length > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            同場玩家類的路徑套不上：{ignored.join("、")}。
          </p>
        )}

        {path.length === 0 ? (
          <EmptyState>先選一條預設路徑，或用「＋ 加一層」自己排。</EmptyState>
        ) : atLeaf ? (
          <PathMatches family={family} picks={picks} scoped={scoped} scopeAll={scopeAll && family === "participants"} meta={meta} />
        ) : (
          <>
            {loading ? (
              <Skeleton className="w-full" style={{ height: TABLE_H + 44 }} />
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : !rows.length ? (
              <EmptyState>這個條件下沒有資料。</EmptyState>
            ) : (
              <div className="reveal">
                <AgTable
                  columns={columns}
                  rows={rows}
                  height={TABLE_H}
                  rowHeight={54}
                  fileName="drill"
                  onRowClick={drill}
                />
              </div>
            )}
            {level > 0 && (
              <PathMatchesToggle family={family} picks={picks} scoped={scoped} scopeAll={scopeAll && family === "participants"} meta={meta} />
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

/** 還沒走到最後一層，也可以先看目前條件的每一場。
 *  收起時不掛載列表（<details> 收起時子元素照樣渲染，會白白多送查詢）。換一層條件就自動收起。 */
function PathMatchesToggle(props: Parameters<typeof PathMatches>[0]) {
  const key = props.picks.map((p) => `${p.member}=${p.value}`).join("|")
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === key
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpenFor(open ? null : key)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <List className="size-3.5" />
        列出目前條件的每一場
        <Plus className={cn("ml-auto size-3.5 transition-transform", open && "rotate-45")} />
      </button>
      {open && (
        <div className="border-t p-3">
          <PathMatches {...props} />
        </div>
      )}
    </div>
  )
}

/** 逐場列表。哪幾場由 Cube 依同一組條件查出來，數字和上面的表格保證是同一個定義。 */
function PathMatches({
  family,
  picks,
  scoped,
  scopeAll,
  meta,
}: {
  family: ReturnType<typeof familyOf>
  picks: DrillPick[]
  scoped: (query: CubeQuery) => CubeQuery
  scopeAll: boolean
  meta: CubeMeta
}) {
  const { matchParams, account } = useFilters()
  const ids = useCube(
    scopeAll
      ? null
      : scoped({
          measures: [`${family}.games`],
          dimensions: ["matches.game_id"],
          filters: picks.map(pickFilter),
          limit: MAX_GAME_IDS,
        }),
  )
  if (scopeAll) {
    return (
      <EmptyState>
        逐場列表是以一個帳號為主角列出的。把左上的「分析對象」切回目前帳號，就能看到這些條件下的每一場。
      </EmptyState>
    )
  }
  if (ids.loading) return <Skeleton className="h-40 w-full" />
  if (ids.error) return <div className="text-sm text-destructive">{ids.error}</div>
  const gameIds = ids.rows.map((r) => String(r["matches.game_id"]))
  if (!gameIds.length) return <EmptyState>這個條件下沒有對局。</EmptyState>
  return (
    <div className="space-y-2">
      {gameIds.length >= MAX_GAME_IDS && (
        <p className="text-[11px] text-muted-foreground">
          符合的對局超過 {MAX_GAME_IDS} 場，這裡只列出其中 {MAX_GAME_IDS} 場。再往下鑽一層可以縮小範圍。
        </p>
      )}
      <MatchList
        key={picks.map((p) => pickLabel(meta, p)).join("|")}
        params={{ ...matchParams(), game_ids: gameIds.join(",") }}
        puuid={account?.puuid}
      />
    </div>
  )
}
