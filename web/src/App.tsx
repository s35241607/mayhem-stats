import { useState } from "react"
import { Zap, X, RefreshCw, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollectorStatus } from "@/hooks/useCube"
import { MAYHEM_QUEUE_ID, type CubeFilter } from "@/lib/cube"
import { Overview } from "@/pages/Overview"
import { Champions } from "@/pages/Champions"
import { Augments } from "@/pages/Augments"
import { Players } from "@/pages/Players"
import { TimeAnalysis } from "@/pages/TimeAnalysis"
import { Pivot } from "@/pages/Pivot"

export type Drill = CubeFilter & { label: string }

export type Filters = {
  queueId: string | null
  drills: Drill[]
  addDrill: (drill: Drill) => void
  removeDrill: (index: number) => void
}

function StatusBar() {
  const status = useCollectorStatus()
  const [ingesting, setIngesting] = useState(false)

  const ingestNow = async () => {
    setIngesting(true)
    try {
      await fetch("/api/ingest", { method: "POST" })
    } finally {
      setIngesting(false)
    }
  }

  if (!status) {
    return <div className="text-sm text-muted-foreground">載入採集器狀態…</div>
  }

  const range =
    status.oldestGame && status.newestGame
      ? `${new Date(status.oldestGame).toLocaleDateString("zh-TW")} ~ ${new Date(status.newestGame).toLocaleDateString("zh-TW")}`
      : "—"

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Circle
          className={
            status.clientConnected
              ? "size-2 fill-win text-win"
              : "size-2 fill-muted-foreground text-muted-foreground"
          }
        />
        {status.clientConnected ? "客戶端已連線" : "客戶端未執行"}
        {status.phase && status.phase !== "None" && (
          <Badge variant="secondary" className="ml-1">
            {status.phase}
          </Badge>
        )}
      </span>
      <span>
        資料庫 <b className="text-foreground">{status.mayhemMatches}</b> 場 Mayhem / 共{" "}
        <b className="text-foreground">{status.totalMatches}</b> 場
      </span>
      <span>
        涵蓋 <b className="text-foreground">{range}</b>
      </span>
      {status.lastRun && (
        <span>
          上次採集{" "}
          <b className="text-foreground">
            {new Date(status.lastRun.at * 1000).toLocaleTimeString("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>
          （新增 {status.lastRun.new}）
        </span>
      )}
      <Button size="sm" variant="outline" onClick={ingestNow} disabled={ingesting}>
        <RefreshCw className={ingesting ? "animate-spin" : ""} />
        {ingesting ? "採集中…" : "立即採集"}
      </Button>
    </div>
  )
}

export default function App() {
  const [queueId, setQueueId] = useState<string | null>(MAYHEM_QUEUE_ID)
  const [drills, setDrills] = useState<Drill[]>([])

  const filters: Filters = {
    queueId,
    drills,
    addDrill: (drill) =>
      setDrills((prev) =>
        prev.some((d) => d.member === drill.member && d.values[0] === drill.values[0])
          ? prev
          : [...prev, drill],
      ),
    removeDrill: (index) => setDrills((prev) => prev.filter((_, i) => i !== index)),
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-7">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Zap className="size-6 text-primary" />
          ARAM: Mayhem 戰績 BI
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          客戶端開著時自動採集對局並存進本機資料庫，指標定義走 Cube 語意層。
          因為 Riot 對 Mayhem 封鎖公開 API、客戶端也只保留最新 100 場，資料是從開始採集那天起累積的。
        </p>
      </header>

      <Card className="mb-4">
        <CardContent className="py-1">
          <StatusBar />
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 py-1">
          <Select
            value={queueId ?? "all"}
            onValueChange={(v) => setQueueId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MAYHEM_QUEUE_ID}>只看 Mayhem</SelectItem>
              <SelectItem value="all">全部模式</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            {drills.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                點表格任一列可以下鑽該項目
              </span>
            ) : (
              drills.map((drill, index) => (
                <Badge key={index} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5">
                  {drill.label}
                  <button
                    onClick={() => filters.removeDrill(index)}
                    className="rounded-sm opacity-60 transition hover:opacity-100"
                    aria-label="移除篩選"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>

          {drills.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setDrills([])}>
              清除下鑽
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">總覽</TabsTrigger>
          <TabsTrigger value="champions">英雄</TabsTrigger>
          <TabsTrigger value="augments">增幅裝置</TabsTrigger>
          <TabsTrigger value="players">隊友 / 對手</TabsTrigger>
          <TabsTrigger value="time">時段</TabsTrigger>
          <TabsTrigger value="pivot">自由樞紐</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Overview filters={filters} />
        </TabsContent>
        <TabsContent value="champions">
          <Champions filters={filters} />
        </TabsContent>
        <TabsContent value="augments">
          <Augments filters={filters} />
        </TabsContent>
        <TabsContent value="players">
          <Players filters={filters} />
        </TabsContent>
        <TabsContent value="time">
          <TimeAnalysis filters={filters} />
        </TabsContent>
        <TabsContent value="pivot">
          <Pivot filters={filters} />
        </TabsContent>
      </Tabs>

      <footer className="mt-8 text-xs leading-relaxed text-muted-foreground">
        資料來源：本機 League 客戶端 LCU API，存於 mayhem.db，不會上傳到任何地方。
        指標定義集中在 Cube 模型（cube/model/cubes），前端只送維度與指標名稱。
      </footer>
    </div>
  )
}
