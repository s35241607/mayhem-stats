export const round1 = (value: number) => value.toFixed(1)
export const round0 = (value: number) => Math.round(value).toLocaleString()
export const round2 = (value: number) => value.toFixed(2)

/** 單一項目（一隻英雄、一個增幅、一個場次序號）的勝率，場次低於這個數就不單獨解讀：
 *  圖表不畫、表格淡化。原本各頁各訂 2、3、4、5，同一個「樣本太小」在不同頁標準不同。
 *  （「出現 2 次以上才列出」是另一件事——那是先把只有一筆的雜訊濾掉，不是勝率可不可信。） */
export const MIN_GAMES = 5

export const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

/** 熱力圖的粗分組。
 *
 *  168 格攤 100 多場，單格最多只有個位數，顏色再怎麼校正也只是在看雜訊。
 *  切成 7×4 = 28 格之後，每格的樣本才有機會累積到看得出差異的量。 */
export const BLOCKS = [
  { label: "深夜 0-5", from: 0, to: 5 },
  { label: "早上 6-11", from: 6, to: 11 },
  { label: "下午 12-17", from: 12, to: 17 },
  { label: "晚上 18-23", from: 18, to: 23 },
]

export type HourCell = { weekday: number; hour: number; games: number; winrate: number | null }
export type BlockCell = { weekday: number; block: number; games: number; winrate: number | null }

/** 逐小時併成四時段。要用勝場數相加，不能把勝率平均起來——那樣一場的格子會和二十場的一樣重。 */
export function toBlocks(hours: HourCell[]): BlockCell[] {
  const acc = new Map<string, { weekday: number; block: number; games: number; wins: number }>()
  for (const h of hours) {
    const block = BLOCKS.findIndex((b) => h.hour >= b.from && h.hour <= b.to)
    if (block < 0) continue
    const key = `${h.weekday}:${block}`
    const prev = acc.get(key) ?? { weekday: h.weekday, block, games: 0, wins: 0 }
    prev.games += h.games
    prev.wins += (h.games * (h.winrate ?? 0)) / 100
    acc.set(key, prev)
  }
  return [...acc.values()].map((c) => ({
    weekday: c.weekday,
    block: c.block,
    games: c.games,
    winrate: c.games ? (c.wins / c.games) * 100 : null,
  }))
}
