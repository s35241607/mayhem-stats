import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"
import { Panel } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import { CHANGELOG, markChangelogSeen } from "@/lib/changelog"
import { useNavigate } from "@/lib/nav"

const SEEN_KEY = "mayhem-changelog-seen"

/** 更新紀錄：最新的在上面。進來就算看過（小紅點消失），但這次進來前沒看過的幾筆標「新」。 */
export function Changelog() {
  const navigate = useNavigate()
  // 進頁那一刻的「看過到哪」，先記下來再標成已看過，「新」的標籤才不會一進來就消失
  const [seenBefore] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? ""
    } catch {
      return ""
    }
  })
  useEffect(() => markChangelogSeen(), [])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {CHANGELOG.map((entry, i) => {
        const fresh = entry.id > seenBefore
        return (
            <Panel
              key={entry.id}
              index={Math.min(i, 5)}
              title={entry.title}
              caption={entry.date}
              action={
                fresh ? <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">新</span> : undefined
              }
            >
              <ul className="space-y-1.5 text-sm">
                {entry.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {entry.page && (
                <Button size="sm" variant="outline" className="mt-3 max-sm:h-10" onClick={() => navigate(entry.page!)}>
                  去看看
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
            </Panel>
        )
      })}
    </div>
  )
}
