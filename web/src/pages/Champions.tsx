import { useMemo, useState, type CSSProperties } from "react"
import { BarCell, RecordCell, StatCell } from "@/components/cells"
import { Filter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, Panel, EmptyState } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CubeMatchList } from "@/components/MatchList"
import { BarChart, DIM_OPACITY, RadarChart, type BarDatum, type RadarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAX_GAME_IDS, iconUrl, num, type CubeFilter, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
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
function buildColumns(rows: CubeRow[]): GridColumn[] {
  // 最大值只看樣本夠的英雄，免得一場打出 5000 的把整欄的條壓扁
  const solid = rows.filter((r) => n0(r, "participants.games") >= MIN_GAMES)
  const pool = solid.length ? solid : rows
  const maxDpm = Math.max(1, ...pool.map((r) => n0(r, "participants.dpm")))
  const totalGames = rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
  const avgDpm = totalGames
    ? rows.reduce((a, r) => a + n0(r, "participants.dpm") * n0(r, "participants.games"), 0) / totalGames
    : null
  const avgWr = totalGames ? (100 * rows.reduce((a, r) => a + n0(r, "participants.wins"), 0)) / totalGames : null

  return [
    { key: "champions.name", title: "英雄", kind: "dimension", iconKey: "champions.icon_path", flex: 1.6, minWidth: 160 },
    { key: "participants.games", title: "場次", kind: "metric", format: round0, flex: 0.6, minWidth: 80 },
    {
      key: "participants.winrate",
      title: "戰績",
      kind: "metric",
      flex: 1.5,
      minWidth: 170,
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
      minWidth: 165,
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
      minWidth: 230,
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

/** 點了某隻英雄之後：摘要 + 出裝與增幅 + 這隻英雄的每一場（和對局紀錄頁同樣的卡片）。 */
function ChampionPanel({ row, onClose }: { row: CubeRow; onClose: () => void }) {
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

  return (
    <Panel
      title={`${name} 的每一場`}
      action={
        <span className="flex items-center gap-1">
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
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
            收起
          </Button>
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
      </div>
    </Panel>
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

/** 英雄類型：六邊形 + 各類的場次與勝率。點一類，下面的排行與表格只剩那一類的英雄。 */
function RolePanel({
  role,
  scope,
  onRole,
  onScope,
}: {
  role: string | null
  scope: RoleScope
  onRole: (role: string | null) => void
  onScope: (scope: RoleScope) => void
}) {
  const { apply } = useFilters()
  const [mode, setMode] = useState<RadarMode>("games")
  const byRole = useCube(
    apply({
      measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate"],
      dimensions: ["champion_roles.name"],
      filters: scope === "primary" ? PRIMARY_ONLY : [],
      limit: NO_LIMIT,
    }),
  )
  // 比較基準另外查：含次定位時雙定位的場次會算兩次，從各類加權回推的「平均」是偏的
  const overall = useCube(apply({ measures: ["participants.games", "participants.wins"] }))
  const totalGames = n0(overall.rows[0] ?? {}, "participants.games")
  const baseline = totalGames ? (100 * n0(overall.rows[0], "participants.wins")) / totalGames : null

  // 沒玩過的類別也要留一個頂點（場次 0），六邊形才不會少一角、換篩選時形狀才對得起來
  const data = useMemo(
    () =>
      ROLES.map((label) => {
        const r = byRole.rows.find((x) => x["champion_roles.name"] === label)
        return {
          label,
          games: r ? n0(r, "participants.games") : 0,
          wins: r ? n0(r, "participants.wins") : 0,
          losses: r ? n0(r, "participants.losses") : 0,
          winrate: r ? opt(r, "participants.winrate") : null,
        }
      }),
    [byRole.rows],
  )
  const radar: RadarDatum[] = data
  const list = [...data].sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0))
  const pick = (label: string) => onRole(role === label ? null : label)
  const loading = byRole.loading || overall.loading

  return (
    <Panel
      title="英雄類型"
      caption={
        scope === "primary"
          ? "每場只算英雄的主定位（客戶端列出的第一個），六類加起來就是總場次。點頂點名稱或右邊的列，下面的排行與表格就只看那一類"
          : "雙定位的英雄兩類都算（例如蓋倫同時算鬥士和坦克），所以各類的佔比加起來會超過 100%。點頂點名稱或右邊的列，下面只看那一類"
      }
      action={
        <span className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as RadarMode)}>
            <ToggleGroupItem value="games">形狀：場次</ToggleGroupItem>
            <ToggleGroupItem value="winrate">形狀：勝率</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={(v) => v && onScope(v as RoleScope)}>
            <ToggleGroupItem value="primary">只算主定位</ToggleGroupItem>
            <ToggleGroupItem value="all">含次定位</ToggleGroupItem>
          </ToggleGroup>
        </span>
      }
    >
      {loading ? (
        <Skeleton className="h-[364px] w-full" />
      ) : byRole.error || overall.error ? (
        <div className="text-sm text-destructive">{byRole.error ?? overall.error}</div>
      ) : !totalGames ? (
        <EmptyState>這個條件下還沒有對局。</EmptyState>
      ) : (
        <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <RadarChart data={radar} mode={mode} baseline={baseline} selected={role} onPick={pick} />
            <p className="text-center text-[11px] text-muted-foreground">
              {mode === "games"
                ? "形狀是場次；頂點下的百分比是勝率，比你的整體勝率明顯高／低才上色（場次少的先往平均收斂）"
                : `形狀是勝率（外框 100%）；虛線圈是你的整體勝率 ${baseline?.toFixed(1) ?? "—"}%，頂點在圈外就是這類比平常會贏`}
            </p>
          </div>
          <div className="space-y-1">
            {role && (
              <button
                onClick={() => onRole(null)}
                className="mb-1 flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary transition hover:bg-primary/15"
              >
                <Filter className="size-3" />
                只看{role}（{scope === "primary" ? "主定位" : "含次定位"}）
                <X className="size-3" />
              </button>
            )}
            {list.map((d, i) => {
              const dimmed = role !== null && role !== d.label
              return (
                <button
                  key={d.label}
                  onClick={() => pick(d.label)}
                  style={{ "--stagger": `${i * 35}ms`, opacity: dimmed ? DIM_OPACITY : 1 } as CSSProperties}
                  className={cn(
                    "slide-in grid w-full grid-cols-[3.5rem_4.5rem_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-accent",
                    role === d.label && "bg-primary/10 ring-1 ring-primary",
                  )}
                >
                  <span className="text-sm font-semibold">{d.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {d.games} 場
                    <br />佔 {Math.round((100 * d.games) / totalGames)}%
                  </span>
                  {d.games ? (
                    <RecordCell
                      winrate={d.winrate}
                      wins={d.wins}
                      losses={d.losses}
                      baseline={baseline}
                      baselineLabel="你的整體勝率"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">沒玩過</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Panel>
  )
}

type RankBy = "winrate" | "games"

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
  // 拿掉場次門檻之後，依勝率排會被一堆一場 100% 的英雄佔滿前面；
  // 想看「常玩的那幾隻打得怎樣」就切成依場次排，長條仍然是勝率
  const [rankBy, setRankBy] = useState<RankBy>("winrate")
  useCrumb(10, role ? `${role}（${scope === "primary" ? "主定位" : "含次定位"}）` : null, () => setRole(null))
  useCrumb(20, picked, () => setPicked(null))
  const { rows, loading, error } = useCube(
    apply({
      measures: MEASURES,
      dimensions: ["champions.name", "champions.icon_path"],
      filters: roleFilters(role, scope),
      order: { "participants.games": "desc" },
      limit: NO_LIMIT,
    }),
  )
  const pickedRow = picked ? rows.find((r) => r["champions.name"] === picked) : undefined
  // 欄位定義只在資料換了才重建，不然每次重畫 AG Grid 都會重新套欄位
  const columns = useMemo(() => buildColumns(rows), [rows])

  // 全部英雄都上榜（不設場次門檻，使用者要求），長條末端同時標勝率與場次；
  // 顏色本來就會依場次往整體平均收縮，所以一場全勝的那根是淡的，不會看起來最強
  const top: BarDatum[] = rows
    .map((r) => ({
      label: String(r["champions.name"] ?? "—"),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r["participants.games"]) ?? 0,
    }))
    .sort((a, b) => (rankBy === "games" ? b.games - a.games || b.value - a.value : b.value - a.value || b.games - a.games))

  const table = (
    <Panel
      title="英雄表現"
      caption={`點英雄看這隻英雄的每一場。輸出條的長度對應最高的英雄，戰績條與輸出條上的刻度線是你的整體水準。欄位標題可排序（戰績依勝率、輸出依每分鐘傷害），匯出 CSV 含所有原始欄位`}
    >
      {loading ? (
        <Skeleton className="h-[520px] w-full" />
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
          onDrill={(_col, value) => {
            setPicked(value)
            window.scrollTo({ top: 0, behavior: "smooth" })
          }}
        />
      )}
    </Panel>
  )

  return (
    <div className="space-y-4">
      {pickedRow && <ChampionPanel key={picked} row={pickedRow} onClose={() => setPicked(null)} />}

      <RolePanel role={role} scope={scope} onRole={setRole} onScope={setScope} />

      <Panel
        title="勝率排行"
        caption={
          rankBy === "winrate"
            ? `全部 ${top.length} 隻英雄都列出來，長條後面是勝率與場次；顏色依場次往你的整體勝率收縮，所以一兩場的那幾根顏色很淡。依勝率排時前面幾乎都是只玩過一兩場的，想看常玩的就切成「依場次」`
            : `全部 ${top.length} 隻英雄依場次由多到少，長條長度仍然是勝率。超過 14 隻時在圖上捲動，點長條看那隻英雄的每一場`
        }
        action={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={rankBy}
            onValueChange={(v) => v && setRankBy(v as RankBy)}
          >
            <ToggleGroupItem value="winrate">依勝率</ToggleGroupItem>
            <ToggleGroupItem value="games">依場次</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : top.length ? (
          <BarChart
            data={top}
            suffix="%"
            showGames
            onPick={(label) => {
              setPicked(label)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }}
          />
        ) : (
          <EmptyState>這個條件下還沒有對局。</EmptyState>
        )}
      </Panel>

      {table}
    </div>
  )
}
