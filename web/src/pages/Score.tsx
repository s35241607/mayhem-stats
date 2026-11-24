import { type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { ContribScore } from "@/components/Contribution"
import { BellCompare, Caption, ErrorFunnel, ModRange, RoleWeightMatrix, ScoreFlow, ScoreScale, Waterfall } from "@/components/ScoreCharts"
import { EmptyState, LoadingBlock, Panel, QueryError } from "@/components/primitives"
import { RoleChip } from "@/components/RoleChip"
import { useBuildRoles } from "@/hooks/useBuildRoles"
import { useCube } from "@/hooks/useCube"
import { WORK_BASE, WORK_GAP, WORK_MEASURES, WORK_MODS, WORK_PARTS, WORK_STATUS, isEstimate, workScore } from "@/hooks/useContribution"
import { num, type CubeRow } from "@/lib/cube"
import { useFilters } from "@/lib/filters"
import { WORK_SD } from "@/lib/gap"
import { cn } from "@/lib/utils"

// 「分數怎麼算」：給玩家看的本場貢獻（v5.4，contribution.work）白話說明。
// 規則本體在 cube/model/cubes/contribution.yml 的 meta.materialize.sql，規格與實測在 docs/contribution-scoring.md；
// 這頁的敘述要跟著那兩份改。九個項目的名稱與定位比重直接讀 hooks/useContribution.ts 的 WORK_PARTS，不在這裡另抄一份。

type GeneKey = (typeof WORK_PARTS)[number]["key"]

/** 每個計分項目的一句白話（名稱與定位比重在 WORK_PARTS） */
const PLAIN: Record<GeneKey, string> = {
  "contribution.gene_dmg":
    "每分鐘打在敵方英雄身上的傷害。會依對局長短、對面有幾個前排、這場打得多血腥調整；坦克、輔助、鬥士打出主 C 級的傷害時，這一項的比重會自動加大。",
  "contribution.gene_soak":
    "每分鐘替隊伍扛下的傷害（減免掉的占 62%、實際吃下的占 38%）。射手、刺客、法師不算這一項；鬥士和坦克若打出高輸出，承傷偏低也不扣分。",
  "contribution.gene_kill":
    "每分鐘擊殺數，但算分時不會超過你的輸出水準太多：傷害很低、只撿尾刀的擊殺不灌分。坦克和輔助要傷害也夠高時才開始算。",
  "contribution.gene_ka":
    "每分鐘擊殺＋助攻，並另外看對局後段（65% 時間之後）有沒有在場。會依對面前排數和這場的血腥度調整，殺很多的局不會讓人人參團都虛高。",
  "contribution.gene_heal":
    "每分鐘幫「隊友」補的血和上的盾，自己回血不算。主要是輔助的項目；其他定位只有在賽後統計齊全、每分鐘補隊友超過 500 時，才有一點順手保人的加分。",
  "contribution.gene_cc":
    "每分鐘控制敵人的時間，和累計的控場長度混在一起看。射手、刺客沒控場不扣分、控得多才加；其他定位打出高輸出（坦克、鬥士高承傷也算）時，控場少也不扣。",
  "contribution.gene_obj":
    "每分鐘對塔和主堡的傷害。每個定位都算，推塔傷害特別高、或自己一個人拆掉建築，還會另外得到高光加分（首塔與多人一起拆的不算）。",
  "contribution.gene_wave":
    "每分鐘打小兵的傷害（總傷害扣掉打英雄和打建築的部分），只算在射手、法師、刺客身上。",
  "contribution.gene_anti":
    "終場身上有重創或破盾裝時，估計替隊伍擋掉了多少敵方治療與護盾。只加不扣，最多 +2.5；只看終場裝備，不代表真的有打中。",
}

/** 一句話短版：卡片收合時只顯示這句 */
const SHORT: Record<GeneKey, string> = {
  "contribution.gene_dmg": "打英雄的傷害",
  "contribution.gene_soak": "替隊伍扛下的傷害",
  "contribution.gene_kill": "擊殺（不能只撿尾刀）",
  "contribution.gene_ka": "擊殺＋助攻，後期有沒有在場",
  "contribution.gene_heal": "幫隊友補血、上盾",
  "contribution.gene_cc": "控制敵人的時間",
  "contribution.gene_obj": "打塔與主堡",
  "contribution.gene_wave": "打小兵（射、法、刺）",
  "contribution.gene_anti": "重創、破盾裝擋掉的治療護盾",
}

const BONUSES = [
  ["多殺與團戰連鎖", "雙殺、三殺、四殺、五殺；輔助另看高參團加上高保人／控場／承傷的串連。"],
  ["推塔與單人拆建築", "推塔傷害明顯高於同定位，或自己一個人拆掉建築。首塔、多人一起拆的不算。"],
  ["交戰品質", "單殺、10 秒內的換命占優勢；輔助另看後期關鍵團有沒有在場。"],
  ["金幣效率", "同樣的金幣打出更多傷害（前排、輔助看綜合影響力）。"],
  ["跨界表現", "坦克、輔助、鬥士打出很高的輸出；坦克以外的定位控場特別多；非坦克、輔助在賽後統計齊全時順手補隊友很多。"],
  ["功能裝", "重創、破盾裝估計擋掉的敵方治療與護盾（最多 +2.5）。"],
] as const

const PENALTIES = [
  ["孤立送頭", "前後 10 秒內隊友沒擊殺、也只有你一個人死——被單抓。比例明顯高於同定位才扣，最多 −7。"],
  ["後期掉點", "對局 65% 時間之後，第二次起的孤立死亡每次 −2.2，最多 −5。"],
  ["隱身", "主要工作和參團都遠低於同定位，整場幾乎沒存在感，最多 −8。"],
] as const

const signed = (v: number) => (Math.abs(v) < 0.05 ? "0.0" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`)

/** 一段說明：標題＋內容。用 Panel 才有一致的卡片、進場錯開與標題旁的 ⓘ */
function Section({ title, caption, hint, index, children }: { title: string; caption?: string; hint?: string; index: number; children: ReactNode }) {
  return (
    <Panel title={title} caption={caption} hint={hint} index={index}>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </Panel>
  )
}

/** 加分／扣分的項目：小卡片，點開看條件 */
function ModChips({ title, tone, items }: { title: string; tone: "win" | "loss"; items: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <div className={cn("mb-1.5 text-[13px] font-semibold", tone === "win" ? "text-win" : "text-loss")}>{title}</div>
      <div className="space-y-1.5">
        {items.map(([h, t]) => (
          <details key={h} className="group rounded-lg border border-border/60 bg-muted/30">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
              <span className={cn("size-2 shrink-0 rounded-full", tone === "win" ? "bg-win" : "bg-loss")} aria-hidden />
              <span className="flex-1 text-[13px] font-medium">{h}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="px-3 pb-2.5 text-xs leading-relaxed text-muted-foreground">{t}</p>
          </details>
        ))}
      </div>
    </div>
  )
}

/** 小標＋一句話的條列 */
function Bullet({ head, children, tone }: { head: string; children: ReactNode; tone?: "win" | "loss" }) {
  return (
    <li className="flex gap-2">
      <span
        className={cn("mt-2 size-1.5 shrink-0 rounded-full", tone === "win" ? "bg-win/80" : tone === "loss" ? "bg-loss/80" : "bg-primary/70")}
        aria-hidden
      />
      <span>
        <span className="font-semibold">{head}</span>
        <span className="text-muted-foreground">：{children}</span>
      </span>
    </li>
  )
}

export function Score() {
  // 平均 n 場的 95% 誤差範圍：1.96 × 單場標準差 ÷ √n
  const halfWidth = (n: number) => Math.round((1.96 * WORK_SD) / Math.sqrt(n))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Section title="一張圖看懂" caption="每一場都照這五步算出一個 0～100 的數字" index={0}>
        <ScoreFlow />
      </Section>

      <Section
        title="50 是一般水準"
        hint={
          "校準時全部計分場次平均約 49.5；實測坦克、輔助平均約 53～54，刺客、法師約 47。\n" +
          "不會強迫拉回 50：整場大家都打得好就一起高、都很爛就一起低。\n" +
          "全站只有這一個分數：計分板、對局卡片、MVP／ACE、英雄頁、好友比較都用它。6 分鐘內結束或重開的對局不計分。"
        }
        index={1}
      >
        <ScoreScale />
        <p>
          和 50 差不到 {WORK_GAP} 分（灰帶）就當作一樣；某個定位平均比 50 高或低，<span className="font-semibold">是真的比較高或低</span>，不會被拉回 50。
        </p>
      </Section>

      <Section
        title="九個計分項目"
        caption="每一項都換算成每分鐘的量，和同定位的跨場基準比"
        hint={
          "長局每分鐘的量會自然變大，所以每一項都以 16.5 分鐘為基準做時長修正。\n" +
          "比較基準是同出裝定位（和全體）的中位數與四分位距，極端值會被壓縮，單一項不會無限加分。\n" +
          "點每一項看完整說明；各定位的比重在下一段的表。"
        }
        index={2}
      >
        <BellCompare />
        <div className="grid gap-2 sm:grid-cols-2">
          {WORK_PARTS.map((c, i) => (
            // 收合時只有名稱＋一句話，點開看完整說明（原生 details：鍵盤、讀屏都能用）
            <details key={c.key} className="group rounded-lg border border-border/60 bg-muted/30 open:bg-muted/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{c.label}</span>
                  <span className="ml-2 text-[13px] text-muted-foreground">{SHORT[c.key]}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-3 pb-3 text-[13px] leading-relaxed">{PLAIN[c.key]}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="各定位看重什麼" caption="同樣的九項，不同定位的比重不一樣" index={3}>
        <RoleWeightMatrix />
      </Section>

      <Section title="加分與扣分" caption="九個項目之外，看擊殺與建築的時間軸找出高光和失誤" index={4}>
        <ModRange />
        <div className="grid gap-3 sm:grid-cols-2">
          <ModChips title="高光加分" tone="win" items={BONUSES} />
          <ModChips title="失誤扣分" tone="loss" items={PENALTIES} />
        </div>
        <p className="text-xs text-muted-foreground">
          點每一項看條件。高光不看一血、首塔與終結連殺；核心九項合計超過 +15 後再乘 1.18 拉開差距；最後的「校正」對所有人一樣
          （有賽後統計 −11.3、暫估 −9.6），讓整體平均落在 50 附近。
        </p>
      </Section>

      <Section title="為什麼和勝負無關" index={5}>
        <p>
          <span className="font-semibold">輸贏不是計分的輸入</span>：贏了不加分、輸了不扣分。分數只看你這場做了什麼。
        </p>
        <p className="text-muted-foreground">
          贏的一隊通常輸出、推塔做得比較多，所以分數和勝負會有關聯；但輸的一隊一樣可以拿高分——
          輸的那一隊分數最高的人標 ACE，贏的那一隊最高的標 MVP。
        </p>
      </Section>

      <Section title="暫估（數字後面的 *）" index={6}>
        <p>
          「幫隊友補了多少血、上了多少盾」只有遊戲的賽後統計有。採集器會自動抓，但有些場次抓不到（或十個人不齊全）。
          這些場次的分數標成<span className="font-semibold">暫估</span>，數字後面加一個{" "}
          <span className="font-mono text-muted-foreground">*</span>。
        </p>
        <ul className="space-y-1.5">
          <Bullet head="治療">用對局明細裡的總治療量（治療到 2 人以上才算），乘上輔助平常「補隊友占總治療」的比例（約 0.62），把自己回血的部分扣掉。</Bullet>
          <Bullet head="輔助的護盾">依這隻英雄在有統計的場次平常多上多少盾、身上有幾件輔助裝，再乘上這場的參團活躍度來估。</Bullet>
          <Bullet head="比重微調">輔助在暫估場次，保人的比重稍微降低，挪到參團與控場。</Bullet>
        </ul>
        <p className="text-muted-foreground">實測輔助在有統計與暫估場次的平均分數差不到 0.6 分。破盾裝在暫估場次看不到敵方護盾量，只算重創。</p>
      </Section>

      <Section title="怎麼看差距" index={7}>
        <p>
          <span className="font-semibold">差不到 {WORK_GAP} 分就當作一樣。</span>
          畫面上和 50 差不到 {WORK_GAP} 分的分數用灰色，差 {WORK_GAP} 分以上才上色（
          <span className="text-win">高於 50</span>／<span className="text-loss">低於 50</span>）。
        </p>
        <p>
          同一個人每場分數本來就會上下跳，單場的標準差大約 <span className="font-mono">{WORK_SD}</span> 分——
          一場 70、一場 35 很正常，<span className="font-semibold">單場高低說明不了實力</span>。看平均要看場數：
        </p>
        <ErrorFunnel />
        <Caption>帶子是平均分數的 95% 誤差範圍，灰帶是和 50 差不到 {WORK_GAP} 分的「差不多」。場數越多帶子越窄：平均 10 場是 ±{halfWidth(10)}、30 場 ±{halfWidth(30)}、100 場 ±{halfWidth(100)}。</Caption>
        <p className="text-muted-foreground">
          也就是說：平均 30 場是 55 分，真正的水準大概在 {55 - halfWidth(30)}～{55 + halfWidth(30)} 之間。
          好友比較頁的「強勢」就是整段範圍都高於 50；差 {WORK_GAP} 分以上但範圍還跨過 50 的，只算「偏強」。
        </p>
      </Section>

      <LiveExample />
    </div>
  )
}

/** 實例：目前帳號（標題列的帳號與期間）最近一場有計分的對局，九項加減分怎麼加回總分。
 *  和戰報計分板同一組語意層欄位（WORK_MEASURES），畫法也是同一個 ContribBars。 */
function LiveExample() {
  const { apply } = useFilters()
  const res = useCube(
    apply({
      dimensions: ["participants.participant_key", WORK_STATUS, "matches.played_at", "champions.name"],
      measures: WORK_MEASURES,
      filters: [{ member: WORK_STATUS, operator: "equals", values: ["complete", "estimate"] }],
      order: { "matches.played_at": "desc" },
      limit: 1,
      timezone: "Asia/Taipei",
    }),
  )
  const row: CubeRow | undefined = res.rows[0]
  const key = row ? String(row["participants.participant_key"]) : null
  const roles = useBuildRoles(key ? [key] : [])
  const role = key ? roles.get(key) : undefined

  return (
    <Panel
      title="實際算一場"
      caption="你最近一場有計分的對局（依標題列的帳號與期間）"
      hint={"每一列是這一項讓總分加減幾分。\n小數點各自四捨五入，加起來可能差 0.1。"}
      index={8}
      refreshing={res.refreshing}
    >
      {res.error ? (
        <QueryError error={res.error} />
      ) : res.loading ? (
        <LoadingBlock height={360} label="找最近一場…" />
      ) : !row ? (
        <EmptyState>目前的帳號與期間裡沒有計分過的對局。</EmptyState>
      ) : (
        <ExampleBody row={row} role={role} />
      )}
    </Panel>
  )
}

function ExampleBody({ row, role }: { row: CubeRow; role?: string }) {
  const score = workScore(row)
  const est = isEstimate(row)
  const sumOf = (keys: readonly string[]) => keys.reduce((s, k) => s + (num(row[k]) ?? 0), 0)
  const genes = sumOf(WORK_PARTS.map((c) => c.pts))
  const mods = sumOf(WORK_MODS.map((m) => m.pts))
  const base = num(row[WORK_BASE]) ?? 0
  const raw = 50 + genes + mods + base
  // matches.played_at 是 UTC、沒有時區字尾（沒有 granularity 時 timezone 參數不作用），轉成本地時間
  const rawAt = String(row["matches.played_at"] ?? "")
  const at = rawAt ? new Date(rawAt.endsWith("Z") ? rawAt : `${rawAt}Z`) : null
  const pad = (n: number) => String(n).padStart(2, "0")
  const playedAt = at ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}` : ""

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{String(row["champions.name"] ?? "—")}</span>
        {role && <RoleChip role={role} />}
        <span className="text-muted-foreground">{playedAt}</span>
        <span className="ml-auto flex items-baseline gap-1">
          <span className="text-xs text-muted-foreground">本場貢獻</span>
          <ContribScore dev={score === null ? null : score - 50} className="text-2xl font-bold" />
          {est && <span className="text-muted-foreground">*</span>}
        </span>
      </div>

      <Waterfall row={row} score={score} />
      <Caption>從 50 分出發，往右（<span className="font-semibold text-win">這個顏色</span>）是加分、往左（<span className="font-semibold text-loss">這個顏色</span>）是扣分，一項一項累加；最後的「校正」對所有人都一樣，讓整體平均落在 50 附近。</Caption>

      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-[13px] tabular-nums leading-relaxed">
        <div className="flex flex-wrap gap-x-2">
          <span>50</span>
          <span className="text-muted-foreground">九項</span>
          <span>{signed(genes)}</span>
          <span className="text-muted-foreground">高光／失誤</span>
          <span>{signed(mods)}</span>
          <span className="text-muted-foreground">校正</span>
          <span>{signed(base)}</span>
          <span>＝ {raw.toFixed(1)}</span>
        </div>
        <div className="mt-1 text-muted-foreground">
          {raw < 0 || raw > 100 ? `超出範圍，裁到 ${score === null ? "—" : Math.round(score)}` : `四捨五入 ＝ ${score === null ? "—" : Math.round(score)}`}
        </div>
      </div>
      {est && (
        <p className="text-xs text-muted-foreground">
          * 這一場是暫估：沒有賽後統計的隊友治療護盾量，治療與輔助護盾用估的。
        </p>
      )}
    </div>
  )
}
