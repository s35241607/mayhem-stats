/** 自由探索「工作台」的分析規格：把哪些欄位放在哪個欄位架、怎麼畫。
 *
 *  一份規格就是一張卡片的全部內容——存到伺服器（/api/explore/items）、放進網址、擺上儀表板都是這個形狀。
 *  規格只記「成員名稱」，定義一律留在語意層（cube/model）：這裡沒有任何 SQL、分組界線或指標算法。
 *  計算欄位是唯一的例外，它是對「查詢回來的聚合結果」再做四則運算（見 calc.ts），不碰明細。 */
import type { CubeFilter, CubeQuery } from "@/lib/cube"
import type { CubeMeta, Member } from "@/hooks/useCubeMeta"
import { COMPANION } from "@/lib/drill"
import { NO_LIMIT } from "@/pages/shared"
import type { Codec } from "@/lib/urlState"

export type VizType = "table" | "pivot" | "bar" | "stacked" | "line" | "area" | "combo" | "pie" | "scatter" | "kpi"

/** 計算欄位：公式裡用 [標題] 引用指標，refs 記每個標題對到哪個成員（同名的標題很多，不能只靠標題） */
export type Calc = { id: string; name: string; formula: string; refs: Record<string, string>; decimals: number; unit: string }

export type Spec = {
  v: 1
  /** 看目前帳號，或跨所有玩家聚合 */
  scope: "account" | "all"
  /** 列：分組維度，由粗到細。圖表的類別軸用第一個 */
  rows: string[]
  /** 欄：樞紐表橫向展開的維度 */
  cols: string[]
  /** 數值：指標名稱，或 calc:<id> */
  values: string[]
  /** 顏色：把圖表拆成多個系列的維度 */
  color: string | null
  filters: CubeFilter[]
  segments: string[]
  calcs: Calc[]
  viz: VizType
  sort: { by: string; dir: "asc" | "desc" } | null
  limit: number
  /** 樞紐表顯示小計與總計 */
  totals: boolean
}

export const MAX_ROWS = 3
export const MAX_COLS = 2
export const MAX_VALUES = 6

export const EMPTY_SPEC: Spec = {
  v: 1,
  scope: "account",
  rows: ["champions.name"],
  cols: [],
  values: ["participants.games", "participants.winrate"],
  color: null,
  filters: [],
  segments: [],
  calcs: [],
  viz: "table",
  sort: null,
  limit: 200,
  totals: true,
}

export const specCodec: Codec<Spec> = {
  parse: (raw) => {
    try {
      const s = JSON.parse(raw) as Partial<Spec>
      return s && s.v === 1 && Array.isArray(s.rows) && Array.isArray(s.values) ? { ...EMPTY_SPEC, ...s } : undefined
    } catch {
      return undefined
    }
  },
  format: (s) => JSON.stringify(s),
}

// ─────────────────────────────────────────── 資料集（分析粒度）

/** 一個查詢只能用同一個「資料集」的欄位：它們之間有 join 路徑，跨資料集沒有（Cube 會回 Can't find join path）。
 *  - participants：一列是「某位玩家的某一場」，英雄、增幅、裝備、對局、隊伍情境都掛在它上面
 *  - teammates：一列是「某人的某一場 × 同場另一位玩家」
 *  - augment_pairs：一列是「某位玩家某一場的兩個增幅組合」 */
export type Dataset = "participants" | "teammates" | "augment_pairs"

export const DATASETS: { id: Dataset; title: string; grain: string; note: string }[] = [
  {
    id: "participants",
    title: "對局表現",
    grain: "一列＝某位玩家的某一場",
    note: "最主要的資料集。英雄、出裝定位、增幅、裝備、對局資訊、隊伍與陣容情境、本場貢獻、翻盤都可以一起用。以增幅或裝備分組時一場會展開成多列，場次類指標已經處理成不重複計算。",
  },
  {
    id: "teammates",
    title: "同場玩家",
    grain: "一列＝某人的某一場 × 同場的另一位玩家",
    note: "用來問「和誰同隊比較會贏」「常遇到誰」。只能搭配對局資訊、英雄定位與出裝定位，不能和對局表現的指標混用。",
  },
  {
    id: "augment_pairs",
    title: "增幅組合",
    grain: "一列＝某位玩家某一場同時拿到的兩個增幅",
    note: "看兩個增幅一起出現時的場次與勝率。樣本通常很少，當線索看，不要當排行。",
  },
]

const SHARED_WITH_TEAMMATES = new Set(["matches", "champion_roles", "builds"])

export function datasetOf(member: string): Dataset {
  const cube = member.split(".")[0]
  if (cube === "teammates" || cube === "augment_pairs") return cube
  return "participants"
}

/** 這個成員能不能放進目前的資料集。matches 等幾個 cube 兩邊都接得上 */
export function fitsDataset(member: string, dataset: Dataset): boolean {
  const cube = member.split(".")[0]
  if (dataset === "teammates") return cube === "teammates" || SHARED_WITH_TEAMMATES.has(cube)
  // my_games 的分區算法和其他資料集都不同（只有本機帳號、依時間排序），不放進工作台
  if (cube === "my_games") return false
  if (dataset === "participants") return datasetOf(member) === "participants"
  return cube === dataset
}

export const isCalc = (value: string) => value.startsWith("calc:")
export const calcOf = (spec: Spec, value: string) => spec.calcs.find((c) => `calc:${c.id}` === value)

/** 規格裡用到的所有語意層成員（不含計算欄位本身，但含它引用的指標） */
export function membersOf(spec: Spec): string[] {
  return [...spec.rows, ...spec.cols, ...(spec.color ? [spec.color] : []), ...measuresOf(spec), ...spec.filters.map((f) => f.member)]
}

/** 目前規格屬於哪個資料集：看第一個不是「兩邊都接得上」的成員；都沒有就是對局表現 */
export function specDataset(spec: Spec): Dataset {
  for (const m of membersOf(spec)) {
    const d = datasetOf(m)
    if (d !== "participants") return d
  }
  return "participants"
}

/** 要向 Cube 查的指標：數值架上的指標，加上計算欄位引用到的 */
export function measuresOf(spec: Spec): string[] {
  const out: string[] = []
  const add = (m: string) => void (out.includes(m) || out.push(m))
  for (const v of spec.values) {
    if (!isCalc(v)) add(v)
    else Object.values(calcOf(spec, v)?.refs ?? {}).forEach(add)
  }
  return out
}

/** 組出一個層級的查詢（還沒套全域條件，呼叫端再交給 filters 的 apply）。
 *  dims 由呼叫端決定：平面結果是全部維度，樞紐表的小計是其中幾個的前綴。 */
export function specQuery(spec: Spec, dims: string[], opts: { sort?: boolean; limit?: number } = {}): CubeQuery {
  const measures = measuresOf(spec)
  const companions = dims.flatMap((d) => [COMPANION[d]?.icon, COMPANION[d]?.rarity].filter(Boolean) as string[])
  const query: CubeQuery = {
    measures,
    dimensions: [...dims, ...companions],
    ...(spec.segments.length ? { segments: spec.segments } : {}),
    ...(spec.filters.length ? { filters: spec.filters } : {}),
    limit: opts.limit ?? NO_LIMIT,
  }
  // 排序交給 Cube 的只有「真的在查詢裡的成員」；計算欄位的排序在前端做
  if (opts.sort !== false && spec.sort && (measures.includes(spec.sort.by) || dims.includes(spec.sort.by))) {
    query.order = { [spec.sort.by]: spec.sort.dir }
  } else if (opts.sort !== false && measures.length) {
    const games = measures.find((m) => m.endsWith(".games")) ?? measures[0]
    query.order = { [games]: "desc" }
  }
  return query
}

// ─────────────────────────────────────────── 顯示

export function valueTitle(spec: Spec, meta: CubeMeta, value: string): string {
  if (isCalc(value)) return calcOf(spec, value)?.name ?? "（已刪除的計算欄位）"
  const m = meta.byName.get(value)
  return m?.shortTitle || m?.title || value
}

export function formatValue(spec: Spec, meta: CubeMeta, value: string, n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  const calc = isCalc(value) ? calcOf(spec, value) : undefined
  const m: Member | undefined = calc ? undefined : meta.byName.get(value)
  const decimals = calc ? calc.decimals : (m?.meta?.decimals ?? (Number.isInteger(n) ? 0 : 1))
  const unit = calc ? calc.unit : (m?.meta?.unit ?? "")
  return `${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit}`
}

/** 這個圖表種類需要什麼，目前的規格夠不夠。回傳 null 表示可以畫，否則是一句說明 */
export function vizProblem(spec: Spec): string | null {
  const dims = spec.rows.length
  const vals = spec.values.length
  if (!vals) return "「數值」至少要放一個指標。"
  switch (spec.viz) {
    case "table":
    case "pivot":
      return null
    case "kpi":
      return null
    case "pie":
      return dims >= 1 ? null : "圓餅圖要在「列」放一個維度（每一塊是它的一個值）。"
    case "scatter":
      return dims >= 1 && vals >= 2 ? null : "散布圖要在「列」放一個維度、在「數值」放至少兩個指標（X 與 Y）。"
    case "combo":
      return dims >= 1 && vals >= 2 ? null : "組合圖要在「列」放一個維度、在「數值」放兩個指標（長條與折線）。"
    default:
      return dims >= 1 ? null : "這種圖要在「列」放一個維度當類別軸。"
  }
}

export const VIZ_LABEL: Record<VizType, string> = {
  table: "表格",
  pivot: "樞紐表",
  bar: "長條",
  stacked: "堆疊",
  line: "折線",
  area: "面積",
  combo: "組合",
  pie: "圓餅",
  scatter: "散布",
  kpi: "數字",
}
