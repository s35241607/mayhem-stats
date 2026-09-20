import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { DrillPanel } from "@/components/MatchList"
import { Kpi, Panel, EmptyState, QueryError } from "@/components/primitives"
import { AgTable, type GridColumn } from "@/components/AgTable"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num } from "@/lib/cube"
import { ContrastCell, numOf } from "@/components/cells"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"

/** 拿來做勝負對照的指標。higherIsBetter 只影響顏色，不影響數字。 */
type Metric = {
  key: string
  label: string
  group: string
  decimals?: number
  suffix?: string
  higherIsBetter: boolean
}

const TEAM_METRICS: Metric[] = [
  { key: "participants.team_dpm", label: "我方每分鐘傷害", group: "團隊", higherIsBetter: true },
  { key: "participants.enemy_dpm", label: "敵方每分鐘傷害", group: "團隊", higherIsBetter: false },
  { key: "participants.team_gpm", label: "我方每分鐘經濟", group: "團隊", higherIsBetter: true },
  { key: "participants.enemy_gpm", label: "敵方每分鐘經濟", group: "團隊", higherIsBetter: false },
  { key: "participants.avg_team_kills", label: "我方總擊殺", group: "團隊", decimals: 1, higherIsBetter: true },
  { key: "participants.avg_enemy_kills", label: "敵方總擊殺", group: "團隊", decimals: 1, higherIsBetter: false },
]

const MINE_METRICS: Metric[] = [
  { key: "participants.avg_kills", label: "我的擊殺", group: "我自己", decimals: 1, higherIsBetter: true },
  { key: "participants.avg_deaths", label: "我的死亡", group: "我自己", decimals: 1, higherIsBetter: false },
  { key: "participants.avg_assists", label: "我的助攻", group: "我自己", decimals: 1, higherIsBetter: true },
  { key: "participants.kda", label: "我的 KDA", group: "我自己", decimals: 2, higherIsBetter: true },
  { key: "participants.dpm", label: "我的每分鐘傷害", group: "我自己", higherIsBetter: true },
  { key: "participants.gpm", label: "我的每分鐘經濟", group: "我自己", higherIsBetter: true },
  { key: "participants.avg_taken", label: "我承受的傷害", group: "我自己", higherIsBetter: false },
  { key: "participants.avg_survival", label: "最長存活(秒)", group: "我自己", higherIsBetter: true },
]

const SHARE_METRICS: Metric[] = [
  { key: "participants.damage_share", label: "我的傷害佔比", group: "隊內佔比", decimals: 1, suffix: "%", higherIsBetter: true },
  { key: "participants.tank_share", label: "我的承傷佔比", group: "隊內佔比", decimals: 1, suffix: "%", higherIsBetter: true },
  { key: "participants.kill_participation", label: "我的參團率", group: "隊內佔比", decimals: 1, suffix: "%", higherIsBetter: true },
]

const ALL_METRICS = [...TEAM_METRICS, ...MINE_METRICS, ...SHARE_METRICS]

// 好壞方向每個指標都不一樣：敵方傷害變高是壞事，我的 KDA 變高是好事。差不到 3% 就不上色，免得看起來像有事
const toneOf = (diff: number | null, higherIsBetter: boolean) =>
  diff === null || Math.abs(diff) < 3 ? null : diff > 0 === higherIsBetter ? "good" : "bad"

const fmtMetric = (n: number, decimals = 0, suffix = "") =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`

// 表格高 680px + 工具列：載入骨架要一樣高（722px），資料到的時候版面才不會往下推
const COLUMNS: GridColumn[] = [
  { key: "group", title: "分類", kind: "dimension", flex: 0.8, minWidth: 90 },
  { key: "label", title: "指標", kind: "dimension", flex: 1.3, minWidth: 140 },
  {
    // 排序依「敗局相差」；兩條細條同刻度，一眼看出勝局和敗局差多少
    key: "diffPct",
    title: "勝局 vs 敗局（敗局相差）",
    kind: "metric",
    flex: 2.6,
    minWidth: 300,
    cell: (r) => (
      <ContrastCell
        win={numOf(r, "win")}
        loss={numOf(r, "loss")}
        format={(n) => fmtMetric(n, Number(r.decimals ?? 0), String(r.suffix ?? ""))}
        diffPct={numOf(r, "diffPct")}
        tone={toneOf(numOf(r, "diffPct"), r.higherIsBetter === true)}
      />
    ),
  },
  { key: "win", title: "勝局", kind: "metric", hide: true },
  { key: "loss", title: "敗局", kind: "metric", hide: true },
]

export function Losses() {
  const { apply, matchParams, account } = useFilters()
  const [bucket, setBucket] = useState<string | null>(null)
  useCrumb(10, bucket ? `對局長度 ${bucket}` : null, () => setBucket(null))

  const byResult = useCube(
    apply({
      measures: ["participants.games", ...ALL_METRICS.map((m) => m.key), "matches.avg_duration"],
      dimensions: ["participants.result"],
      limit: 5,
    }),
  )

  const byDuration = useCube(
    apply({
      measures: ["participants.games", "participants.winrate"],
      dimensions: ["matches.duration_bucket"],
      limit: 10,
    }),
  )

  const win = byResult.rows.find((r) => r["participants.result"] === "勝")
  const loss = byResult.rows.find((r) => r["participants.result"] === "敗")
  const winGames = num(win?.["participants.games"]) ?? 0
  const lossGames = num(loss?.["participants.games"]) ?? 0
  const total = winGames + lossGames

  const rows = ALL_METRICS.map((m) => {
    const w = num(win?.[m.key])
    const l = num(loss?.[m.key])
    // 用相對差而不是絕對差,不同量級的指標才排得在一起比
    const diffPct = w !== null && l !== null && w !== 0 ? ((l - w) / Math.abs(w)) * 100 : null
    return { group: m.group, label: m.label, win: w, loss: l, diffPct, higherIsBetter: m.higherIsBetter, decimals: m.decimals, suffix: m.suffix }
  })

  const durationBars: BarDatum[] = byDuration.rows.map((r) => ({
    label: String(r["matches.duration_bucket"] ?? "—"),
    value: num(r["participants.winrate"]) ?? 0,
    games: num(r["participants.games"]) ?? 0,
  }))

  const teamDpmWin = num(win?.["participants.team_dpm"])
  const teamDpmLoss = num(loss?.["participants.team_dpm"])
  const enemyDpmWin = num(win?.["participants.enemy_dpm"])
  const enemyDpmLoss = num(loss?.["participants.enemy_dpm"])
  const oursDrop =
    teamDpmWin && teamDpmLoss ? ((teamDpmLoss - teamDpmWin) / teamDpmWin) * 100 : null
  const theirsRise =
    enemyDpmWin && enemyDpmLoss ? ((enemyDpmLoss - enemyDpmWin) / enemyDpmWin) * 100 : null

  const durWin = num(win?.["matches.avg_duration"])
  const durLoss = num(loss?.["matches.avg_duration"])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="勝率"
          value={total ? `${((winGames / total) * 100).toFixed(1)}%` : "—"}
          hint={total ? `${winGames} 勝 ${lossGames} 敗` : undefined}
          loading={byResult.loading}
        />
        <Kpi
          label="打不動還是被打爆"
          value={oursDrop !== null && theirsRise !== null ? (Math.abs(theirsRise) > Math.abs(oursDrop) ? "被打爆" : "打不動") : "—"}
          hint={
            oursDrop !== null && theirsRise !== null
              ? `輸時我方輸出 ${oursDrop.toFixed(0)}%、敵方 ${theirsRise > 0 ? "+" : ""}${theirsRise.toFixed(0)}%`
              : undefined
          }
          loading={byResult.loading}
        />
        <Kpi
          label="平均局長"
          // matches.avg_duration 在模型裡已經除過 60，單位就是分鐘
          value={durWin !== null && durLoss !== null ? `${durLoss.toFixed(1)} / ${durWin.toFixed(1)} 分` : "—"}
          hint="敗局 / 勝局。輸的局通常比較長，所以下面一律用每分鐘來比"
          loading={byResult.loading}
        />
      </div>

      <Panel
        title="勝局與敗局，數字差在哪"
        caption="「敗局相差」= 敗局比勝局高或低幾 %。綠色代表往好的方向、紅色代表往壞的方向；可以點欄位標題排序。"
      >
        {byResult.loading ? (
          <Skeleton className="h-[722px] w-full" />
        ) : byResult.error ? (
          <QueryError error={byResult.error} />
        ) : !win || !loss ? (
          <EmptyState>這個條件下缺少勝局或敗局，沒得比較。</EmptyState>
        ) : (
          <>
            <AgTable columns={COLUMNS} rowHeight={54} rows={rows as unknown as Record<string, unknown>[]} height={680} fileName="win-vs-loss" />
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <p>
                這張表是<strong>描述</strong>，不是原因。遊戲中的數字大多是輸贏的結果而不是起因——
                落後了才會經濟少、才會被推塔，不是反過來。真正在結果之前就決定的，是英雄、增幅、
                時段、隊友這些，那些在其他頁面。
              </p>
              <p>
                「隊內佔比」那一組比較接近可以自省的部分：如果輸的時候你的佔比反而變高，
                代表拖住的不是你；反過來就是你自己在輸的局裡也縮了。
              </p>
              <p>和朋友一起打會不會贏，在「隊友 / 對手」頁最上方。</p>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="對局長度與勝率"
        caption="和上面的「平均局長」是同一件事的分組版。注意因果方向：贏的時候通常推得快，所以短局勝率高多半是結果、不是原因。點一根看那些場次"
      >
        {byDuration.loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : byDuration.error ? (
          <QueryError error={byDuration.error} />
        ) : durationBars.length ? (
          <BarChart
            data={durationBars}
            suffix="%"
            selected={bucket}
            onPick={(label) => setBucket((cur) => (cur === label ? null : label))}
          />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>

      {bucket && (
        <DrillPanel
          title={`對局長度 ${bucket}`}
          params={{ ...matchParams(), duration: bucket }}
          puuid={account?.puuid}
          onClose={() => setBucket(null)}
        />
      )}
    </div>
  )
}
