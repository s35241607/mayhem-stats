import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Kpi, Panel, EmptyState, QueryError } from "@/components/primitives"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { num, type CubeFilter } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { DrillPanel } from "@/components/MatchList"
import { MIN_GAMES, NO_LIMIT } from "./shared"

/** 下鑽的分組。kind 同時是 /api/matches 的參數名。 */
type TiltFocus = { kind: "prev_result" | "session_stage" | "game_of_day"; value: string; label: string }

const STAGE_ORDER = ["第 1-2 場", "第 3-5 場", "第 6-9 場", "第 10 場以後"]

export function Tilt() {
  const { queueId, subjectFilter, timeFilter, matchParams, account } = useFilters()
  const [focus, setFocus] = useState<TiltFocus | null>(null)
  useCrumb(10, focus?.label ?? null, () => setFocus(null))
  // 「一天打到第幾場」原本畫成分段、逐場兩張並排的圖。同一個維度的粗細兩種，
  // 改成和時段頁「四時段／逐小時」一樣用切換鈕。
  const [grain, setGrain] = useState<"stage" | "index">("stage")

  // my_games 是自己的 cube，沒有 participants.is_me，所以不套 apply()，
  // 改用 subjectFilter 指定要看誰的對局序列。
  const filters: CubeFilter[] = subjectFilter("my_games.puuid")
  if (queueId) {
    filters.push({ member: "my_games.queue_id", operator: "equals", values: [queueId] })
  }
  const time = timeFilter("my_games.played_at")

  const byPrev = useCube({
    measures: ["my_games.games", "my_games.wins", "my_games.winrate"],
    dimensions: ["my_games.prev_result"],
    filters,
    ...time,
    limit: 10,
  })

  const byStage = useCube({
    measures: ["my_games.games", "my_games.winrate"],
    dimensions: ["my_games.session_stage"],
    filters,
    ...time,
    limit: 10,
  })

  const byIndex = useCube(
    grain === "index"
      ? {
          measures: ["my_games.games", "my_games.winrate"],
          dimensions: ["my_games.game_of_day"],
          filters,
          ...time,
          limit: NO_LIMIT,
        }
      : null,
  )

  const pick = (label: string) =>
    byPrev.rows.find((r) => r["my_games.prev_result"] === label)

  const afterLoss = pick("前一場輸")
  const afterWin = pick("前一場贏")
  const lossWr = num(afterLoss?.["my_games.winrate"] ?? null)
  const winWr = num(afterWin?.["my_games.winrate"] ?? null)
  const delta = lossWr !== null && winWr !== null ? lossWr - winWr : null

  const prevBars: BarDatum[] = byPrev.rows
    .filter((r) => r["my_games.prev_result"] !== "沒有前一場")
    .map((r) => ({
      label: String(r["my_games.prev_result"]),
      value: num(r["my_games.winrate"]) ?? 0,
      games: num(r["my_games.games"]) ?? 0,
    }))

  const stageBars: BarDatum[] = byStage.rows
    .map((r) => ({
      label: String(r["my_games.session_stage"]),
      value: num(r["my_games.winrate"]) ?? 0,
      games: num(r["my_games.games"]) ?? 0,
    }))
    .sort((a, b) => STAGE_ORDER.indexOf(a.label) - STAGE_ORDER.indexOf(b.label))

  const indexBars: BarDatum[] = byIndex.rows
    .map((r) => ({
      label: `第 ${r["my_games.game_of_day"]} 場`,
      index: Number(r["my_games.game_of_day"]),
      value: num(r["my_games.winrate"]) ?? 0,
      games: num(r["my_games.games"]) ?? 0,
    }))
    .filter((r) => r.games >= MIN_GAMES)
    .sort((a, b) => a.index - b.index)

  // 點長條 → 下面列出那一組的每一場。再點一次同一根取消。
  const toggleFocus = (next: TiltFocus) =>
    setFocus((cur) => (cur && cur.kind === next.kind && cur.value === next.value ? null : next))

  const dayChart = grain === "stage" ? byStage : byIndex
  const dayBars = grain === "stage" ? stageBars : indexBars

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="前一場輸之後"
          value={lossWr === null ? "—" : `${lossWr.toFixed(1)}%`}
          hint={afterLoss ? `${num(afterLoss["my_games.games"])} 場` : undefined}
          tone={lossWr !== null && lossWr < 50 ? "loss" : undefined}
          loading={byPrev.loading}
        />
        <Kpi
          label="前一場贏之後"
          value={winWr === null ? "—" : `${winWr.toFixed(1)}%`}
          hint={afterWin ? `${num(afterWin["my_games.games"])} 場` : undefined}
          tone={winWr !== null && winWr >= 50 ? "win" : undefined}
          loading={byPrev.loading}
        />
        <Kpi
          label="落差"
          value={delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`}
          hint={
            delta === null
              ? undefined
              : delta < -5
                ? "輸完之後明顯變差"
                : delta > 5
                  ? "輸完之後反而更好"
                  : "沒有明顯差別"
          }
          tone={delta === null ? undefined : delta < -5 ? "loss" : delta > 5 ? "win" : undefined}
          loading={byPrev.loading}
        />
      </div>

      <Panel
        title="前一場的結果，對這一場有影響嗎"
        caption="兩個柱子差距明顯的話，代表上一場的結果會影響你下一場的表現。點一根看那些場次"
      >
        {byPrev.loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : byPrev.error ? (
          <QueryError error={byPrev.error} />
        ) : prevBars.length ? (
          <BarChart
            data={prevBars}
            suffix="%"
            selected={focus?.kind === "prev_result" ? focus.value : null}
            onPick={(label) => toggleFocus({ kind: "prev_result", value: label, label })}
          />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>

      <Panel
        title="一天打到第幾場開始變差"
        caption={
          grain === "stage"
            ? "以當天的第幾場分組，樣本集中、比較看得出趨勢。點一根看那些場次"
            : `逐場拆開，只列出累積 ${MIN_GAMES} 場以上的場次序號。點一根看那些場次`
        }
        action={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={grain}
            onValueChange={(v) => v && setGrain(v as "stage" | "index")}
          >
            <ToggleGroupItem value="stage">分段</ToggleGroupItem>
            <ToggleGroupItem value="index">逐場</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {dayChart.loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : dayChart.error ? (
          <QueryError error={dayChart.error} />
        ) : dayBars.length ? (
          <BarChart
            data={dayBars}
            suffix="%"
            selected={
              grain === "stage" && focus?.kind === "session_stage"
                ? focus.value
                : grain === "index" && focus?.kind === "game_of_day"
                  ? `第 ${focus.value} 場`
                  : null
            }
            onPick={(label) =>
              grain === "stage"
                ? toggleFocus({ kind: "session_stage", value: label, label: `當日${label}` })
                : toggleFocus({ kind: "game_of_day", value: label.replace(/\D/g, ""), label: `當日${label}` })
            }
          />
        ) : (
          <EmptyState>
            {grain === "stage" ? "還沒有資料。" : `單一場次序號還沒累積到 ${MIN_GAMES} 場，切回「分段」看看。`}
          </EmptyState>
        )}
      </Panel>

      {focus && (
        <DrillPanel
          title={focus.label}
          params={{ ...matchParams(), [focus.kind]: focus.value }}
          puuid={account?.puuid}
          onClose={() => setFocus(null)}
        />
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        「前一場」是同一個模式內、時間上的前一場——這樣切是為了讓上方的模式篩選有意義，
        否則篩到 Mayhem 時，前一場可能指向畫面上根本看不到的其他模式對局。
        另外提醒：這類差距在幾十場的樣本下波動很大，看到落差先當成傾向，不要當成定論。
      </p>
    </div>
  )
}
