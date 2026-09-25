import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { BarCell, RecordCell, StatCell } from "@/components/cells"
import { Filter, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CubeMatchList } from "@/components/MatchList"
import { RadarChart, type RadarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAX_GAME_IDS, iconUrl, num, type CubeFilter, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { prefersReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { MIN_GAMES, NO_LIMIT, round0, round1, round2 } from "./shared"

const MEASURES = [
  "participants.games",
  "participants.wins",
  "participants.losses",
  "participants.winrate",
  "participants.kda",
  "participants.avg_kills",
  "participants.avg_deaths",
  "participants.avg_assists",
  "participants.dpm",
  "participants.gpm",
  "participants.kill_participation",
  "participants.damage_share",
]

const n0 = (r: Record<string, unknown>, k: string) => num(r[k] as string | number | null) ?? 0
const opt = (r: Record<string, unknown>, k: string) => num(r[k] as string | number | null)

/** 10 欄一格一個數字 → 5 欄複合格子。被合併的原始欄位留成隱藏欄，匯出 CSV 仍帶得出來。
 *  資料條的最大值與平均線依目前資料算，所以欄位定義要跟著資料重建。 */
function buildColumns(rows: CubeRow[], overallWr: number | null): GridColumn[] {
  // 最大值只看樣本夠的英雄，免得一場打出 5000 的把整欄的條壓扁
  const solid = rows.filter((r) => n0(r, "participants.games") >= MIN_GAMES)
  const pool = solid.length ? solid : rows
  const maxDpm = Math.max(1, ...pool.map((r) => n0(r, "participants.dpm")))
  const totalGames = rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
  const avgDpm = totalGames
    ? rows.reduce((a, r) => a + n0(r, "participants.dpm") * n0(r, "participants.games"), 0) / totalGames
    : null
  // 戰績刻度一律是「你的整體勝率」，不從表格各列回推：六邊形篩成某一類之後，
  // 回推出來的會變成那一類的平均，刻度跟著移動，就看不出這一類整體是高是低
  const avgWr = overallWr

  return [
    { key: "champions.name", title: "英雄", kind: "dimension", iconKey: "champions.icon_path", flex: 1.4, minWidth: 140 },
    { key: "participants.games", title: "場次", kind: "metric", format: round0, flex: 0.5, minWidth: 70 },
    {
      key: "participants.winrate",
      title: "戰績",
      kind: "metric",
      flex: 1.5,
      minWidth: 160,
      cell: (r) => (
        <RecordCell
          winrate={opt(r, "participants.winrate")}
          wins={n0(r, "participants.wins")}
          losses={n0(r, "participants.losses")}
          baseline={avgWr}
          baselineLabel="你的整體勝率"
        />
      ),
    },
    {
      key: "participants.kda",
      title: "KDA",
      kind: "metric",
      flex: 1.2,
      minWidth: 150,
      cell: (r) => (
        <StatCell
          main={opt(r, "participants.kda")?.toFixed(2) ?? "—"}
          sub={`${round1(n0(r, "participants.avg_kills"))}/${round1(n0(r, "participants.avg_deaths"))}/${round1(n0(r, "participants.avg_assists"))} · 參團 ${Math.round(n0(r, "participants.kill_participation"))}%`}
        />
      ),
    },
    {
      key: "participants.dpm",
      title: "輸出（每分鐘傷害）",
      kind: "metric",
      flex: 2,
      minWidth: 195,
      cell: (r) => (
        <BarCell
          value={opt(r, "participants.dpm")}
          max={maxDpm}
          reference={avgDpm}
          label={round0(n0(r, "participants.dpm"))}
          sub={`傷害佔 ${round1(n0(r, "participants.damage_share"))}% · 經濟 ${round0(n0(r, "participants.gpm"))}`}
        />
      ),
    },
    { key: "participants.wins", title: "勝場", kind: "metric", hide: true },
    { key: "participants.losses", title: "敗場", kind: "metric", hide: true },
    { key: "participants.avg_kills", title: "平均擊殺", kind: "metric", hide: true },
    { key: "participants.avg_deaths", title: "平均死亡", kind: "metric", hide: true },
    { key: "participants.avg_assists", title: "平均助攻", kind: "metric", hide: true },
    { key: "participants.kill_participation", title: "參團率", kind: "metric", hide: true },
    { key: "participants.gpm", title: "每分鐘經濟", kind: "metric", hide: true },
    { key: "participants.damage_share", title: "傷害佔比", kind: "metric", hide: true },
  ]
}

/** 這隻英雄的出裝或增幅：一列一項，場次 + 那幾場的勝率。
 *
 *  勝率的比較基準是「這隻英雄的整體勝率」，不是 50%——寫在標題裡，
 *  不然 40% 看起來像很差，但這隻英雄本來就只有 35%。
 *  一律全部列出（查詢不設上限），太長就在框裡捲動。 */
function BuildList({
  title,
  caption,
  rows,
  loading,
  error,
  nameKey,
  iconKey,
  baseline,
}: {
  title: string
  caption: string
  rows: CubeRow[]
  loading: boolean
  error: string | null
  nameKey: string
  iconKey: string
  baseline: number | null
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{caption}</div>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : !rows.length ? (
        <EmptyState>這個條件下沒有資料。</EmptyState>
      ) : (
        <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
          {rows.map((r, i) => {
            const label = String(r[nameKey] ?? "—")
            const games = n0(r, "participants.games")
            const wr = opt(r, "participants.winrate")
            const above = wr !== null && baseline !== null && wr >= baseline
            return (
              <div
                key={label}
                style={{ "--stagger": `${Math.min(i, 10) * 30}ms` } as CSSProperties}
                className="slide-in flex items-center gap-2.5 rounded-md px-1.5 py-1"
              >
                <img src={iconUrl(r[iconKey] as string)} alt="" className="size-7 shrink-0 rounded bg-icon-tile" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{games} 場</span>
                <span
                  className={cn(
                    "w-[52px] shrink-0 rounded border px-1 text-right text-[11px] tabular-nums",
                    wr === null || baseline === null
                      ? "border-border text-muted-foreground"
                      : above
                        ? "border-win/30 bg-win/10 text-win"
                        : "border-loss/30 bg-loss/10 text-loss",
                  )}
                >
                  {wr === null ? "—" : `${round1(wr)}%`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 點了某隻英雄之後：從右邊滑出的抽屜，裡面是摘要 + 出裝與增幅 + 這隻英雄的每一場。
 *
 *  原本是在頁面最上方插一塊 Panel 再把頁面捲回頂端：點的那一列瞬間不見、畫面整片跳走，
 *  使用者要自己找「剛剛點的東西跑去哪了」。抽屜蓋在表格上、表格留在原位，
 *  關掉（ESC、點遮罩、右上角）就回到剛才的位置，也不會打亂六邊形的篩選。
 *  用 Radix Dialog 拿到焦點鎖定與 ESC；動畫用 index.css 的 drawer-in，不用 shadcn Sheet 內建的
 *  tw-animate 類別（規則是版面動畫只走 index.css 的 utility）。不做離場動畫。 */
function ChampionDrawer({ row, onClose }: { row: CubeRow | undefined; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs" />
        <DialogPrimitive.Content
          className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl sm:w-[min(980px,92vw)]"
          aria-describedby={undefined}
        >
          {row && <ChampionDetail key={String(row["champions.name"])} row={row} onClose={onClose} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ChampionDetail({ row, onClose }: { row: CubeRow; onClose: () => void }) {
  const { apply, addDrill, drills } = useFilters()
  const name = String(row["champions.name"])
  const onlyThis = useMemo(
    () => [{ member: "champions.name", operator: "equals" as const, values: [name] }],
    [name],
  )
  // 裝備排除第 7 格（飾品）：那格每場都一樣，擺進來只會佔掉第一名
  const items = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["items.name", "items.icon_path"],
      filters: [...onlyThis, { member: "items.slot", operator: "lt", values: ["6"] }],
      order: { "participants.games": "desc" },
      limit: NO_LIMIT,
    }),
  )
  const augments = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["augments.name", "augments.icon_path"],
      filters: onlyThis,
      order: { "participants.games": "desc" },
      limit: NO_LIMIT,
    }),
  )
  const metric = (key: string, fmt: (n: number) => string, suffix = "") => {
    const n = num(row[key])
    return n === null ? "—" : `${fmt(n)}${suffix}`
  }
  const winrate = num(row["participants.winrate"])
  const drilled = drills.some((d) => d.member === "champions.name" && d.values[0] === name)
  // 逐場卡片等抽屜滑完才掛：和換頁一樣，重的東西不要和進場動畫搶主執行緒
  const [slid, setSlid] = useState(prefersReducedMotion())
  useEffect(() => {
    if (slid) return
    const timer = setTimeout(() => setSlid(true), 300)
    return () => clearTimeout(timer)
  }, [slid])

  return (
    <>
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <img
          src={iconUrl(row["champions.icon_path"] as string)}
          alt=""
          className="size-10 shrink-0 rounded-lg bg-icon-tile ring-1 ring-border"
        />
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-base font-semibold">{name}</DialogPrimitive.Title>
          <div className="text-xs text-muted-foreground">
            {metric("participants.games", round0)} 場 · 出裝、增幅與每一場
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={drilled}
          onClick={() =>
            addDrill({ member: "champions.name", operator: "equals", values: [name], label: `英雄：${name}` })
          }
        >
          <Filter className="size-3.5" />
          {drilled ? "其他頁已只看這隻" : "其他頁也只看這隻"}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="關閉">
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <Kpi
            label="勝率"
            value={metric("participants.winrate", round1, "%")}
            hint={`${metric("participants.wins", round0)} 勝 ${metric("participants.losses", round0)} 敗`}
            tone={winrate === null ? undefined : winrate >= 50 ? "win" : "loss"}
          />
          <Kpi label="KDA" value={metric("participants.kda", round2)} />
          <Kpi label="每分鐘傷害" value={metric("participants.dpm", round0)} />
          <Kpi label="每分鐘經濟" value={metric("participants.gpm", round0)} />
          <Kpi label="傷害佔比" value={metric("participants.damage_share", round1, "%")} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <BuildList
            title="最常出的裝備"
            caption={`對局結束時身上的裝備（不含飾品），依出現場次排序。勝率是帶著這件裝備收場的那幾場，和這隻英雄的整體 ${metric("participants.winrate", round1, "%")} 比`}
            rows={items.rows}
            loading={items.loading}
            error={items.error}
            nameKey="items.name"
            iconKey="items.icon_path"
            baseline={winrate}
          />
          <BuildList
            title="最常選的增幅"
            caption={`依選到的場次排序。勝率是選了這個增幅的那幾場，和這隻英雄的整體 ${metric("participants.winrate", round1, "%")} 比`}
            rows={augments.rows}
            loading={augments.loading}
            error={augments.error}
            nameKey="augments.name"
            iconKey="augments.icon_path"
            baseline={winrate}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          這兩份清單是「出現過這件裝備／這個增幅的場次」，不是因果：終場裝備同時受對局長短、經濟與勝負過程影響，
          場次少的那幾列只能當成看過什麼，不能當成建議。
        </p>
        {/* 是哪幾場由 Cube 用同一組條件查，上方的全域下鑽（增幅等）也會套到列表上 */}
        {slid ? (
          <CubeMatchList
            gameIdKey="matches.game_id"
            listKey={name}
            query={apply({
              measures: ["participants.games"],
              dimensions: ["matches.game_id"],
              filters: onlyThis,
              limit: MAX_GAME_IDS,
            })}
          />
        ) : (
          <Skeleton className="h-[240px] w-full" />
        )}
      </div>
    </>
  )
}

/** 六種定位在六邊形上的順序：相鄰的是性質相近的——坦克、鬥士、刺客是近戰，
 *  射手、法師是遠程，輔助接回坦克（開團／保人）。固定順序，形狀才能跨篩選比較。 */
const ROLES = ["坦克", "鬥士", "刺客", "射手", "法師", "輔助"]

type RoleScope = "primary" | "all"
type RadarMode = "games" | "winrate"

/** 主定位模式：每場只算英雄的第一個定位，六類加總等於總場次。 */
const PRIMARY_ONLY: CubeFilter[] = [{ member: "champion_roles.is_primary", operator: "equals", values: ["true"] }]

/** 依定位篩的條件（給下面的排行與表格用）。 */
function roleFilters(role: string | null, scope: RoleScope): CubeFilter[] {
  if (!role) return []
  return [
    { member: "champion_roles.name", operator: "equals", values: [role] },
    ...(scope === "primary" ? PRIMARY_ONLY : []),
  ]
}

/** 左半邊：六邊形。點某一類（點那個方向的任何位置），右邊的英雄勝率與下面的表格就只剩那一類。 */
function RoleRadar({
  role,
  scope,
  baseline,
  totalGames,
  onRole,
}: {
  role: string | null
  scope: RoleScope
  baseline: number | null
  totalGames: number
  onRole: (role: string | null) => void
}) {
  const { apply } = useFilters()
  const [mode, setMode] = useState<RadarMode>("games")
  const byRole = useCube(
    apply({
      measures: ["participants.games", "participants.wins", "participants.winrate"],
      dimensions: ["champion_roles.name"],
      filters: scope === "primary" ? PRIMARY_ONLY : [],
      limit: NO_LIMIT,
    }),
  )

  // 沒玩過的類別也要留一個頂點（場次 0），六邊形才不會少一角、換篩選時形狀才對得起來
  const data: RadarDatum[] = useMemo(
    () =>
      ROLES.map((label) => {
        const r = byRole.rows.find((x) => x["champion_roles.name"] === label)
        return {
          label,
          games: r ? n0(r, "participants.games") : 0,
          wins: r ? n0(r, "participants.wins") : 0,
          winrate: r ? opt(r, "participants.winrate") : null,
        }
      }),
    [byRole.rows],
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">英雄類型</div>
        <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as RadarMode)}>
          <ToggleGroupItem value="games">形狀：場次</ToggleGroupItem>
          <ToggleGroupItem value="winrate">形狀：勝率</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {byRole.loading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : byRole.error ? (
        <div className="text-sm text-destructive">{byRole.error}</div>
      ) : (
        <RadarChart
          data={data}
          mode={mode}
          baseline={baseline}
          total={totalGames}
          height={420}
          selected={role}
          onPick={(label) => onRole(role === label ? null : label)}
        />
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        {mode === "games"
          ? "形狀是場次；頂點下是勝率與場次，比你的整體勝率明顯高／低才上色（場次少的先往平均收斂）"
          : `形狀是勝率（外框 100%）；虛線圈是你的整體勝率 ${baseline?.toFixed(1) ?? "—"}%，頂點在圈外就是這類比平常會贏`}
        。點某一類的方向就篩選，再點一次取消
      </p>
    </div>
  )
}

export function Champions() {
  const { apply } = useFilters()
  const [picked, setPicked] = useState<string | null>(null)
  const [role, setRoleState] = useState<string | null>(null)
  const [scope, setScope] = useState<RoleScope>("primary")
  // 定位是比英雄高一層的聚焦：換定位時，原本點開的那隻英雄可能已經不在這一類裡
  const setRole = (next: string | null) => {
    setRoleState(next)
    setPicked(null)
  }
  const roleLabel = role ? `${role}（${scope === "primary" ? "主定位" : "含次定位"}）` : null
  useCrumb(10, roleLabel, () => setRole(null))
  useCrumb(20, picked, () => setPicked(null))
  const { rows, loading, error } = useCube(
    apply({
      measures: MEASURES,
      dimensions: ["champions.name", "champions.icon_path"],
      filters: roleFilters(role, scope),
      // 預設依場次：85 隻裡有 49 隻只玩過一場，依勝率排時前面全是一場 100% 的。表頭可以再改排序
      order: { "participants.games": "desc" },
      limit: NO_LIMIT,
    }),
  )
  // 比較基準另外查、不跟著定位篩選：六邊形的虛線圈與表格戰績條上的刻度是同一條「你的整體勝率」，
  // 篩成坦克之後才看得出坦克整體是高是低。含次定位時從各類加權回推也是偏的，所以一定要另外查
  const overall = useCube(apply({ measures: ["participants.games", "participants.wins"] }))
  const totalGames = n0(overall.rows[0] ?? {}, "participants.games")
  const baseline = totalGames ? (100 * n0(overall.rows[0], "participants.wins")) / totalGames : null
  const pickedRow = picked ? rows.find((r) => r["champions.name"] === picked) : undefined
  // 欄位定義只在資料換了才重建，不然每次重畫 AG Grid 都會重新套欄位
  const columns = useMemo(() => buildColumns(rows, baseline), [rows, baseline])

  return (
    <div className="space-y-4">
      <ChampionDrawer row={pickedRow} onClose={() => setPicked(null)} />

      {/* 六邊形與英雄表並排：原本右側還有一份「各英雄勝率」排行，和下面的表格是同一份 85 隻英雄、
          同樣的場次與戰績，只是少了 KDA、輸出、排序與匯出。拿掉它，六邊形直接篩這張表 */}
      <Panel
        title="英雄"
        caption={
          scope === "primary"
            ? "左邊是六種類型（每場只算英雄的主定位，六類加起來就是總場次），點某一類的方向，右邊的表就只剩那一類。點表格的一列看那隻英雄的出裝、增幅與每一場"
            : "左邊是六種類型（雙定位的英雄兩類都算，佔比加起來會超過 100%），點某一類的方向，右邊的表就只剩那一類。點表格的一列看那隻英雄的出裝、增幅與每一場"
        }
        action={
          <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={(v) => v && setScope(v as RoleScope)}>
            <ToggleGroupItem value="primary">只算主定位</ToggleGroupItem>
            <ToggleGroupItem value="all">含次定位</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {overall.error ? (
          <div className="text-sm text-destructive">{overall.error}</div>
        ) : !overall.loading && !totalGames ? (
          <EmptyState>這個條件下還沒有對局。</EmptyState>
        ) : (
          <div className="grid gap-6 min-[1500px]:grid-cols-[340px_minmax(0,1fr)]">
            {/* 表格欄位最小寬度加總約 715px（KDA、輸出的補充文字實測要 146／190px 才不被截斷），
                加上 340px 的六邊形，1500px 以上的視窗才並排得下，更窄就上下排 */}
            <RoleRadar role={role} scope={scope} baseline={baseline} totalGames={totalGames} onRole={setRole} />

            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">英雄表現</span>
                {role ? (
                  // 聚焦狀態一定要有文字說明與看得到的清除鈕，不能只靠六邊形上的顏色
                  <button
                    onClick={() => setRole(null)}
                    className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary transition hover:bg-primary/15"
                  >
                    <Filter className="size-3" />
                    只看{roleLabel}
                    <X className="size-3" />
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">全部類型</span>
                )}
              </div>
              {loading ? (
                <Skeleton className="h-[560px] w-full" />
              ) : error ? (
                <div className="text-sm text-destructive">{error}</div>
              ) : (
                <AgTable
                  columns={columns}
                  rowHeight={54}
                  rows={rows}
                  height={560}
                  fileName="champions"
                  drillOn="click"
                  highlight={picked ? { key: "champions.name", value: picked } : null}
                  onDrill={(_col, value) => setPicked(value)}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                預設依場次由多到少。戰績條的刻度是你的整體勝率，輸出條的刻度是表中英雄的平均
              </p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
