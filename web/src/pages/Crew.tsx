import { useMemo, useState, type CSSProperties } from "react"
import { ArrowRight, Check } from "lucide-react"
import { RecordCell } from "@/components/cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EmptyState, Panel, QueryError } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { RadarChart, SHRINK_K, shrunk, type RadarDatum } from "@/components/charts"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { useCube } from "@/hooks/useCube"
import { iconUrl, num, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { useFilters, type Player } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { useNavigate } from "@/lib/nav"
import { cn } from "@/lib/utils"
import { NO_LIMIT, PRIMARY_ONLY, ROLES, round0, round1, round2 } from "./shared"

/** 「擅長」至少要幾場才算：一場全勝的英雄不能叫擅長 */
const BEST_MIN = 3
/** 擅長的英雄每人列幾隻 */
const BEST_SHOWN = 5

const n0 = (r: CubeRow | undefined, k: string) => (r ? (num(r[k]) ?? 0) : 0)
const opt = (r: CubeRow | undefined, k: string) => (r ? num(r[k]) : null)

/** Riot ID 拆成名稱與 #tag，版面上 tag 用淡色 */
const splitId = (riotId: string | null, puuid: string) => {
  const [name, tag] = (riotId ?? puuid.slice(0, 8)).split("#")
  return { name, tag: tag ? `#${tag}` : "" }
}

function PlayerName({ player, className }: { player: Player; className?: string }) {
  const { name, tag } = splitId(player.riot_id, player.puuid)
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="truncate font-medium">{name}</span>
      {tag && <span className="shrink-0 text-[11px] text-muted-foreground">{tag}</span>}
      {!!player.is_me && (
        <Badge variant="outline" className="shrink-0 border-primary/40 px-1 py-0 text-[10px] text-primary">
          我
        </Badge>
      )}
    </span>
  )
}

/** 矩陣格子的底色：往比較基準收縮後的偏離幅度分四級。
 *  用主題 token 的透明度疊，不另外挑色；偏離不到 2 個百分點不上色（樣本量下看不出差別）。 */
function tintClass(dev: number) {
  const a = Math.abs(dev)
  if (a < 2) return "bg-muted/40"
  if (dev > 0) return a < 5 ? "bg-win/15" : a < 10 ? "bg-win/30" : "bg-win/45"
  return a < 5 ? "bg-loss/15" : a < 10 ? "bg-loss/30" : "bg-loss/45"
}

type Compare = "self" | "group"

/** 抽屜：某個人（或某個人在某一類）玩過的每隻英雄。 */
function PlayerDrawerBody({
  player,
  role,
  overallWr,
  roleData,
  total,
  crewFilter,
}: {
  player: Player
  role: string | null
  overallWr: number | null
  roleData: RadarDatum[]
  total: number
  crewFilter: (puuids: string[]) => CubeFilter
}) {
  const { apply, setAccount } = useFilters()
  const go = useNavigate()
  const settled = useDrawerSettled()
  const champs = useCube(
    apply(
      {
        measures: ["participants.games", "participants.wins", "participants.losses", "participants.winrate"],
        dimensions: ["champions.name", "champions.icon_path"],
        filters: [
          crewFilter([player.puuid]),
          ...(role ? [{ member: "champion_roles.name", operator: "equals" as const, values: [role] }, ...PRIMARY_ONLY] : []),
        ],
        order: { "participants.games": "desc" },
        limit: NO_LIMIT,
      },
      "all",
    ),
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {role ? `只算主定位是${role}的英雄。` : ""}戰績條的刻度是他自己的整體勝率 {overallWr?.toFixed(1) ?? "—"}%
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAccount(player)
            go("dashboard")
          }}
        >
          切換成看他的完整數據
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
      {!role && (
        <div className="rounded-lg border p-3">
          <div className="mb-1 text-sm font-semibold">英雄類型（只算主定位）</div>
          {settled ? (
            <RadarChart data={roleData} mode="games" baseline={overallWr} total={total} height={300} />
          ) : (
            <div className="h-[300px]" />
          )}
        </div>
      )}
      {champs.loading ? (
        <Skeleton className="h-[320px] w-full" />
      ) : champs.error ? (
        <div className="text-sm text-destructive">{champs.error}</div>
      ) : !champs.rows.length ? (
        <EmptyState>這個條件下沒有對局。</EmptyState>
      ) : (
        <div className="space-y-1">
          {champs.rows.map((r, i) => (
            <div
              key={String(r["champions.name"])}
              style={{ "--stagger": `${Math.min(i * 30, 400)}ms` } as CSSProperties}
              className="slide-in grid grid-cols-[minmax(0,1fr)_4rem_minmax(9rem,13rem)] items-center gap-3 rounded-md px-2 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <img src={iconUrl(r["champions.icon_path"] as string)} alt="" className="size-8 shrink-0 rounded-md bg-icon-tile" />
                <span className="truncate text-[13px] font-medium">{String(r["champions.name"])}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{n0(r, "participants.games")} 場</span>
              <RecordCell
                winrate={opt(r, "participants.winrate")}
                wins={n0(r, "participants.wins")}
                losses={n0(r, "participants.losses")}
                baseline={overallWr}
                baselineLabel="他自己的整體勝率"
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function Crew() {
  const { players, apply } = useFilters()
  const crew = useMemo(() => players.filter((p) => p.crew), [players])
  // 預設全部人都比；點名字可以拿掉（至少留一個）
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const chosen = crew.filter((p) => !excluded.has(p.puuid))
  const puuids = chosen.map((p) => p.puuid)
  const [compare, setCompare] = useState<Compare>("self")
  const [focus, setFocus] = useState<{ puuid: string; role: string | null } | null>(null)

  const byId = useMemo(() => new Map(crew.map((p) => [p.puuid, p])), [crew])
  const focusPlayer = focus ? byId.get(focus.puuid) : undefined
  useCrumb(
    10,
    focusPlayer ? `${splitId(focusPlayer.riot_id, focusPlayer.puuid).name}${focus?.role ? `・${focus.role}` : ""}` : null,
    () => setFocus(null),
  )

  // 全域條件（模式、期間、下鑽）照套，但不鎖定帳號（scope "all"），改成鎖定這群人。
  // equals 給多個值就是 IN。
  const crewFilter = (ids: string[]): CubeFilter => ({ member: "participants.puuid", operator: "equals", values: ids })
  const q = (query: CubeQuery): CubeQuery | null =>
    puuids.length ? apply({ ...query, filters: [crewFilter(puuids), ...(query.filters ?? [])] }, "all") : null

  const summary = useCube(
    q({
      measures: [
        "participants.games",
        "participants.wins",
        "participants.losses",
        "participants.winrate",
        "participants.kda",
        "participants.dpm",
        "participants.kill_participation",
      ],
      dimensions: ["participants.puuid"],
      limit: NO_LIMIT,
    }),
  )
  const roles = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.winrate"],
      dimensions: ["participants.puuid", "champion_roles.name"],
      filters: PRIMARY_ONLY,
      limit: NO_LIMIT,
    }),
  )
  const champs = useCube(
    q({
      measures: ["participants.games", "participants.wins", "participants.winrate"],
      dimensions: ["participants.puuid", "champions.name", "champions.icon_path"],
      limit: NO_LIMIT,
    }),
  )
  const error = summary.error ?? roles.error ?? champs.error

  const sumOf = (puuid: string) => summary.rows.find((r) => r["participants.puuid"] === puuid)
  const roleOf = (puuid: string, role: string) =>
    roles.rows.find((r) => r["participants.puuid"] === puuid && r["champion_roles.name"] === role)
  const wrOf = (puuid: string) => opt(sumOf(puuid), "participants.winrate")

  // 依場次排：場次多的人數字比較可信，放上面
  const ordered = [...chosen].sort((a, b) => n0(sumOf(b.puuid), "participants.games") - n0(sumOf(a.puuid), "participants.games"))

  // 「和大家比」的基準：這群人在這一類的合計勝率
  const groupRoleWr = (role: string) => {
    const rows = roles.rows.filter((r) => r["champion_roles.name"] === role)
    const g = rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
    return g ? (100 * rows.reduce((a, r) => a + n0(r, "participants.wins"), 0)) / g : null
  }
  const groupGames = summary.rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
  const groupWr = groupGames ? (100 * summary.rows.reduce((a, r) => a + n0(r, "participants.wins"), 0)) / groupGames : null

  const radarFor = (puuid: string): RadarDatum[] =>
    ROLES.map((label) => {
      const r = roleOf(puuid, label)
      return { label, games: n0(r, "participants.games"), wins: n0(r, "participants.wins"), winrate: opt(r, "participants.winrate") }
    })
  const topRole = (puuid: string) => [...radarFor(puuid)].sort((a, b) => b.games - a.games)[0]

  // ── 總覽表 ──
  const tableRows = useMemo(
    () =>
      ordered.map((p) => {
        const s = sumOf(p.puuid)
        const tr = topRole(p.puuid)
        const games = n0(s, "participants.games")
        return {
          puuid: p.puuid,
          player: splitId(p.riot_id, p.puuid).name + (p.is_me ? "（我）" : ""),
          "participants.games": games,
          "participants.wins": n0(s, "participants.wins"),
          "participants.losses": n0(s, "participants.losses"),
          "participants.winrate": opt(s, "participants.winrate"),
          "participants.kda": opt(s, "participants.kda"),
          "participants.dpm": opt(s, "participants.dpm"),
          "participants.kill_participation": opt(s, "participants.kill_participation"),
          top_role: tr?.games ? `${tr.label}（${Math.round((100 * tr.games) / Math.max(1, games))}%）` : "—",
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.rows, roles.rows, chosen.map((p) => p.puuid).join()],
  )
  const columns: GridColumn[] = useMemo(
    () => [
      { key: "player", title: "玩家", kind: "dimension", flex: 1.4, minWidth: 150 },
      { key: "participants.games", title: "場次", kind: "metric", format: round0, flex: 0.5, minWidth: 70 },
      {
        key: "participants.winrate",
        title: "戰績",
        kind: "metric",
        flex: 1.5,
        minWidth: 170,
        cell: (r) => (
          <RecordCell
            winrate={num(r["participants.winrate"] as number | null)}
            wins={Number(r["participants.wins"]) || 0}
            losses={Number(r["participants.losses"]) || 0}
            baseline={groupWr}
            baselineLabel="這群人合計的勝率"
          />
        ),
      },
      { key: "participants.kda", title: "KDA", kind: "metric", format: round2, flex: 0.7, minWidth: 80 },
      { key: "participants.dpm", title: "每分鐘傷害", kind: "metric", format: round0, flex: 0.8, minWidth: 100 },
      { key: "participants.kill_participation", title: "參團率", kind: "metric", format: round1, suffix: "%", flex: 0.7, minWidth: 90 },
      { key: "top_role", title: "最常玩的類型", kind: "dimension", flex: 1, minWidth: 130 },
      { key: "participants.wins", title: "勝場", kind: "metric", hide: true },
      { key: "participants.losses", title: "敗場", kind: "metric", hide: true },
    ],
    [groupWr],
  )

  // ── 擅長的英雄：場次夠的英雄裡，往他自己的平均收縮後勝率最高的 ──
  const bestOf = (puuid: string) => {
    const base = wrOf(puuid) ?? 50
    return champs.rows
      .filter((r) => r["participants.puuid"] === puuid && n0(r, "participants.games") >= BEST_MIN)
      .map((r) => ({
        name: String(r["champions.name"]),
        icon: r["champions.icon_path"] as string,
        games: n0(r, "participants.games"),
        wins: n0(r, "participants.wins"),
        winrate: opt(r, "participants.winrate"),
        adj: shrunk(n0(r, "participants.games"), opt(r, "participants.winrate"), base),
      }))
      // 並列（同場次同勝率）時依名稱排，每次顯示同一組，不會隨查詢回傳順序跳動
      .sort((a, b) => b.adj - a.adj || b.games - a.games || a.name.localeCompare(b.name, "zh-Hant"))
      .slice(0, BEST_SHOWN)
  }

  const loading = summary.loading || roles.loading || champs.loading

  if (!players.length) return <Skeleton className="h-[420px] w-full" />
  if (crew.length < 2) {
    return (
      <EmptyState>
        還沒有可以比較的好友。到「追蹤對象」加入一起打的朋友，他們的戰績被採集進來之後就會出現在這裡。
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      {error && <QueryError error={error} />}

      <Panel
        title="比較對象"
        caption="你和追蹤中的好友。點名字可以拿掉或加回來；模式、期間與上方的篩選照常套用。大部分場次是一起打的，勝率會互相牽動，差距要看場次多不多"
      >
        <div className="flex flex-wrap gap-2">
          {crew.map((p) => {
            const on = !excluded.has(p.puuid)
            return (
              <button
                key={p.puuid}
                onClick={() =>
                  setExcluded((cur) => {
                    const next = new Set(cur)
                    if (on) {
                      if (crew.length - next.size <= 1) return cur // 至少留一個
                      next.add(p.puuid)
                    } else next.delete(p.puuid)
                    return next
                  })
                }
                className={cn(
                  "flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition",
                  on ? "border-primary/50 bg-primary/10" : "text-muted-foreground opacity-60 hover:opacity-100",
                )}
              >
                <Check className={cn("size-3.5 shrink-0", on ? "text-primary" : "opacity-0")} />
                <PlayerName player={p} />
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel
        title="總覽"
        caption={`每人一列，依場次排。戰績條上的刻度是這群人合計的勝率 ${groupWr?.toFixed(1) ?? "—"}%。點一列看他玩過的每隻英雄`}
      >
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <AgTable
            columns={columns}
            rows={tableRows}
            rowHeight={54}
            height={Math.min(560, 110 + tableRows.length * 54)}
            fileName="crew"
            drillOn="click"
            highlight={focus && !focus.role ? { key: "puuid", value: focus.puuid } : null}
            onDrill={(_c, _v, row) => setFocus({ puuid: String(row.puuid), role: null })}
          />
        )}
      </Panel>

      <Panel
        title="英雄類型勝率"
        caption={
          compare === "self"
            ? "每一格是這個人玩這一類時的勝率與場次（只算主定位）。顏色是和「他自己的整體勝率」比：看每個人擅長哪一類"
            : "每一格是這個人玩這一類時的勝率與場次（只算主定位）。顏色是和「這群人玩這一類的合計勝率」比：看同一類誰玩得最好"
        }
        action={
          <ToggleGroup type="single" size="sm" variant="outline" value={compare} onValueChange={(v) => v && setCompare(v as Compare)}>
            <ToggleGroupItem value="self">和自己比</ToggleGroupItem>
            <ToggleGroupItem value="group">和大家比</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground">
                  <th className="w-[220px] px-2 text-left font-normal">玩家</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-2 text-center font-medium text-foreground">
                      {r}
                      {compare === "group" && (
                        <div className="font-mono text-[10px] font-normal text-muted-foreground">
                          合計 {groupRoleWr(r)?.toFixed(1) ?? "—"}%
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((p, i) => {
                  const overall = wrOf(p.puuid)
                  return (
                    <tr key={p.puuid} className="rise" style={{ "--stagger": `${i * 40}ms` } as CSSProperties}>
                      <td className="max-w-[14rem] px-2">
                        <PlayerName player={p} />
                        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          整體 {overall?.toFixed(1) ?? "—"}%・{n0(sumOf(p.puuid), "participants.games")} 場
                        </div>
                      </td>
                      {ROLES.map((role) => {
                        const r = roleOf(p.puuid, role)
                        const games = n0(r, "participants.games")
                        const wr = opt(r, "participants.winrate")
                        const base = (compare === "self" ? overall : groupRoleWr(role)) ?? 50
                        const dev = games ? shrunk(games, wr, base) - base : 0
                        const active = focus?.puuid === p.puuid && focus.role === role
                        return (
                          <td key={role} className="p-0">
                            <button
                              disabled={!games}
                              onClick={() => setFocus(active ? null : { puuid: p.puuid, role })}
                              title={
                                games
                                  ? `${role}・${games} 場・${n0(r, "participants.wins")} 勝 ${games - n0(r, "participants.wins")} 敗`
                                  : `沒玩過${role}`
                              }
                              className={cn(
                                "flex h-14 w-full flex-col items-center justify-center rounded-md transition",
                                games ? tintClass(dev) : "bg-muted/15",
                                games && "hover:ring-1 hover:ring-primary/60",
                                active && "ring-2 ring-primary",
                              )}
                            >
                              {games ? (
                                <>
                                  <span className="font-mono text-sm font-semibold tabular-nums">{wr?.toFixed(1)}%</span>
                                  <span className="text-[11px] text-muted-foreground">{games} 場</span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>比基準低</span>
              <span className="flex overflow-hidden rounded">
                {["bg-loss/45", "bg-loss/30", "bg-loss/15", "bg-muted/40", "bg-win/15", "bg-win/30", "bg-win/45"].map((c) => (
                  <span key={c} className={cn("h-3 w-6", c)} />
                ))}
              </span>
              <span>比基準高</span>
              <span className="opacity-70">
                場次少的先往基準收斂（少於 {SHRINK_K} 場時顏色很淡），相差不到 2 個百分點不上色。點一格看那個人在這一類玩過的英雄
              </span>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="擅長的英雄"
        caption={`每人列出玩過 ${BEST_MIN} 場以上、勝率往他自己平均收縮後最高的 ${BEST_SHOWN} 隻。只玩過一兩場就全勝的不算擅長`}
      >
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ordered.map((p, i) => {
              const best = bestOf(p.puuid)
              const overall = wrOf(p.puuid)
              return (
                <button
                  key={p.puuid}
                  onClick={() => setFocus({ puuid: p.puuid, role: null })}
                  style={{ "--stagger": `${i * 40}ms` } as CSSProperties}
                  className="rise flex flex-col gap-2 rounded-lg border p-3 text-left transition hover:border-primary/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <PlayerName player={p} className="text-sm" />
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      整體 {overall?.toFixed(1) ?? "—"}%
                    </span>
                  </div>
                  {best.length ? (
                    <div className="space-y-1">
                      {best.map((c) => {
                        const above = c.winrate !== null && overall !== null && c.winrate >= overall
                        return (
                          <div key={c.name} className="flex items-center gap-2">
                            <img src={iconUrl(c.icon)} alt="" className="size-7 shrink-0 rounded-md bg-icon-tile" />
                            <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {c.wins} 勝 {c.games - c.wins} 敗
                            </span>
                            <span
                              className={cn(
                                "w-[52px] shrink-0 rounded border px-1 text-right font-mono text-[11px] tabular-nums",
                                above ? "border-win/30 bg-win/10 text-win" : "border-loss/30 bg-loss/10 text-loss",
                              )}
                            >
                              {c.winrate?.toFixed(1)}%
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">還沒有英雄玩到 {BEST_MIN} 場。</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      <DetailDrawer
        open={!!focusPlayer}
        onClose={() => setFocus(null)}
        title={focusPlayer ? <PlayerName player={focusPlayer} /> : ""}
        subtitle={
          focusPlayer
            ? `${focus?.role ? `${focus.role}・` : ""}整體 ${wrOf(focusPlayer.puuid)?.toFixed(1) ?? "—"}%・${n0(sumOf(focusPlayer.puuid), "participants.games")} 場`
            : undefined
        }
      >
        {focusPlayer && (
          <PlayerDrawerBody
            key={`${focusPlayer.puuid}:${focus?.role ?? ""}`}
            player={focusPlayer}
            role={focus?.role ?? null}
            overallWr={wrOf(focusPlayer.puuid)}
            roleData={radarFor(focusPlayer.puuid)}
            total={n0(sumOf(focusPlayer.puuid), "participants.games")}
            crewFilter={crewFilter}
          />
        )}
      </DetailDrawer>
    </div>
  )
}
