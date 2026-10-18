import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DATE_RANGES, useFilters, type SiteDefaults } from "@/lib/filters"
import { MAYHEM_QUEUE_ID } from "@/lib/cube"

const ALL = "all"

/** 全站預設查詢區間：打開頁面時的模式、期間、版本起點。只有管理員看得到這個按鈕（後端 /api/config 也會再擋一次）。 */
export function SiteDefaultsDialog() {
  const { canEditDefaults, siteDefaults, saveSiteDefaults, versionOptions, queueId, dateRange, versionFrom } = useFilters()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SiteDefaults>(siteDefaults)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (!canEditDefaults) return null

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setDraft(siteDefaults)
      setMessage(null)
    }
  }
  const save = async () => {
    setSaving(true)
    const error = await saveSiteDefaults(draft)
    setSaving(false)
    setMessage(error ? { ok: false, text: error } : { ok: true, text: "已儲存。之後打開頁面的人都會從這組條件開始。" })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" aria-label="預設查詢區間">
          <SlidersHorizontal className="size-3.5" />
          預設
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>預設查詢區間</DialogTitle>
          <DialogDescription>
            所有人打開頁面時，全域篩選從這組條件開始；進來之後每個人仍可自己切換，切換不會改到這裡。只有管理員能改。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
          <span className="text-muted-foreground">模式</span>
          <Select value={draft.queue ?? ALL} onValueChange={(v) => setDraft({ ...draft, queue: v === ALL ? null : v })}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={MAYHEM_QUEUE_ID}>只看 Mayhem</SelectItem>
              <SelectItem value={ALL}>全部模式</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-muted-foreground">期間</span>
          <Select value={draft.dateRange} onValueChange={(v) => setDraft({ ...draft, dateRange: v })}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-muted-foreground">版本</span>
          <Select value={draft.versionFrom ?? ALL} onValueChange={(v) => setDraft({ ...draft, versionFrom: v === ALL ? null : v })}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部版本</SelectItem>
              {/* 已存的起點不在目前資料裡（例如資料被清過）時也要選得到，否則選單會顯示空白 */}
              {draft.versionFrom && !versionOptions.some((o) => o.patch === draft.versionFrom) && (
                <SelectItem value={draft.versionFrom}>{draft.versionFrom} 之後</SelectItem>
              )}
              {[...versionOptions].reverse().map((o) => (
                <SelectItem key={o.patch} value={o.patch}>
                  <span className="font-mono">{o.patch}</span> 之後
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">「某版本之後」包含那個版本，之後出的新版本也會自動算進去。</p>

        {message && <p className={message.ok ? "text-xs text-win" : "text-xs text-loss"}>{message.text}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft({ queue: queueId, dateRange, versionFrom })}
            title="手動勾選的版本不能當預設，只會帶入版本起點"
          >
            帶入目前的篩選
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "儲存中…" : "儲存為預設"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
