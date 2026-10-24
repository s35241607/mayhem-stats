import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronRight, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { MARK, stripTip, tipLevelClass } from "@/lib/tip"

const CHIP = "inline-flex items-center rounded-md border px-1.5 text-[11px] leading-[18px] whitespace-nowrap align-[1px]"

function Mark({ kind, text }: { kind: string; text: string }) {
  switch (kind) {
    case "big":
      return <b className="font-mono text-[15px] font-bold tabular-nums text-foreground">{text}</b>
    case "n":
      return <b className="font-mono font-semibold tabular-nums text-foreground">{text}</b>
    case "win":
      return <b className="font-mono font-semibold tabular-nums text-win">{text}</b>
    case "loss":
      return <b className="font-mono font-semibold tabular-nums text-loss">{text}</b>
    case "mute":
      return <span className="text-muted-foreground">{text}</span>
    case "rank":
      return <span className="mr-1.5 rounded bg-primary/15 px-1.5 font-mono text-[11px] font-bold leading-[18px] text-primary">{text}</span>
    case "lv":
      return <span className={cn(CHIP, tipLevelClass[text] ?? "border-border bg-muted text-foreground")}>{text}</span>
    case "tagwin":
      return <span className={cn(CHIP, "border-win/50 bg-win/15 text-foreground")}>{text}</span>
    case "tagmute":
      return <span className={cn(CHIP, "border-foreground/25 bg-muted text-foreground")}>{text}</span>
    default:
      return <>{text}</>
  }
}

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<Mark key={k++} kind={m[1]} text={m[2]} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return (
    <>
      {out.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </>
  )
}

type Block =
  | { kind: "title"; text: string }
  | { kind: "item"; label: string; text: string; subs: string[] }
  | { kind: "para"; text: string }
  | { kind: "foot"; text: string }

/** 把提示字串拆成幾塊：標題、項目（含補充行）、段落、操作提示 */
function parseTip(text: string): Block[] {
  const lines = text.split("\n")
  const blocks: Block[] = []
  lines.forEach((line, i) => {
    const lab = /^\{\{lab\|([^}]*)\}\}(.*)$/.exec(line)
    if (lab) return void blocks.push({ kind: "item", label: lab[1], text: lab[2], subs: [] })
    if (line.startsWith("> ")) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === "item") last.subs.push(line.slice(2))
      else blocks.push({ kind: "para", text: line.slice(2) })
      return
    }
    if (line.startsWith("-- ")) return void blocks.push({ kind: "foot", text: line.slice(3) })
    // 第一行夠短（像「鬥士・179 場」）就當標題；有標記的標題長一點也行（名次小標＋名字＋場次）
    const plain = stripTip(line)
    if (i === 0 && lines.length > 1 && plain.length <= (line.includes("{{") ? 30 : 24)) return void blocks.push({ kind: "title", text: line })
    blocks.push({ kind: "para", text: line })
  })
  return blocks
}

/** 全站共用的滑過提示：任何元素加上 data-tip="…"，滑過或用鍵盤聚焦就在它上方（放不下改下方）顯示主題配色的提示框，
 *  取代瀏覽器內建的 title（延遲久、樣式不能改、深色主題下是一塊白框）。
 *
 *  為什麼不是每個元素各包一個 Radix Tooltip：好友比較一頁就有兩三百個要提示的點（出裝條、英雄頭像、搭檔格子），
 *  各掛一個 Tooltip 根元件很重；這裡整頁只有一個監聽器和一個提示框，用事件委派找最近的 [data-tip]。
 *  內容是純文字，\n 會換行。 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const show = (el: Element) => {
      const text = el.getAttribute("data-tip")
      if (!text) return
      const r = el.getBoundingClientRect()
      // 上方留得下約 80px 就放上方，否則放下方
      const below = r.top < 90
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below })
    }
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null
      if (el === current.current) return
      current.current = el
      window.clearTimeout(timer.current)
      if (!el) {
        setTip(null)
        return
      }
      timer.current = window.setTimeout(() => show(el), e.type === "focusin" ? 0 : 120)
    }
    const hide = () => {
      window.clearTimeout(timer.current)
      current.current = null
      setTip(null)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && hide()
    document.addEventListener("pointerover", over)
    document.addEventListener("focusin", over)
    document.addEventListener("focusout", hide)
    document.addEventListener("pointerdown", hide)
    window.addEventListener("scroll", hide, true)
    window.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerover", over)
      document.removeEventListener("focusin", over)
      document.removeEventListener("focusout", hide)
      document.removeEventListener("pointerdown", hide)
      window.removeEventListener("scroll", hide, true)
      window.removeEventListener("keydown", esc)
    }
  }, [])

  // 量到提示框寬度之後再夾進視窗內（左右各留 8px）
  const [shift, setShift] = useState(0)
  useEffect(() => {
    if (!tip || !box.current) return
    const w = box.current.offsetWidth
    const left = tip.x - w / 2
    setShift(left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0)
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      role="tooltip"
      data-testid="tip-layer"
      className={cn(
        // 用彈出層的底色（深色主題是深底淺字），不用反白：大段說明在反白底上很刺眼、難讀
        "reveal pointer-events-none fixed z-[100] w-max max-w-[22rem] rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] leading-6 text-popover-foreground shadow-xl shadow-black/30",
      )}
      style={{
        left: tip.x + shift,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "8px" : "calc(-100% - 8px)"})`,
      }}
    >
      {parseTip(tip.text).map((b, i) => {
        if (b.kind === "title")
          return (
            <p key={i} className="mb-1.5 border-b border-border/60 pb-1.5 text-[14px] font-semibold leading-6 text-foreground">
              <Inline text={b.text} />
            </p>
          )
        if (b.kind === "item")
          return (
            <div key={i} className={cn("grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-x-2", i > 0 && "mt-2")}>
              <span className="text-xs text-muted-foreground">{b.label}</span>
              <div>
                <p className="flex flex-wrap items-baseline gap-x-1.5">
                  <Inline text={b.text} />
                </p>
                {b.subs.map((sub, j) => (
                  <p key={j} className="text-xs leading-5 text-muted-foreground">
                    <Inline text={sub} />
                  </p>
                ))}
              </div>
            </div>
          )
        if (b.kind === "foot")
          return (
            <p key={i} className="mt-2 flex items-center gap-0.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
              <Inline text={b.text} />
              <ChevronRight className="size-3.5" />
            </p>
          )
        // 沒有標記的純文字：「標題：說明」的標題加粗、說明用次一級的顏色，一眼分得出重點
        const two = !b.text.includes("{{") ? /^([^：\n]{1,8})：(.+)$/.exec(b.text) : null
        return (
          <p key={i} className={cn("text-popover-foreground/90", i > 0 && "mt-1")}>
            {two ? (
              <>
                <span className="font-semibold text-foreground">{two[1]}</span>
                <span className="text-muted-foreground">：</span>
                {two[2]}
              </>
            ) : (
              <Inline text={b.text} />
            )}
          </p>
        )
      })}
      <span
        className={cn("absolute size-2.5 rotate-45 border-border bg-popover", tip.below ? "border-t border-l" : "border-r border-b")}
        style={{ left: `calc(50% - ${shift}px)`, [tip.below ? "top" : "bottom"]: -5.5, marginLeft: -5 }}
      />
    </div>
  )
}

/** 說明的小圖示：滑過或聚焦顯示 text。版面上只留一句話，細節收進這裡 */
export function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      data-tip={text}
      data-testid="hint"
      className={cn(
        "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full align-[-3px] text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none",
        className,
      )}
    >
      <Info className="size-3.5" />
    </span>
  )
}
