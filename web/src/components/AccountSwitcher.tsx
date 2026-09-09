import { useEffect, useState } from "react"
import { Search, User, Check, Radar } from "lucide-react"
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
import { useFilters, type Player } from "@/lib/filters"
import { cn } from "@/lib/utils"

/** 帳號快速切換。用可搜尋的命令面板而不是下拉選單——
 *  資料庫裡的玩家有上百個，下拉選單捲起來根本找不到人。 */
export function AccountSwitcher() {
  const { account, players, setAccount } = useFilters()
  const [open, setOpen] = useState(false)

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

  const pick = (player: Player) => {
    setAccount(player)
    setOpen(false)
  }

  const me = players.filter((p) => p.is_me)
  const tracked = players.filter((p) => !p.is_me && p.tracked)
  const others = players.filter((p) => !p.is_me && !p.tracked)

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
        title="切換帳號（Ctrl/⌘ + K）"
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
        onOpenChange={setOpen}
        title="切換帳號"
        description="所有頁面都會改成這個帳號的數據"
      >
        {/* 這版 shadcn 的 CommandDialog 沒有內建 <Command> 包裹層，
            少了它 cmdk 的子元件找不到 store，開啟時會直接拋錯。 */}
        <Command>
          <CommandInput placeholder="搜尋玩家名稱…" />
          <CommandList>
            <CommandEmpty>找不到這個玩家。只有出現在你對局裡的人才查得到。</CommandEmpty>
            {me.length > 0 && <CommandGroup heading="我的帳號">{me.map(row)}</CommandGroup>}
            {tracked.length > 0 && (
              <CommandGroup heading="追蹤中">{tracked.map(row)}</CommandGroup>
            )}
            {others.length > 0 && (
              <CommandGroup heading="同場過的玩家">{others.map(row)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

/** 目前在看別人時的提示。避免看到數字卻以為是自己的。 */
export function ViewingOtherBanner() {
  const { account, isMe } = useFilters()
  if (!account || isMe) return null
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      <Radar className="size-4 shrink-0 text-primary" />
      <span>
        目前看的是 <b>{account.riot_id}</b> 的數據，不是你自己的。
      </span>
      <span className="text-xs text-muted-foreground">
        （只涵蓋資料庫裡有的對局，通常遠少於他的實際戰績）
      </span>
    </div>
  )
}
