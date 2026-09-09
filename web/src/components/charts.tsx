import { useEffect, useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"

/** 包一層尺寸觀察。
 *
 * ECharts 是在掛載當下量容器寬度，而在 grid／flex 版面裡那一刻寬度常常還是 0，
 * 之後它也不會自己重算——結果就是高度正常、寬度 0 的空白圖。
 * ResizeObserver 在初次佈局與之後每次容器變動時都會觸發，補上這個缺口。
 */
type EChartsInstance = { resize: () => void }

function ResponsiveChart({
  option,
  height,
  onEvent,
}: {
  option: unknown
  height: number
  /** 圖表事件，主要用來做下鑽（點一個點就把它加成篩選）。 */
  onEvent?: Record<string, (params: never) => void>
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const instance = useRef<EChartsInstance | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => instance.current?.resize())
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={boxRef} className="w-full">
      <ReactECharts
        // onChartReady 是取得實例的官方途徑；改用元件 ref 拿 getEchartsInstance
        // 在這個版本拿不到東西，resize 會被 optional chaining 靜靜吞掉。
        onChartReady={(chart: EChartsInstance) => {
          instance.current = chart
          chart.resize()
        }}
        option={option as never}
        onEvents={onEvent as never}
        style={{ height, width: "100%" }}
        notMerge
      />
    </div>
  )
}

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

  return <ResponsiveChart option={option} height={240} />
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

  return <ResponsiveChart option={option} height={300} />
}

// ─────────────────────────────────────────── 橫向長條圖

export type BarDatum = { label: string; value: number; games: number }

export function BarChart({
  data,
  suffix = "",
  colorBy = "value",
  onPick,
}: {
  data: BarDatum[]
  suffix?: string
  colorBy?: "value" | "flat"
  onPick?: (label: string) => void
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

  return (
    <ResponsiveChart
      option={option}
      height={Math.max(180, data.length * 34)}
      onEvent={onPick ? { click: (p: { name?: string }) => p.name && onPick(p.name) } : undefined}
    />
  )
}


// ─────────────────────────────────────────── 散布圖（找離群值）

export type ScatterPoint = {
  label: string
  x: number
  y: number
  size: number
}

/** 兩個指標交叉看，泡泡大小是場次。用來找「輸出高但贏不了」這種矛盾組合。 */
export function ScatterChart({
  points,
  xName,
  yName,
  xSuffix = "",
  ySuffix = "",
  onPick,
}: {
  points: ScatterPoint[]
  xName: string
  yName: string
  xSuffix?: string
  ySuffix?: string
  onPick?: (label: string) => void
}) {
  const theme = useTheme()

  const option = useMemo(() => {
    const maxSize = Math.max(1, ...points.map((p) => p.size))
    return {
      grid: { left: 56, right: 28, top: 24, bottom: 44 },
      tooltip: {
        ...baseTooltip(theme),
        formatter: (p: { data: { value: number[]; name: string } }) =>
          `${p.data.name}<br/>${xName} ${p.data.value[0].toFixed(1)}${xSuffix}` +
          `<br/>${yName} ${p.data.value[1].toFixed(1)}${ySuffix}` +
          `<br/>${p.data.value[2]} 場`,
      },
      xAxis: {
        type: "value",
        name: xName,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLabel: { color: theme.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.border } },
      },
      yAxis: {
        type: "value",
        name: yName,
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLabel: { color: theme.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.border } },
      },
      series: [
        {
          type: "scatter",
          data: points.map((p) => ({ name: p.label, value: [p.x, p.y, p.size] })),
          symbolSize: (v: number[]) => 8 + 26 * Math.sqrt(v[2] / maxSize),
          itemStyle: { color: theme.accent2, opacity: 0.75, borderColor: theme.card },
          emphasis: { itemStyle: { color: theme.primary, opacity: 1 } },
          label: {
            show: true,
            position: "top",
            color: theme.muted,
            fontSize: 10,
            formatter: (p: { data: { name: string; value: number[] } }) =>
              // 只標樣本較大的點，否則標籤會糊成一團
              p.data.value[2] >= Math.max(3, maxSize * 0.4) ? p.data.name : "",
          },
        },
      ],
    }
  }, [points, xName, yName, xSuffix, ySuffix, theme])

  return (
    <ResponsiveChart
      option={option}
      height={380}
      onEvent={onPick ? { click: (p: { data?: { name?: string } }) => p.data?.name && onPick(p.data.name) } : undefined}
    />
  )
}

// ─────────────────────────────────────────── 佔比樹狀圖

export function TreemapChart({
  items,
  onPick,
}: {
  items: { label: string; value: number; winrate: number | null }[]
  onPick?: (label: string) => void
}) {
  const theme = useTheme()

  const option = useMemo(
    () => ({
      tooltip: {
        ...baseTooltip(theme),
        formatter: (p: { name: string; value: number; data: { winrate: number | null } }) =>
          `${p.name}<br/>${p.value} 次` +
          (p.data.winrate === null ? "" : `<br/>勝率 ${p.data.winrate.toFixed(1)}%`),
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { color: theme.text, fontSize: 11, overflow: "truncate" },
          itemStyle: { borderColor: theme.card, borderWidth: 2, gapWidth: 2 },
          data: items.map((i) => ({
            name: i.label,
            value: i.value,
            winrate: i.winrate,
            // 用勝率上色，面積是使用次數：一眼看出「常用但不太贏」的組合
            itemStyle: {
              color:
                i.winrate === null
                  ? theme.muted
                  : i.winrate >= 50
                    ? theme.win
                    : theme.loss,
              opacity: 0.35 + Math.min(Math.abs((i.winrate ?? 50) - 50) / 50, 1) * 0.5,
            },
          })),
        },
      ],
    }),
    [items, theme],
  )

  return (
    <ResponsiveChart
      option={option}
      height={380}
      onEvent={onPick ? { click: (p: { name?: string }) => p.name && onPick(p.name) } : undefined}
    />
  )
}
