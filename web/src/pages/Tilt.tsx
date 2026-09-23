import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Kpi, Panel, EmptyState, QueryError } from "@/components/primitives"
import { BarChart, type BarDatum } from "@/components/charts"
import { useCube } from "@/hooks/useCube"
import { MAX_GAME_IDS, num, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { DrillPanel } from "@/components/MatchList"
import { MIN_GAMES, NO_LIMIT } from "./shared"

/** 下鑽的分組。kind 同時是 participant_context 的維度名。 */
type TiltFocus = { kind: "prev_result" | "session_stage" | "game_in_session"; value: string; label: string }

const STAGE_ORDER = ["第 1-2 場", "第 3-5 場", "第 6-9 場", "第 10 場以後"]

const G = "participants.games"
const W = "participants.wins"

/** 兩個勝率差（a − b，百分點）的 95% 區間，常態近似。樣本不夠時回傳 null。
 *  用來決定「落差」要不要上色：區間跨過 0 就只描述、不下結論。 */
function diffInterval(a: CubeRow | undefined, b: CubeRow | undefined): [number, number] | null {
  const na = num(a?.[G] ?? null) ?? 0
  const nb = num(b?.[G] ?? null) ?? 0
  if (na < MIN_GAMES || nb < MIN_GAMES) return null
  const pa = (num(a?.[W] ?? null) ?? 0) / na
  const pb = (num(b?.[W] ?? null) ?? 0) / nb
  const se = Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb) * 100
  const d = (pa - pb) * 100
  return [d - 1.96 * se, d + 1.96 * se]
}

export function Tilt() {
  const { apply } = useFilters()
  const [focus, setFocus] = useState<TiltFocus | null>(null)
  useCrumb(10, focus?.label ?? null, () => setFocus(null))
  // 「一輪打到第幾場」同一個維度的粗細兩種，和時段頁「四時段／逐小時」一樣用切換鈕。
  const [grain, setGrain] = useState<"stage" | "index">("stage")

  // participant_context 和 participants 一對一，所以直接走 apply()：
  // 帳號、模式、期間、全域下鑽（例如某隻英雄）都會一起套上。
  // 序列（前一場、第幾場）是在完整歷史上先算好的，篩選不會讓它重新編號。
  const byPrev = useCube(
    apply({ measures: [G, W, "participants.winrate"], dimensions: ["participant_context.prev_result"], limit: 10 }),
  )
  const byStage = useCube(
    apply({ measures: [G, W, "participants.winrate"], dimensions: ["participant_context.session_stage"], limit: 10 }),
  )
  const byIndex = useCube(
    grain === "index"
      ? apply({ measures: [G, W, "participants.winrate"], dimensions: ["participant_context.game_in_session"], limit: NO_LIMIT })
      : null,
  )

  const pick = (label: string) => byPrev.rows.find((r) => r["participant_context.prev_result"] === label)
  const afterLoss = pick("前一場輸")
  const afterWin = pick("前一場贏")
  const lossWr = num(afterLoss?.["participants.winrate"] ?? null)
  const winWr = num(afterWin?.["participants.winrate"] ?? null)
  const delta = lossWr !== null && winWr !== null ? lossWr - winWr : null
  const interval = diffInterval(afterLoss, afterWin)
  const clear = interval !== null && (interval[1] < 0 || interval[0] > 0)

  // 平均線用這個條件下的整體勝率（含「沒有前一場」那場），不要用長條自己的加權平均——
  // 拿掉一組之後平均會偏掉，同一頁兩張圖的「平均」就對不上
  const totalGames = byPrev.rows.reduce((a, r) => a + (num(r[G]) ?? 0), 0)
  const totalWins = byPrev.rows.reduce((a, r) => a + (num(r[W]) ?? 0), 0)
  const overall = totalGames ? (100 * totalWins) / totalGames : undefined

  const prevBars: BarDatum[] = byPrev.rows
    .filter((r) => r["participant_context.prev_result"] !== "沒有前一場")
    .map((r) => ({
      label: String(r["participant_context.prev_result"]),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r[G]) ?? 0,
    }))

  const stageBars: BarDatum[] = byStage.rows
    .map((r) => ({
      label: String(r["participant_context.session_stage"]),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r[G]) ?? 0,
    }))
    .sort((a, b) => STAGE_ORDER.indexOf(a.label) - STAGE_ORDER.indexOf(b.label))

  const indexBars: BarDatum[] = byIndex.rows
    .map((r) => ({
      label: `第 ${r["participant_context.game_in_session"]} 場`,
      index: Number(r["participant_context.game_in_session"]),
      value: num(r["participants.winrate"]) ?? 0,
      games: num(r[G]) ?? 0,
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
          hint={afterLoss ? `${num(afterLoss[G])} 場` : undefined}
          loading={byPrev.loading}
        />
        <Kpi
          label="前一場贏之後"
          value={winWr === null ? "—" : `${winWr.toFixed(1)}%`}
          hint={afterWin ? `${num(afterWin[G])} 場` : undefined}
          loading={byPrev.loading}
        />
        <Kpi
          label="落差"
          value={delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`}
          hint={
            interval === null
              ? delta === null
                ? undefined
                : "樣本太少，先不解讀"
              : `95% 區間 ${interval[0].toFixed(0)}～${interval[1].toFixed(0)} pp・${clear ? "區間不含 0" : "還在樣本誤差內"}`
          }
          // 只有區間不跨 0 才上色；跨 0 時再大的落差也只是描述
          tone={clear && delta !== null ? (delta < 0 ? "loss" : "win") : undefined}
          loading={byPrev.loading}
        />
      </div>

      <Panel
        title="前一場的結果，和這一場的勝率"
        caption="兩組的勝率並排比較。這是關聯不是因果：連勝連敗也可能來自同一段時間的隊友與對手，不一定是心態。點一根看那些場次"
      >
        {byPrev.loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : byPrev.error ? (
          <QueryError error={byPrev.error} />
        ) : prevBars.length ? (
          <BarChart
            data={prevBars}
            suffix="%"
            showGames
            baseline={overall}
            selected={focus?.kind === "prev_result" ? focus.value : null}
            onPick={(label) => toggleFocus({ kind: "prev_result", value: label, label })}
          />
        ) : (
          <EmptyState>還沒有資料。</EmptyState>
        )}
      </Panel>

      <Panel
        title="同一輪連續打到第幾場"
        caption={
          grain === "stage"
            ? "一輪 = 前一場結束後不到 60 分鐘就接著打，跨過午夜也算同一輪。以輪內第幾場分組，點一根看那些場次"
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
            showGames
            baseline={overall}
            selected={
              grain === "stage" && focus?.kind === "session_stage"
                ? focus.value
                : grain === "index" && focus?.kind === "game_in_session"
                  ? `第 ${focus.value} 場`
                  : null
            }
            onPick={(label) =>
              grain === "stage"
                ? toggleFocus({ kind: "session_stage", value: label, label: `當輪${label}` })
                : toggleFocus({ kind: "game_in_session", value: label.replace(/\D/g, ""), label: `當輪${label}` })
            }
          />
        ) : (
          <EmptyState>
            {grain === "stage" ? "還沒有資料。" : `單一場次序號還沒累積到 ${MIN_GAMES} 場，切回「分段」看看。`}
          </EmptyState>
        )}
      </Panel>

      {focus && (
        // 「是哪幾場」用和上面圖表同一組條件向 Cube 查，後端不必再抄一份視窗函數
        <DrillPanel
          title={focus.label}
          gameIdKey="matches.game_id"
          query={apply({
            measures: [G],
            dimensions: ["matches.game_id"],
            filters: [{ member: `participant_context.${focus.kind}`, operator: "equals", values: [focus.value] }],
            limit: MAX_GAME_IDS,
          })}
          onClose={() => setFocus(null)}
        />
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        「前一場」與「一輪」都在同一個模式內算——這樣切是為了讓上方的模式篩選有意義，
        否則篩到 Mayhem 時，前一場可能指向畫面上根本看不到的其他模式對局。
        60 分鐘是分析上的切法，不是遊戲提供的欄位。這類差距在一兩百場的樣本下波動很大，看落差旁的區間再下判斷。
      </p>
    </div>
  )
}
