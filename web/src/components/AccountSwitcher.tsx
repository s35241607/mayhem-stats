import { useEffect, useMemo, useState } from "react"
import { Search, User, Check, Radar, UserCheck, Unlink, CornerDownRight, CalendarRange, FilterX } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { DATE_RANGES, useFilters, type Player } from "@/lib/filters"
import { useCube } from "@/hooks/useCube"
import { iconUrl } from "@/lib/cube"
import { useNavigate } from "@/lib/nav"
import type { PageId } from "@/components/AppShell"
import { cn } from "@/lib/utils"

/** 「同場過的玩家」一次最多畫幾個。 */
const OTHERS_SHOWN = 50

/** 搜尋到幾個英雄／增幅就夠了：再多代表字打得不夠，繼續輸入比往下捲快 */
const ENTITIES_SHOWN = 8

type PageEntry = { id: PageId; label: string; group: string }

/** 全站指令面板（Ctrl/⌘ + K）：跳頁、直接打開某隻英雄或某個增幅、換期間、換帳號。
 *  原本只能換帳號；找「某隻英雄的數字在哪」得先想它在哪一頁、點過去、再從表格裡找。
 *  英雄與增幅清單開面板時才查（走 lib/cube 的快取，開第二次不會再問）。
 *
 *  帳號的部分：用可搜尋的面板而不是下拉選單——
 *  資料庫裡的玩家有上千個，下拉選單捲起來根本找不到人。
 *
 *  不把所有人都畫出來：兩千多個項目時，按 Ctrl+K 要 1 秒才出現、每打一個字 0.3 秒
 *  （cmdk 每次都要對全部項目打分、排序、重畫）。我的帳號與追蹤中的永遠全列；
 *  同場過的玩家只畫場次最多的前幾十個，打字時換成符合的前幾十個，並寫明還有幾個沒列出。
 *  篩選自己做（名稱或 puuid 的子字串），cmdk 只負責鍵盤上下選與 Enter。 */
export function AccountSwitcher({ pages }: { pages: PageEntry[] }) {
  const { account, players, setAccount, viewer, apply, dateRange, setDateRange, drills, clearDrills } = useFilters()
  const go = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const champions = useCube(
    open ? apply({ measures: ["participants.games"], dimensions: ["champions.name", "champions.icon_path"], order: { "participants.games": "desc" }, limit: 500 }) : null,
  )
  const augments = useCube(
    open ? apply({ measures: ["participants.games"], dimensions: ["augments.name", "augments.icon_path"], order: { "participants.games": "desc" }, limit: 500 }) : null,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch("") // 下次打開從頭開始，不留上次的搜尋字
  }

  const pick = (player: Player) => {
    setAccount(player)
    changeOpen(false)
  }
  /** 做完一件事就關面板 */
  const run = (fn: () => void) => () => {
    fn()
    changeOpen(false)
  }

  // 頁面、英雄、增幅、動作：沒打字時只列頁面（英雄和增幅太多，列出來只是雜訊）
  const jump = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const hit = (text: string) => text.toLowerCase().includes(needle)
    const entities = (rows: typeof champions.rows, nameKey: string, iconKey: string) =>
      needle
        ? rows
            .filter((r) => hit(String(r[nameKey] ?? "")))
            .slice(0, ENTITIES_SHOWN)
            .map((r) => ({ name: String(r[nameKey]), icon: iconUrl(r[iconKey] as string | null), games: Number(r["participants.games"] ?? 0) }))
        : []
    return {
      pages: needle ? pages.filter((p) => hit(p.label) || hit(p.id)) : pages,
      champions: entities(champions.rows, "champions.name", "champions.icon_path"),
      augments: entities(augments.rows, "augments.name", "augments.icon_path"),
      ranges: needle ? DATE_RANGES.filter((r) => hit(r.label) || hit("期間")) : [],
      clearDrills: !!drills.length && (!needle || hit("清除下鑽篩選")),
    }
  }, [search, pages, champions.rows, augments.rows, drills.length])

  // API 已經依「我、追蹤中、場次多到少」排好，這裡只分組、篩選，不重排
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const hit = (p: Player) =>
      !needle || (p.riot_id ?? "").toLowerCase().includes(needle) || p.puuid.toLowerCase().includes(needle)
    const matched = players.filter(hit)
    const others = matched.filter((p) => !p.is_me && !p.tracked)
    return {
      me: matched.filter((p) => p.is_me),
      tracked: matched.filter((p) => !p.is_me && p.tracked),
      others: others.slice(0, OTHERS_SHOWN),
      hidden: Math.max(0, others.length - OTHERS_SHOWN),
      searching: needle !== "",
    }
  }, [players, search])
  const { me, tracked, others } = groups

  const row = (player: Player) => (
    <CommandItem
      key={player.puuid}
      value={`${player.riot_id ?? player.puuid} ${player.puuid}`}
      onSelect={() => pick(player)}
      // 這版 shadcn 的 CommandDialog 結構有點問題（DialogHeader 被放在
      // DialogContent 外面），實測 onSelect 不會觸發，所以點擊路徑另外接上。
      onClick={() => pick(player)}
      className="gap-2"
    >
      <Check
        className={cn(
          "size-3.5 shrink-0",
          account?.puuid === player.puuid ? "opacity-100 text-primary" : "opacity-0",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{player.riot_id ?? player.puuid.slice(0, 8)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{player.games} 場</span>
    </CommandItem>
  )

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 min-w-0 items-center gap-2 rounded-md border bg-secondary/50 px-2.5 text-sm transition hover:bg-accent"
        data-tip={"搜尋與跳轉（Ctrl/⌘ + K）\n頁面、英雄、增幅、期間、帳號"}
        aria-label="搜尋與跳轉"
      >
        <User className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-[150px] truncate font-medium">
          {account?.riot_id ?? "載入中…"}
        </span>
        {account && !account.is_me && (
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
            他人
          </Badge>
        )}
        <Search className="size-3 shrink-0 text-muted-foreground" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title="搜尋與跳轉"
        description="跳到某一頁、打開某隻英雄或增幅、換期間或帳號"
      >
        {/* 這版 shadcn 的 CommandDialog 沒有內建 <Command> 包裹層，
            少了它 cmdk 的子元件找不到 store，開啟時會直接拋錯。
            shouldFilter={false}：篩選在上面的 groups 自己做（理由見元件說明）。 */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜尋頁面、英雄、增幅、玩家…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>找不到符合的頁面、英雄、增幅或玩家。玩家只有出現在你對局裡的人才查得到。</CommandEmpty>
            {jump.pages.length > 0 && (
              <CommandGroup heading="頁面">
                {jump.pages.map((p) => (
                  <CommandItem key={p.id} value={`page ${p.id}`} onSelect={run(() => go(p.id))} onClick={run(() => go(p.id))} className="gap-2">
                    <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.group}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {jump.champions.length > 0 && (
              <CommandGroup heading="英雄">
                {jump.champions.map((c) => {
                  const open = run(() => go("champions", { champ: c.name }))
                  return (
                    <CommandItem key={c.name} value={`champion ${c.name}`} onSelect={open} onClick={open} className="gap-2">
                      {c.icon ? <img loading="lazy" decoding="async" src={c.icon} alt="" className="size-5 shrink-0 rounded bg-icon-tile" /> : <span className="size-5 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.games} 場</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {jump.augments.length > 0 && (
              <CommandGroup heading="增幅">
                {jump.augments.map((a) => {
                  const open = run(() => go("augments", { aug: a.name }))
                  return (
                    <CommandItem key={a.name} value={`augment ${a.name}`} onSelect={open} onClick={open} className="gap-2">
                      {a.icon ? <img loading="lazy" decoding="async" src={a.icon} alt="" className="size-5 shrink-0 rounded bg-icon-tile" /> : <span className="size-5 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{a.games} 場</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {(jump.ranges.length > 0 || jump.clearDrills) && (
              <CommandGroup heading="動作">
                {jump.ranges.map((r) => {
                  const set = run(() => setDateRange(r.value))
                  return (
                    <CommandItem key={r.value} value={`range ${r.value}`} onSelect={set} onClick={set} className="gap-2">
                      <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">期間：{r.label}</span>
                      {dateRange === r.value && <Check className="size-3.5 shrink-0 text-primary" />}
                    </CommandItem>
                  )
                })}
                {jump.clearDrills && (
                  <CommandItem value="clear drills" onSelect={run(clearDrills)} onClick={run(clearDrills)} className="gap-2">
                    <FilterX className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">清除下鑽篩選（{drills.length} 個）</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {me.length > 0 && <CommandGroup heading="我的帳號">{me.map(row)}</CommandGroup>}
            {tracked.length > 0 && (
              <CommandGroup heading="追蹤中">{tracked.map(row)}</CommandGroup>
            )}
            {others.length > 0 && (
              <CommandGroup heading="同場過的玩家">{others.map(row)}</CommandGroup>
            )}
            {groups.hidden > 0 && (
              <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
                {groups.searching
                  ? `還有 ${groups.hidden} 位符合，繼續輸入縮小範圍`
                  : `只列出場次最多的 ${OTHERS_SHOWN} 位，其餘 ${groups.hidden} 位請輸入名稱搜尋`}
              </p>
            )}
          </CommandList>
        </Command>
        {/* 綁錯了要有地方解除：目前選的是自己綁定的帳號時才出現 */}
        {viewer?.canLink && account?.is_me ? (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {viewer.name ? `${viewer.name} 綁定了` : "已綁定"} {account.riot_id}
            </span>
            <LinkButton player={account} linked />
          </div>
        ) : null}
      </CommandDialog>
    </>
  )
}

/** 綁定或解除「這是我」的按鈕。只在公開鏡像用 Discord 登入時出現。 */
function LinkButton({ player, linked }: { player: Player; linked: boolean }) {
  const { viewer, setLinked } = useFilters()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!viewer?.canLink) return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      setError(await setLinked(player.puuid, !linked))
    } catch {
      setError("連不上伺服器")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button size="sm" variant={linked ? "ghost" : "default"} onClick={toggle} disabled={busy}>
        {linked ? <Unlink className="size-3.5" /> : <UserCheck className="size-3.5" />}
        {linked ? "這不是我" : "這是我的帳號"}
      </Button>
    </span>
  )
}

/** 目前在看別人時的提示。避免看到數字卻以為是自己的。 */
export function ViewingOtherBanner() {
  const { account, isMe, viewer } = useFilters()
  if (!account || isMe) return null
  // 用 Discord 登入但還沒綁過帳號：不是在看別人，是系統還不知道他是誰
  const unknown = viewer?.canLink && viewer.linked.length === 0
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      <Radar className="size-4 shrink-0 text-primary" />
      {unknown ? (
        <span className="min-w-0 flex-1">
          還不知道哪個是你的帳號。用上方的帳號切換（Ctrl/⌘ + K）找到自己，再按「這是我的帳號」，
          之後每次登入都會直接看你自己的數據。
        </span>
      ) : (
        <>
          <span>
            目前看的是 <b>{account.riot_id}</b> 的數據，不是你自己的。
          </span>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            （只涵蓋資料庫裡有的對局，通常遠少於他的實際戰績）
          </span>
        </>
      )}
      <LinkButton player={account} linked={false} />
      {unknown && <span className="w-full text-xs text-muted-foreground">目前顯示的是 {account.riot_id}。</span>}
    </div>
  )
}
