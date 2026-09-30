import { useCurrentFrame } from "remotion"
import type { RecapData, RecapItem, RecapPalette } from "./types.ts"
import { Heading, Icon, Meter, Num, Rise, Tile } from "./kit.tsx"
import { WEEKDAY_NAMES, clamp01, fmt, mix, progress, type } from "./helpers.ts"

type SceneProps = { data: RecapData; palette: RecapPalette; origin: string }

const md = (date: string) => {
  const [, m, d] = date.split("-")
  return `${Number(m)}/${Number(d)}`
}
const pct = (winrate: number | null) => (winrate === null ? "—" : `${winrate.toFixed(1)}%`)
/** 從第一場到最後一場涵蓋幾天（含頭尾）。 */
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

export function Intro({ data, palette }: SceneProps) {
  return (
    <div style={{ position: "absolute", left: 120, right: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Rise>
        <div style={{ ...type.eyebrow, color: palette.primary }}>ARAM: MAYHEM</div>
      </Rise>
      <Rise at={6}>
        <div style={{ ...type.hero, fontSize: 240, color: palette.fg, marginTop: 24 }}>賽季回顧</div>
      </Rise>
      <Rise at={16}>
        <div style={{ ...type.big, fontSize: 84, color: palette.primary, marginTop: 40 }}>
          {md(data.from)} – {md(data.to)}
        </div>
      </Rise>
      <Rise at={26}>
        <div style={{ ...type.body, color: palette.muted, marginTop: 28 }}>
          {data.player ? `${data.player}　` : ""}{fmt(data.games)} 場・{fmt(data.hours, 1)} 小時
        </div>
      </Rise>
    </div>
  )
}

export function Volume({ data, palette }: SceneProps) {
  const winrate = (100 * data.wins) / data.games
  const losses = data.games - data.wins
  const perDay = data.games / spanDays(data.from, data.to)
  return (
    <>
      <Heading eyebrow="出場" title="這段期間，你打了" palette={palette} />
      <div style={{ position: "absolute", left: 120, top: 330, display: "flex", alignItems: "baseline", gap: 24 }}>
        <Rise at={10} style={{ ...type.hero, color: palette.fg }}>
          <Num value={data.games} at={10} dur={42} />
        </Rise>
        <Rise at={14} style={{ ...type.title, color: palette.muted }}>場</Rise>
      </div>
      <div style={{ position: "absolute", left: 120, top: 650, width: 1000 }}>
        <Rise at={30}>
          <div style={{ display: "flex", height: 28, borderRadius: 28, overflow: "hidden", background: mix(palette.muted, 22) }}>
            <WinLossBar wins={data.wins} losses={losses} palette={palette} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", ...type.body, marginTop: 22 }}>
            <span style={{ color: palette.win }}>{data.wins} 勝</span>
            <span style={{ color: palette.loss }}>{losses} 敗</span>
          </div>
        </Rise>
        <Rise at={44}>
          <div style={{ ...type.body, color: palette.muted, marginTop: 36 }}>
            累計 {fmt(data.hours, 1)} 小時，平均每天 {perDay.toFixed(1)} 場
          </div>
        </Rise>
      </div>
      <Rise at={36} style={{ position: "absolute", right: 120, top: 340, textAlign: "right" }}>
        <div style={{ ...type.eyebrow, color: palette.muted }}>勝率</div>
        <div style={{ ...type.hero, fontSize: 220, color: palette.primary, marginTop: 8 }}>
          <Num value={winrate} at={36} dur={42} decimals={1} suffix="%" />
        </div>
      </Rise>
    </>
  )
}

function WinLossBar({ wins, losses, palette }: { wins: number; losses: number; palette: RecapPalette }) {
  const p = progress(useCurrentFrame(), 34, 34)
  const total = wins + losses
  return (
    <div style={{ display: "flex", width: `${p * 100}%`, height: "100%" }}>
      <div style={{ width: `${(100 * wins) / total}%`, background: palette.win }} />
      <div style={{ width: `${(100 * losses) / total}%`, background: palette.loss }} />
    </div>
  )
}

export function Champions({ data, palette, origin }: SceneProps) {
  const max = Math.max(...data.champions.map((c) => c.games), 1)
  return (
    <>
      <Heading eyebrow="英雄" title="你最常出場的英雄" palette={palette} />
      <div style={{ position: "absolute", left: 120, right: 120, top: 400, display: "flex", flexDirection: "column", gap: 52 }}>
        {data.champions.map((c, i) => (
          <Rise key={c.name} at={12 + i * 12} style={{ display: "flex", alignItems: "center", gap: 44 }}>
            <div style={{ ...type.big, fontSize: 84, width: 80, color: i === 0 ? palette.gold : palette.muted }}>{i + 1}</div>
            <Icon path={c.icon} origin={origin} size={150} palette={palette} radius={28} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ ...type.title, fontSize: 60, color: palette.fg }}>{c.name}</div>
                <div style={{ ...type.body, color: palette.muted }}>
                  <Num value={c.games} at={20 + i * 12} dur={30} /> 場・勝率 {pct(c.winrate)}
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <Meter ratio={c.games / max} at={20 + i * 12} color={i === 0 ? palette.primary : palette.data} palette={palette} />
              </div>
            </div>
          </Rise>
        ))}
      </div>
    </>
  )
}

function AugmentCard({ label, item, at, palette, origin }: { label: string; item: RecapItem; at: number; palette: RecapPalette; origin: string }) {
  return (
    <Rise at={at} style={{ flex: 1 }}>
      <Tile palette={palette} style={{ height: 470 }}>
        <div style={{ ...type.eyebrow, fontSize: 30, color: palette.primary }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 40 }}>
          <Icon path={item.icon} origin={origin} size={180} palette={palette} radius={36} />
          <div style={{ ...type.title, fontSize: 56, color: palette.fg }}>{item.name}</div>
        </div>
        <div style={{ ...type.body, color: palette.muted, marginTop: 44 }}>
          <span style={{ color: palette.fg }}><Num value={item.games} at={at + 8} dur={30} /></span> 場・勝率{" "}
          <span style={{ color: palette.fg }}>{pct(item.winrate)}</span>
        </div>
      </Tile>
    </Rise>
  )
}

export function Augments({ data, palette, origin }: SceneProps) {
  const { augmentMostPicked: most, augmentBest: best } = data
  return (
    <>
      <Heading eyebrow="增幅裝置" title="你的增幅偏好" palette={palette} />
      <div style={{ position: "absolute", left: 120, right: 120, top: 400, display: "flex", gap: 48 }}>
        {most && <AugmentCard label="最常拿" item={most} at={12} palette={palette} origin={origin} />}
        {best && <AugmentCard label="勝率最高（至少 5 場）" item={best} at={26} palette={palette} origin={origin} />}
      </div>
    </>
  )
}

export function When({ data, palette }: SceneProps) {
  const max = Math.max(...data.weekdays.map((d) => d.games), 1)
  // 亮起的柱子是「場次最多的一天」，和右邊第一項同一個定義；「主場時段」是另一件事，不靠柱子表示
  const busiest = data.weekdays.findIndex((d) => d.games === max)
  const frame = useCurrentFrame()
  const fact = (label: string, value: string, note: string, at: number, color: string) => (
    <Rise at={at} style={{ marginBottom: 44 }}>
      <div style={{ ...type.eyebrow, fontSize: 28, color: palette.muted }}>{label}</div>
      <div style={{ ...type.title, fontSize: 76, color, marginTop: 6 }}>{value}</div>
      <div style={{ ...type.body, fontSize: 36, color: palette.muted, marginTop: 4 }}>{note}</div>
    </Rise>
  )
  return (
    <>
      <Heading eyebrow="時段" title="你的遊戲時間" palette={palette} />
      <div style={{ position: "absolute", left: 120, top: 330, width: 1010, height: 600, display: "flex", alignItems: "flex-end", gap: 28 }}>
        {data.weekdays.map((d, i) => {
          const grow = progress(frame, 12 + i * 4, 34)
          const isBusiest = i === busiest
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <div style={{ ...type.small, color: isBusiest ? palette.fg : palette.muted, marginBottom: 12, opacity: grow }}>{d.games || ""}</div>
              <div
                style={{
                  width: "100%",
                  height: `${clamp01(d.games / max) * grow * 100 * 0.82}%`,
                  minHeight: d.games ? 8 : 0,
                  borderRadius: 16,
                  background: isBusiest ? palette.primary : mix(palette.data, 70),
                }}
              />
              <div style={{ ...type.small, marginTop: 18, color: isBusiest ? palette.primary : palette.muted, fontWeight: isBusiest ? 800 : 500 }}>
                {WEEKDAY_NAMES[i]}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ position: "absolute", right: 120, top: 330, width: 560 }}>
        {fact("最常開打的一天", WEEKDAY_NAMES[busiest], `${max} 場`, 36, palette.primary)}
        {data.peak && fact("最常開打的時段", `${WEEKDAY_NAMES[data.peak.weekday]}${data.peak.block}`, `${data.peak.games} 場`, 48, palette.fg)}
        {data.bestBlock && fact(
          "勝率最高的時段",
          data.bestBlock.block,
          `${pct((100 * data.bestBlock.wins) / data.bestBlock.games)}・${data.bestBlock.games} 場`,
          60,
          palette.fg,
        )}
      </div>
    </>
  )
}

function Stat({ label, value, note, at, palette, color }: {
  label: string
  value: number
  note?: string
  at: number
  palette: RecapPalette
  color?: string
}) {
  return (
    <Rise at={at} style={{ width: 818 }}>
      <Tile palette={palette} style={{ padding: "34px 48px" }}>
        <div style={{ ...type.eyebrow, fontSize: 30, color: palette.muted }}>{label}</div>
        <div style={{ ...type.hero, fontSize: 130, color: color ?? palette.fg, marginTop: 10 }}>
          <Num value={value} at={at + 6} dur={36} />
        </div>
        <div style={{ ...type.small, color: palette.muted, marginTop: 8, minHeight: 38 }}>{note ?? ""}</div>
      </Tile>
    </Rise>
  )
}

export function Highlights({ data, palette }: SceneProps) {
  return (
    <>
      <Heading eyebrow="戰績" title="累積下來的數字" palette={palette} />
      <div style={{ position: "absolute", left: 120, top: 300, width: 1680, display: "flex", flexWrap: "wrap", gap: 44 }}>
        <Stat label="擊殺" value={data.kills} note={`死亡 ${fmt(data.deaths)}・助攻 ${fmt(data.assists)}`} at={10} palette={palette} />
        <Stat
          label="雙殺以上"
          value={data.multikills}
          note={data.pentas ? `其中五殺 ${data.pentas} 次` : undefined}
          at={20}
          palette={palette}
        />
        <Stat label="最長連勝（場）" value={data.longestWinStreak} at={30} palette={palette} color={palette.win} />
        <Stat label="最長連敗（場）" value={data.longestLossStreak} at={40} palette={palette} color={palette.loss} />
      </div>
    </>
  )
}

export function Partner({ data, palette }: SceneProps) {
  const partner = data.partner
  if (!partner) return null
  return (
    <>
      <Heading eyebrow="夥伴" title="最常和你同隊的人" palette={palette} />
      <div style={{ position: "absolute", left: 120, right: 120, top: 400 }}>
        <Rise at={12}>
          <div style={{ ...type.hero, fontSize: 150, color: palette.primary, overflowWrap: "anywhere" }}>{partner.name}</div>
        </Rise>
        <Rise at={28} style={{ marginTop: 56, display: "flex", gap: 90 }}>
          <div>
            <div style={{ ...type.eyebrow, fontSize: 30, color: palette.muted }}>同隊</div>
            <div style={{ ...type.big, color: palette.fg, marginTop: 8 }}><Num value={partner.games} at={28} dur={34} /> 場</div>
          </div>
          <div>
            <div style={{ ...type.eyebrow, fontSize: 30, color: palette.muted }}>一起打的勝率</div>
            <div style={{ ...type.big, color: palette.fg, marginTop: 8 }}>
              <Num value={(100 * partner.wins) / partner.games} at={34} dur={34} decimals={1} suffix="%" />
            </div>
          </div>
        </Rise>
      </div>
    </>
  )
}

export function Outro({ data, palette }: SceneProps) {
  const top = data.champions[0]
  const winrate = (100 * data.wins) / data.games
  const chips = [
    { k: "場次", v: fmt(data.games) },
    { k: "勝率", v: `${winrate.toFixed(1)}%` },
    { k: "最愛英雄", v: top?.name ?? "—" },
    { k: "最愛增幅", v: data.augmentMostPicked?.name ?? "—" },
  ]
  return (
    <div style={{ position: "absolute", left: 120, right: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Rise>
        <div style={{ ...type.eyebrow, color: palette.primary }}>{md(data.from)} – {md(data.to)}　賽季回顧</div>
      </Rise>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, marginTop: 44 }}>
        {chips.map((c, i) => (
          <Rise key={c.k} at={8 + i * 8}>
            <Tile palette={palette} style={{ padding: "30px 44px" }}>
              <div style={{ ...type.small, color: palette.muted }}>{c.k}</div>
              <div style={{ ...type.title, color: palette.fg, marginTop: 8 }}>{c.v}</div>
            </Tile>
          </Rise>
        ))}
      </div>
      <Rise at={50}>
        <div style={{ ...type.hero, fontSize: 150, color: palette.fg, marginTop: 90 }}>接住每一場。</div>
      </Rise>
    </div>
  )
}
