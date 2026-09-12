import { useEffect, useMemo, useRef, useState } from "react"
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
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const sync = () => {
      const w = box.clientWidth
      setWidth(w)
      if (w > 0) instance.current?.resize()
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // 寬度還是 0 就先不要建立圖表。ECharts 在掛載當下量寬度,量到 0 就不會產生
  // canvas,而且之後只能靠 resize 救回來——分頁在背景時瀏覽器會把 ResizeObserver
  // 一起節流,那個 resize 可能好幾秒後才來,圖就一直是空白的。
  if (width === 0) {
    return <div ref={boxRef} className="w-full" style={{ height }} />
  }

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

/** 把任何 CSS 顏色字串解析成 [r,g,b]。
 *
 *  專案的主題色是 oklch()。canvas 的 fillStyle 看得懂它,所以單純填色沒問題,
 *  但 ECharts 的 visualMap 漸層是交給 zrender 自己做內插的,而 zrender 解析不了
 *  oklch——漸層會整個塌掉。實測結果是熱力圖完全沒有顏色,只剩背景的棋盤格。
 *  這裡借畫布讓瀏覽器幫我們解析,之後所有內插都自己算,只餵 ECharts 純 rgb()。 */
const rgbCache = new Map<string, [number, number, number]>()

function toRgb(color: string): [number, number, number] {
  const hit = rgbCache.get(color)
  if (hit) return hit
  let out: [number, number, number] = [128, 128, 128]
  try {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    out = [d[0], d[1], d[2]]
  } catch {
    /* 解析不了就用中性灰，總比整張圖沒顏色好 */
  }
  rgbCache.set(color, out)
  return out
}

const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = toRgb(a)
  const [r2, g2, b2] = toRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`
}

/** 文字要黑要白，看背景亮度決定。 */
const readableOn = (color: string) => {
  const [r, g, b] = toRgb(color)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0f1520" : "#eef1f8"
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

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

/** 熱力圖用的 24 小時刻度。 */
export const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i))

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

export type HeatCell = { weekday: number; x: number; games: number; winrate: number | null }

/** 樣本數多少才算「這格的勝率可以看」。低於這個數會被拉回整體平均。 */
const SHRINK_K = 6
/** 顏色飽和到頂的偏離幅度。用 ±20 個百分點,不是 0~100,否則真實差距全被壓成一團。 */
const SPREAD = 20

/** 把一格的勝率往整體平均收縮。
 *
 *  一場 100% 和二十場 60%,原始數字看起來前者比較強,但前者只是還沒輸過而已。
 *  收縮之後 (wins + k*base) / (n + k),一場的格子幾乎貼著平均、顏色很淡,
 *  場次夠多才會真的往兩端跑。這樣顏色本身就帶著「可不可信」的資訊。 */
function shrunk(games: number, winrate: number | null, base: number) {
  if (!games || winrate === null) return base
  const wins = (winrate / 100) * games
  return ((wins + SHRINK_K * (base / 100)) / (games + SHRINK_K)) * 100
}

export function Heatmap({
  cells,
  xLabels,
  selected,
  onPick,
}: {
  cells: HeatCell[]
  /** x 軸的刻度。24 小時就給 24 個，粗分組就給 4 個。 */
  xLabels: string[]
  /** 目前下鑽中的格子,會打上外框。 */
  selected?: { weekday: number; x: number } | null
  onPick?: (cell: { weekday: number; x: number }) => void
}) {
  const theme = useTheme()

  const { option, base } = useMemo(() => {
    const totalGames = cells.reduce((sum, c) => sum + c.games, 0)
    const totalWins = cells.reduce((sum, c) => sum + (c.games * (c.winrate ?? 0)) / 100, 0)
    const base = totalGames ? (totalWins / totalGames) * 100 : 50

    // 空格也要畫出來,否則會分不清「沒打過」和「打過但勝率中庸」。
    const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.x}`, c]))
    // 空格要看得出來是「格子」，否則 168 格的版面會散掉，也分不清沒打過和打過但普通
    const empty = mix(theme.card, theme.muted, 0.28)
    const neutral = mix(theme.card, theme.muted, 0.85)

    const data = []
    for (let wd = 0; wd < 7; wd++) {
      for (let x = 0; x < xLabels.length; x++) {
        const cell = byKey.get(`${wd}:${x}`)
        const games = cell?.games ?? 0
        const adjusted = shrunk(games, cell?.winrate ?? null, base)
        const deviation = (adjusted - base) / SPREAD // -1 ~ 1
        const color = !games
          ? empty
          : mix(neutral, deviation >= 0 ? theme.win : theme.loss, Math.min(1, Math.abs(deviation)))
        const isSelected = selected && selected.weekday === wd && selected.x === x
        data.push({
          value: [x, wd, games, cell?.winrate ?? null, adjusted],
          itemStyle: {
            color,
            borderColor: isSelected ? theme.primary : theme.card,
            borderWidth: isSelected ? 2 : 1,
          },
          label: { color: games ? readableOn(color) : "transparent" },
        })
      }
    }

    return {
      base,
      option: {
        grid: { left: 46, right: 16, top: 10, bottom: 26 },
        tooltip: {
          ...baseTooltip(theme),
          formatter: (p: { value: [number, number, number, number | null, number] }) => {
            const [x, wd, games, raw, adj] = p.value
            const when = `${WEEKDAYS[wd]} ${xLabels[x]}`
            if (!games) return `${when}<br/>沒有對局`
            const wins = Math.round(((raw ?? 0) / 100) * games)
            const note =
              games < SHRINK_K
                ? `<br/><span style="opacity:.7">只有 ${games} 場，顏色已往整體 ${base.toFixed(0)}% 收斂</span>`
                : ""
            return (
              `${when}<br/>${games} 場 · ${wins} 勝 ${games - wins} 敗` +
              `<br/>勝率 ${(raw ?? 0).toFixed(1)}%（校正後 ${adj.toFixed(1)}%）${note}`
            )
          },
        },
        xAxis: {
          type: "category",
          data: xLabels,
          splitArea: { show: false },
          axisLabel: { color: theme.muted, fontSize: xLabels.length > 12 ? 10 : 12, interval: 0 },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: "category",
          data: WEEKDAYS,
          splitArea: { show: false },
          axisLabel: { color: theme.muted, fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "heatmap",
            data,
            label: { show: true, formatter: (p: { value: number[] }) => (p.value[2] ? String(p.value[2]) : ""), fontSize: 10 },
            itemStyle: { borderRadius: 3 },
            emphasis: { itemStyle: { borderColor: theme.primary, borderWidth: 2 } },
          },
        ],
      },
    }
  }, [cells, xLabels, selected, theme])

  return (
    <div className="space-y-2">
      <ResponsiveChart
        option={option}
        height={260}
        onEvent={
          onPick
            ? { click: (p: { value?: number[] }) => p.value && onPick({ weekday: p.value[1], x: p.value[0] }) }
            : undefined
        }
      />
      <HeatLegend base={base} theme={theme} />
    </div>
  )
}

/** 自己畫圖例。ECharts 的 visualMap 會用 zrender 內插主題色,而它解析不了 oklch。 */
function HeatLegend({ base, theme }: { base: number; theme: ReturnType<typeof useTheme> }) {
  const neutral = mix(theme.card, theme.muted, 0.85)
  const steps = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>勝率低</span>
      <span className="flex overflow-hidden rounded">
        {steps.map((d) => (
          <span
            key={d}
            className="h-3 w-6"
            style={{ background: mix(neutral, d >= 0 ? theme.win : theme.loss, Math.abs(d)) }}
          />
        ))}
      </span>
      <span>勝率高</span>
      <span className="opacity-70">
        中間 = 你的整體 {base.toFixed(1)}%，兩端 = ±{SPREAD} 個百分點；格子裡的數字是場次
      </span>
    </div>
  )
}


export type BarDatum = { label: string; value: number; games: number }

export function BarChart({
  data,
  suffix = "",
  colorBy = "value",
  baseline,
  onPick,
}: {
  data: BarDatum[]
  suffix?: string
  colorBy?: "value" | "flat"
  /** 紅綠的分界。預設用這批資料自己的加權平均——也就是「你的水準」。
   *  傳數字可以改成固定門檻(例如 50)。 */
  baseline?: number
  onPick?: (label: string) => void
}) {
  const theme = useTheme()

  const option = useMemo(() => {
    const ordered = [...data].reverse() // ECharts 的 y 軸由下往上
    // 用 50% 當紅綠分界，對整體勝率 42.6% 的人來說幾乎整排都是紅的，
    // 看不出「哪個比較適合我」。改成跟自己的平均比。
    const totalGames = data.reduce((a, d) => a + d.games, 0)
    const base =
      baseline ??
      (totalGames
        ? data.reduce((a, d) => a + d.value * d.games, 0) / totalGames
        : data.reduce((a, d) => a + d.value, 0) / Math.max(1, data.length))
    const neutral = mix(theme.card, theme.muted, 0.9)
    // 顏色和熱力圖同一套規則：場次少的先往平均收縮，不會因為兩場全勝就通紅通綠
    const tint = (d: BarDatum) => {
      const adj = shrunk(d.games, d.value, base)
      const dev = (adj - base) / SPREAD
      return mix(neutral, dev >= 0 ? theme.win : theme.loss, Math.min(1, Math.abs(dev)))
    }
    return {
      // 有平均線時上緣要留位置給它的標籤，否則會被切掉
      grid: { left: 8, right: 56, top: colorBy === "flat" ? 8 : 20, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(theme),
        formatter: (p: { name: string; value: number; dataIndex: number }) => {
          const d = ordered[p.dataIndex]
          const diff = p.value - base
          const tail =
            colorBy === "flat"
              ? ""
              : `<br/><span style="opacity:.7">比平均 ${base.toFixed(1)}${suffix} ${diff >= 0 ? "高" : "低"} ${Math.abs(diff).toFixed(1)}${suffix}</span>`
          return `${p.name}<br/>${p.value.toFixed(1)}${suffix} · ${d.games} 場${tail}`
        },
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
              color: colorBy === "flat" ? theme.primary : tint(d),
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barMaxWidth: 22,
          markLine:
            colorBy === "flat"
              ? undefined
              : {
                  silent: true,
                  symbol: "none",
                  data: [{ xAxis: base }],
                  lineStyle: { color: theme.muted, type: "dashed", width: 1 },
                  label: {
                    formatter: `平均 ${base.toFixed(1)}${suffix}`,
                    color: theme.muted,
                    fontSize: 10,
                    // 預設會沿著線轉成直的，壓在長條上很難讀
                    rotate: 0,
                    position: "end",
                    distance: 2,
                  },
                },
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
  }, [data, suffix, colorBy, baseline, theme])

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

// ─────────────────────────────────────────── 每日戰績（場次 + 勝率）

export type DayDatum = { date: string; games: number; winrate: number | null }

/** 一天一組：長條是場次，折線是勝率。
 *
 *  兩個指標量級差很多（場次個位數、勝率 0~100），所以分兩個 y 軸。
 *  場次少的那天勝率本來就跳，折線的點會跟著場次縮小,提醒那天別多看。 */
export function DailyChart({
  days,
  selected,
  onPick,
}: {
  days: DayDatum[]
  selected?: string | null
  onPick?: (date: string) => void
}) {
  const theme = useTheme()

  const option = useMemo(() => {
    const maxGames = Math.max(1, ...days.map((d) => d.games))
    const total = days.reduce((a, d) => a + d.games, 0)
    const wins = days.reduce((a, d) => a + (d.games * (d.winrate ?? 0)) / 100, 0)
    const base = total ? (wins / total) * 100 : 50
    return {
      grid: { left: 40, right: 44, top: 16, bottom: 48 },
      tooltip: {
        trigger: "axis",
        ...baseTooltip(theme),
        formatter: (ps: { dataIndex: number }[]) => {
          const d = days[ps[0].dataIndex]
          const w = Math.round(((d.winrate ?? 0) / 100) * d.games)
          return `${d.date}<br/>${d.games} 場 · ${w} 勝 ${d.games - w} 敗<br/>勝率 ${(d.winrate ?? 0).toFixed(1)}%<br/><span style="opacity:.7">點一下看這天的每一場</span>`
        },
      },
      xAxis: {
        type: "category",
        data: days.map((d) => d.date.slice(5)),
        axisLabel: { color: theme.muted, fontSize: 10, rotate: days.length > 12 ? 45 : 0 },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "場次",
          nameTextStyle: { color: theme.muted, fontSize: 10 },
          max: Math.ceil(maxGames * 1.25),
          axisLabel: { color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.border } },
        },
        {
          type: "value",
          name: "勝率",
          nameTextStyle: { color: theme.muted, fontSize: 10 },
          min: 0,
          max: 100,
          axisLabel: { color: theme.muted, fontSize: 10, formatter: "{value}%" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          type: "bar",
          name: "場次",
          data: days.map((d) => ({
            value: d.games,
            itemStyle: {
              color: selected === d.date ? theme.primary : mix(theme.card, theme.muted, 0.9),
              borderRadius: [3, 3, 0, 0],
            },
          })),
          barMaxWidth: 26,
        },
        {
          type: "line",
          name: "勝率",
          yAxisIndex: 1,
          data: days.map((d) => d.winrate),
          smooth: false,
          connectNulls: true,
          lineStyle: { color: theme.primary, width: 2 },
          itemStyle: { color: theme.primary },
          // 點的大小跟著場次走，一兩場的那天不會看起來和二十場一樣有份量
          symbolSize: (_v: unknown, p: { dataIndex: number }) =>
            4 + 8 * Math.sqrt((days[p.dataIndex]?.games ?? 0) / maxGames),
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: base }],
            lineStyle: { color: theme.muted, type: "dashed", width: 1 },
            label: {
              formatter: `整體 ${base.toFixed(1)}%`,
              color: theme.muted,
              fontSize: 10,
              position: "insideEndTop",
            },
          },
        },
      ],
    }
  }, [days, selected, theme])

  return (
    <ResponsiveChart
      option={option}
      height={260}
      onEvent={
        onPick ? { click: (p: { dataIndex?: number }) => {
          const d = days[p.dataIndex ?? -1]
          if (d) onPick(d.date)
        } } : undefined
      }
    />
  )
}
