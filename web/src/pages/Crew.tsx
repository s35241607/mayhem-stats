import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowRight, Lock, LoaderCircle, BookOpen, Check, ChevronDown, ChevronRight, ChevronsUpDown, Crown, Flame, Hammer, HeartHandshake, Infinity as InfinityIcon, Medal, Search, Shield, Handshake, Snowflake, Sparkles, Star, Trophy, Zap, Users, Skull, Award, Mountain, Heart, Moon, type LucideIcon } from "lucide-react"
import { RecordCell } from "@/components/cells"
import { ContribBars, ContribScore } from "@/components/Contribution"
import { PERF_PARTS, WORK, WORK_GAMES, WORK_GAP, WORK_MEASURES, WORK_PARTS } from "@/hooks/useContribution"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState, LoadingBlock, Panel, QueryError } from "@/components/primitives"
import { Hint } from "@/components/TipLayer"
import { stripTip, tipLevelClass } from "@/lib/tip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ContribRadarChart, SHRINK_K, shrunk } from "@/components/charts"
import { DetailDrawer, useDrawerSettled } from "@/components/DetailDrawer"
import { ForestAxis, ForestTrack } from "@/components/GapForest"
import { useCube } from "@/hooks/useCube"
import { MAX_GAME_IDS, iconUrl, num, type CubeFilter, type CubeQuery, type CubeRow } from "@/lib/cube"
import { MatchList } from "@/components/MatchList"
import { useFilters, type Player } from "@/lib/filters"
import { useCrumb } from "@/lib/breadcrumb"
import { prefersReducedMotion } from "@/lib/motion"
import { useNavigate } from "@/lib/nav"
import { cn } from "@/lib/utils"
import {
  MIN_N,
  WORK_SD,
  STRENGTH_CLASS,
  gapOf,
  scoreGapOf,
  scoreStrengthOf,
  strengthOf,
  wilson,
  zFor,
  type Gap,
  type ScoreGap,
  type Strength,
} from "@/lib/gap"
import { participantRows } from "@/lib/who"
import { BUILD_ROLES, BUILD_SHORT, NO_LIMIT, round0, splitRiotId } from "./shared"

// ── 判斷：和陣容、敗因、節奏三頁同一套「區間」講法 ─────────────────────────────
// 判斷用本場貢獻（contribution_v2.work，2026-10-17 起）：每場只和同一場另外九個人比工作量，權重依終場裝備的連續比例，
// 最後用寫死的常數換成 0～100，再扣掉同樣裝備組成的平均（v2.1），50＝所有人的平均（所以跨場平均和 50 比是「比一般人做得多或少」）。
// 不用擊殺、金錢、勝負當輸入，死亡不扣分。規格與限制見 contribution_v2.yml 與 docs/contribution-scoring.md。
// 之前用當局表現分（contribution.perf，和同類型、同時長帶的歷史人次比）；「打法」那一段還是看它的各項。
// 2026-10-10 從隊內排名（contribution.score）換成本場貢獻的理由仍然成立：隊內排名是零和的，而好友幾乎都五排，
//   它量到的是「這群朋友之間誰分到比較多工作」——和強的朋友同隊的人一定被壓低（同隊時 64.7 對 31.1）。
//   原本不用本場貢獻是因為它和勝負有關（個人相關 0.19），但五排的朋友共享輸贏，這個顧慮在這頁不成立。
//   和 50 比，95% 區間（標準誤＝單場標準差 WORK_SD 18.5 ÷ √有分數的場數）整段高於 50 是「強勢」、整段低於 50 是「不強勢」；
//   差 WORK_GAP（4）分以上但區間還跨過 50 是「偏強／偏弱」；不到 MIN_N 場不下判斷（畫面寫熱身中／初體驗）。
//   畫面上的字（labelOf）再依差距與場次細分成十級、全部用正面的說法：招牌／拿手／上手／順手／標準發揮／磨合中／摸索中／潛力股，
//   場次不到 MIN_N 的是熱身中／初體驗。內部值（data-strength、e2e）仍是五級，和陣容頁共用，不動。
//   同一個人同時比好幾種出裝（或好幾隻英雄）時用 zFor(k) 放寬區間——一次比二十隻，總會有一兩隻只是運氣。
// 勝率只當補充：和他自己的整體勝率比，區間（同樣放寬）整段在一邊才標 ▲▼，以及「雖敗猶榮」（表現好但勝率比他平常低 WR_LUCK 以上）、
//   「默契加分」（貢獻不強勢但勝率明顯高）。好友多半一起打、勝率互相牽動，2026-10 實測每個人的整體勝率都和 50% 分不出差別。
// 舊版用固定門檻（貢獻差 6 分、勝率差 3／5pp），不管場次：89% 的出裝、82% 的英雄都被貼上「適合／不適合」，
//   而且幾乎全部跟著這個人的整體水準走（整體強的人每個出裝都「適合」）。改成區間之後，看得出的只剩真的看得出的。
//   依據見 analysis/crew_verdicts.py。

/** 抽屜「看得出的強項」等處每邊最多放幾隻頭像；其餘寫「還有 N 隻」 */
const CHAMPS_SHOWN = 5
/** 全員一覽的英雄欄：上下兩條各最多放幾隻（一條一整行，寬度夠） */
const MATRIX_CHAMPS = 12
/** 場次、勝負、本場貢獻，以及算區間要用的「有本場貢獻的場次」（重開局沒有分數） */
const STAT_MEASURES = [
  "participants.games",
  "participants.wins",
  "participants.losses",
  "participants.winrate",
  WORK,
  WORK_GAMES,
]

const n0 = (r: CubeRow | undefined, k: string) => (r ? (num(r[k]) ?? 0) : 0)
const opt = (r: CubeRow | undefined, k: string) => (r ? num(r[k]) : null)
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`
/** 本場貢獻換成「和所有人的平均（50）的差距」 */
const dev = (r: CubeRow | undefined) => {
  const v = opt(r, WORK)
  return v === null ? null : v - 50
}

const splitId = splitRiotId

/** 中心（選填）的場次篩選：設了中心就是「他也在場」這一個條件，整頁的查詢都要加上；沒設是空的。
 *  用 context 傳下去，抽屜與戰報列表不必一路帶參數。 */
const CenterFilterContext = createContext<CubeFilter[] | null>([])

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

// ── 每一組（一種出裝、一隻英雄、或整體）的數字與判斷 ─────────────────────────

type Stat = { key: string; label: string; icon?: string; games: number; wins: number; winrate: number | null; score: number | null; scored: number }
type Judged = Stat & {
  /** 本場貢獻和 50 比（區間已依同時比幾組放寬）；沒有分數是 null */
  g: ScoreGap | null
  strength: Strength
  /** 勝率和他自己的整體勝率比（區間同樣放寬）；只用來標 ▲▼ 與「雖敗猶榮／默契加分」 */
  wr: Gap | null
  /** 排序用：本場貢獻往他自己的平均收縮（SHRINK_K 場虛擬場次），一兩場的不會排到最前面 */
  est: number | null
}
type Own = { score: number | null; winrate: number | null }
type Profile = {
  overall: Judged
  /** 整體勝率和 50% 比 */
  overallWr: Gap | null
  roles: Judged[]
  /** 同時比了幾種出裝（樣本夠的），區間依它放寬 */
  roleK: number
  champs: Judged[]
  champK: number
  style: PlayStyle
}

const statOf = (r: CubeRow | undefined, key: string, label: string, icon?: string): Stat => ({
  key,
  label,
  icon,
  games: n0(r, "participants.games"),
  wins: n0(r, "participants.wins"),
  winrate: opt(r, "participants.winrate"),
  score: opt(r, WORK),
  scored: n0(r, WORK_GAMES),
})

function judge(s: Stat, own: Own, z: number): Judged {
  const g = s.score === null ? null : scoreGapOf(s.score, s.scored, z, WORK_SD)
  const wr = own.winrate === null || !s.games ? null : gapOf({ key: s.key, label: s.label, games: s.games, wins: s.wins }, own.winrate, z)
  const est = s.score === null || own.score === null ? null : (s.scored * s.score + SHRINK_K * own.score) / (s.scored + SHRINK_K)
  return { ...s, g, strength: g ? scoreStrengthOf(g, WORK_GAP) : "看不出", wr, est }
}

/** 一個人的一組（他的幾種出裝，或他玩過的英雄）一起判斷：樣本夠的有 k 組，區間就放寬到「這 k 組一起看還是 95%」 */
function judgeAll(stats: Stat[], own: Own) {
  const k = stats.filter((s) => s.score !== null && s.scored >= MIN_N).length
  const z = zFor(k)
  return { k, items: stats.map((s) => judge(s, own, z)) }
}

const wrFlag = (j: Judged) => (j.wr?.clear ? (j.wr.diff > 0 ? "up" : "down") : null)

/** 勝率和他自己的平均差這麼多（百分點）以上、但還在誤差內時，補一句「勝率不錯／手氣待回溫」 */
const WR_LEAN = 15
/** 表現和勝率走反方向（打得好卻常輸、打得差卻常贏）要差這麼多百分點、至少 LUCK_MIN 場，才標「雖敗猶榮／默契加分」 */
const WR_LUCK = 10
const LUCK_MIN = 10

/** 勝率的補充說明：
 *  - 貢獻比平均高（強勢／偏強），勝率卻比他自己的平均低 WR_LUCK 以上 →「雖敗猶榮」：輸多半不是他的問題
 *  - 貢獻比平均低（不強勢／偏弱），勝率卻高 WR_LUCK 以上 →「默契加分」
 *    這兩個不要求勝率的區間整段在一邊：勝率每項只有幾十場，區間幾乎都寬到 ±20pp，那樣幾乎永遠不會出現；
 *    本場貢獻本身已經是看得出（或偏）的才標，誤差另外寫在滑過的說明裡
 *  - 其餘：勝率區間整段在一邊是「勝率亮眼／蓄勢待發」，差 WR_LEAN 以上但還在誤差內是「勝率不錯／手氣待回溫」 */
function extraOf(j: Judged) {
  const d = j.wr?.interval ? j.wr.diff : null
  if (d !== null && j.games >= LUCK_MIN) {
    if (isPos(j.strength) && d <= -WR_LUCK) return WR_NOTES.unlucky
    if (isNeg(j.strength) && d >= WR_LUCK) return WR_NOTES.carried
  }
  const f = wrFlag(j)
  if (f) return f === "up" ? WR_NOTES.clearUp : WR_NOTES.clearDown
  if (d !== null && Math.abs(d) >= WR_LEAN) return d > 0 ? WR_NOTES.leanUp : WR_NOTES.leanDown
  return null
}

/** 勝率補充的六個說法。全部用正面的字：勝率低寫成「還沒兌現」而不是「差」 */
const WR_NOTES = {
  /** 貢獻高，勝率卻比他平常低 WR_LUCK 以上 */
  unlucky: "雖敗猶榮",
  /** 貢獻還在追平均，勝率卻比他平常高 WR_LUCK 以上 */
  carried: "默契加分",
  clearUp: "勝率亮眼",
  leanUp: "勝率不錯",
  /** 勝率區間整段低於他自己的平均 */
  clearDown: "蓄勢待發",
  leanDown: "手氣待回溫",
} as const
const isLuck = (x: string | null) => x === WR_NOTES.unlucky || x === WR_NOTES.carried
/** 勝率卡（整體勝率和 50% 比）用的字，和勝率補充同一套說法 */
const WR_SHOWN: Record<Strength, string> = { 強勢: WR_NOTES.clearUp, 偏強: WR_NOTES.leanUp, 看不出: "五五波", 偏弱: WR_NOTES.leanDown, 不強勢: WR_NOTES.clearDown }

/** 畫面上的標籤，全部是正面的說法，由強到弱共十九級。內部五級（強勢…不強勢）和陣容頁共用，這裡再依「和 50 差幾分」細分：
 *  - 看得出高（區間整段高於 50）：傳奇 ≥20、招牌 ≥12、拿手 ≥8，其餘得心應手
 *  - 偏強（差 WORK_GAP 以上、還在誤差內）：嶄露頭角 ≥12、上手 ≥8、漸入佳境 ≥6，其餘順手
 *  - 和平均差不多（差不到 WORK_GAP）：小有心得 ≥+2、標準發揮、暖機中 ≤−2
 *  - 偏弱：磨合中、調整中 ≤−6、摸索中 ≤−8、練功中 ≤−12
 *  - 看得出低：潛力股，差 15 以上是璞玉
 *  - 有分數的場次不到 MIN_N：TRIAL_MAX 場以下「初體驗」，其餘「熱身中」
 *  切點看 2026-10-18 好友 9 人（16.17 之後）的實際差距分布，讓每一級都有人：英雄偏強 50 項大約四等分（4～6、6～8、8～12、12 以上），
 *  偏弱 32 項同理；看得出的英雄只有 9 項，所以頂端兩級（傳奇、璞玉）各只有幾項。
 *  顏色是一條由強到弱的連續色帶：稜鏡色 → 金 → 勝方色由實心漸淡 → 灰 → 敗方色由淡漸實心，全部是主題變數（亮色主題有各自的版本）；
 *  每一級都有底色與實線框，才看得出是標籤；字用前景色（淡底上的勝敗色字太淡）。看得出的實心填滿，還在誤差內的只是淡底。 */
const TRIAL_MAX = 2
const LEVELS = [
  { label: "傳奇", strength: "強勢", min: 20, note: "比平均高 20 分以上（看得出）", cls: "border-prismatic bg-prismatic text-background font-semibold" },
  { label: "招牌", strength: "強勢", min: 12, note: "比平均高 12 分以上（看得出）", cls: "border-gold bg-gold text-background font-semibold" },
  { label: "拿手", strength: "強勢", min: 8, note: "比平均高 8 分以上（看得出）", cls: "border-win bg-win text-background font-semibold" },
  { label: "得心應手", strength: "強勢", min: -Infinity, note: "比平均高（看得出）", cls: "border-win bg-win/40 text-foreground font-semibold" },
  { label: "嶄露頭角", strength: "偏強", min: 12, note: "高 12 分以上，還在誤差內", cls: "border-win/70 bg-win/30 text-foreground" },
  { label: "上手", strength: "偏強", min: 8, note: "高 8 分以上，還在誤差內", cls: "border-win/60 bg-win/22 text-foreground" },
  { label: "漸入佳境", strength: "偏強", min: 6, note: "高 6 分以上，還在誤差內", cls: "border-win/50 bg-win/15 text-foreground" },
  { label: "順手", strength: "偏強", min: -Infinity, note: `高 ${WORK_GAP} 分以上，還在誤差內`, cls: "border-win/40 bg-win/10 text-foreground" },
  { label: "小有心得", strength: "看不出", min: 2, note: `高 2～${WORK_GAP} 分，和平均差不多`, cls: "border-foreground/25 bg-muted text-foreground" },
  { label: "標準發揮", strength: "看不出", min: -2, note: "和平均差不多", cls: "border-foreground/20 bg-muted text-foreground/85" },
  { label: "暖機中", strength: "看不出", min: -Infinity, note: `低 2～${WORK_GAP} 分，和平均差不多`, cls: "border-foreground/25 bg-muted text-foreground" },
  { label: "磨合中", strength: "偏弱", min: -6, note: `低 ${WORK_GAP} 分以上，還在誤差內`, cls: "border-loss/40 bg-loss/10 text-foreground" },
  { label: "調整中", strength: "偏弱", min: -8, note: "低 6 分以上，還在誤差內", cls: "border-loss/50 bg-loss/15 text-foreground" },
  { label: "摸索中", strength: "偏弱", min: -12, note: "低 8 分以上，還在誤差內", cls: "border-loss/60 bg-loss/22 text-foreground" },
  { label: "練功中", strength: "偏弱", min: -Infinity, note: "低 12 分以上，還在誤差內", cls: "border-loss/70 bg-loss/30 text-foreground" },
  { label: "潛力股", strength: "不強勢", min: -15, note: "低於平均（看得出）", cls: "border-loss bg-loss/40 text-foreground font-semibold" },
  { label: "璞玉", strength: "不強勢", min: -Infinity, note: "低於平均 15 分以上（看得出）", cls: "border-loss bg-loss text-background font-semibold" },
  { label: "熱身中", strength: null, min: -Infinity, note: `${TRIAL_MAX + 1}～${MIN_N - 1} 場，還不下判斷`, cls: "border-foreground/15 bg-muted/60 text-muted-foreground" },
  { label: "初體驗", strength: null, min: -Infinity, note: `${TRIAL_MAX} 場以下`, cls: "border-foreground/10 bg-muted/40 text-muted-foreground/80" },
] as const satisfies readonly { label: string; strength: Strength | null; min: number; note: string; cls: string }[]
type Level = (typeof LEVELS)[number]["label"]
// 提示框裡的等級標籤要和畫面上同一個顏色：把每一級的 class 登記給 TipLayer（class 字串留在這個檔案裡，Tailwind 才掃得到）
for (const l of LEVELS) tipLevelClass[l.label] = l.cls
const LEVEL_OF = new Map(LEVELS.map((l) => [l.label as Level, l]))

/** 同一個內部五級裡，照差距由高往低找第一個 d ≥ min 的那一級（每一組最後一級的 min 是 −∞，一定找得到） */
function labelOf(j: Pick<Judged, "g" | "strength" | "scored">): Level {
  if (!j.g?.interval) return j.scored <= TRIAL_MAX ? "初體驗" : "熱身中"
  const d = j.g.mean - 50
  return LEVELS.find((l) => l.strength === j.strength && d >= l.min)!.label
}
/** 這一級的框線與底色 */
const levelClass = (j: Pick<Judged, "g" | "strength" | "scored">) => LEVEL_OF.get(labelOf(j))!.cls
/** 等級標籤的外型（大小、圓角、留白），顏色另外由 levelClass／LEVELS.cls 給 */
const CHIP = "inline-flex items-center rounded-md border px-1.5 text-[11px] leading-[18px] whitespace-nowrap shadow-xs"

const isPos = (s: Strength) => s === "強勢" || s === "偏強"
const isNeg = (s: Strength) => s === "不強勢" || s === "偏弱"
const isClear = (s: Strength) => s === "強勢" || s === "不強勢"

/** 提示框的內容（排版標記見 components/TipLayer）：標題是名字與場次；「本場貢獻」「勝率」各一個項目，
 *  大數字在前、等級標籤與勝負用各自的顏色，次要的補充（區間、他自己的整體勝率）放在下一行 */
function tipOf(j: Judged, ownWr: number | null) {
  const m = (kind: string, text: string) => `{{${kind}|${text}}}`
  const lines = [`${j.label}${m("mute", `・${j.games} 場${j.scored !== j.games ? `（有本場貢獻的 ${j.scored} 場）` : ""}`)}`]
  if (j.g) {
    const iv = j.g.interval
    lines.push(`${m("lab", "本場貢獻")}${m("big", String(Math.round(j.g.mean)))}${iv ? ` ${m("lv", labelOf(j))}` : ""}`)
    lines.push(
      iv
        ? `> 區間 ${Math.round(50 + iv[0])}～${Math.round(50 + iv[1])}・50＝所有人的平均`
        : `> 不到 ${MIN_N} 場，不下判斷・50＝所有人的平均`,
    )
  }
  if (j.games && j.winrate !== null) {
    lines.push(`${m("lab", "勝率")}${m("big", `${j.winrate.toFixed(1)}%`)} ${m("win", `${j.wins} 勝`)} ${m("loss", `${j.games - j.wins} 敗`)}`)
    const parts: string[] = []
    if (ownWr !== null) parts.push(`他自己的整體 ${ownWr.toFixed(1)}%`)
    if (j.wr?.interval) {
      parts.push(`差 ${m(j.wr.diff >= 0 ? "win" : "loss", `${signed(j.wr.diff)}pp`)}`)
      parts.push(`區間 ${signed(j.wr.interval[0], 0)}～${signed(j.wr.interval[1], 0)}pp`)
      parts.push(j.wr.clear ? "看得出差別" : m("mute", "還在誤差內"))
    }
    if (parts.length) lines.push(`> ${parts.join("・")}`)
  }
  const x = extraOf(j)
  const unclear = j.wr?.clear ? "" : "（勝率差距還在誤差內）"
  if (x === WR_NOTES.unlucky)
    lines.push(`${m("tagwin", x)} 貢獻比平均高，勝率卻比他平常低 ${WR_LUCK} 個百分點以上，輸多半不是他的問題${unclear}`)
  if (x === WR_NOTES.carried)
    lines.push(`${m("tagmute", x)} 貢獻還在追平均，勝率卻比他平常高 ${WR_LUCK} 個百分點以上，和隊友配合得好${unclear}`)
  return lines.join("\n")
}

/** 判定標籤：五級（實心＝看得出、虛線＝還在誤差內），勝率也看得出時在後面補一句 */
function StrengthChip({ j }: { j: Judged }) {
  const x = extraOf(j)
  const up = (j.wr?.diff ?? 0) > 0
  // 不到 MIN_N 場沒有區間：和「場次夠、和 50 差不多」的標準發揮分開講
  if (!j.g?.interval && !x) return <span className="text-[11px] text-muted-foreground/80">{labelOf(j)}</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span data-testid="strength-chip" className={cn(CHIP, levelClass(j))}>
        {labelOf(j)}
      </span>
      {x && (
        <span className={cn("text-[11px]", wrFlag(j) ? "text-foreground" : "text-muted-foreground")}>
          <span className={up ? "text-win" : "text-loss"}>{up ? "▲" : "▼"}</span>
          {x}
        </span>
      )}
    </span>
  )
}

// ── 全員一覽：一人一列（迷你雷達、出裝標籤、英雄頭像）────────────────────────

const DOT_CLASS: Record<Strength, string> = {
  強勢: "fill-win",
  偏強: "fill-win",
  看不出: "fill-muted-foreground",
  偏弱: "fill-loss",
  不強勢: "fill-loss",
}
const NUM_CLASS: Record<Strength, string> = {
  強勢: "text-win",
  偏強: "text-win",
  看不出: "text-foreground",
  偏弱: "text-loss",
  不強勢: "text-loss",
}

/** 一人一列的格線，class 寫成完整字串（Tailwind 掃不到拼出來的） */
/** 寬的時候四欄（名字、雷達、出裝、英雄）；窄的時候兩欄：名字與雷達在上，出裝、英雄各佔整行堆疊。
 *  用容器查詢（@container）而不是視窗寬度，側欄展開或收合時排版跟著實際可用的寬度走。 */
const ROW_COLS =
  "grid-cols-[minmax(0,1fr)_6rem] gap-3 @[1000px]:grid-cols-[14rem_6rem_minmax(14rem,0.8fr)_minmax(0,1.2fr)] @[1000px]:gap-4 @[1400px]:grid-cols-[18rem_6rem_minmax(16rem,0.7fr)_minmax(0,1.3fr)]"
/** 全員一覽載入中的佔位：每人一列，欄位和真正的列（ROW_COLS）一樣——名字與稱號、雷達、出裝橫條、英雄頭像——
 *  換上內容時版面不會跳。上面一行是轉圈圈與說明，讓人知道不是壞了；列本身是呼吸的淡色塊（只動 opacity）。 */
function MatrixSkeleton({ rows, label }: { rows: number; label: string }) {
  const bar = "rounded bg-muted"
  return (
    <div className="@container" role="status" aria-live="polite" data-testid="loading-block" data-slot="skeleton">
      <div className="mb-2 flex items-center gap-2 px-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        {label}
      </div>
      {Array.from({ length: Math.min(rows, 9) }, (_, i) => (
        <div
          key={i}
          style={{ animationDelay: `${i * 120}ms` }}
          className={cn("grid animate-pulse items-center border-b px-2 py-3", ROW_COLS)}
        >
          <span className="grid gap-1.5">
            <span className={cn(bar, "h-4 w-32")} />
            <span className={cn(bar, "h-3 w-40")} />
            <span className={cn(bar, "h-3 w-24")} />
            <span className="mt-0.5 flex gap-1.5">
              {[0, 1, 2].map((k) => (
                <span key={k} className={cn(bar, "h-[22px] w-16 rounded-full")} />
              ))}
            </span>
          </span>
          <span className="mx-auto size-[88px] rounded-full bg-muted" />
          <span className={cn("grid gap-2", SECTION_SPAN)}>
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <span key={k} className={cn(bar, "h-3")} style={{ width: `${55 + ((i * 7 + k * 13) % 40)}%` }} />
            ))}
          </span>
          <span className={cn("grid gap-3", SECTION_SPAN)}>
            {[0, 1].map((row) => (
              <span key={row} className="flex gap-1.5">
                {Array.from({ length: 8 }, (_, k) => (
                  <span key={k} className="size-8 shrink-0 rounded-md bg-muted" />
                ))}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}
/** 窄的時候出裝、英雄整行；寬的時候各佔一欄 */
const SECTION_SPAN = "col-span-2 border-t border-border/50 pt-2 @[1000px]:col-span-1 @[1000px]:border-t-0 @[1000px]:pt-0"

type HexDatum = { label: string; games: number; strength: Strength | null }

/** 迷你雷達（出裝定位九個頂點）：形狀是各出裝定位佔他自己場次的比例（偏好怎麼玩），頂點顏色是判定。
 *
 *  一覽表裡每人一個，上下排成一欄就能一眼比形狀。用 SVG 而不是 ECharts：七個 canvas 實例的成本不值得，
 *  這裡也不需要互動。外框是「他自己最常用的那種出裝」，形狀才撐得開。 */
function MiniHex({ data, total, size = 96 }: { data: HexDatum[]; total: number; size?: number }) {
  const c = size / 2
  const r = size / 2 - 14 // 留位置給標籤
  const n = data.length
  const at = (i: number, frac: number) => {
    const a = ((90 + (i * 360) / n) * Math.PI) / 180 // 和 ECharts 雷達同方向：正上方開始、逆時針
    return [c + Math.cos(a) * r * frac, c - Math.sin(a) * r * frac] as const
  }
  const ring = (frac: number) => data.map((_, i) => at(i, frac).join(",")).join(" ")
  const share = data.map((d) => (total ? d.games / total : 0))
  const scaleMax = Math.max(0.01, ...share)
  const tone = (d: HexDatum) => (d.strength ? DOT_CLASS[d.strength] : "fill-muted-foreground")
  const text = data
    .map((d, i) => `${d.label} ${Math.round(share[i] * 100)}%（${d.games} 場${d.strength && d.strength !== "看不出" ? `，${d.strength}` : ""}）`)
    .join("\n")
  return (
    // 頂點多時左右兩端的標籤會貼到邊，overflow 放出去（欄與欄之間有 gap，不會壓到別人）
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 overflow-visible">
      <title>{`各出裝定位佔他場次的比例\n${text}`}</title>
      <polygon points={ring(1)} className="fill-muted/30 stroke-muted-foreground/40" strokeWidth={1} />
      <polygon points={ring(0.5)} className="fill-none stroke-muted-foreground/25" strokeWidth={0.75} />
      {data.map((_, i) => {
        const [x, y] = at(i, 1)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="stroke-muted-foreground/25" strokeWidth={0.75} />
      })}
      <polygon
        points={share.map((v, i) => at(i, Math.min(1, v / scaleMax)).join(",")).join(" ")}
        className="fill-data/30 stroke-data"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const [x, y] = at(i, Math.min(1, share[i] / scaleMax))
        const [lx, ly] = at(i, 1.3)
        const shown = d.strength && d.strength !== "看不出"
        return (
          <g key={d.label}>
            <circle cx={x} cy={y} r={d.strength && isClear(d.strength) ? 3.2 : shown ? 2.6 : 1.8} className={tone(d)} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className={cn("text-[9px] font-semibold", tone(d))}>
              {BUILD_SHORT[d.label] ?? d.label.slice(0, 1)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 抽屜總覽的雷達：和一覽表的迷你雷達同一套——形狀是各出裝佔他場次的比例、顏色是本場貢獻的判定。
 *  原本用共用的 RadarChart，它的標籤顏色是「勝率和他自己的平均比」，和一覽表的判定（本場貢獻）不是同一件事，
 *  同一個坦克一邊寫偏強、一邊是紅字，看起來像數字對不上。 */
function RoleHex({ roles, total, selected, onPick }: { roles: Judged[]; total: number; selected: string | null; onPick: (label: string) => void }) {
  const W = 420
  const H = 320 // 標籤三行（名稱、本場貢獻・場次、勝率），底下那個頂點要多留空間
  const cx = W / 2
  const cy = H / 2 + 2
  const r = 92
  const n = roles.length
  const at = (i: number, frac: number) => {
    const a = ((90 + (i * 360) / n) * Math.PI) / 180 // 和一覽表同方向：正上方開始、逆時針
    return [cx + Math.cos(a) * r * frac, cy - Math.sin(a) * r * frac] as const
  }
  const ring = (frac: number) => roles.map((_, i) => at(i, frac).join(",")).join(" ")
  const share = roles.map((j) => (total ? j.games / total : 0))
  const scaleMax = Math.max(0.01, ...share)
  const tone = (j: Judged) => (j.g?.interval ? DOT_CLASS[j.strength] : "fill-muted-foreground")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[420px] overflow-visible" data-testid="role-hex">
      <polygon points={ring(1)} className="fill-muted/30 stroke-muted-foreground/40" strokeWidth={1} />
      <polygon points={ring(0.5)} className="fill-none stroke-muted-foreground/25" strokeWidth={0.75} />
      {roles.map((_, i) => {
        const [x, y] = at(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="stroke-muted-foreground/25" strokeWidth={0.75} />
      })}
      <polygon
        points={share.map((v, i) => at(i, Math.min(1, v / scaleMax)).join(",")).join(" ")}
        className="fill-data/30 stroke-data"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {roles.map((j, i) => {
        const [x, y] = at(i, Math.min(1, share[i] / scaleMax))
        const [lx, ly] = at(i, 1.42)
        const on = selected === j.label
        return (
          <g
            key={j.key}
            role="button"
            tabIndex={j.games ? 0 : -1}
            aria-label={`看他用${j.label}玩過的英雄`}
            data-label={j.label}
            data-strength={j.strength}
            className={cn("outline-none", j.games ? "cursor-pointer" : "cursor-default opacity-60", "[&:hover_text]:underline")}
            onClick={() => j.games && onPick(j.label)}
            onKeyDown={(e) => {
              if (j.games && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault()
                onPick(j.label)
              }
            }}
          >
            <title>{j.games ? stripTip(tipOf(j, null)) : `${j.label}：沒有對局`}</title>
            <circle cx={x} cy={y} r={isClear(j.strength) ? 5 : j.g?.interval && j.strength !== "看不出" ? 4 : 3} className={tone(j)} />
            <text x={lx} y={ly - 7} textAnchor="middle" dominantBaseline="central" className={cn("text-[13px] font-semibold", tone(j), on && "underline")}>
              {j.label}
            </text>
            <text x={lx} y={ly + 9} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground font-mono text-[11px]">
              {j.games ? `${j.score === null ? "—" : Math.round(j.score)}・${j.games} 場` : "沒打過"}
            </text>
            {j.games > 0 && j.winrate !== null && (
              <text x={lx} y={ly + 23} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground font-mono text-[11px]">
                勝率 {Math.round(j.winrate)}%
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 全員一覽的出裝欄：六種出裝固定順序各一條，點是本場貢獻和 50 的差，橫線是誤差範圍，所有人共用一把尺（reach），
 *  上下對照就看得出誰在哪種出裝比較強。實心點＝看得出、空心＝還在誤差內、灰點＝不到 MIN_N 場 */
function RoleStrip({ roles, reach, ownWr }: { roles: Judged[]; reach: number; ownWr: number | null }) {
  const at = (d: number) => `${50 + (Math.max(-reach, Math.min(reach, d)) / reach) * 50}%`
  return (
    <span className="grid gap-y-1" data-testid="crew-role-strip">
      {BUILD_ROLES.map((label) => {
        const j = roles.find((r) => r.label === label)
        const d = j?.g ? j.g.mean - 50 : null
        const iv = j?.g?.interval ?? null
        const pos = d !== null && d >= 0
        return (
          <span
            key={label}
            data-tip={j ? tipOf(j, ownWr) : `${label}：沒有玩過`}
            data-testid="crew-role-chip"
            data-label={label}
            data-strength={j?.strength}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_7rem] items-center gap-1.5 text-[11px]"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="relative h-3">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/50" />
              {iv && d !== null && (
                <span
                  className={cn("absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full", pos ? "bg-win/50" : "bg-loss/50")}
                  style={{ left: at(iv[0]), right: `calc(100% - ${at(iv[1])})` }}
                />
              )}
              {d !== null && (
                <span
                  className={cn(
                    "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                    !iv ? "border-muted-foreground/40 bg-muted-foreground/30"
                      : isClear(j!.strength) ? (pos ? "border-win bg-win" : "border-loss bg-loss")
                        : j!.strength === "看不出" ? "border-muted-foreground bg-card"
                          : pos ? "border-win bg-card" : "border-loss bg-card",
                  )}
                  style={{ left: at(d) }}
                />
              )}
            </span>
            <span className="flex items-center justify-end whitespace-nowrap">
              {j && j.games ? (
                <span className={cn(CHIP, levelClass(j))}>{labelOf(j)}</span>
              ) : (
                <span className="text-muted-foreground/60">—</span>
              )}
              {j && <LuckTag j={j} />}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** 表現和勝率走反方向時的小標：「雖敗猶榮」「默契加分」 */
function LuckTag({ j }: { j: Judged }) {
  const x = extraOf(j)
  if (!isLuck(x)) return null
  return (
    <span
      data-testid="crew-luck"
      className={cn("ml-1 rounded-sm px-1 text-[10px]", x === WR_NOTES.unlucky ? "bg-win/15 text-win" : "bg-muted text-muted-foreground")}
    >
      {x}
    </span>
  )
}

function RowLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex flex-wrap items-center gap-1">
        {LEVELS.map((l) => (
          <span
            key={l.label}
            data-testid="crew-level-legend"
            data-tip={`${l.label}：${l.note}`}
            className={cn(CHIP, "cursor-help", l.cls)}
          >
            {l.label}
          </span>
        ))}
        <span className="ml-1">由強到弱</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-full border-2 border-win bg-win" />
        <span className="size-2.5 rounded-full border-2 border-win bg-card" />
        <span className="size-2.5 rounded-full border-2 border-muted-foreground/40 bg-muted-foreground/30" />
        <span data-tip={`出裝欄：實心＝看得出、空心＝還在誤差內、灰＝不到 ${MIN_N} 場；橫線是誤差範圍，滑過看勝率`} className="cursor-help">
          出裝點
        </span>
      </span>
      <span>
        <span className={cn(CHIP, "cursor-help border-win/50 bg-win/15 text-foreground")} data-tip={`${WR_NOTES.unlucky}：貢獻高、勝率還沒跟上（比他平常低 ${WR_LUCK}pp 以上）`}>{WR_NOTES.unlucky}</span>
      </span>
      <span>
        <span className={cn(CHIP, "cursor-help border-foreground/25 bg-muted text-foreground")} data-tip={`${WR_NOTES.carried}：貢獻還在追，但和隊友配合常贏（勝率比他平常高 ${WR_LUCK}pp 以上）`}>{WR_NOTES.carried}</span>
      </span>
    </div>
  )
}

/** 全員一覽的「怎麼判斷的」：預設收起，標題列只留一句話 */
function HowWeJudge({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-lg border bg-muted/10 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer text-xs font-medium text-foreground">怎麼判斷的、為什麼不再用「適合／不適合」</summary>
      <div className="mt-2 space-y-1.5">{children}</div>
    </details>
  )
}

// ── 全員一覽：英雄 ──────────────────────────────────────────────────────────

/** 英雄頭像：名次、判定外框、本場貢獻。給 onClick 時整顆可以點（在整列按鈕裡面也可以，點擊不會傳到外層）；
 *  放在別的按鈕裡時，外層按鈕加上 group，滑過一樣會有上浮與變亮 */
function ChampBadge({ j, rank, ownWr, onClick }: { j: Judged; rank: number; ownWr: number | null; onClick?: () => void }) {
  const p = isPos(j.strength)
  const clear = isClear(j.strength)
  const body = (
    <span className="relative block transition duration-150 group-hover:-translate-y-0.5 group-hover:brightness-125">
      <span
        className={cn(
          "absolute -left-1 -top-1 z-10 flex size-4 items-center justify-center rounded-full font-mono text-[9px] font-bold text-background ring-1 ring-background",
          p ? "bg-win" : "bg-loss",
        )}
      >
        {rank}
      </span>
      <img
        src={iconUrl(j.icon)}
        alt={j.label}
        className={cn(
          "size-8 rounded-md bg-icon-tile transition-shadow duration-150 group-hover:shadow-md group-hover:shadow-primary/40",
          clear && p && "ring-2 ring-win/80",
          clear && !p && "ring-2 ring-loss/80",
          !clear && p && "outline-1 outline-offset-1 outline-dashed outline-win/60",
          !clear && !p && "outline-1 outline-offset-1 outline-dashed outline-loss/60",
        )}
      />
      <span
        className={cn(
          "absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-background px-0.5 font-mono text-[9px] leading-tight",
          p ? "text-win" : "text-loss",
        )}
      >
        {Math.round(j.score ?? 50)}
      </span>
      {isLuck(extraOf(j)) && (
        <span
          data-testid="crew-champ-luck"
          className={cn(
            "absolute -right-1 -top-1 z-10 rounded-sm px-0.5 text-[8px] leading-tight ring-1 ring-background",
            extraOf(j) === WR_NOTES.unlucky ? "bg-win text-background" : "bg-muted-foreground text-background",
          )}
        >
          {extraOf(j) === WR_NOTES.unlucky ? "猶榮" : "默契"}
        </span>
      )}
    </span>
  )
  const tip = `{{rank|第 ${rank} 名}}${tipOf(j, ownWr)}${onClick ? "\n-- 點一下看他玩這隻的每一場" : ""}`
  if (!onClick) {
    return (
      <span data-tip={tip} className="relative shrink-0" data-testid="crew-champ" data-strength={j.strength}>
        {body}
      </span>
    )
  }
  return (
    // 在一覽表的整列按鈕裡面，不能再放 <button>，所以用 role="button"；點擊與鍵盤都不往外傳
    <span
      role="button"
      tabIndex={0}
      data-tip={tip}
      aria-label={`看${j.label}的每一場`}
      data-testid="crew-champ"
      data-strength={j.strength}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="group relative shrink-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {body}
    </span>
  )
}

/** 比平均強（或弱）的英雄：看得出的排前面，同一級依差距大小、再依場次 */
function sideOf(champs: Judged[], side: "pos" | "neg") {
  const pick = side === "pos" ? isPos : isNeg
  const dir = side === "pos" ? -1 : 1
  return champs
    .filter((j) => pick(j.strength))
    .sort(
      (a, b) =>
        Number(isClear(b.strength)) - Number(isClear(a.strength)) ||
        dir * ((a.g?.diff ?? 0) - (b.g?.diff ?? 0)) ||
        b.games - a.games ||
        a.label.localeCompare(b.label, "zh-Hant"),
    )
}

function ChampSide({
  items,
  ownWr,
  tone,
  onMore,
  onPick,
  max = CHAMPS_SHOWN,
}: {
  items: Judged[]
  ownWr: number | null
  tone?: "pos" | "neg"
  onMore?: () => void
  onPick?: (label: string) => void
  max?: number
}) {
  if (!items.length) return <span className="text-[11px] text-muted-foreground">—</span>
  const rest = items.length - max
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5 gap-y-3", tone && "border-l-2 pl-2", tone === "pos" && "border-win/60", tone === "neg" && "border-loss/60")}>
      {items.slice(0, max).map((j, i) => (
        <ChampBadge key={j.key} j={j} rank={i + 1} ownWr={ownWr} onClick={onPick ? () => onPick(j.label) : undefined} />
      ))}
      {rest > 0 &&
        (onMore ? (
          <button type="button" onClick={onMore} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            還有 {rest} 隻
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground" data-tip="點這一列看完整排名">
            還有 {rest} 隻
          </span>
        ))}
    </span>
  )
}

/** 抽屜裡的橫向長條：比平均強（或弱）的英雄全部列出，一行排開，太多時左右捲動 */
function ChampStrip({
  title,
  tone,
  items,
  ownWr,
  onPick,
}: {
  title: string
  tone: "pos" | "neg"
  items: Judged[]
  ownWr: number | null
  /** 點一隻：捲到下面清單的那一列並展開他玩這隻的每一場 */
  onPick: (label: string) => void
}) {
  const clear = items.filter((j) => isClear(j.strength)).length
  return (
    <div className="rounded-lg border px-3 py-2" data-testid={tone === "pos" ? "strip-strong" : "strip-weak"}>
      <div className="mb-1.5 flex items-baseline gap-2 text-xs">
        <span className={cn("font-semibold", tone === "pos" ? "text-win" : "text-loss")}>{title}</span>
        <span className="text-[11px] text-muted-foreground">
          {items.length} 隻{items.length ? `・看得出 ${clear}（實線框）` : ""}
        </span>
      </div>
      {items.length ? (
        <div className="flex gap-2.5 overflow-x-auto px-1 pb-2.5 pt-1.5">
          {items.map((j, i) => (
            <button
              key={j.key}
              type="button"
              onClick={() => onPick(j.label)}
              aria-label={`看${j.label}的每一場`}
              className="group flex shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-md px-0.5 transition hover:bg-accent/60"
            >
              <ChampBadge j={j} rank={i + 1} ownWr={ownWr} />
              <span className="mt-1 max-w-[3.5rem] truncate text-[10px] text-muted-foreground group-hover:text-foreground">{j.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="pb-1 text-[11px] text-muted-foreground">沒有（{MIN_N} 場以上、差距 6 分以上的才列）</div>
      )}
    </div>
  )
}

// ── 抽屜 ────────────────────────────────────────────────────────────────────

/** 某個人在某些條件下（某隻英雄、某種出裝）的每一場。
 *  是哪幾場交給 Cube 用同一組條件查（和列表上方的場次同一個來源），再送 /api/matches 列出；
 *  recordMetric 有值時只取該指標最高的那一場。帳號換成這個人（matchParams 預設是目前選的帳號），戰報也以他為主角。 */
function PlayerMatches({ puuid, filters, recordMetric }: { puuid: string; filters: CubeFilter[]; recordMetric?: string }) {
  const { apply, matchParams } = useFilters()
  const centerFilters = useContext(CenterFilterContext)
  const ids = useCube(
    centerFilters === null ? null : apply(
      {
        measures: ["participants.games", ...(recordMetric ? [recordMetric] : [])],
        dimensions: ["matches.game_id"],
        filters: [{ member: "participants.puuid", operator: "equals", values: [puuid] }, ...centerFilters, ...filters],
        ...(recordMetric ? { order: { [recordMetric]: "desc" as const }, limit: 1 } : { limit: MAX_GAME_IDS }),
      },
      "all",
    ),
  )
  if (ids.loading) return <LoadingBlock height={160} label="載入中…" />
  if (ids.error) return <div className="text-sm text-destructive">{ids.error}</div>
  const gameIds = ids.rows.map((r) => String(r["matches.game_id"]))
  if (!gameIds.length) return <EmptyState>{recordMetric ? "找不到創下這項紀錄的對局。" : "這個條件下沒有對局。"}</EmptyState>
  return <MatchList params={{ ...matchParams(), puuid, game_ids: gameIds.join(",") }} puuid={puuid} />
}

/** 抽屜裡的一串對局。等抽屜滑完才查、才掛逐場列表，滑動時不卡 */
function GamesBody({ source }: { source: GamesSource }) {
  const settled = useDrawerSettled()
  if (!settled) return <LoadingBlock height={160} label="載入中…" />
  if ("params" in source) return <MatchList params={source.params} showPlayer />
  return <PlayerMatches puuid={source.puuid} filters={source.filters} recordMetric={source.recordMetric} />
}

/** 可展開的一列：點了在正下方列出每一場，再點一次收起。箭頭轉向表示展開狀態 */
function ExpandRow({
  open,
  onToggle,
  className,
  style,
  children,
  label,
  rowKey,
}: {
  open: boolean
  onToggle: () => void
  className: string
  style?: CSSProperties
  children: React.ReactNode
  label: string
  /** 讓外面找得到這一列（捲過去用） */
  rowKey?: string
}) {
  return (
    <button
      type="button"
      data-row-key={rowKey}
      onClick={onToggle}
      aria-expanded={open}
      data-tip={open ? `收起${label}的每一場` : `展開${label}的每一場`}
      style={style}
      className={cn(className, "w-full text-left transition hover:bg-accent", open && "bg-primary/10 hover:bg-primary/15")}
    >
      {children}
    </button>
  )
}

/** 兩個分頁：總覽（整體的數字、雷達、看得出的強弱、貢獻分解）、出裝與英雄（出裝的區間圖，點一種出裝下面只列那種出裝的英雄） */
type DrawerTab = "overview" | "picks"

/** 頂層分頁：全員一覽、數據總表、查英雄、查增幅裝置。一次只看一段，分頁列貼在頁首下面。 */
type Section = "matrix" | "stats" | "champ" | "augment" | "badges"

/** 抽屜裡的一串對局：範圍條件交給 Cube 找出是哪幾場（PlayerMatches），或現成的列表參數（單場紀錄） */
type GamesSource = { puuid: string; filters: CubeFilter[]; recordMetric?: string } | { params: Record<string, string> }

/** 點了一格或一列之後，抽屜列出算進去的每一場。cell 記下是哪一格，原頁面就亮著那一格 */
type GamesFocus = { title: string; note: string; cell?: { puuid: string; key: string }; source: GamesSource }

/** 右側抽屜同一時間只開一個：一位好友（總覽、出裝與英雄），或一串對局（數字、英雄、增幅、單場紀錄） */
type Focus = { kind: "player"; puuid: string; role: string | null; tab: DrawerTab; champ?: string } | ({ kind: "games" } & GamesFocus)

/** 總覽分頁上的一張數字卡：主數字、區間、判定與一句說明 */
function SummaryCard({ title, main, sub, strength, label, note, cls }: { title: string; main: string; sub: string; strength: Strength; label: string; note: string; cls?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {title}
          <Hint text={note} />
        </span>
        <span className={cn(CHIP, cls ?? STRENGTH_CLASS[strength])}>{label}</span>
      </div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{main}</div>
      <div className="font-mono text-[11px] tabular-nums text-muted-foreground">{sub}</div>
    </div>
  )
}

// ── 玩家類型：常玩什麼（出裝分布、AD／AP、英雄池）與打法（表現分六項哪裡突出） ─────────────
// 位置看出裝定位的場次比例，打法看表現分六項的平均（各項都和同類型比，50＝中位數，所以是「同樣的位置裡他哪裡做得多」）。
// 門檻是判斷：六項的平均在 300 場時誤差約 ±2，差 AXIS_LEAN 分以上才算突出；場次不到 STYLE_MIN 只講位置不講打法。

const STYLE_MIN = 20
/** 打法用的六項（表現分），順序同 PERF_PARTS */
const AXES = [
  { key: "contribution.perf_dmg", label: "輸出", up: "輸出高", down: "輸出較少" },
  { key: "contribution.perf_soak", label: "承傷", up: "很耐打", down: "承傷較少" },
  { key: "contribution.perf_minion", label: "清兵", up: "清兵多", down: "清兵較少" },
  { key: "contribution.perf_obj", label: "推塔", up: "常拆塔", down: "推塔較少" },
  { key: "contribution.perf_cc", label: "控場", up: "控場多", down: "控場較少" },
  { key: "contribution.perf_heal", label: "治療護盾", up: "常補血護盾", down: "補血護盾較少" },
] as const
const AXIS_LEAN = 4

type PlayStyle = {
  /** 「AD 後排輸出」這種位置描述 */
  position: string
  /** 「衝鋒型」這種打法；場次不夠或沒有明顯特徵是 null */
  archetype: string | null
  archetypeNote: string | null
  /** 出裝比例，由多到少（只列有玩的）；base 是一般玩家的比例 */
  mix: { label: string; share: number; base: number }[]
  /** 比一般玩家明顯多玩的出裝 */
  favors: { label: string; share: number; base: number }[]
  adShare: number | null
  champCount: number
  top5Share: number
  topChamps: string[]
  /** 有表現分的場次夠 STYLE_MIN，才講打法 */
  enough: boolean
  /** 五項的平均（和同類型比，50＝中位數；治療護盾不算） */
  axes: { label: string; value: number | null; up: string; down: string }[]
}

function playStyleOf(
  roles: Judged[],
  champs: Judged[],
  sum: CubeRow | undefined,
  base: Map<string, number>,
  scored: number,
  dmgGames: { ad: number; ap: number },
): PlayStyle {
  const total = roles.reduce((a, j) => a + j.games, 0)
  const share = (labels: string[]) => (total ? roles.filter((j) => labels.includes(j.label)).reduce((a, j) => a + j.games, 0) / total : 0)
  // 四大類：後排（射手、法師）、前排（坦克、鬥士）、刺客、輔助。最大的一類占 45% 以上才說他是那一類，
  // 後排再看射手、法師哪個占後排的三分之二以上；都不到就是「什麼位置都玩」，附上最常的出裝
  const adc = share(["射手"])
  const mage = share(["法師"])
  const groups = [
    { name: "back", v: adc + mage },
    { name: "front", v: share(["坦克", "鬥士"]) },
    { name: "dive", v: share(["刺客"]) },
    { name: "support", v: share(["輔助"]) },
  ].sort((x, y) => y.v - x.v)
  const adShare = dmgGames.ad + dmgGames.ap > 0 ? dmgGames.ad / (dmgGames.ad + dmgGames.ap) : null
  const dmg = adShare === null ? "" : adShare >= 0.62 ? "AD " : adShare <= 0.38 ? "AP " : ""
  const topRole = [...roles].sort((x, y) => y.games - x.games)[0]
  const main = groups[0]
  const position =
    main.v < 0.45
      ? `什麼位置都玩${topRole?.games ? `（最常玩 ${topRole.label}）` : ""}`
      : main.name === "back"
        ? adc >= main.v * (2 / 3)
          ? "射手"
          : mage >= main.v * (2 / 3)
            ? "法師"
            : "後排（射手＋法師）"
        : main.name === "front"
          ? `${dmg}前排（坦克／鬥士）`
          : main.name === "dive"
            ? `${dmg}刺客`
            : "輔助"
  const mix = roles
    .filter((j) => j.games > 0)
    .map((j) => ({ label: j.label, share: total ? j.games / total : 0, base: base.get(j.label) ?? 0 }))
    .sort((a, b) => b.share - a.share)
  const favors = mix.filter((m) => m.share >= 0.08 && m.base > 0 && m.share / m.base >= 1.5)

  const played = champs.filter((j) => j.games > 0).sort((a, b) => b.games - a.games)
  const champGames = played.reduce((a, j) => a + j.games, 0)
  const top5Share = champGames ? played.slice(0, 5).reduce((a, j) => a + j.games, 0) / champGames : 0

  // 治療護盾只在有治療或護盾隊友的場次才有值，平均只代表那幾場（可能只占一成），不拿來判斷打法
  const axes = AXES.filter((a) => a.label !== "治療護盾").map((a) => ({ label: a.label, value: opt(sum, a.key), up: a.up, down: a.down }))
  const v = (label: string) => axes.find((a) => a.label === label)?.value ?? 50
  let archetype: string | null = null
  let archetypeNote: string | null = null
  if (scored >= STYLE_MIN) {
    const ups = axes.filter((a) => a.value !== null && a.value >= 50 + AXIS_LEAN)
    const downs = axes.filter((a) => a.value !== null && a.value <= 50 - AXIS_LEAN)
    // 輸出、承傷都除以 √（死亡＋1），死得多會拉低這兩項，所以不再另外看存活
    if (ups.length >= 3) {
      archetype = "全面型"
      archetypeNote = "好幾項都比同類型多，沒有明顯的洞"
    } else if (v("推塔") >= 57) {
      archetype = "推進型"
      archetypeNote = "拆塔比同類型多：團戰贏了會把優勢換成塔"
    } else if (v("輸出") >= 57) {
      archetype = "輸出型"
      archetypeNote = "打出的傷害（死亡打折後）比同類型多"
    } else if (v("承傷") >= 57) {
      archetype = "前排型"
      archetypeNote = "扛下的傷害（死亡打折後）比同類型多"
    } else if (v("控場") >= 57) {
      archetype = "控場型"
      archetypeNote = "控制敵人的時間比同類型多"
    } else if (v("清兵") >= 57) {
      archetype = "清線型"
      archetypeNote = "清兵比同類型多"
    } else if (!ups.length && !downs.length) {
      archetype = "均衡型"
      archetypeNote = "輸出、承傷、清兵、推塔、控場都和同類型的中位數差不多"
    }
  }
  return {
    position,
    archetype,
    archetypeNote,
    mix,
    favors,
    adShare,
    champCount: played.length,
    top5Share,
    topChamps: played.slice(0, 5).map((j) => j.label),
    enough: scored >= STYLE_MIN,
    axes,
  }
}

const pct0 = (v: number) => `${Math.round(v * 100)}%`
/** 一行版：位置・打法；沒有對上任何一型時，改寫最突出的一兩項（「很少死」） */
const styleLine = (s: PlayStyle) => {
  if (s.archetype) return `${s.position}・${s.archetype}`
  if (!s.enough) return s.position
  const top = s.axes
    .filter((a) => a.value !== null && Math.abs(a.value - 50) >= AXIS_LEAN)
    .sort((a, b) => Math.abs((b.value ?? 50) - 50) - Math.abs((a.value ?? 50) - 50))
    .slice(0, 2)
    .map((a) => ((a.value ?? 50) > 50 ? a.up : a.down))
  return top.length ? `${s.position}・${top.join('、')}` : s.position
}

// ── 稱號：累積到門檻就有 ─────────────────────────────────────────────────────
// 每個稱號有一條固定的門檻（下面的 T），誰達標誰拿，不跟別人比：一個人可以同時有好幾個，也可能一個都沒有；
// 換篩選只會因為數字變了而得失，不會因為「別人比較強」。值全部來自語意層（participants 的指標，和數據總表同一份定義）。
// 門檻是看 2026-10-24 好友 9 人（場次 ≥ 20 的）的實際分布訂的整數：每個稱號大約 1～3 位達標，要改直接改 T。
// 場次不到 TITLE_MIN_GAMES 的人不參加（比率太不準）；要賽後統計的兩項（守護天使、不死之身）另外要求那種場次至少 TITLE_MIN_EOG 場。

const TITLE_MIN_GAMES = 20
const TITLE_MIN_EOG = 10
/** 逆風支柱：敗場（有本場貢獻的）至少這麼多場 */
const TITLE_MIN_LOSSES = 10
/** 各稱號的門檻（達標＝拿到）。改了要把 hint 的字一起看一下；hint 是用這裡的數字組出來的，不會不同步 */
const T = {
  pentas: 5, // 次
  dpm: 2200, // 每分鐘對英雄傷害
  soak: 5300, // 每分鐘承受＋減免
  cc: 2.1, // 每分鐘控場秒數
  obj: 130, // 每分鐘對建築與中立目標傷害
  heal: 80, // 每分鐘治療＋護盾隊友
  mvp: 14, // MVP 率 %
  ace: 12, // ACE 率 %
  dead: 25, // 死亡時間占全場 %（越低越好）
  fb: 12, // 首殺率 %
  kp: 70, // 參團率 %
  multi: 72, // 多殺場次 %
  loss: 48, // 敗場平均本場貢獻
  top: 20, // 最常玩的那隻英雄的場次
  night: 20, // 0～5 點開打的場次占 %
  champs: 90, // 玩過的英雄數
  duoWr: 55, // 最佳拍檔：同隊勝率 %
} as const

/** 里程碑：場次的門檻，由高到低找第一個達到的 */
const GAME_MILESTONES = [
  { games: 500, name: "五百場老將" },
  { games: 300, name: "三百場老將" },
  { games: 100, name: "百場老將" },
] as const

const TITLE_MEASURES = [
  "participants.games",
  "participants.pentas",
  "participants.dpm",
  "participants.taken_per_min",
  "participants.mitigated_per_min",
  "participants.cc_time_per_min",
  "participants.objective_damage_per_min",
  "participants.ally_heal_shield_per_min",
  "participants.ally_heal_games",
  "participants.mvp_games",
  "participants.time_dead_share",
  "participants.time_dead_games",
  "participants.champion_count",
  "participants.first_blood_rate",
  "participants.kill_participation",
  "participants.multikill_rate",
  "participants.ace_games",
]

/** 稱號另外要的三份資料，併進 TITLE_MEASURES 那一列（鍵名是這裡自訂的，不是語意層的成員）：
 *  敗場的平均本場貢獻（segment losses_only）、0～5 點開打的場次、最常玩那隻英雄的場次 */
const X_LOSS_WORK = "x.loss_work"
const X_LOSS_GAMES = "x.loss_games"
const X_NIGHT_GAMES = "x.night_games"
const X_TOP_CHAMP = "x.top_champ_games"

/** 徽章的等級：傳說（五殺之王、MVP 常客，最難拿的兩個）用增幅稜鏡色，其餘稱號用金色，里程碑用銀色。
 *  顏色都是主題變數（--prismatic／--gold／--silver），亮色主題有各自加深的版本 */
type TitleTier = "legend" | "gold" | "silver"

type TitleDef = {
  name: string
  icon: LucideIcon
  tier: TitleTier
  /** 滑過時的說明：要達到什麼 */
  hint: string
  value: (r: CubeRow) => number | null
  /** 門檻；lower 的是「不超過」，其餘是「至少」 */
  threshold: number
  fmt: (v: number) => string
  /** 「還差多少」的寫法（d 一定是正的） */
  gap: (d: number) => string
  /** 除了場次以外的參加條件（例如要有賽後統計）：還不能算時回傳一句「還缺什麼」，可以算是 null */
  locked?: (r: CubeRow) => string | null
  /** 越低越好（死亡時間） */
  lower?: boolean
}

/** 百分比類的「還差」 */
const PP = (d: number) => `${d.toFixed(1)} 個百分點`
/** 某一種場次要至少 need 場才開始算 */
const needGames = (have: number, need: number, what: string) => (have >= need ? null : `${what}還差 ${need - have} 場才開始計算（目前 ${have} 場）`)

const TITLES: TitleDef[] = [
  { name: "五殺之王", icon: Crown, tier: "legend", hint: `累積 ${T.pentas} 次五殺`, threshold: T.pentas, gap: (d) => `${Math.ceil(d)} 次五殺`, value: (r) => n0(r, "participants.pentas") || null, fmt: (v) => `${v} 次五殺` },
  { name: "輸出擔當", icon: Flame, tier: "gold", hint: `每分鐘對英雄傷害 ${T.dpm.toLocaleString()} 以上`, threshold: T.dpm, gap: (d) => `每分鐘 ${Math.ceil(d).toLocaleString()} 傷害`, value: (r) => opt(r, "participants.dpm"), fmt: (v) => `每分鐘 ${Math.round(v).toLocaleString()} 傷害` },
  {
    name: "鋼鐵前排",
    icon: Shield,
    tier: "gold",
    hint: `每分鐘承受＋減免的傷害 ${T.soak.toLocaleString()} 以上`,
    threshold: T.soak, gap: (d) => `每分鐘 ${Math.ceil(d).toLocaleString()} 承傷`,
    value: (r) => {
      const a = opt(r, "participants.taken_per_min")
      const b = opt(r, "participants.mitigated_per_min")
      return a === null || b === null ? null : a + b
    },
    fmt: (v) => `每分鐘扛 ${Math.round(v).toLocaleString()}`,
  },
  { name: "控場大師", icon: Snowflake, tier: "gold", hint: `每分鐘控制敵人 ${T.cc} 秒以上`, threshold: T.cc, gap: (d) => `每分鐘 ${d.toFixed(1)} 秒控場`, value: (r) => opt(r, "participants.cc_time_per_min"), fmt: (v) => `每分鐘控場 ${v.toFixed(1)} 秒` },
  { name: "拆遷大隊", icon: Hammer, tier: "gold", hint: `每分鐘對建築與中立目標的傷害 ${T.obj} 以上`, threshold: T.obj, gap: (d) => `每分鐘 ${Math.ceil(d)} 建築傷害`, value: (r) => opt(r, "participants.objective_damage_per_min"), fmt: (v) => `每分鐘拆 ${Math.round(v).toLocaleString()}` },
  {
    name: "守護天使",
    icon: HeartHandshake,
    tier: "gold",
    hint: `每分鐘治療＋護盾隊友 ${T.heal} 以上（不含自補；只算有賽後統計的場次，至少 ${TITLE_MIN_EOG} 場）`,
    threshold: T.heal, gap: (d) => `每分鐘 ${Math.ceil(d)} 治療護盾`,
    value: (r) => opt(r, "participants.ally_heal_shield_per_min"),
    locked: (r) => needGames(n0(r, "participants.ally_heal_games"), TITLE_MIN_EOG, "有賽後統計的場次"),
    fmt: (v) => `每分鐘補 ${Math.round(v).toLocaleString()}`,
  },
  {
    name: "MVP 常客",
    icon: Trophy,
    tier: "legend",
    hint: `拿到 MVP（贏的一隊裡本場貢獻最高）的場次占 ${T.mvp}% 以上`,
    threshold: T.mvp, gap: PP,
    value: (r) => {
      const g = n0(r, "participants.games")
      return g ? (100 * n0(r, "participants.mvp_games")) / g : null
    },
    fmt: (v) => `MVP 率 ${v.toFixed(1)}%`,
  },
  {
    name: "不死之身",
    icon: InfinityIcon,
    tier: "gold",
    hint: `死亡時間占全場 ${T.dead}% 以下（只算有賽後統計的場次，至少 ${TITLE_MIN_EOG} 場）`,
    threshold: T.dead, gap: PP,
    value: (r) => opt(r, "participants.time_dead_share"),
    locked: (r) => needGames(n0(r, "participants.time_dead_games"), TITLE_MIN_EOG, "有賽後統計的場次"),
    lower: true,
    fmt: (v) => `死亡時間只占 ${v.toFixed(1)}%`,
  },
  { name: "先馳得點", icon: Zap, tier: "gold", hint: `親自拿到首殺的場次占 ${T.fb}% 以上`, threshold: T.fb, gap: PP, value: (r) => opt(r, "participants.first_blood_rate"), fmt: (v) => `首殺率 ${v.toFixed(1)}%` },
  { name: "團戰核心", icon: Users, tier: "gold", hint: `參團率（擊殺＋助攻占全隊擊殺）${T.kp}% 以上`, threshold: T.kp, gap: PP, value: (r) => opt(r, "participants.kill_participation"), fmt: (v) => `參團率 ${v.toFixed(1)}%` },
  { name: "多殺專家", icon: Skull, tier: "gold", hint: `拿到雙殺以上的場次占 ${T.multi}% 以上`, threshold: T.multi, gap: PP, value: (r) => opt(r, "participants.multikill_rate"), fmt: (v) => `多殺場次 ${v.toFixed(1)}%` },
  {
    name: "逆境王牌",
    icon: Award,
    tier: "legend",
    hint: `拿到 ACE（輸的一隊裡本場貢獻最高）的場次占 ${T.ace}% 以上`,
    threshold: T.ace, gap: PP,
    value: (r) => {
      const g = n0(r, "participants.games")
      return g ? (100 * n0(r, "participants.ace_games")) / g : null
    },
    fmt: (v) => `ACE 率 ${v.toFixed(1)}%`,
  },
  {
    name: "逆風支柱",
    icon: Mountain,
    tier: "gold",
    hint: `輸掉的場次裡平均本場貢獻 ${T.loss} 以上（至少 ${TITLE_MIN_LOSSES} 場敗場）：輸了也有扛起工作`,
    threshold: T.loss, gap: (d) => `${d.toFixed(1)} 分`,
    value: (r) => opt(r, X_LOSS_WORK),
    locked: (r) => needGames(n0(r, X_LOSS_GAMES), TITLE_MIN_LOSSES, "敗場"),
    fmt: (v) => `敗場平均貢獻 ${v.toFixed(1)}`,
  },
  { name: "本命專精", icon: Heart, tier: "gold", hint: `同一隻英雄玩了 ${T.top} 場以上`, threshold: T.top, gap: (d) => `${Math.ceil(d)} 場`, value: (r) => n0(r, X_TOP_CHAMP) || null, fmt: (v) => `最常玩的英雄 ${v} 場` },
  {
    name: "夜貓子",
    icon: Moon,
    tier: "gold",
    hint: `0～5 點開打的場次占 ${T.night}% 以上`,
    threshold: T.night, gap: PP,
    value: (r) => {
      const g = n0(r, "participants.games")
      return g ? (100 * n0(r, X_NIGHT_GAMES)) / g : null
    },
    fmt: (v) => `深夜場 ${v.toFixed(1)}%`,
  },
  { name: "英雄百科", icon: BookOpen, tier: "gold", hint: `玩過 ${T.champs} 隻以上的英雄`, threshold: T.champs, gap: (d) => `${Math.ceil(d)} 隻英雄`, value: (r) => opt(r, "participants.champion_count"), fmt: (v) => `玩過 ${Math.round(v)} 隻英雄` },
]

type Title = { name: string; kind: "title" | "milestone"; tier: TitleTier; icon: LucideIcon; tip: string }

/** 同隊的一組好友（兩人一起、同一隊）。games／wins 來自語意層的 teammates */
type DuoPair = { a: Player; b: Player; games: number; wins: number }

/** 最佳拍檔：同隊至少 DUO_TITLE_MIN 場、勝率達 T.duoWr% 的組合（兩個人都拿到）。勝率在矩陣裡照樣標誤差 */
const DUO_TITLE_MIN = 30
/** 矩陣裡少於這個場次的格子只寫場次、不上色 */
const DUO_MIN_GAMES = 20
/** 勝率和 50% 差不到這麼多百分點的格子不分勝敗色 */
const DUO_NEUTRAL_PP = 2

const nameOf = (p: Player) => splitRiotId(p.riot_id, p.puuid).name

/** 一個人離一個徽章還有多遠。ratio 是進度條（0～1）；levels 是多段的徽章（老將）在進度條上的刻度 */
type BadgeStatus = {
  state: "earned" | "progress" | "locked"
  ratio: number
  now: string | null
  target: string
  note: string
  /** 多段徽章：這個人目前到哪一級（顯示在名稱上） */
  level?: string
  levels?: { at: number; label: string }[]
}

/** 稱號的進度：場次不到 TITLE_MIN_GAMES 或缺賽後統計時是「還不能算」；計數類（五殺、本命）沒有紀錄就當 0 */
function titleStatus(t: TitleDef, r: CubeRow | undefined): BadgeStatus {
  const target = `${t.fmt(t.threshold)}${t.lower ? " 以下" : " 以上"}`
  const games = r ? n0(r, "participants.games") : 0
  if (!r || games < TITLE_MIN_GAMES)
    return { state: "locked", ratio: games / TITLE_MIN_GAMES, now: null, target, note: `再打 ${TITLE_MIN_GAMES - games} 場才開始計算（目前 ${games} 場）` }
  const lock = t.locked?.(r)
  if (lock) return { state: "locked", ratio: 0, now: null, target, note: lock }
  const raw = t.value(r)
  if (raw === null && t.lower) return { state: "locked", ratio: 0, now: null, target, note: "還沒有紀錄" }
  const v = raw ?? 0
  const earned = t.lower ? v <= t.threshold : v >= t.threshold
  const ratio = earned ? 1 : t.lower ? t.threshold / v : Math.max(0, v / t.threshold)
  return { state: earned ? "earned" : "progress", ratio, now: t.fmt(v), target, note: earned ? "已獲得" : `還差 ${t.gap(t.lower ? v - t.threshold : t.threshold - v)}` }
}

/** 最佳拍檔的進度：看他和每位好友同隊的紀錄，拿最接近的那一組 */
function duoStatus(p: Player, duos: DuoPair[]): BadgeStatus {
  const target = `同隊 ${DUO_TITLE_MIN} 場以上、勝率 ${T.duoWr}% 以上`
  const mine = duos.filter((d) => d.a.puuid === p.puuid || d.b.puuid === p.puuid)
  const other = (d: DuoPair) => nameOf(d.a.puuid === p.puuid ? d.b : d.a)
  const wr = (d: DuoPair) => (100 * d.wins) / d.games
  const best = mine.filter((d) => d.games >= DUO_TITLE_MIN).sort((x, y) => wr(y) - wr(x))[0]
  if (best) {
    const earned = wr(best) >= T.duoWr
    return {
      state: earned ? "earned" : "progress",
      ratio: earned ? 1 : wr(best) / T.duoWr,
      now: `和 ${other(best)} ${wr(best).toFixed(1)}%（${best.games} 場）`,
      target,
      note: earned ? "已獲得" : `和 ${other(best)} 一起的勝率還差 ${PP(T.duoWr - wr(best))}`,
    }
  }
  const most = [...mine].sort((x, y) => y.games - x.games)[0]
  if (!most?.games) return { state: "locked", ratio: 0, now: null, target, note: "還沒有和比較對象裡的好友同隊過" }
  return {
    state: "locked",
    ratio: most.games / DUO_TITLE_MIN,
    now: `和 ${other(most)} 同隊 ${most.games} 場`,
    target,
    note: `和 ${other(most)} 同隊還差 ${DUO_TITLE_MIN - most.games} 場才開始計算`,
  }
}

/** 老將：場次分三級（GAME_MILESTONES），進度條畫到最高一級，中間的級數是刻度 */
function veteranStatus(r: CubeRow | undefined): BadgeStatus {
  const games = r ? n0(r, "participants.games") : 0
  const asc = [...GAME_MILESTONES].sort((a, b) => a.games - b.games)
  const top = asc[asc.length - 1].games
  const got = [...asc].reverse().find((m) => games >= m.games)
  const next = asc.find((m) => games < m.games)
  return {
    state: got ? "earned" : "progress",
    ratio: Math.min(1, games / top),
    now: `${games} 場`,
    target: asc.map((m) => `${m.games}`).join("／") + " 場",
    note: next ? `再 ${next.games - games} 場升到「${next.name}」` : "已經是最高一級",
    level: got?.name,
    levels: asc.map((m) => ({ at: m.games / top, label: `${m.games}` })),
  }
}

/** 徽章一覽的目錄：全部稱號＋最佳拍檔＋兩個里程碑。status 依人算 */
type BadgeCard = { key: string; name: string; icon: LucideIcon; tier: TitleTier; kind: "title" | "milestone"; hint: string; status: (p: Player) => BadgeStatus }

function badgeCatalog(rows: CubeRow[], duos: DuoPair[]): BadgeCard[] {
  const rowOf = (puuid: string) => rows.find((r) => r["participants.puuid"] === puuid)
  return [
    ...TITLES.map((t): BadgeCard => ({ key: t.name, name: t.name, icon: t.icon, tier: t.tier, kind: "title", hint: t.hint, status: (p) => titleStatus(t, rowOf(p.puuid)) })),
    {
      key: "最佳拍檔",
      name: "最佳拍檔",
      icon: Handshake,
      tier: "gold",
      kind: "title",
      hint: `和某位好友同隊至少 ${DUO_TITLE_MIN} 場，一起打的勝率 ${T.duoWr}% 以上`,
      status: (p) => duoStatus(p, duos),
    },
    {
      key: "五殺達成",
      name: "五殺達成",
      icon: Sparkles,
      tier: "silver",
      kind: "milestone",
      hint: "拿過一次五殺",
      status: (p) => {
        const n = n0(rowOf(p.puuid), "participants.pentas")
        return { state: n > 0 ? "earned" : "progress", ratio: n > 0 ? 1 : 0, now: `${n} 次五殺`, target: "1 次五殺", note: n > 0 ? "已獲得" : "還差 1 次五殺" }
      },
    },
    {
      key: "老將",
      name: "老將",
      icon: Medal,
      tier: "silver",
      kind: "milestone",
      hint: [...GAME_MILESTONES].reverse().map((m) => `${m.games} 場「${m.name}」`).join(" → "),
      status: (p) => veteranStatus(rowOf(p.puuid)),
    },
  ]
}

/** 每個人拿到的稱號與里程碑：達標就有，不跟別人比。rows 是 TITLE_MEASURES 以 participants.puuid 分組的結果（再併上敗場貢獻等） */
function titlesOf(people: Player[], rows: CubeRow[], duos: DuoPair[]): Map<string, Title[]> {
  const out = new Map<string, Title[]>(people.map((p) => [p.puuid, []]))
  const rowOf = (puuid: string) => rows.find((r) => r["participants.puuid"] === puuid)
  // 提示框用的排版標記見 lib/tip.ts：標題是稱號名，「條件」是要達到什麼，「目前」是他的數字（門檻放在下一行）
  const m = (kind: string, text: string) => `{{${kind}|${text}}}`
  for (const p of people) {
    const r = rowOf(p.puuid)
    if (!r) continue
    const mine = out.get(p.puuid)!
    const games = n0(r, "participants.games")
    for (const t of TITLES) {
      if (titleStatus(t, r).state !== "earned") continue
      const v = t.value(r)!
      mine.push({
        name: t.name,
        kind: "title",
        tier: t.tier,
        icon: t.icon,
        tip: `${t.name}\n${m("lab", "條件")}${t.hint}\n${m("lab", "目前")}${m("big", t.fmt(v))}\n> 門檻 ${t.fmt(t.threshold)}${t.lower ? " 以下" : " 以上"}・${games} 場`,
      })
    }
  }
  // 最佳拍檔：兩個人都有
  for (const d of duos) {
    if (d.games < DUO_TITLE_MIN || (100 * d.wins) / d.games < T.duoWr) continue
    const wr = ((100 * d.wins) / d.games).toFixed(1)
    for (const [me, other] of [[d.a, d.b], [d.b, d.a]] as const) {
      out.get(me.puuid)?.push({
        name: "最佳拍檔",
        kind: "title",
        tier: "gold",
        icon: Handshake,
        tip: `最佳拍檔：和 ${nameOf(other)}\n${m("lab", "條件")}同隊至少 ${DUO_TITLE_MIN} 場，一起打的勝率 ${T.duoWr}% 以上\n${m("lab", "目前")}${m("big", `${wr}%`)} ${m("win", `${d.wins} 勝`)} ${m("loss", `${d.games - d.wins} 敗`)}\n> 和 ${nameOf(other)} 同隊 ${d.games} 場`,
      })
    }
  }
  // 里程碑
  for (const p of people) {
    const r = rowOf(p.puuid)
    if (!r) continue
    const mine = out.get(p.puuid)!
    const pentas = n0(r, "participants.pentas")
    // 已經是五殺之王就不再重複寫五殺達成
    if (pentas > 0 && !mine.some((t) => t.name === "五殺之王")) mine.push({ name: "五殺達成", kind: "milestone", tier: "silver", icon: Sparkles, tip: `里程碑：拿過五殺（${pentas} 次）` })
    const games = n0(r, "participants.games")
    const g = GAME_MILESTONES.find((x) => games >= x.games)
    if (g) mine.push({ name: g.name, kind: "milestone", tier: "silver", icon: Medal, tip: `里程碑：大亂鬥 ${g.games} 場以上（目前 ${games} 場）` })
  }
  return out
}

/** 搭檔矩陣：兩人同隊的場次與勝率。顏色依勝率和 50% 的差（勝／敗兩色），區間整段在一邊才加粗外框；
 *  少於 DUO_MIN_GAMES 場只寫場次。點一格列出那幾場 */
function DuoMatrix({ people, pairs, onOpen }: { people: Player[]; pairs: DuoPair[]; onOpen: (d: DuoPair) => void }) {
  const pairOf = (a: Player, b: Player) => pairs.find((d) => (d.a.puuid === a.puuid && d.b.puuid === b.puuid) || (d.a.puuid === b.puuid && d.b.puuid === a.puuid))
  // 每格至少 3.25rem；畫面夠寬就平均撐滿，不夠才橫向捲動
  const cols = { gridTemplateColumns: `8rem repeat(${people.length}, minmax(3.25rem, 1fr))`, minWidth: `calc(8rem + ${people.length} * 3.5rem)` }
  return (
    <div className="overflow-x-auto" data-testid="crew-duo-matrix">
      <div className="grid gap-1 text-[11px]" style={cols}>
        <span />
        {people.map((p) => (
          <span key={p.puuid} className="truncate px-1 text-center font-medium" data-tip={p.riot_id ?? undefined}>
            {nameOf(p)}
          </span>
        ))}
        {people.map((a) => (
          <Fragment key={a.puuid}>
            <span className="truncate pr-1 text-right font-medium leading-9" data-tip={a.riot_id ?? undefined}>
              {nameOf(a)}
            </span>
            {people.map((b) => {
              if (a.puuid === b.puuid) return <span key={b.puuid} className="rounded-md bg-muted/30" />
              const d = pairOf(a, b)
              if (!d || !d.games) return <span key={b.puuid} className="flex h-9 items-center justify-center rounded-md border border-dashed text-muted-foreground/60">—</span>
              const wr = (100 * d.wins) / d.games
              const enough = d.games >= DUO_MIN_GAMES
              const [lo, hi] = wilson(d.wins, d.games)
              const clear = enough && (lo > 50 || hi < 50)
              // 和 50% 差 15pp 就是最深色；差不到 DUO_NEUTRAL_PP 用中性灰（四捨五入後都寫 50%，上色會被讀成有差）。
              // 顏色用主題的勝／敗變數混透明，主題換了跟著換
              const strength = enough ? Math.min(1, Math.abs(wr - 50) / 15) : 0
              const tone = Math.abs(wr - 50) < DUO_NEUTRAL_PP ? "var(--muted-foreground)" : wr >= 50 ? "var(--win)" : "var(--loss)"
              return (
                <button
                  key={b.puuid}
                  type="button"
                  data-testid="crew-duo-cell"
                  data-pair={`${nameOf(a)}|${nameOf(b)}`}
                  onClick={() => onOpen(d)}
                  data-tip={`${nameOf(a)}＋${nameOf(b)} 同隊 ${d.games} 場、${d.wins} 勝 ${d.games - d.wins} 敗（${wr.toFixed(1)}%）\n95% 區間 ${lo.toFixed(0)}～${hi.toFixed(0)}%${enough ? (clear ? "，看得出和 50% 不同" : "，還在誤差內") : `；不到 ${DUO_MIN_GAMES} 場，不上色`}\n點一下看這幾場`}
                  style={enough ? { background: `color-mix(in oklab, ${tone} ${Math.round(14 + strength * 40)}%, transparent)` } : undefined}
                  className={cn(
                    "flex h-9 flex-col items-center justify-center rounded-md border leading-tight transition hover:brightness-125",
                    clear ? (wr >= 50 ? "border-win" : "border-loss") : "border-transparent",
                    !enough && "bg-muted/20 text-muted-foreground",
                  )}
                >
                  {enough && <span className="font-mono text-xs font-semibold tabular-nums">{Math.round(wr)}%</span>}
                  <span className="font-mono text-[10px] tabular-nums opacity-75">{d.games} 場</span>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** 各等級的徽章樣式：底色是同色系的斜向漸層、外圍一圈同色的光，圖示放在一顆實心的小圓裡 */
const TIER_CLASS: Record<TitleTier, { badge: string; icon: string }> = {
  legend: {
    badge: "border-prismatic/70 bg-linear-135 from-prismatic/30 via-prismatic/10 to-gold/15 text-prismatic shadow-[0_0_12px_-3px] shadow-prismatic/70",
    icon: "bg-prismatic text-background",
  },
  gold: {
    badge: "border-gold/60 bg-linear-135 from-gold/25 to-gold/5 text-gold shadow-[0_0_10px_-4px] shadow-gold/70",
    icon: "bg-gold text-background",
  },
  silver: {
    badge: "border-silver/45 bg-silver/10 text-silver",
    icon: "bg-silver/80 text-background",
  },
}
/** 傳說 → 金 → 銀，同一級照原本的順序 */
const TIER_ORDER: Record<TitleTier, number> = { legend: 0, gold: 1, silver: 2 }

/** 稱號（傳說／金）與里程碑（銀）。一個都沒有就不畫。size="lg" 給抽屜用 */
function TitleBadges({ titles, className, size = "sm" }: { titles: Title[] | undefined; className?: string; size?: "sm" | "lg" }) {
  if (!titles?.length) return null
  const sorted = [...titles].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
  const lg = size === "lg"
  return (
    <span className={cn("flex flex-wrap", lg ? "gap-2" : "gap-1.5", className)} data-testid="crew-titles">
      {sorted.map((t, i) => {
        const tier = TIER_CLASS[t.tier]
        const Icon = t.icon
        return (
          <span
            key={t.name}
            data-tip={t.tip}
            data-testid={t.kind === "title" ? "crew-title" : "crew-milestone"}
            data-tier={t.tier}
            style={{ "--stagger": `${i * 120}ms` } as CSSProperties}
            className={cn(
              "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
              t.kind === "title" && "title-shine",
              lg ? "gap-1.5 py-0.5 pr-2.5 pl-0.5 text-xs" : "gap-1 py-px pr-2 pl-px text-[11px]",
              tier.badge,
            )}
          >
            <span className={cn("flex shrink-0 items-center justify-center rounded-full", lg ? "size-5" : "size-4", tier.icon)}>
              <Icon className={lg ? "size-3" : "size-2.5"} strokeWidth={2.5} />
            </span>
            {t.name}
          </span>
        )
      })}
    </span>
  )
}

/** 徽章一覽：所有徽章一張一張卡片，選一個人看他拿到哪些、沒拿到的還差多少；每張卡片下面列出比較對象裡誰已經拿到。
 *  版面參考 LoL 的挑戰：圖示＋名稱＋等級、一句條件、進度條（左邊是目前、右邊是門檻；多段的有刻度）、已獲得的人。 */
function BadgesPanel({ people, rows, duos, loading }: { people: Player[]; rows: CubeRow[]; duos: DuoPair[]; loading: boolean }) {
  const [who, setWho] = useState<string | null>(null)
  const [show, setShow] = useState<"all" | "earned" | "todo">("all")
  const sel = people.find((p) => p.puuid === who) ?? people.find((p) => p.is_me) ?? people[0]
  const cards = useMemo(() => badgeCatalog(rows, duos), [rows, duos])
  const view = useMemo(() => {
    if (!sel) return []
    const rank = { earned: 0, progress: 1, locked: 2 } as const
    return cards
      .map((c) => ({ c, st: c.status(sel), holders: people.filter((p) => c.status(p).state === "earned") }))
      .sort((a, b) => rank[a.st.state] - rank[b.st.state] || (a.st.state === "earned" ? TIER_ORDER[a.c.tier] - TIER_ORDER[b.c.tier] : b.st.ratio - a.st.ratio))
  }, [cards, sel, people])
  const earned = view.filter((v) => v.st.state === "earned").length
  const closest = view.find((v) => v.st.state === "progress")
  const shown = view.filter((v) => (show === "all" ? true : show === "earned" ? v.st.state === "earned" : v.st.state !== "earned"))
  return (
    <Panel
      title="徽章"
      caption="每個徽章都是累積到門檻就有；選一個人看他拿到哪些、還差多少"
      hint={`稱號（金、傳說）與里程碑（銀）都在這裡。數字照上面的篩選與比較範圍算；場次不到 ${TITLE_MIN_GAMES} 場的人，稱號先不算（比率太不準）。每張卡片下面列出目前比較對象裡已經拿到的人`}
    >
      {loading || !sel ? (
        <LoadingBlock height={560} label="載入徽章進度…" />
      ) : (
        <div className="space-y-4" data-testid="crew-badges">
          <div className="flex flex-wrap items-center gap-2">
            {people.map((p) => (
              <button
                key={p.puuid}
                type="button"
                onClick={() => setWho(p.puuid)}
                data-testid="badge-person"
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition",
                  p.puuid === sel.puuid ? "border-primary bg-primary/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {nameOf(p)}
                {!!p.is_me && <span className="ml-1 text-[10px] text-primary">我</span>}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3">
            <div className="min-w-[14rem] flex-1">
              <div className="text-sm">
                <span className="font-semibold">{nameOf(sel)}</span> 已獲得{" "}
                <span className="font-mono text-lg font-bold tabular-nums" data-testid="badge-earned-count">
                  {earned}
                </span>
                <span className="text-muted-foreground"> / {view.length} 個徽章</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div key={sel.puuid} className="bar-grow h-full rounded-full bg-primary" style={{ width: `${(100 * earned) / Math.max(1, view.length)}%` }} />
              </div>
              {closest && (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  最接近的是「<span className="text-foreground">{closest.c.name}</span>」：{closest.st.note}
                </div>
              )}
            </div>
            <ToggleGroup type="single" size="sm" variant="outline" value={show} onValueChange={(v) => v && setShow(v as typeof show)}>
              <ToggleGroupItem value="all" className="h-7 px-2 text-xs">全部</ToggleGroupItem>
              <ToggleGroupItem value="earned" className="h-7 px-2 text-xs">已獲得</ToggleGroupItem>
              <ToggleGroupItem value="todo" className="h-7 px-2 text-xs">還沒拿到</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {shown.length === 0 ? (
            <EmptyState>{show === "earned" ? `${nameOf(sel)} 目前還沒有拿到徽章。` : `${nameOf(sel)} 已經拿到全部的徽章。`}</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {shown.map(({ c, st, holders }, i) => (
                <BadgeCardView key={`${sel.puuid}:${c.key}`} card={c} st={st} holders={holders} total={people.length} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

/** 一張徽章卡片。拿到的：等級色的框與圖示、進度條滿格；沒拿到的：灰階圖示、主題色進度條與「還差多少」；還不能算的：鎖頭與缺什麼 */
function BadgeCardView({ card, st, holders, total, index }: { card: BadgeCard; st: BadgeStatus; holders: Player[]; total: number; index: number }) {
  const tier = TIER_CLASS[card.tier]
  const Icon = card.icon
  const got = st.state === "earned"
  const fill = got ? (card.tier === "legend" ? "bg-prismatic" : card.tier === "gold" ? "bg-gold" : "bg-silver") : st.state === "locked" ? "bg-muted-foreground/50" : "bg-primary"
  const shownHolders = holders.slice(0, 4)
  return (
    <div
      data-testid="badge-card"
      data-state={st.state}
      data-badge={card.key}
      style={{ "--stagger": `${Math.min(index * 30, 360)}ms` } as CSSProperties}
      className={cn("rise flex flex-col gap-2 rounded-lg border p-3", got ? cn(tier.badge, "text-foreground") : "bg-card")}
    >
      <div className="flex items-center gap-3">
        <span className={cn("relative flex size-11 shrink-0 items-center justify-center rounded-full", got ? tier.icon : "bg-muted text-muted-foreground")}>
          <Icon className="size-5" strokeWidth={2.25} />
          {st.state === "locked" && (
            <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border bg-card text-muted-foreground">
              <Lock className="size-2.5" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate font-semibold", !got && "text-foreground/85")}>{st.level ?? card.name}</span>
            {got && <Check className="size-4 shrink-0 text-win" strokeWidth={3} />}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {card.tier === "legend" ? "傳說稱號" : card.kind === "title" ? "稱號" : "里程碑"}・好友中 {holders.length}／{total} 人已獲得
          </div>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{card.hint}</p>
      <div className="mt-auto">
        <div className="relative h-2 rounded-full bg-muted">
          <div key={card.key} className={cn("bar-grow absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${Math.round(Math.min(1, Math.max(0, st.ratio)) * 100)}%` }} />
          {st.levels?.map((l) => (
            <span key={l.label} className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground/50" style={{ left: `calc(${l.at * 100}% - 1px)` }} />
          ))}
        </div>
        {st.levels && (
          <div className="relative mt-0.5 h-3.5 font-mono text-[10px] text-muted-foreground">
            {st.levels.map((l) => (
              <span key={l.label} className="absolute tabular-nums" style={{ left: `${l.at * 100}%`, transform: `translateX(${l.at >= 0.99 ? "-100%" : "-50%"})` }}>
                {l.label}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
          <span className="truncate font-mono tabular-nums text-foreground/90">{st.now ?? "—"}</span>
          {!st.levels && <span className="shrink-0 text-muted-foreground">門檻 {st.target}</span>}
        </div>
        <div className={cn("mt-0.5 text-xs", got ? "font-semibold text-win" : st.state === "locked" ? "text-muted-foreground" : "font-medium text-primary")} data-testid="badge-note">
          {st.note}
        </div>
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        {holders.length === 0 ? (
          <span>比較對象裡還沒有人拿到</span>
        ) : (
          <>
            {shownHolders.map((p) => (
              <span key={p.puuid} className="rounded-full border px-1.5 leading-[18px] text-foreground/85">
                {nameOf(p)}
              </span>
            ))}
            {holders.length > shownHolders.length && <span>和另外 {holders.length - shownHolders.length} 人</span>}
          </>
        )}
      </div>
    </div>
  )
}

/** 總覽分頁的「玩家類型」卡片 */
function StyleCard({ style, scored }: { style: PlayStyle; scored: number }) {
  const notable = style.axes
    .filter((a) => a.value !== null && Math.abs(a.value - 50) >= AXIS_LEAN)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  return (
    <div className="rounded-lg border p-3" data-testid="crew-style">
      <div className="text-[11px] text-muted-foreground">玩家類型</div>
      <div className="mt-0.5 text-lg font-semibold">{styleLine(style)}</div>
      {style.archetypeNote && <div className="text-[12px] text-muted-foreground">{style.archetypeNote}</div>}
      <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-[12px] sm:grid-cols-[5.5rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">常玩的出裝</dt>
        <dd>
          {style.mix.slice(0, 4).map((m, i) => (
            <span key={m.label}>
              {i > 0 && "、"}
              {m.label} <span className="font-mono tabular-nums">{pct0(m.share)}</span>
            </span>
          ))}
          {style.favors.length > 0 && (
            <span className="block text-muted-foreground">
              比一般玩家多玩 {style.favors.map((m) => `${m.label}（他 ${pct0(m.share)}，一般 ${pct0(m.base)}）`).join("、")}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">AD／AP</dt>
        <dd>{style.adShare === null ? "—" : `AD 裝 ${pct0(style.adShare)}、AP 裝 ${pct0(1 - style.adShare)}（兩種傷害裝都沒買的純坦、純輔助不算）`}</dd>
        <dt className="text-muted-foreground">英雄池</dt>
        <dd>
          玩過 {style.champCount} 隻，最常玩的 5 隻占 <span className="font-mono tabular-nums">{pct0(style.top5Share)}</span>
          {style.topChamps.length > 0 && <span className="block text-muted-foreground">{style.topChamps.join("、")}</span>}
        </dd>
        <dt className="text-muted-foreground">打法</dt>
        <dd>
          {scored < STYLE_MIN
            ? `有分數的場次不到 ${STYLE_MIN} 場，先不判斷`
            : notable.length
              ? notable.map((a, i) => (
                  <span key={a.label}>
                    {i > 0 && "、"}
                    <span className={(a.value ?? 50) > 50 ? "text-win" : "text-loss"}>{(a.value ?? 50) > 50 ? a.up : a.down}</span>
                    <span className="font-mono text-muted-foreground tabular-nums">（{a.label} {Math.round(a.value ?? 50)}）</span>
                  </span>
                ))
              : "五項都和同類型的中位數差不多"}
          <Hint className="ml-1" text="打法看的是舊的當局表現分各項：和同類型、同時長帶的人比，50＝中位數，所以是「同樣的位置裡他哪裡做得多」；治療護盾只有部分場次有量，不算進來" />
        </dd>
      </dl>
    </div>
  )
}

/** 一句話講這個人整體的情形：只根據看得出的差別 */
function readingOf(p: Profile) {
  const s = p.overall.strength
  const w = p.overallWr ? strengthOf(p.overallWr) : "看不出"
  if (s === "強勢")
    return w === "強勢"
      ? "貢獻比平均高，勝率也明顯高於 50%：打得好也贏得多。"
      : "貢獻比平均高，勝率則和 50% 分不出差別：輸贏很大一部分取決於隊友與隨機拿到的陣容，表現已經到位。"
  if (s === "不強勢")
    return w === "不強勢"
      ? "貢獻還在追趕平均，勝率也還在累積：每一項都還有成長的餘地，是潛力最大的階段。"
      : "貢獻還在追趕平均，勝率卻沒有受影響：和隊友配合得很好。"
  return "本場貢獻和平均差不多，發揮很標準（差距還在誤差內）。"
}

/** 總覽分頁的「看得出的強項／潛力」：只列區間整段在一邊的，其餘只講有幾項 */
function Highlights({
  profile,
  onRole,
  onChamps,
  onChamp,
}: {
  profile: Profile
  onRole: (r: string) => void
  onChamps: () => void
  onChamp: (label: string) => void
}) {
  const ownWr = profile.overall.winrate
  const block = (title: string, s: Strength, tone: string) => {
    const roles = profile.roles.filter((j) => j.strength === s)
    const champs = sideOf(profile.champs, s === "強勢" ? "pos" : "neg").filter((j) => j.strength === s)
    return (
      <div>
        <div className={cn("mb-1 text-[11px] font-semibold", tone)}>{title}</div>
        {!roles.length && !champs.length ? (
          <div className="text-[11px] text-muted-foreground">沒有看得出的（場次不夠，或差距都在誤差內）</div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {roles.map((j) => (
              <button
                key={j.key}
                type="button"
                data-tip={tipOf(j, ownWr)}
                onClick={() => onRole(j.label)}
                className={cn("rounded border px-1.5 py-0.5 text-[11px]", STRENGTH_CLASS[j.strength])}
              >
                {j.label}
              </button>
            ))}
            {champs.slice(0, 8).map((j, i) => (
              <ChampBadge key={j.key} j={j} rank={i + 1} ownWr={ownWr} onClick={() => onChamp(j.label)} />
            ))}
            {champs.length > 8 && (
              <button type="button" onClick={onChamps} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                還有 {champs.length - 8} 隻
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  const leans = [...profile.roles, ...profile.champs]
  const leanUp = leans.filter((j) => j.strength === "偏強").length
  const leanDown = leans.filter((j) => j.strength === "偏弱").length
  return (
    <div className="grid content-start gap-3">
      {block("看得出的強項", "強勢", "text-win")}
      {block("看得出的潛力", "不強勢", "text-loss")}
      <p className="text-[11px] text-muted-foreground">
        另有 {leanUp} 項上手／順手、{leanDown} 項磨合中／摸索中，差距還在誤差內；「出裝與英雄」分頁看得到全部。
      </p>
    </div>
  )
}

/** 出裝定位分頁：一種出裝一列，本場貢獻畫成區間（中線＝所有人的平均 50），右邊是勝率與判定 */
function RoleForest({ profile, selected, onPick }: { profile: Profile; selected: string | null; onPick: (role: string) => void }) {
  const ownWr = profile.overall.winrate
  const far = profile.roles.flatMap((j) => (j.g?.interval ? [Math.abs(j.g.interval[0]), Math.abs(j.g.interval[1])] : []))
  const reach = Math.min(50, Math.max(20, Math.ceil(Math.max(0, ...far) / 10) * 10))
  const total = profile.overall.games
  const cols = "grid-cols-[5.5rem_minmax(8rem,1fr)_2.5rem_3.25rem_minmax(6.5rem,9rem)_7.5rem]"
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        點是他這種出裝的本場貢獻、線是區間（同時比 {profile.roleK} 種出裝，已放寬）；區間整段在中線同一邊才上色。點一列，下面只列他用這種出裝玩過的英雄
      </div>
      <div>
        <div className={cn("grid items-end gap-x-2", cols)}>
          <span />
          <ForestAxis reach={reach} center="平均 50" unit="分" worse="低於平均" better="比平均強" />
          <span className="pb-0.5 text-right text-[10px] text-muted-foreground">貢獻</span>
          <span className="pb-0.5 text-right text-[10px] text-muted-foreground">場次</span>
          <span className="pb-0.5 text-[10px] text-muted-foreground">勝率（刻度＝他自己）</span>
          <span className="pb-0.5 text-[10px] text-muted-foreground">判定</span>
        </div>
        {profile.roles.map((j) => (
          <button
            key={j.key}
            type="button"
            data-testid="role-row"
            data-label={j.label}
            data-strength={j.strength}
            disabled={!j.games}
            onClick={() => onPick(j.label)}
            data-tip={j.games ? tipOf(j, ownWr) : `${j.label}：沒有對局`}
            className={cn(
              "grid w-full items-center gap-x-2 border-b border-border/50 text-left transition last:border-b-0 enabled:hover:bg-accent/60",
              cols,
              selected === j.label && "rounded bg-primary/10 ring-1 ring-primary",
              !j.games && "opacity-50",
            )}
          >
            <span className="truncate pl-1 text-[13px] font-medium">{j.label}</span>
            <ForestTrack
              diff={j.g?.interval ? j.g.diff : null}
              interval={j.g?.interval ?? null}
              clear={!!j.g?.clear}
              reach={reach}
              empty={j.games ? `不到 ${MIN_N} 場` : undefined}
            />
            <span className={cn("text-right font-mono text-[13px] font-semibold tabular-nums", j.g?.interval ? NUM_CLASS[j.strength] : "text-muted-foreground")}>
              {j.score === null ? "—" : Math.round(j.score)}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {j.games}
              {total > 0 && j.games > 0 && <span className="block text-[10px]">{Math.round((100 * j.games) / total)}%</span>}
            </span>
            {j.games ? (
              <RecordCell winrate={j.winrate} wins={j.wins} losses={j.games - j.wins} baseline={ownWr} baselineLabel="他自己的整體勝率" />
            ) : (
              <span />
            )}
            {j.games ? <StrengthChip j={j} /> : <span className="text-[11px] text-muted-foreground">沒打過</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 抽屜：某個人的完整分析，分成「總覽」與「出裝與英雄」兩個分頁 */
function PlayerDrawerBody({
  player,
  profile,
  role,
  onRole,
  tab,
  onTab,
  crewFilter,
  jumpChamp,
  titles,
}: {
  player: Player
  profile: Profile
  /** 這個人在目前比較對象裡拿到的稱號與里程碑 */
  titles?: Title[]
  role: string | null
  onRole: (role: string | null) => void
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  crewFilter: (puuids: string[]) => CubeFilter
  /** 從一覽表點英雄頭像打開時：直接展開那隻英雄的每一場 */
  jumpChamp?: string
}) {
  const { apply, setAccount } = useFilters()
  const go = useNavigate()
  const settled = useDrawerSettled()
  const [sortBy, setSortBy] = useState<"score" | "games">("score")
  const [onlyClear, setOnlyClear] = useState(false)
  // 進場的滑入動畫只在第一次列出時播：切換排序或篩選時列會重新排列，React 搬動 DOM 節點會讓 CSS 動畫重播，
  // 整張清單看起來在跳來跳去
  const [reordered, setReordered] = useState(false)
  // 切到「只看看得出的」時清單一下變短，捲動位置會被擠回頂端；那時先把清單區撐在原本的高度
  const listRef = useRef<HTMLDivElement>(null)
  const [listMinH, setListMinH] = useState<number | undefined>(undefined)
  // 點英雄列展開那隻英雄的每一場（同時只開一隻，免得被好幾份列表撐得很長）
  const [openChamp, setOpenChamp] = useState<string | null>(null)
  useCrumb(20, openChamp ? `${openChamp}的每一場` : null, () => setOpenChamp(null))
  const ownWr = profile.overall.winrate
  const own: Own = { score: profile.overall.score, winrate: ownWr }
  const roleFilter = role ? [{ member: "builds.build_role", operator: "equals" as const, values: [role] }] : []
  const centerFilters = useContext(CenterFilterContext)
  const contrib = useCube(
    centerFilters === null ? null : apply({ measures: WORK_MEASURES, filters: [crewFilter([player.puuid]), ...roleFilter, ...centerFilters], limit: 1 }, "all"),
  )
  const champs = useCube(
    centerFilters === null ? null : apply(
      {
        measures: STAT_MEASURES,
        dimensions: ["champions.name", "champions.icon_path"],
        filters: [crewFilter([player.puuid]), ...roleFilter, ...centerFilters],
        order: { "participants.games": "desc" },
        limit: NO_LIMIT,
      },
      "all",
    ),
  )
  // 英雄分頁的判斷：沒選出裝時和一覽表用同一份（profile.champs），選了出裝才用這裡查的那一組重新判斷
  const champJudged = useMemo(() => {
    if (!role) return { k: profile.champK, items: profile.champs }
    return judgeAll(
      champs.rows.map((r) => statOf(r, String(r["champions.name"]), String(r["champions.name"]), r["champions.icon_path"] as string)),
      own,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, champs.rows, profile])
  const champRows = useMemo(() => {
    const list = champJudged.items.filter((j) => j.games > 0 && (!onlyClear || isClear(j.strength) || wrFlag(j)))
    return [...list].sort((a, b) =>
      sortBy === "games"
        ? b.games - a.games || (b.est ?? 0) - (a.est ?? 0)
        : (b.est ?? -1) - (a.est ?? -1) || b.games - a.games || a.label.localeCompare(b.label, "zh-Hant"),
    )
  }, [champJudged, sortBy, onlyClear])

  // 橫向長條點一隻英雄：清單裡展開那一列（被「只看看得出的」藏起來就先放回全部），再捲過去
  const jumpToChamp = (label: string, delay = 60) => {
    onTab("picks")
    setOnlyClear(false)
    setListMinH(undefined)
    setOpenChamp(label)
    setTimeout(() => {
      document.querySelector(`[data-row-key="${CSS.escape(label)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })
    }, delay)
  }
  // 抽屜剛打開時要等它滑進來（約 300ms）、清單畫出來，再捲過去
  useEffect(() => {
    if (jumpChamp) jumpToChamp(jumpChamp, 450)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpChamp])
  const pickRole = (r: string | null) => {
    onRole(r)
    onTab("picks")
  }
  const ov = profile.overall
  const wrAll = profile.overallWr
  const champCols = "grid-cols-[1.5rem_minmax(8rem,1fr)_3rem_minmax(8rem,11rem)_minmax(7rem,10rem)_2.25rem_6.5rem]"
  // 英雄清單裡的貢獻區間共用一把尺：取所有區間最遠的一端，進位到 10，介於 20～50
  const champReach = Math.min(
    50,
    Math.max(20, Math.ceil(Math.max(0, ...champJudged.items.flatMap((j) => (j.g?.interval ? [Math.abs(j.g.interval[0]), Math.abs(j.g.interval[1])] : []))) / 10) * 10),
  )

  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as DrawerTab)} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="overview">總覽</TabsTrigger>
          <TabsTrigger value="picks">出裝與英雄</TabsTrigger>
        </TabsList>
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

      {/* ── 總覽：整體的兩個數字、一句解讀、出裝雷達、看得出的強弱 ── */}
      <TabsContent value="overview" className="reveal space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCard
            title="本場貢獻"
            main={ov.score === null ? "—" : String(Math.round(ov.score))}
            sub={
              ov.g?.interval
                ? `95% 區間 ${Math.round(50 + ov.g.interval[0])}～${Math.round(50 + ov.g.interval[1])}・${ov.scored} 場`
                : `${ov.scored} 場`
            }
            strength={ov.strength}
            label={labelOf(ov)}
            cls={levelClass(ov)}
            note="每場只和同一場另外九個人比工作量（輸出、承傷、控場、治療護盾，權重依終場裝備），50＝所有人的平均；死亡不扣分。標 * 的暫估場次（沒有賽後統計）也算在內"
          />
          <SummaryCard
            title="勝率"
            main={ov.winrate === null ? "—" : `${ov.winrate.toFixed(1)}%`}
            sub={
              wrAll?.interval
                ? `95% 區間 ${Math.round(50 + wrAll.interval[0])}～${Math.round(50 + wrAll.interval[1])}%・${ov.wins} 勝 ${ov.games - ov.wins} 敗`
                : `${ov.wins} 勝 ${ov.games - ov.wins} 敗`
            }
            strength={wrAll ? strengthOf(wrAll) : "看不出"}
            label={WR_SHOWN[wrAll ? strengthOf(wrAll) : "看不出"]}
            note="和 50% 比。好友多半一起打、勝率會互相牽動，用來比人不太準"
          />
        </div>
        <p className="text-sm" data-testid="crew-reading">
          {readingOf(profile)}
        </p>
        {!!titles?.length && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="text-[11px] text-muted-foreground">稱號</span>
            <TitleBadges titles={titles} size="lg" />
            <span className="text-[11px] text-muted-foreground">滑過看數字；稱號是累積到門檻就有，滑過看條件</span>
          </div>
        )}
        <StyleCard style={profile.style} scored={ov.scored} />
        <div className="grid gap-4 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center gap-1 text-sm font-semibold">
              各出裝
              <Hint text="形狀是各出裝佔他場次的比例；顏色和一覽表一樣是本場貢獻的判定，標籤下是本場貢獻・場次與勝率。點一種出裝看他用它玩過的英雄" />
            </div>
            <RoleHex roles={profile.roles} total={ov.games} selected={role} onPick={(r) => pickRole(r)} />
          </div>
          <Highlights profile={profile} onRole={(r) => pickRole(r)} onChamps={() => onTab("picks")} onChamp={(label) => jumpToChamp(label, 150)} />
        </div>
        {/* 貢獻分解：本場貢獻的四項與加分（選了出裝就只看那種出裝） */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold">
            貢獻分解{role ? `・出裝是${role}時` : "・所有出裝"}
          </div>
          <div className="text-[12px]">
            本場貢獻 <ContribScore dev={dev(contrib.rows[0])} gap={WORK_GAP} className="text-base font-semibold" />
          </div>
        </div>
        <div className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          每一項和同一場另外九個人比，50＝參考量
          <Hint text={"每一項都是每分鐘的量，和同一場另外九個人比：參考量是其他九人的量依裝備職責分到他的份，等於參考量是 50、兩倍約 67，雷達裡的虛線圈與橫條中間的刻度就是 50。\n權重看終場裝備的連續比例（輸出裝重輸出、坦裝重承傷、輔助裝重治療護盾，控場每種都有一點），不用英雄名稱（只有射手英雄依 AD 裝比例另加最多約 2.5 分，補控場少、站後排的落差）；權重低的工作做到超過參考量另有加分，清兵、推塔另有最多 6 分。\n死亡不扣分。治療護盾隊友的量只有賽後統計有，沒有的場次改用含自補的治療量（暫估）"} />
        </div>
        {!settled || contrib.loading ? (
          <LoadingBlock height={300} label="載入貢獻分解…" />
        ) : contrib.error ? (
          <div className="text-sm text-destructive">{contrib.error}</div>
        ) : (
          // 雷達看形狀（哪幾項突出、哪幾項是洞），橫條看每一項的確切數字與說明，兩個都留
          <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ContribRadarChart
              data={WORK_PARTS.map((c) => ({ label: c.label, hint: c.hint, value: opt(contrib.rows[0], c.key) }))}
              gap={WORK_GAP}
              height={300}
            />
            <ContribBars row={contrib.rows[0]} kind="work" />
          </div>
        )}
      </div>
      </TabsContent>

      {/* ── 出裝與英雄：上面各種出裝的區間，點一種出裝下面只列那種出裝的英雄；英雄點一列看每一場 ── */}
      <TabsContent value="picks" className="reveal space-y-5">
        <RoleForest profile={profile} selected={role} onPick={(r) => onRole(role === r ? null : r)} />
        <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
          <div className="text-sm font-semibold">{role ? `出裝是${role}時玩過的英雄` : "玩過的每隻英雄"}</div>
          {role && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRole(null)}>
              看全部出裝
            </Button>
          )}
        </div>
        {!(role && (!settled || champs.loading)) && (
          <div className="grid gap-2">
            <ChampStrip title="比平均強的英雄" tone="pos" items={sideOf(champJudged.items, "pos")} ownWr={ownWr} onPick={jumpToChamp} />
            <ChampStrip title="還在培養的英雄" tone="neg" items={sideOf(champJudged.items, "neg")} ownWr={ownWr} onPick={jumpToChamp} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            依{sortBy === "score" ? "本場貢獻" : "場次"}排
            <Hint
              text={`${sortBy === "score" ? "本場貢獻往他自己的平均收縮過，一兩場的不會排到最前面。" : ""}判定的區間依同時比了 ${champJudged.k} 隻（${MIN_N} 場以上）放寬，所以單隻英雄很難看得出差別`}
            />
          </div>
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" size="sm" variant="outline" value={sortBy} onValueChange={(v) => {
                if (!v) return
                setReordered(true)
                setSortBy(v as "score" | "games")
              }}>
              <ToggleGroupItem value="score" className="h-7 px-2 text-xs">依貢獻</ToggleGroupItem>
              <ToggleGroupItem value="games" className="h-7 px-2 text-xs">依場次</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" size="sm" variant="outline" value={onlyClear ? "clear" : "all"} onValueChange={(v) => {
                if (!v) return
                setReordered(true)
                setListMinH(v === "clear" ? listRef.current?.offsetHeight : undefined)
                setOnlyClear(v === "clear")
              }}>
              <ToggleGroupItem value="all" className="h-7 px-2 text-xs">全部</ToggleGroupItem>
              <ToggleGroupItem value="clear" className="h-7 px-2 text-xs">只看看得出的</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div ref={listRef} style={{ minHeight: onlyClear ? listMinH : undefined }}>
        {role && (!settled || champs.loading) ? (
          <LoadingBlock height={320} label="載入英雄戰績…" />
        ) : role && champs.error ? (
          <div className="text-sm text-destructive">{champs.error}</div>
        ) : !champRows.length ? (
          <EmptyState>{onlyClear ? "沒有看得出差別的英雄：場次不夠，或差距都在誤差內。" : "這個條件下沒有對局。"}</EmptyState>
        ) : (
          <div className="space-y-1">
            <div className={cn("grid gap-3 px-2 text-[11px] text-muted-foreground", champCols)}>
              <span>#</span>
              <span>英雄（點一列看每一場）</span>
              <span>場次</span>
              <span>勝率（刻度＝他自己）</span>
              <span className="text-center">本場貢獻（中線＝50）</span>
              <span />
              <span>判定</span>
            </div>
            {champRows.map((j, i) => {
              const open = openChamp === j.label
              return (
                <Fragment key={j.key}>
                  <ExpandRow
                    open={open}
                    onToggle={() => setOpenChamp(open ? null : j.label)}
                    label={j.label}
                    rowKey={j.label}
                    style={{ "--stagger": `${Math.min(i * 30, 400)}ms` } as CSSProperties}
                    className={cn(!reordered && "slide-in", "grid items-center gap-3 rounded-md px-2 py-1.5", champCols)}
                  >
                    <span className="text-right font-mono text-[11px] font-bold tabular-nums text-muted-foreground" data-testid="pick-rank">
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5" data-tip={tipOf(j, ownWr)}>
                      <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                      <img src={iconUrl(j.icon)} alt="" className="size-8 shrink-0 rounded-md bg-icon-tile" />
                      <span className="truncate text-[13px] font-medium">{j.label}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{j.games} 場</span>
                    <RecordCell winrate={j.winrate} wins={j.wins} losses={j.games - j.wins} baseline={ownWr} baselineLabel="他自己的整體勝率" />
                    <ForestTrack
                      diff={j.g?.interval ? j.g.diff : null}
                      interval={j.g?.interval ?? null}
                      clear={!!j.g?.clear}
                      reach={champReach}
                      empty={`不到 ${MIN_N} 場`}
                    />
                    <span className={cn("text-right font-mono text-[13px] font-semibold tabular-nums", j.g?.interval ? NUM_CLASS[j.strength] : "text-muted-foreground")}>
                      {j.score === null ? "—" : Math.round(j.score)}
                    </span>
                    <StrengthChip j={j} />
                  </ExpandRow>
                  {open && (
                    <div className="reveal mb-2 ml-3 border-l-2 border-primary/40 pl-3">
                      <PlayerMatches
                        puuid={player.puuid}
                        filters={[{ member: "champions.name", operator: "equals", values: [j.label] }, ...roleFilter]}
                      />
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        )}
        </div>
        </div>
      </TabsContent>

    </Tabs>
  )
}

type LookupOption = { name: string; icon: string; games: number; players: number }

/** 英雄／增幅選擇器：可搜尋，依「幾個人用過、合計幾場」排序 */
function LookupPicker({
  options,
  value,
  onChange,
  kind,
}: {
  options: LookupOption[]
  value: string | null
  onChange: (name: string) => void
  kind: LookupKind
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.name === value)
  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-[280px] justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {current ? (
              <img src={iconUrl(current.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
            <span className="truncate">{current?.name ?? `選一${kind.counter}${kind.noun}`}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`搜尋${kind.noun}名稱…`} />
          <CommandList>
            <CommandEmpty>這群人都沒{kind.verb}過這{kind.counter}。</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.name}
                value={o.name}
                onSelect={() => pick(o.name)}
                // 同 AccountSwitcher：這版 cmdk 的 onSelect 在某些包法下不觸發，點擊路徑另外接上
                onClick={() => pick(o.name)}
                className="gap-2"
              >
                <img src={iconUrl(o.icon)} alt="" className="size-6 shrink-0 rounded bg-icon-tile" />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {o.players} 人・{o.games} 場
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** 「查英雄」「查增幅裝置」的差別：查哪個維度、用什麼量詞與動詞。其餘完全一樣。 */
type LookupKind = {
  title: string
  /** Panel 下面那一句；完整說明（caption）收進 ⓘ */
  short: string
  caption: string
  noun: string
  counter: string
  verb: string
  nameKey: string
  iconKey: string
}

/** 選一個東西（一隻英雄、一個增幅），看這群人各自用它的戰績；點一列開抽屜看他用它的每一場。 */
function LookupPanel({
  kind,
  rows,
  loading,
  people,
  puuids,
  wrOf,
  active,
  onOpen,
}: {
  kind: LookupKind
  rows: CubeRow[]
  loading: boolean
  people: Player[]
  puuids: string[]
  wrOf: (puuid: string) => number | null
  /** 抽屜開著的那一格，原頁面亮著它 */
  active: { puuid: string; key: string } | null
  onOpen: (games: GamesFocus) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)

  // 選項是這群人用過的東西，依「幾個人用過、合計幾場」排
  const options = useMemo(() => {
    const m = new Map<string, LookupOption>()
    for (const r of rows) {
      if (!puuids.includes(String(r["participants.puuid"]))) continue
      const name = String(r[kind.nameKey])
      const cur = m.get(name) ?? { name, icon: r[kind.iconKey] as string, games: 0, players: 0 }
      cur.games += n0(r, "participants.games")
      cur.players += 1
      m.set(name, cur)
    }
    return [...m.values()].sort((a, b) => b.players - a.players || b.games - a.games)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, puuids.join(), kind])
  const value = picked && options.some((o) => o.name === picked) ? picked : (options[0]?.name ?? null)

  const byPlayer = people
    .map((p) => {
      const r = rows.find((x) => x["participants.puuid"] === p.puuid && x[kind.nameKey] === value)
      const base = wrOf(p.puuid)
      const games = n0(r, "participants.games")
      const wins = n0(r, "participants.wins")
      const wr = games ? (100 * wins) / games : null
      return {
        player: p,
        games,
        wins,
        losses: n0(r, "participants.losses"),
        winrate: wr,
        base,
        delta: games && base !== null ? shrunk(games, wr, base) - base : null,
        perf: games ? dev(r) : null,
      }
    })
    .sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0))
  const played = byPlayer.filter((r) => r.games)
  const total = played.reduce((a, r) => a + r.games, 0)
  const wins = played.reduce((a, r) => a + r.wins, 0)

  return (
    <Panel title={kind.title} caption={kind.short} hint={kind.caption}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <LookupPicker options={options} value={value} onChange={setPicked} kind={kind} />
        {value && (
          <span className="text-xs text-muted-foreground">
            {played.length} 人{kind.verb}過・合計 {total} 場・{wins} 勝 {total - wins} 敗
          </span>
        )}
      </div>
      {loading ? (
        <LoadingBlock height={320} label="載入中…" />
      ) : !value ? (
        <EmptyState>這群人還沒有對局。</EmptyState>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(8rem,14rem)_4.5rem_4.5rem] gap-3 px-2 text-[11px] text-muted-foreground">
            <span>玩家</span>
            <span>場次</span>
            <span>戰績</span>
            <span className="text-right">勝率</span>
            <span className="text-right">貢獻</span>
          </div>
          {byPlayer.map((r, i) => {
            const cellKey = `${kind.nameKey}=${value}`
            const isActive = active?.puuid === r.player.puuid && active.key === cellKey
            const name = splitId(r.player.riot_id, r.player.puuid).name
            const rowClass = "slide-in grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(8rem,14rem)_4.5rem_4.5rem] items-center gap-3 rounded-md px-2 py-1.5"
            const style = { "--stagger": `${i * 35}ms` } as CSSProperties
            const cells = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <PlayerName player={r.player} className="text-[13px]" />
                  {!!r.games && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{r.games ? `${r.games} 場` : ""}</span>
                {r.games ? (
                  <RecordCell winrate={r.winrate} wins={r.wins} losses={r.losses} baseline={r.base} baselineLabel="他自己的整體勝率" />
                ) : (
                  <span className="text-xs text-muted-foreground">沒{kind.verb}過</span>
                )}
                <span
                  className={cn(
                    "text-right font-mono text-[11px] tabular-nums",
                    r.delta === null || Math.abs(r.delta) < 2 ? "text-muted-foreground" : r.delta > 0 ? "text-win" : "text-loss",
                  )}
                >
                  {r.delta === null ? "" : `${signed(r.delta)}pp`}
                </span>
                <span className="text-right text-[12px]">{r.perf === null ? "" : <ContribScore dev={r.perf} gap={WORK_GAP} />}</span>
              </>
            )
            // 沒用過的人沒有東西可看，維持一般的列
            if (!r.games) {
              return (
                <div key={r.player.puuid} style={style} className={cn(rowClass, "opacity-60")}>
                  {cells}
                </div>
              )
            }
            return (
              <button
                key={r.player.puuid}
                type="button"
                data-testid="lookup-row"
                data-tip={`看${name}${kind.verb}${value}的每一場`}
                style={style}
                onClick={() =>
                  onOpen({
                    title: `${name}${kind.verb}${value}的每一場`,
                    note: `${r.games} 場・${r.wins} 勝 ${r.losses} 敗`,
                    cell: { puuid: r.player.puuid, key: cellKey },
                    source: { puuid: r.player.puuid, filters: [{ member: kind.nameKey, operator: "equals", values: [value] }] },
                  })
                }
                className={cn(rowClass, "w-full text-left transition hover:bg-accent", isActive && "bg-primary/10 hover:bg-primary/15")}
              >
                {cells}
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

const CHAMPION_LOOKUP: LookupKind = {
  title: "查英雄",
  short: "選一隻英雄，看每個人玩它的戰績",
  caption:
    "選一隻英雄，看每個人玩它的戰績；點一列開抽屜看他玩這隻英雄的每一場。「勝率」是和他自己整體勝率的差距（依場次收縮後），戰績條的刻度也是他自己的整體勝率；「貢獻」是這幾場的本場貢獻平均（50＝所有人的平均）",
  noun: "英雄",
  counter: "隻",
  verb: "玩",
  nameKey: "champions.name",
  iconKey: "champions.icon_path",
}

const AUGMENT_LOOKUP: LookupKind = {
  title: "查增幅裝置",
  short: "選一個增幅裝置，看每個人拿它的戰績",
  caption:
    "選一個增幅裝置，看每個人拿它的戰績；點一列開抽屜看他拿到它的每一場。欄位的意思和「查英雄」一樣。一場會拿好幾個增幅，同一場會同時出現在它拿到的每個增幅底下，所以各增幅的場次不能加總",
  noun: "增幅",
  counter: "個",
  verb: "拿",
  nameKey: "augments.name",
  iconKey: "augments.icon_path",
}

// ── 數據總表：每個人的各項平均，分成幾組切換 ─────────────────────────────────
// 都是「每場先算再平均」的語意層度量；比人時要記得出裝比例不同（射手天生打塔快、坦克天生承傷多），所以最後一組是出裝比例。
// 對小兵傷害對局資料沒有，用「總輸出 − 對英雄 − 對建築」估計；死亡時間只有賽後統計有（2026-10-03 起）。
type StatCol = { key: string; label: string; fmt: (v: number) => string; hint: string; lower?: boolean; record?: boolean }
const int = (v: number) => Math.round(v).toLocaleString()
const pctFmt = (v: number) => `${v.toFixed(1)}%`
const mmssFmt = (v: number) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`
/** matches.avg_duration 的單位是分鐘；畫面統一顯示成遊戲內時鐘 mm:ss。 */
const durationFmt = (minutes: number) => {
  const seconds = Math.round(minutes * 60)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
const STAT_SETS: { id: string; label: string; caption: string; cols: StatCol[] }[] = [
  {
    id: "overview",
    label: "整體",
    caption: "先看每個人的樣本量與平均遊戲時長；時長是每場對局長度的平均，不是把所有分鐘加總",
    cols: [
      { key: "matches.avg_duration", label: "平均遊戲時長", fmt: durationFmt, hint: "每場遊戲長度的平均，顯示為 mm:ss" },
    ],
  },
  {
    id: "dmg",
    label: "輸出",
    caption: "對英雄的傷害。傷害占全隊是零和的（五個人加起來 100%），和強的朋友同隊會被分走",
    cols: [
      { key: "participants.avg_damage", label: "平均對英雄傷害", fmt: int, hint: "每場平均對英雄造成的傷害" },
      { key: "participants.dpm", label: "每分鐘對英雄傷害", fmt: int, hint: "每場對英雄傷害除以對局分鐘數再平均" },
      { key: "participants.damage_share", label: "傷害占全隊", fmt: pctFmt, hint: "對英雄傷害占我方全隊的比例" },
      { key: "participants.damage_per_gold", label: "每塊錢傷害", fmt: (v) => v.toFixed(2), hint: "對英雄傷害除以獲得金錢：錢有沒有換成輸出" },
      { key: "participants.champion_damage_focus", label: "打在英雄上的比例", fmt: pctFmt, hint: "總輸出裡有多少打在英雄身上，偏低代表花很多時間在清兵、打塔" },
    ],
  },
  {
    id: "tank",
    label: "承傷與存活",
    caption: "承受傷害高不一定是壞事：前排本來就要吃傷害，要和死亡一起看",
    cols: [
      { key: "participants.avg_taken", label: "平均承受傷害", fmt: int, hint: "每場平均承受的總傷害" },
      { key: "participants.taken_per_min", label: "每分鐘承受傷害", fmt: int, hint: "每場承受傷害除以對局分鐘數再平均" },
      { key: "participants.tank_share", label: "承傷占全隊", fmt: pctFmt, hint: "承受傷害占我方全隊的比例" },
      { key: "participants.mitigated_per_min", label: "每分鐘減免傷害", fmt: int, hint: "護甲、魔抗、護盾等擋掉的傷害，每分鐘" },
      { key: "participants.avg_deaths", label: "平均死亡", fmt: (v) => v.toFixed(1), hint: "每場平均死亡次數（越少越好）", lower: true },
      { key: "participants.avg_time_dead", label: "平均死亡時間", fmt: mmssFmt, hint: "每場在死亡倒數裡的總時間（越少越好）。對局資料沒有，只算有賽後統計的場次（2026-10-03 起、採集器有抓到賽後畫面的）", lower: true },
      { key: "participants.time_dead_share", label: "死亡時間占全場", fmt: pctFmt, hint: "死亡總時間占全場時間的比例（越少越好），同樣只算有賽後統計的場次", lower: true },
    ],
  },
  {
    id: "fight",
    label: "團戰",
    caption: "參與擊殺、控場與治療：輔助、坦克的貢獻多半在這裡",
    cols: [
      { key: "participants.kda", label: "KDA", fmt: (v) => v.toFixed(2), hint: "(擊殺＋助攻) ÷ 死亡" },
      { key: "participants.avg_kills", label: "平均擊殺", fmt: (v) => v.toFixed(1), hint: "每場平均擊殺" },
      { key: "participants.avg_assists", label: "平均助攻", fmt: (v) => v.toFixed(1), hint: "每場平均助攻" },
      { key: "participants.kill_participation", label: "參團率", fmt: pctFmt, hint: "(擊殺＋助攻) ÷ 隊伍擊殺" },
      { key: "participants.cc_time_per_min", label: "每分鐘控場", fmt: (v) => `${v.toFixed(1)} 秒`, hint: "每分鐘控制敵人的時間" },
      { key: "participants.heal_per_min", label: "每分鐘治療", fmt: int, hint: "每分鐘治療量（含自補）" },
      { key: "participants.multikill_rate", label: "多殺場次率", fmt: pctFmt, hint: "有雙殺以上的場次比例" },
    ],
  },
  {
    id: "peak",
    label: "單場巔峰",
    caption: "每個人最極端的一場：這組是紀錄榜，不是穩定表現評分；死亡相關數字越高只代表曾經死得更密集",
    cols: [
      { key: "participants.max_kills", label: "單場最高擊殺", fmt: int, hint: "範圍內單場最高擊殺數", record: true },
      { key: "participants.max_deaths", label: "單場最高死亡", fmt: int, hint: "範圍內單場最高死亡數；極端紀錄，不代表表現較好", record: true },
      {
        key: "participants.max_deaths_per_min",
        label: "單場最高每分鐘死亡",
        fmt: (v) => v.toFixed(2),
        hint: "範圍內單場最高每分鐘死亡數；極端紀錄，不代表表現較好",
        record: true,
      },
      { key: "participants.max_assists", label: "單場最高助攻", fmt: int, hint: "範圍內單場最高助攻數", record: true },
      { key: "participants.max_damage", label: "單場最高對英雄傷害", fmt: int, hint: "範圍內單場對英雄造成的最高傷害", record: true },
      { key: "participants.max_dpm", label: "單場最高每分鐘傷害", fmt: int, hint: "範圍內單場最高每分鐘對英雄傷害", record: true },
      { key: "participants.max_objective_damage", label: "單場最高推塔傷害", fmt: int, hint: "範圍內單場對建築造成的最高傷害", record: true },
      { key: "participants.max_cc", label: "單場最高控場時間", fmt: (v) => `${Math.round(v)} 秒`, hint: "範圍內單場最高控場時間", record: true },
      { key: "participants.max_largest_spree", label: "單場最高連殺", fmt: int, hint: "範圍內單場最高連續擊殺數", record: true },
      { key: "participants.max_largest_multi_kill", label: "單場最高多殺", fmt: (v) => `${Math.round(v)} 殺`, hint: "雙殺為 2、三殺為 3，依此類推", record: true },
      { key: "participants.max_duration", label: "單場最高時長", fmt: durationFmt, hint: "範圍內單場最長對局時間，顯示為 mm:ss", record: true },
      { key: "participants.max_taken", label: "單場最高承受傷害", fmt: int, hint: "範圍內單場承受的最高總傷害", record: true },
      { key: "participants.max_mitigated", label: "單場最高減免傷害", fmt: int, hint: "範圍內單場透過防禦與其他效果減免的最高傷害", record: true },
      { key: "participants.max_heal", label: "單場最高治療量", fmt: int, hint: "範圍內單場最高總治療量，包含自我治療", record: true },
      { key: "participants.max_gpm", label: "單場最高每分鐘經濟", fmt: int, hint: "範圍內單場最高每分鐘獲得金錢", record: true },
      { key: "participants.max_cs", label: "單場最高補兵", fmt: int, hint: "範圍內單場最高擊殺小兵數", record: true },
      { key: "participants.max_turret_kills", label: "單場最高防禦塔擊殺", fmt: int, hint: "範圍內單場親手摧毀的最高防禦塔數", record: true },
      { key: "participants.max_penta_kills", label: "單場最高五殺次數", fmt: int, hint: "範圍內單場最高五殺次數", record: true },
      { key: "participants.max_crit", label: "單場最高單次暴擊傷害", fmt: int, hint: "範圍內單場最高單次暴擊傷害", record: true },
      // 每分鐘版本：和上面的總量不同單位，短局不會因為打得久而佔便宜（算式同每分鐘平均，見 participants.yml）
      { key: "participants.best_kills_per_min", label: "單場最高每分鐘擊殺", fmt: (v) => v.toFixed(2), hint: "範圍內每分鐘擊殺最高的那一場", record: true },
      { key: "participants.best_assists_per_min", label: "單場最高每分鐘助攻", fmt: (v) => v.toFixed(2), hint: "範圍內每分鐘助攻最高的那一場", record: true },
      { key: "participants.best_taken_per_min", label: "單場最高每分鐘承受傷害", fmt: int, hint: "範圍內每分鐘承受傷害最高的那一場", record: true },
      { key: "participants.best_mitigated_per_min", label: "單場最高每分鐘減免傷害", fmt: int, hint: "範圍內每分鐘減免傷害最高的那一場", record: true },
      { key: "participants.best_heal_per_min", label: "單場最高每分鐘治療", fmt: int, hint: "範圍內每分鐘治療量（含自補）最高的那一場", record: true },
      { key: "participants.best_cc_time_per_min", label: "單場最高每分鐘控場", fmt: (v) => `${v.toFixed(1)} 秒`, hint: "範圍內每分鐘控場時間最高的那一場", record: true },
      { key: "participants.best_cs_per_min", label: "單場最高每分鐘補兵", fmt: (v) => v.toFixed(1), hint: "範圍內每分鐘補兵最高的那一場", record: true },
      { key: "participants.best_objective_damage_per_min", label: "單場最高每分鐘建築傷害", fmt: int, hint: "範圍內每分鐘對建築傷害最高的那一場", record: true },
      { key: "participants.best_minion_damage_per_min", label: "單場最高每分鐘小兵傷害（估）", fmt: int, hint: "範圍內每分鐘小兵傷害（估）最高的那一場", record: true },
    ],
  },
  {
    id: "push",
    label: "推進與資源",
    caption: "大亂鬥是團戰贏了之後推塔決勝，拆塔是把優勢換成勝利的那一步。射手天生打塔快，比人時看「出裝比例」那組",
    cols: [
      { key: "participants.objective_damage_share", label: "建築傷害占全隊", fmt: pctFmt, hint: "對建築的傷害佔我方全隊的比例，每場先算再平均。最能看出「隊上誰在拆塔」" },
      { key: "participants.avg_objective_damage", label: "平均對塔傷害", fmt: int, hint: "每場平均對防禦塔、兵營、主堡的傷害" },
      { key: "participants.avg_turret_kills", label: "每場推塔", fmt: (v) => v.toFixed(2), hint: "每場親手摧毀（最後一擊）的防禦塔數" },
      { key: "participants.total_turret_kills", label: "推塔總數", fmt: int, hint: "範圍內親手摧毀的防禦塔總數（場次多的人自然多）" },
      { key: "participants.avg_inhibitor_kills", label: "每場兵營", fmt: (v) => v.toFixed(2), hint: "每場親手摧毀的兵營數" },
      { key: "participants.avg_minion_damage", label: "平均小兵傷害", fmt: int, hint: "估計值：總輸出 − 對英雄傷害 − 對建築傷害（大亂鬥沒有野怪，剩下的幾乎都是小兵）" },
      { key: "participants.cs_per_min", label: "每分鐘補兵", fmt: (v) => v.toFixed(1), hint: "每分鐘擊殺的小兵數" },
      { key: "participants.gpm", label: "每分鐘經濟", fmt: int, hint: "每分鐘獲得的金錢" },
      { key: "participants.gold_share", label: "經濟占全隊", fmt: pctFmt, hint: "獲得金錢占我方全隊的比例" },
    ],
  },
]
const STAT_MEASURES_ALL = ["participants.games", "participants.time_dead_games", ...STAT_SETS.flatMap((g) => g.cols.map((c) => c.key))]

/** 格子點開之後，抽屜裡的說明：這一欄是怎麼算的、列出的是哪些場 */
function cellNote(c: StatCol) {
  if (c.key.startsWith("mix:")) return `出裝是${c.key.slice(4)}的場次`
  if (c.key.includes("time_dead")) return "這一欄只算有賽後統計的場次；列表是範圍內全部的場次，舊場次沒有死亡時間"
  if (c.record) return "只顯示創下這項單場紀錄的那一場"
  return "這一欄是列出的這些場次的平均"
}

function StatsPanel({
  people,
  rows,
  loading,
  profiles,
  scoped,
  centers,
  active,
  onOpen,
}: {
  people: Player[]
  rows: CubeRow[]
  loading: boolean
  profiles: Map<string, Profile>
  scoped: (query: CubeQuery) => CubeQuery | null
  centers: Player[]
  /** 抽屜開著的那一格，原頁面亮著它 */
  active: { puuid: string; key: string } | null
  onOpen: (games: GamesFocus) => void
}) {
  const [setId, setSetId] = useState<string>("overview")
  const [sortKey, setSortKey] = useState<string>("participants.avg_damage")
  const isMix = setId === "mix"
  // 「單場前 10 場」用的是單場巔峰那一組的指標，只是換成每場一列的看法
  const isTop = setId === "top"
  const set = STAT_SETS.find((g) => g.id === (isTop ? "peak" : setId))
  // 出裝比例那組：六種出裝各占幾成（AD／AP 寫在玩家類型裡，這裡不另列）
  const mixCols: StatCol[] = BUILD_ROLES.map((r) => ({ key: `mix:${r}`, label: r, fmt: (v: number) => `${Math.round(v * 100)}%`, hint: `出裝是${r}的場次比例` }))
  const cols = isMix ? mixCols : (set?.cols ?? [])
  const rowOf = (puuid: string) => rows.find((r) => r["participants.puuid"] === puuid)
  const valueOf = (puuid: string, key: string): number | null => {
    if (key.startsWith("mix:")) return profiles.get(puuid)?.style.mix.find((m) => m.label === key.slice(4))?.share ?? 0
    return opt(rowOf(puuid), key)
  }
  const activeSort = cols.some((c) => c.key === sortKey) ? sortKey : cols[0]?.key
  const lowerSort = cols.find((c) => c.key === activeSort)?.lower
  const sorted = [...people].sort((a, b) => {
    const va = valueOf(a.puuid, activeSort)
    const vb = valueOf(b.puuid, activeSort)
    if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1
    return lowerSort ? va - vb : vb - va
  })
  // 每欄最好的人標綠；死亡類越少越好。出裝比例不是好壞，不標
  const best = new Map(
    cols.map((c) => {
      const vals = people.map((p) => valueOf(p.puuid, c.key)).filter((v): v is number => v !== null)
      return [c.key, isMix || c.record || !vals.length ? null : c.lower ? Math.min(...vals) : Math.max(...vals)]
    }),
  )
  return (
    <Panel
      title="數據總表"
      caption="每個人的各項平均與單場巔峰；點數字看算進去的每一場"
      hint={"每個人的各項平均（每場先算再平均），另有單場巔峰紀錄。切換上方的分組看不同面向；點欄位標題換排序，點數字開抽屜看算進去的每一場；平均表現的最佳值標綠，單場紀錄維持中性。\n比人時記得出裝不同：射手天生打塔快、坦克天生承傷多，可以對照「出裝比例」"}
    >
      {loading ? (
        <LoadingBlock height={300} label="載入數據中…" />
      ) : (
        <div className="reveal space-y-2">
          <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" size="sm" variant="outline" value={setId} onValueChange={(v) => v && setSetId(v)} className="flex-wrap">
            {STAT_SETS.map((g) => (
              <Fragment key={g.id}>
                <ToggleGroupItem value={g.id}>{g.label}</ToggleGroupItem>
                {/* 「單場前 10 場」緊接在單場巔峰後面：同一組指標，改成每場一列 */}
                {g.id === "peak" && <ToggleGroupItem value="top">單場前 10 場</ToggleGroupItem>}
              </Fragment>
            ))}
            <ToggleGroupItem value="mix">出裝比例</ToggleGroupItem>
          </ToggleGroup>
          <Hint text={isMix ? "六種出裝各占他場次的幾成。不是好壞，是拿來對照其他數字的；點數字開抽屜看那種出裝的每一場" : (set?.caption ?? "")} />
          </div>
          {isTop ? (
            <PeakTop scoped={scoped} cols={cols} centers={centers} onOpen={onOpen} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm" data-testid="crew-stats">
                <thead>
                  <tr className="border-b text-[11px] text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">玩家</th>
                    <th className="px-2 py-1.5 text-right font-medium">場次</th>
                    {cols.map((c) => (
                      <th key={c.key} className="px-2 py-1.5 text-right font-medium" data-tip={c.hint}>
                        <button
                          type="button"
                          onClick={() => setSortKey(c.key)}
                          className={cn("cursor-pointer underline-offset-2 hover:text-foreground hover:underline", activeSort === c.key && "text-foreground underline")}
                        >
                          {c.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => {
                    const r = rowOf(p.puuid)
                    return (
                      <tr key={p.puuid} className="border-b border-border/50 last:border-b-0" data-testid="crew-stats-row">
                        <td className="px-2 py-1.5">
                          <PlayerName player={p} className="text-sm" />
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{n0(r, "participants.games")}</td>
                        {cols.map((c) => {
                          const v = valueOf(p.puuid, c.key)
                          const name = splitId(p.riot_id, p.puuid).name
                          return (
                            <td
                              key={c.key}
                              data-key={c.key}
                              className={cn(
                                "px-2 py-1.5 text-right font-mono tabular-nums",
                                v !== null && v === best.get(c.key) && "font-semibold text-win",
                                active?.puuid === p.puuid && active.key === c.key && "bg-primary/10",
                              )}
                            >
                              {v === null ? (
                                "—"
                              ) : (
                                <button
                                  type="button"
                                  data-tip={c.record ? `看${name}創下「${c.label}」的那一場` : `看${name}算進「${c.label}」的每一場`}
                                  onClick={() =>
                                    onOpen({
                                      title: `${name}・${c.label}${c.record ? "的紀錄場" : "的每一場"}`,
                                      note: cellNote(c),
                                      cell: { puuid: p.puuid, key: c.key },
                                      source: {
                                        puuid: p.puuid,
                                        filters: c.key.startsWith("mix:") ? [{ member: "builds.build_role", operator: "equals", values: [c.key.slice(4)] }] : [],
                                        recordMetric: c.record ? c.key : undefined,
                                      },
                                    })
                                  }
                                  className="cursor-pointer rounded px-0.5 underline-offset-2 transition hover:bg-accent hover:underline"
                                >
                                  {c.fmt(v)}
                                </button>
                              )}
                              {(c.key === "participants.avg_time_dead" || c.key === "participants.time_dead_share") && v !== null && (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">{n0(r, "participants.time_dead_games")} 場</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}


// ── 單場紀錄的前 10 場：數據總表「單場巔峰」的第二種看法（每人一格 ↔ 每場一列）────────
// 指標就是那組的欄位（每分鐘與總量都有），一次一個。範圍與中心跟著整頁；點一列看那一場，和點數字看那一場一樣。
const TOP_N = 10

/** 對局長度（分鐘，含小數）寫成 mm:ss。先換成整秒再拆，避免 14.999 分變成 14:60 */
const asClock = (minutes: number) => {
  const total = Math.round(minutes * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function PeakTop({
  scoped,
  cols,
  centers,
  onOpen,
}: {
  scoped: (query: CubeQuery) => CubeQuery | null
  cols: StatCol[]
  centers: Player[]
  onOpen: (games: GamesFocus) => void
}) {
  const { matchParams } = useFilters()
  const perMin = cols.filter((c) => c.label.includes("每分鐘"))
  const totals = cols.filter((c) => !c.label.includes("每分鐘"))
  // 預設是每分鐘擊殺（數據總表的順序裡每分鐘死亡排在最前，不適合當預設）
  const [key, setKey] = useState(cols.find((c) => c.key === "participants.best_kills_per_min")?.key ?? perMin[0]?.key ?? cols[0].key)
  const metric = cols.find((c) => c.key === key) ?? cols[0]
  const metricName = metric.label.replace("單場最高", "")
  const centerNames = centers.map((c) => splitRiotId(c.riot_id, c.puuid).name).join("、")
  const scopeNote = centers.length ? `只算「${centerNames}」都在場的對局：比較對象在這些場裡` : "沒設中心，比較對象的每一場一起比"
  const top = useCube(
    scoped({
      measures: [metric.key],
      dimensions: [
        "participants.participant_key",
        "participants.riot_id",
        "champions.name",
        "champions.icon_path",
        "matches.local_date",
        "matches.duration_minutes",
      ],
      order: { [metric.key]: "desc" },
      limit: TOP_N,
    }),
  )
  const drill = top.rows.length ? participantRows(top.rows) : null
  const deathMetric = metric.key.includes("death")

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={metric.key} onValueChange={setKey}>
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>每分鐘</SelectLabel>
              {perMin.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>總量</SelectLabel>
              {totals.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {drill && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpen({ title: `${metricName}・前 ${TOP_N} 場的戰報`, note: scopeNote, source: { params: { ...matchParams(), ...drill.params } } })}
          >
            列出這幾場的戰報
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {scopeNote}，「{metricName}」最高的前 {TOP_N} 場。點一列開抽屜看那一場。
      </p>

      {top.error ? (
        <QueryError error={top.error} />
      ) : top.loading ? (
        <LoadingBlock height={360} label="載入中…" />
      ) : !top.rows.length ? (
        <EmptyState>{centers.length ? `${centerNames} 在這個模式與期間裡沒有對局。` : "這個條件下沒有對局。"}</EmptyState>
      ) : (
        <ol className="divide-y divide-border/50">
          {top.rows.map((r, i) => {
            const id = String(r["participants.participant_key"])
            const value = num(r[metric.key])
            const minutes = num(r["matches.duration_minutes"])
            const { name, tag } = splitRiotId(r["participants.riot_id"] as string | null, "—")
            return (
              <li key={id} data-testid="minute-record-game" className="slide-in" style={{ "--stagger": `${Math.min(i * 30, 400)}ms` } as CSSProperties}>
                <button
                  type="button"
                  data-tip="點一下看這一場"
                  onClick={() =>
                    onOpen({
                      title: `${name}・${metricName}・第 ${i + 1} 名`,
                      note: "只顯示這一場，戰報點開可以看完整內容",
                      source: { params: { ...matchParams(), ...participantRows([r])?.params } },
                    })
                  }
                  className="flex w-full cursor-pointer items-center gap-3 rounded py-2 text-left transition hover:bg-accent/60"
                >
                  <span className="w-5 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                  <img
                    src={iconUrl(r["champions.icon_path"] as string | null)}
                    alt={String(r["champions.name"] ?? "")}
                    className="size-8 shrink-0 rounded-md bg-icon-tile"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-baseline gap-1">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {tag && <span className="shrink-0 text-[11px] text-muted-foreground">{tag}</span>}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {String(r["champions.name"] ?? "—")} · {String(r["matches.local_date"] ?? "—")}
                      {minutes !== null && ` · ${asClock(minutes)}`}
                    </span>
                  </span>
                  <span
                    data-testid="minute-record-value"
                    className={cn("shrink-0 font-mono text-sm font-semibold tabular-nums", deathMetric ? "text-loss" : "text-foreground")}
                  >
                    {value === null ? "—" : metric.fmt(value)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** 頁首（AppShell 的 sticky 標題列）實際有多高。標題列會依說明文字與視窗寬度換行，所以量實際值，分頁列才能正好貼在它下面。 */
function useHeaderHeight() {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = document.getElementById("app-header")
    if (!el) return
    const measure = () => setHeight(el.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return height
}

type RowSort = "games" | "score" | "winrate" | "titles"

export function Crew() {
  const { players, apply, queueId, activeVersions, timeFilter, matchParams } = useFilters()
  const crew = useMemo(() => players.filter((p) => p.crew), [players])
  // 預設全部人都比；點名字可以拿掉（至少留一個）
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const chosen = crew.filter((p) => !excluded.has(p.puuid))
  const puuids = chosen.map((p) => p.puuid)
  // 右側抽屜同一時間只開一個：一位好友，或一串對局（點數字、英雄、增幅、單場紀錄）
  const [focus, setFocus] = useState<Focus | null>(null)
  // 頂層分頁：一次只看一段
  const [section, setSection] = useState<Section>("matrix")
  const headerHeight = useHeaderHeight()

  const byId = useMemo(() => new Map(crew.map((p) => [p.puuid, p])), [crew])
  const focusPlayer = focus?.kind === "player" ? byId.get(focus.puuid) : undefined
  // 抽屜開著的那一格（原頁面亮著它）
  const focusCell = focus?.kind === "games" ? (focus.cell ?? null) : null
  useCrumb(
    10,
    focus?.kind === "games"
      ? focus.title
      : focusPlayer
        ? `${splitId(focusPlayer.riot_id, focusPlayer.puuid).name}${focus?.kind === "player" && focus.role ? `・${focus.role}` : ""}`
        : null,
    () => setFocus(null),
  )

  // 中心（選填，可多選）：只看這幾位都在場的場次。沒設就是整群比較對象的每一場。
  const [centerIds, setCenterIds] = useState<string[]>([])
  const centers = crew.filter((p) => centerIds.includes(p.puuid))
  const centerNames = centers.map((p) => splitId(p.riot_id, p.puuid).name).join("、")
  // 兩位以上：每一場裡被選中的人有幾位在場（一場一列），之後只留下人數等於選取人數的那些場
  const together = useCube(
    centers.length >= 2
      ? apply(
          {
            measures: ["game_players.n_players"],
            dimensions: ["participants.game_key"],
            filters: [{ member: "game_players.puuid", operator: "equals", values: centers.map((p) => p.puuid) }],
            limit: NO_LIMIT,
          },
          "all",
        )
      : null,
  )
  const sharedKeys =
    centers.length >= 2
      ? together.rows.filter((r) => Number(r["game_players.n_players"]) === centers.length).map((r) => String(r["participants.game_key"]))
      : []
  // null 表示還不能查：同場的場次還在算，或這幾位一場都沒有一起打過
  const centerReady = centers.length < 2 || (!together.loading && !together.error && sharedKeys.length > 0)
  const centerFilters: CubeFilter[] | null = !centerReady
    ? null
    : centers.length === 0
      ? []
      : centers.length === 1
        ? [{ member: "game_players.puuid", operator: "equals", values: [centers[0].puuid] }]
        : [{ member: "participants.game_key", operator: "equals", values: sharedKeys }]
  const centerNote =
    centers.length === 0
      ? "沒設中心：整頁是整群比較對象的每一場"
      : centers.length === 1
        ? `整頁只看「${centerNames}」在的場次`
        : !centerReady
          ? together.loading
            ? `計算「${centerNames}」同場的場次中…`
            : `「${centerNames}」沒有一起打過的場次`
          : `整頁只看「${centerNames}」都在場的場次（${sharedKeys.length} 場）`
  // 分頁列上的範圍：捲動時也看得到，所以要短
  const scopeShort =
    centers.length === 0
      ? "整群的每一場"
      : centers.length === 1
        ? `只看「${centerNames}」在的場次`
        : !centerReady
          ? together.loading
            ? "同場場次計算中…"
            : `「${centerNames}」沒有一起打過的場次`
          : `只看「${centerNames}」都在場（${sharedKeys.length} 場）`

  // 拿掉一個人：他若是中心也一起取消（否則頁面還照他的場次篩，他卻已經不在比較名單裡）
  const toggleIncluded = (puuid: string) => {
    if (!excluded.has(puuid) && crew.length - excluded.size <= 1) return // 至少留一個
    const next = new Set(excluded)
    if (next.has(puuid)) next.delete(puuid)
    else {
      next.add(puuid)
      setCenterIds((ids) => ids.filter((id) => id !== puuid))
    }
    setExcluded(next)
  }
  const toggleCenter = (puuid: string) =>
    setCenterIds((ids) => (ids.includes(puuid) ? ids.filter((id) => id !== puuid) : [...ids, puuid]))

  // 全域條件（模式、期間、下鑽）照套，但不鎖定帳號（scope "all"），改成鎖定這群人。equals 給多個值就是 IN。
  const crewFilter = (ids: string[]): CubeFilter => ({ member: "participants.puuid", operator: "equals", values: ids })
  const q = (query: CubeQuery): CubeQuery | null =>
    puuids.length && centerFilters ? apply({ ...query, filters: [crewFilter(puuids), ...centerFilters, ...(query.filters ?? [])] }, "all") : null

  const summary = useCube(
    q({ measures: [...STAT_MEASURES, "participants.kda", ...PERF_PARTS.map((c) => c.key)], dimensions: ["participants.puuid"], limit: NO_LIMIT }),
  )
  const roles = useCube(q({ measures: STAT_MEASURES, dimensions: ["participants.puuid", "builds.build_role"], limit: NO_LIMIT }))
  const champs = useCube(
    q({ measures: STAT_MEASURES, dimensions: ["participants.puuid", "champions.name", "champions.icon_path"], limit: NO_LIMIT }),
  )
  // 增幅是一場多列的維度：查 winrate 會讓 Cube 走「撈主鍵再 join 回來」的慢路徑（實測 2.0 秒，不查 0.5 秒），
  // 所以只查 games 與 wins，勝率由 LookupPanel 自己除（定義就是 100 × wins / games）
  //   只有「查增幅裝置」分頁用得到，切過去才查：冷快取時這支要 2.6 秒，原本會把一進頁面的全員一覽也卡住
  const augments = useCube(
    section === "augment"
      ? q({
          measures: ["participants.games", "participants.wins", "participants.losses", WORK],
          dimensions: ["participants.puuid", "augments.name", "augments.icon_path"],
          limit: NO_LIMIT,
        })
      : null,
  )
  //   數據總表分頁專用（冷快取 1.5 秒），同樣切過去才查
  const stats = useCube(section === "stats" ? q({ measures: STAT_MEASURES_ALL, dimensions: ["participants.puuid"], limit: NO_LIMIT }) : null)
  // 稱號用的幾項數據（每人一列）
  const titleStats = useCube(q({ measures: TITLE_MEASURES, dimensions: ["participants.puuid"], limit: NO_LIMIT }))
  const lossStats = useCube(q({ measures: [WORK, WORK_GAMES], dimensions: ["participants.puuid"], segments: ["participants.losses_only"], limit: NO_LIMIT }))
  const nightStats = useCube(
    q({ measures: ["participants.games"], dimensions: ["participants.puuid"], filters: [{ member: "matches.hour_of_day", operator: "lt", values: ["6"] }], limit: NO_LIMIT }),
  )
  // 搭檔：兩人同隊的場次與勝場。teammates 和 participants 沒有 join 路徑，不能走 apply()——
  // 模式、版本、期間照全域條件自己帶（都是 matches 的欄位），「中心」不套用（中心是 participants 那邊的條件）
  const duoQuery = useMemo<CubeQuery | null>(() => {
    if (puuids.length < 2) return null
    const filters: CubeFilter[] = [
      { member: "teammates.subject_puuid", operator: "equals", values: puuids },
      { member: "teammates.puuid", operator: "equals", values: puuids },
      { member: "teammates.relation", operator: "equals", values: ["teammate"] },
    ]
    if (queueId) filters.push({ member: "matches.queue_id", operator: "equals", values: [queueId] })
    if (activeVersions.length) filters.push({ member: "matches.patch", operator: "equals", values: activeVersions })
    return {
      measures: ["teammates.games", "teammates.wins"],
      dimensions: ["teammates.subject_puuid", "teammates.puuid"],
      filters,
      ...timeFilter("matches.played_at"),
      limit: NO_LIMIT,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puuids.join(), queueId, activeVersions.join(), timeFilter])
  const duo = useCube(duoQuery)
  // 出裝的傷害類型（AD／AP）：玩家類型與數據總表的出裝比例用
  const dmgTypes = useCube(q({ measures: ["participants.games"], dimensions: ["participants.puuid", "builds.damage_type"], limit: NO_LIMIT }))
  // 參照列：所有參賽者的出裝比例（不鎖玩家，也不受上方「拿掉誰」影響）
  const everyone = useCube(centerFilters === null ? null : apply({ measures: ["participants.games", "participants.winrate", "participants.kda"], filters: centerFilters }, "all"))
  const everyoneRoles = useCube(centerFilters === null ? null : apply({ measures: ["participants.games"], dimensions: ["builds.build_role"], filters: centerFilters, limit: NO_LIMIT }, "all"))
  const error = summary.error ?? roles.error ?? champs.error ?? augments.error ?? everyone.error ?? everyoneRoles.error ?? stats.error ?? dmgTypes.error ?? titleStats.error ?? lossStats.error ?? nightStats.error ?? duo.error ?? together.error
  // 全員一覽要等的：核心數字，加上稱號與玩法用的幾支（不等的話，稱號會在畫面出來之後才一個個冒出來、版面往下推）。
  // 增幅、數據總表不在這裡：那是別的分頁的資料
  const loading =
    summary.loading || roles.loading || champs.loading || everyone.loading || everyoneRoles.loading ||
    dmgTypes.loading || titleStats.loading || lossStats.loading || nightStats.loading

  const sumOf = (puuid: string) => summary.rows.find((r) => r["participants.puuid"] === puuid)
  const gamesOf = (puuid: string) => n0(sumOf(puuid), "participants.games")
  const wrOf = (puuid: string) => opt(sumOf(puuid), "participants.winrate")

  // 每個人的判斷一次算好：一覽表、抽屜都用同一份
  const profiles = useMemo(() => {
    const out = new Map<string, Profile>()
    // 一般玩家（資料庫裡所有參賽者）的出裝比例，拿來對照「他比一般人多玩什麼」
    const baseTotal = everyoneRoles.rows.reduce((a, r) => a + n0(r, "participants.games"), 0)
    const base = new Map(everyoneRoles.rows.map((r) => [String(r["builds.build_role"]), baseTotal ? n0(r, "participants.games") / baseTotal : 0]))
    for (const p of crew) {
      const s = summary.rows.find((r) => r["participants.puuid"] === p.puuid)
      const overallStat = statOf(s, "overall", "整體")
      const own: Own = { score: overallStat.score, winrate: overallStat.winrate }
      // 整體和 50 比只有一組，不用放寬；勝率和 50% 比
      const overall = judge(overallStat, { score: own.score, winrate: null }, 1.96)
      const overallWr = overallStat.games ? gapOf({ key: "overall", label: "整體", games: overallStat.games, wins: overallStat.wins }, 50) : null
      const roleStats = BUILD_ROLES.map((label) =>
        statOf(roles.rows.find((x) => x["participants.puuid"] === p.puuid && x["builds.build_role"] === label), label, label),
      )
      const champStats = champs.rows
        .filter((r) => r["participants.puuid"] === p.puuid)
        .map((r) => statOf(r, String(r["champions.name"]), String(r["champions.name"]), r["champions.icon_path"] as string))
      const roleJ = judgeAll(roleStats, own)
      const champJ = judgeAll(champStats, own)
      const dmgOf = (t: string) => n0(dmgTypes.rows.find((r) => r["participants.puuid"] === p.puuid && r["builds.damage_type"] === t), "participants.games")
      const style = playStyleOf(roleJ.items, champJ.items, s, base, overallStat.scored, { ad: dmgOf("AD"), ap: dmgOf("AP") })
      out.set(p.puuid, { overall, overallWr, roles: roleJ.items, roleK: roleJ.k, champs: champJ.items, champK: champJ.k, style })
    }
    return out
  }, [crew, summary.rows, roles.rows, champs.rows, everyoneRoles.rows, dmgTypes.rows])

  // 依場次排：場次多的人判斷比較可信，放前面
  const ordered = [...chosen].sort((a, b) => gamesOf(b.puuid) - gamesOf(a.puuid))
  const everyoneTotal = n0(everyone.rows[0], "participants.games")
  // 搭檔：每一組只留一列（a 在前面的人），兩個視角的場次、勝場本來就一樣
  const duoPairs = useMemo<DuoPair[]>(() => {
    const out: DuoPair[] = []
    chosen.forEach((a, i) =>
      chosen.slice(i + 1).forEach((b) => {
        const r = duo.rows.find((x) => x["teammates.subject_puuid"] === a.puuid && x["teammates.puuid"] === b.puuid)
        if (r) out.push({ a, b, games: n0(r, "teammates.games"), wins: n0(r, "teammates.wins") })
      }),
    )
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puuids.join(), duo.rows])
  // 稱號那一列，併上敗場貢獻、深夜場次、最常玩英雄的場次（後兩個沒有就是 0）
  const titleRows = useMemo<CubeRow[]>(() => {
    const by = (rows: CubeRow[], puuid: string) => rows.find((r) => r["participants.puuid"] === puuid)
    return titleStats.rows.map((r) => {
      const puuid = String(r["participants.puuid"])
      const loss = by(lossStats.rows, puuid)
      const champGames = champs.rows.filter((c) => c["participants.puuid"] === puuid).map((c) => n0(c, "participants.games"))
      return {
        ...r,
        [X_LOSS_WORK]: loss?.[WORK] ?? null,
        [X_LOSS_GAMES]: loss?.[WORK_GAMES] ?? 0,
        [X_NIGHT_GAMES]: by(nightStats.rows, puuid)?.["participants.games"] ?? 0,
        [X_TOP_CHAMP]: champGames.length ? Math.max(...champGames) : 0,
      } as CubeRow
    })
  }, [titleStats.rows, lossStats.rows, nightStats.rows, champs.rows])
  // 稱號：數字達到門檻就有，不跟別人比（門檻見 T）
  const titles = useMemo(
    () => titlesOf(ordered, titleRows, duoPairs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puuids.join(), titleRows, duoPairs],
  )
  // D：全員一覽的排序。預設依場次（場次多的判斷比較可信）
  const [rowSort, setRowSort] = useState<RowSort>("games")
  const matrixRows = useMemo(() => {
    const key = (p: Player) => {
      const prof = profiles.get(p.puuid)
      if (rowSort === "score") return prof?.overall.score ?? -1
      if (rowSort === "winrate") return prof?.overall.winrate ?? -1
      if (rowSort === "titles") return (titles.get(p.puuid) ?? []).filter((t) => t.kind === "title").length * 1000 + gamesOf(p.puuid) / 1000
      return gamesOf(p.puuid)
    }
    return [...ordered].sort((a, b) => key(b) - key(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.map((p) => p.puuid).join(), rowSort, profiles, titles, summary.rows])
  // B：出裝小森林所有人共用一把尺：取所有區間最遠的一端，進位到 5，介於 10～30
  const roleReach = useMemo(() => {
    const far = ordered.flatMap((p) => (profiles.get(p.puuid)?.roles ?? []).flatMap((j) => (j.g?.interval ? [Math.abs(j.g.interval[0]), Math.abs(j.g.interval[1])] : [])))
    return Math.min(30, Math.max(10, Math.ceil(Math.max(0, ...far) / 5) * 5))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, puuids.join()])

  // 矩陣上方那句話：同時看得出的有幾格
  const counts = useMemo(() => {
    const cells = ordered.flatMap((p) => profiles.get(p.puuid)?.roles ?? []).filter((j) => j.g?.interval)
    return {
      judged: cells.length,
      strong: cells.filter((j) => j.strength === "強勢").length,
      weak: cells.filter((j) => j.strength === "不強勢").length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, puuids.join()])


  if (!players.length) return <MatrixSkeleton rows={6} label="載入好友名單…" />
  if (crew.length < 2) {
    return (
      <EmptyState>
        還沒有可以比較的好友。到「追蹤對象」加入一起打的朋友，他們的戰績被採集進來之後就會出現在這裡。
      </EmptyState>
    )
  }

  const open = (puuid: string, role: string | null, tab: DrawerTab, champ?: string) => setFocus({ kind: "player", puuid, role, tab, champ })
  const openGames = (games: GamesFocus) => setFocus({ kind: "games", ...games })
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })

  return (
    <CenterFilterContext.Provider value={centerFilters}>
    <div className="space-y-4">
      {error && <QueryError error={error} />}

      <Panel
        title="比較對象"
        caption="點名字拿掉或加回來；★ 設為中心"
        hint="你和追蹤中的好友。點名字可以拿掉或加回來；點 ★ 設為中心，整頁只看中心都在場的場次。模式、期間與上方的篩選照常套用。大部分場次是一起打的，勝率會互相牽動，差距要搭配場次看"
      >
        <div className="flex flex-wrap gap-2">
          {crew.map((p) => {
            const on = !excluded.has(p.puuid)
            const isCenter = centerIds.includes(p.puuid)
            const name = splitId(p.riot_id, p.puuid).name
            return (
              <span
                key={p.puuid}
                data-testid="crew-chip"
                className={cn(
                  "flex max-w-[16rem] items-center rounded-full border text-sm transition",
                  on ? (isCenter ? "border-primary bg-primary/20" : "border-primary/50 bg-primary/10") : "text-muted-foreground opacity-60 hover:opacity-100",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleIncluded(p.puuid)}
                  data-tip={on ? `拿掉 ${name}（不納入比較）` : `加回 ${name}`}
                  className="flex min-w-0 items-center gap-1.5 py-1 pl-3 pr-2"
                >
                  <Check className={cn("size-3.5 shrink-0", on ? "text-primary" : "opacity-0")} />
                  <PlayerName player={p} />
                </button>
                <button
                  type="button"
                  data-testid="crew-center"
                  aria-pressed={isCenter}
                  disabled={!on}
                  onClick={() => toggleCenter(p.puuid)}
                  data-tip={!on ? "先加回來才能設為中心" : isCenter ? `取消中心：${name}` : `設為中心：只看 ${name} 也在場的場次`}
                  aria-label={isCenter ? `取消中心：${name}` : `設為中心：${name}`}
                  className="flex h-full items-center rounded-r-full border-l border-border px-2 py-1 transition hover:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Star className={cn("size-3.5", isCenter ? "fill-primary text-primary" : "text-muted-foreground")} />
                </button>
              </span>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">★ 中心（選填，可多選）</span>
          <Button
            size="sm"
            variant={centers.length ? "outline" : "secondary"}
            className="h-7 text-xs"
            disabled={!centers.length}
            onClick={() => setCenterIds([])}
          >
            不設中心
          </Button>
          <span className="text-[11px] text-muted-foreground">{centerNote}</span>
        </div>
      </Panel>

      <Tabs value={section} onValueChange={(v) => setSection(v as Section)} className="gap-4">
        {/* 分頁列貼在頁首下面：捲到哪一段都看得到分頁與目前的比較範圍；「調整比較對象」回到最上面的名單 */}
        <div
          data-testid="crew-sticky"
          style={{ top: headerHeight }}
          className="sticky z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/85 py-2 backdrop-blur"
        >
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="matrix">全員一覽</TabsTrigger>
            <TabsTrigger value="stats">數據總表</TabsTrigger>
            <TabsTrigger value="champ">查英雄</TabsTrigger>
            <TabsTrigger value="augment">查增幅裝置</TabsTrigger>
            <TabsTrigger value="badges">徽章</TabsTrigger>
          </TabsList>
          <div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:justify-end">
            <span className="min-w-0 truncate" data-testid="crew-scope">
              比較 {chosen.length} 人・{scopeShort}
            </span>
            <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={scrollToTop}>
              調整比較對象
            </Button>
          </div>
        </div>

        <TabsContent value="matrix">
          {/* ── 全員一覽：每人一列，迷你雷達 + 出裝與英雄的判定 ── */}
          <Panel
            title="全員一覽"
            action={
              <ToggleGroup type="single" size="sm" variant="outline" value={rowSort} onValueChange={(v) => v && setRowSort(v as RowSort)} data-testid="crew-row-sort">
                <ToggleGroupItem value="games" className="h-7 px-2 text-xs">依場次</ToggleGroupItem>
                <ToggleGroupItem value="score" className="h-7 px-2 text-xs">依貢獻</ToggleGroupItem>
                <ToggleGroupItem value="winrate" className="h-7 px-2 text-xs">依勝率</ToggleGroupItem>
                <ToggleGroupItem value="titles" className="h-7 px-2 text-xs">依稱號數</ToggleGroupItem>
              </ToggleGroup>
            }
            caption="每人一列；滑過看數字，點一列看完整分析"
            hint={"判定看本場貢獻（每場只和同一場的人比，50＝所有人的平均）的誤差範圍：整段高於 50 是得心應手以上（拿手、招牌、傳奇）、整段低於 50 是潛力股或璞玉，還在誤差內的依差距細分（虛線框）；滑過圖例看每一級的切點。\n雷達是各出裝佔他場次的比例；出裝欄每種出裝一條，所有人同一把尺，點是本場貢獻和 50 的差、橫線是誤差範圍（實心＝看得出）。\n英雄的數字是名次，看得出的排前面。"}
          >
            {loading ? (
              <MatrixSkeleton rows={matrixRows.length || crew.length || 6} label="載入好友戰績…" />
            ) : (
              <div className="space-y-3">
                <p className="text-sm" data-testid="crew-matrix-summary">
                  各出裝裡 {counts.judged} 格有 {MIN_N} 場以上，看得出強弱的有 {counts.strong + counts.weak} 格（看得出高 {counts.strong}、看得出低 {counts.weak}），其餘差距都還在誤差內。
                </p>
                <RowLegend />
                <div className="@container">
                  <div>
                    <div className={cn("hidden items-end border-b px-2 pb-1.5 text-[11px] text-muted-foreground @[1000px]:grid", ROW_COLS)}>
                      <span>玩家</span>
                      <span className="text-center">出裝定位</span>
                      <span className="grid grid-cols-[1.75rem_minmax(0,1fr)_7rem] gap-1.5">
                        <span />
                        <span className="flex justify-between font-mono tabular-nums">
                          <span>−{roleReach}</span>
                          <span className="text-foreground">50</span>
                          <span>+{roleReach}</span>
                        </span>
                        <span className="text-right">各出裝</span>
                      </span>
                      <span>英雄（上：比平均強、下：培養中）</span>
                    </div>
                    <div
                      data-testid="crew-reference-row"
                      className={cn("grid w-full items-center border-b border-dashed bg-muted/20 px-2 py-1", ROW_COLS)}
                    >
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-1.5 text-sm font-medium">
                          全體參賽者
                          <span className="rounded border border-dashed px-1 text-[10px] font-normal text-muted-foreground">參照</span>
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                          {everyoneTotal} 場・{opt(everyone.rows[0], "participants.winrate")?.toFixed(1) ?? "—"}%・KDA{" "}
                          {opt(everyone.rows[0], "participants.kda")?.toFixed(2) ?? "—"}
                        </span>
                      </span>
                      <MiniHex
                        data={BUILD_ROLES.map((label) => ({
                          label,
                          games: n0(everyoneRoles.rows.find((x) => x["builds.build_role"] === label), "participants.games"),
                          strength: null,
                        }))}
                        total={everyoneTotal}
                      />
                      <span
                        className="col-span-2 truncate text-[11px] text-muted-foreground"
                        data-tip="把資料庫裡每場十位參賽者都算進來：雷達是一般玩家各出裝佔多少，拿來和下面每個人的形狀對照他偏好什麼；本場貢獻在 v2.1 定版時（2026-10-17）的平均是 50，之後的場次不一定剛好 50；勝率每場兩隊都算，必然是 50%。"
                      >
                        雷達是一般玩家的出裝比例，拿來對照每個人偏好什麼（滑過看說明）
                      </span>
                    </div>
                    {matrixRows.map((p, i) => {
                      const prof = profiles.get(p.puuid)
                      if (!prof) return null
                      const ownWr = prof.overall.winrate
                      const ov = prof.overall
                      return (
                        <button
                          key={p.puuid}
                          type="button"
                          data-testid="crew-row"
                          onClick={() => open(p.puuid, null, "overview")}
                          style={{ "--stagger": `${i * 35}ms` } as CSSProperties}
                          className={cn(
                            "slide-in grid w-full items-center rounded-md border-b px-2 py-1 text-left transition hover:bg-accent",
                            ROW_COLS,
                            focus?.kind === "player" && focus.puuid === p.puuid && "bg-primary/10",
                          )}
                        >
                          <span className="min-w-0">
                            <PlayerName player={p} className="text-sm" />
                            <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                              {ov.games} 場・{ownWr?.toFixed(1) ?? "—"}%・KDA {opt(sumOf(p.puuid), "participants.kda")?.toFixed(2) ?? "—"}
                            </span>
                            <span className="block text-[11px] text-muted-foreground" data-tip={tipOf(ov, null)} data-testid="crew-overall" data-strength={ov.strength}>
                              本場貢獻{" "}
                              <span className={cn("font-mono font-semibold", ov.g?.interval ? NUM_CLASS[ov.strength] : "text-muted-foreground")}>
                                {ov.score === null ? "—" : Math.round(ov.score)}
                              </span>
                              {ov.g?.interval && (
                                <span className={cn(CHIP, "ml-1", levelClass(ov))}>{labelOf(ov)}</span>
                              )}
                            </span>
                            <span className="block truncate text-[11px]" data-tip={prof.style.archetypeNote ?? undefined} data-testid="crew-style-line">
                              {styleLine(prof.style)}
                            </span>
                            <TitleBadges titles={titles.get(p.puuid)} className="mt-1" />
                          </span>
                          <MiniHex data={prof.roles.map((j) => ({ label: j.label, games: j.games, strength: j.strength }))} total={ov.games} />
                          <span className={SECTION_SPAN}>
                            <RoleStrip roles={prof.roles} reach={roleReach} ownWr={ownWr} />
                          </span>
                          <span className={cn("grid content-center gap-2.5", SECTION_SPAN)}>
                            {(["pos", "neg"] as const).map((side) => (
                              <span key={side} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2" data-testid={`crew-champ-${side}`}>
                                <span className={cn(CHIP, "justify-center", side === "pos" ? "border-win/50 bg-win/15 text-foreground" : "border-loss/50 bg-loss/15 text-foreground")}>
                                  {side === "pos" ? "比平均強" : "培養中"}
                                </span>
                                <ChampSide items={sideOf(prof.champs, side)} ownWr={ownWr} max={MATRIX_CHAMPS} onPick={(label) => open(p.puuid, null, "picks", label)} />
                              </span>
                            ))}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <HowWeJudge>
                  <p>
                    本場貢獻：每場的輸出（對英雄傷害）、承傷（承受＋減免）、控場、治療護盾隊友，各自和同一場另外九個人比（參考量是其他九人的量依裝備職責分到他的份），
                    依終場裝備的連續比例加權（不分固定定位；只有射手英雄依 AD 裝比例另加最多約 2.5 分，補控場少、站後排的落差），權重低的工作做到超過參考量另有加分，清兵、推塔另有最多 6 分；最後扣掉「同樣裝備組成的平均」再換成 0～100（係數定版時寫死，射手、坦克、輔助的平均都接近 50），50 是所有人的平均。
                    不用擊殺、金錢、勝負計算，死亡也不扣分；全隊都做得多可以全隊都高。這是「這場做了多少工作」，不是操作實力：同樣的數字在不同陣容下會不同分，跨場平均只是描述。
                    沒有賽後統計的場次（治療護盾隊友的量改用含自補的治療量）是暫估，也算進平均。
                  </p>
                  <p>
                    每一項都算誤差範圍（95%；單場的分數起伏大，標準差約 18.5，場次越多範圍越窄）。範圍整段高於 50 是「得心應手」以上（高 8／12／20 分以上是拿手／招牌／傳奇）、整段低於 50 是「潛力股」（低 15 分以上是璞玉）；
                    差 {WORK_GAP} 分以上但範圍還跨過 50，依差距寫「順手／漸入佳境／上手／嶄露頭角」或「磨合中／調整中／摸索中／練功中」；差不到 {WORK_GAP} 分是「小有心得／標準發揮／暖機中」；
                    不到 {MIN_N} 場不下判斷，寫「熱身中」（{TRIAL_MAX} 場以下是「初體驗」）。同一個人同時比好幾種出裝或好幾隻英雄，範圍會再放寬——
                    一次比二十隻，總有一兩隻看起來特別好或特別差只是運氣。
                  </p>
                  <p>
                    勝率只當補充：和他自己的整體勝率比，範圍也整段在一邊寫「勝率亮眼／蓄勢待發」，差 {WR_LEAN} 個百分點以上但還在誤差內寫「勝率不錯／手氣待回溫」；貢獻比平均高（傳奇到順手）、勝率卻比他平常低 {WR_LUCK} 個百分點以上（至少 {LUCK_MIN} 場）是「雖敗猶榮」：輸多半不是他的問題；反過來貢獻還在追、勝率卻高是「默契加分」。
                    好友多半一起打、勝率互相牽動，每個人的整體勝率目前都和 50% 分不出差別，所以不拿勝率判斷。
                  </p>
                  <p>
                    舊版的「適合／不適合」用固定門檻、不管場次，幾乎每一項都會被貼上標籤，而且跟著這個人的整體水準走（整體強的人每個出裝都「適合」）。
                    同一個人不同出裝、不同英雄之間的差距，目前的資料都還分不出來；看得出的，主要是人和人之間的差別。
                  </p>
                </HowWeJudge>
              </div>
            )}
          </Panel>
          <Panel
            className="mt-4"
            title="搭檔"
            caption="兩人同隊時的勝率；點一格看那幾場"
            hint={`兩人同隊的場次與勝率（同一場、同一隊）。顏色是勝率比 50% 高或低，越深差越多；外框加粗的是誤差範圍整段在一邊、看得出差別的。不到 ${DUO_MIN_GAMES} 場只寫場次。\n好友多半一起打，勝率互相牽動，當作描述看。模式、版本、期間照上方篩選，「中心」不套用。`}
          >
            {duo.loading ? (
              <LoadingBlock height={360} label="載入搭檔勝率…" />
            ) : (
              <DuoMatrix
                people={matrixRows}
                pairs={duoPairs}
                onOpen={(d) =>
                  openGames({
                    title: `${nameOf(d.a)}＋${nameOf(d.b)} 同隊`,
                    note: `${d.games} 場・${d.wins} 勝 ${d.games - d.wins} 敗`,
                    source: { params: { ...matchParams(), puuid: d.a.puuid, with_puuid: d.b.puuid, relation: "teammate" } },
                  })
                }
              />
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="stats">
          <StatsPanel
            people={ordered}
            rows={stats.rows}
            loading={loading || stats.loading}
            profiles={profiles}
            scoped={q}
            centers={centers}
            active={focusCell}
            onOpen={openGames}
          />
        </TabsContent>

        {/* 查英雄、查增幅裝置：同一個元件，只差查哪個維度 */}
        <TabsContent value="champ">
          <LookupPanel
            kind={CHAMPION_LOOKUP}
            rows={champs.rows}
            loading={loading}
            people={ordered}
            puuids={puuids}
            wrOf={wrOf}
            active={focusCell}
            onOpen={openGames}
          />
        </TabsContent>
        <TabsContent value="augment">
          <LookupPanel
            kind={AUGMENT_LOOKUP}
            rows={augments.rows}
            loading={loading || augments.loading}
            people={ordered}
            puuids={puuids}
            wrOf={wrOf}
            active={focusCell}
            onOpen={openGames}
          />
        </TabsContent>
        <TabsContent value="badges">
          <BadgesPanel people={ordered} rows={titleRows} duos={duoPairs} loading={loading || duo.loading} />
        </TabsContent>
      </Tabs>

      <DetailDrawer
        open={!!focus}
        onClose={() => setFocus(null)}
        title={focus?.kind === "games" ? focus.title : focusPlayer ? <PlayerName player={focusPlayer} /> : ""}
        subtitle={
          focus?.kind === "games"
            ? focus.note
            : focusPlayer
              ? `整體 ${wrOf(focusPlayer.puuid)?.toFixed(1) ?? "—"}%・${round0(gamesOf(focusPlayer.puuid))} 場・KDA ${opt(sumOf(focusPlayer.puuid), "participants.kda")?.toFixed(2) ?? "—"}`
              : undefined
        }
      >
        {focus?.kind === "games" && <GamesBody key={focus.title} source={focus.source} />}
        {focus?.kind === "player" && focusPlayer && profiles.get(focusPlayer.puuid) && (
          <PlayerDrawerBody
            key={focusPlayer.puuid}
            player={focusPlayer}
            profile={profiles.get(focusPlayer.puuid)!}
            role={focus.role}
            onRole={(role) => setFocus((f) => (f?.kind === "player" ? { ...f, role } : f))}
            tab={focus.tab}
            onTab={(tab) => setFocus((f) => (f?.kind === "player" ? { ...f, tab } : f))}
            jumpChamp={focus.champ}
            crewFilter={crewFilter}
            titles={titles.get(focusPlayer.puuid)}
          />
        )}
      </DetailDrawer>
    </div>
    </CenterFilterContext.Provider>
  )
}
