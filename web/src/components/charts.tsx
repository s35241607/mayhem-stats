import { useMemo } from "react"
import ReactECharts from "echarts-for-react"

/** 從 CSS 變數讀主題色，讓圖表跟著 shadcn 的主題走，不要另外寫死一組色。 */
function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function useTheme() {
  return useMemo(
    () => ({
      text: cssVar("--foreground", "#eef1f8"),
      muted: cssVar("--muted-foreground", "#8d96ac"),
      border: cssVar("--border", "rgba(255,255,255,0.11)"),
      card: cssVar("--card", "#1f2839"),
      primary: cssVar("--primary", "#ff6a3d"),
      win: cssVar("--win", "#3ee0a4"),
      loss: cssVar("--loss", "#ff6b6b"),
      accent2: cssVar("--chart-2", "#5fb3ef"),
    }),
    [],
  )
}

function baseTooltip(theme: ReturnType<typeof useTheme>) {
  return {
    backgroundColor: theme.card,
    borderColor: theme.border,
    textStyle: { color: theme.text, fontSize: 12 },
    padding: [8, 12],
  }
}

// ─────────────────────────────────────────── 勝率趨勢

export type TrendPoint = { date: string; games: number; winrate: number | null }

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const theme = useTheme()

  const option = useMemo(() => {
    const maxGames = Math.max(1, ...points.map((p) => p.games))
    return {
      grid: { left: 44, right: 20, top: 20, bottom: 32 },
      tooltip: {
        trigger: "axis",
        ...baseTooltip(theme),
        formatter: (params: { data: [string, number]; dataIndex: number }[]) => {
          const p = points[params[0].dataIndex]
          return `${p.date}<br/>${p.games} 場 · 勝率 ${p.winrate?.toFixed(1) ?? "—"}%`
        },
      },
      // time 軸會依實際日期定位，沒打球的日子自然留白，不會把有間隔的兩天畫成相鄰
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: theme.border } },
        axisLabel: { color: theme.muted, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: theme.muted, fontSize: 11, formatter: "{value}%" },
        splitLine: { lineStyle: { color: theme.border } },
      },
      series: [
        {
          type: "line",
          smooth: false,
          data: points.map((p) => [p.date, p.winrate]),
          lineStyle: { color: theme.accent2, width: 2 },
          itemStyle: { color: theme.accent2 },
          // 點的大小代表當天場次，避免只打一場的 0%／100% 看起來跟 20 場一樣重
          symbolSize: (_: unknown, params: { dataIndex: number }) =>
            6 + 12 * Math.sqrt(points[params.dataIndex].games / maxGames),
          areaStyle: { color: theme.accent2, opacity: 0.1 },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 50 }],
            lineStyle: { color: theme.muted, type: "dashed", width: 1 },
            label: { show: false },
          },
        },
      ],
    }
  }, [points, theme])

  return <ReactECharts option={option} style={{ height: 240 }} notMerge />
}

// ─────────────────────────────────────────── 星期 × 時段熱力圖

export type HeatCell = { weekday: number; hour: number; games: number; winrate: number | null }

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const theme = useTheme()

  const option = useMemo(() => {
    const data = cells.map((c) => [c.hour, c.weekday, c.winrate ?? 0, c.games])
    return {
      grid: { left: 52, right: 24, top: 16, bottom: 56 },
      tooltip: {
        ...baseTooltip(theme),
        formatter: (p: { data: number[] }) =>
          `${WEEKDAYS[p.data[1]]} ${String(p.data[0]).padStart(2, "0")}:00<br/>` +
          `${p.data[3]} 場 · 勝率 ${p.data[2].toFixed(1)}%`,
      },
      xAxis: {
        type: "category",
        data: Array.from({ length: 24 }, (_, i) => String(i)),
        splitArea: { show: true },
        axisLabel: { color: theme.muted, fontSize: 10 },
        axisLine: { lineStyle: { color: theme.border } },
      },
      yAxis: {
        type: "category",
        data: WEEKDAYS,
        splitArea: { show: true },
        axisLabel: { color: theme.muted, fontSize: 11 },
        axisLine: { lineStyle: { color: theme.border } },
      },
      visualMap: {
        min: 0,
        max: 100,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        itemWidth: 12,
        itemHeight: 90,
        text: ["勝率高", "勝率低"],
        textStyle: { color: theme.muted, fontSize: 11 },
        inRange: { color: [theme.loss, "#4a5568", theme.win] },
      },
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: true,
            formatter: (p: { data: number[] }) => (p.data[3] ? String(p.data[3]) : ""),
            color: theme.text,
            fontSize: 10,
          },
          itemStyle: { borderColor: theme.card, borderWidth: 1, borderRadius: 3 },
          emphasis: { itemStyle: { borderColor: theme.primary, borderWidth: 2 } },
        },
      ],
    }
  }, [cells, theme])

  return <ReactECharts option={option} style={{ height: 300 }} notMerge />
}

// ─────────────────────────────────────────── 橫向長條圖

export type BarDatum = { label: string; value: number; games: number }

export function BarChart({
  data,
  suffix = "",
  colorBy = "value",
}: {
  data: BarDatum[]
  suffix?: string
  colorBy?: "value" | "flat"
}) {
  const theme = useTheme()

  const option = useMemo(() => {
    const ordered = [...data].reverse() // ECharts 的 y 軸由下往上
    return {
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(theme),
        formatter: (p: { name: string; value: number; dataIndex: number }) =>
          `${p.name}<br/>${p.value.toFixed(1)}${suffix} · ${ordered[p.dataIndex].games} 場`,
      },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.border } },
      },
      yAxis: {
        type: "category",
        data: ordered.map((d) => d.label),
        axisLabel: { color: theme.text, fontSize: 12 },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: ordered.map((d) => ({
            value: d.value,
            itemStyle: {
              color:
                colorBy === "flat"
                  ? theme.primary
                  : d.value >= 50
                    ? theme.win
                    : theme.loss,
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barMaxWidth: 22,
          label: {
            show: true,
            position: "right",
            color: theme.muted,
            fontSize: 11,
            formatter: (p: { value: number }) => `${p.value.toFixed(1)}${suffix}`,
          },
        },
      ],
    }
  }, [data, suffix, colorBy, theme])

  return <ReactECharts option={option} style={{ height: Math.max(180, data.length * 34) }} notMerge />
}
