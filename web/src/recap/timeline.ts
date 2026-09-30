import type { ComponentType } from "react"
import type { RecapData, RecapPalette } from "./types.ts"
import { FPS, H, W } from "./helpers.ts"
import { Augments, Champions, Highlights, Intro, Outro, Partner, Volume, When } from "./scenes.tsx"

export type SceneProps = { data: RecapData; palette: RecapPalette; origin: string }
export type Scene = { id: string; frames: number; view: ComponentType<SceneProps> }

/** 這份資料要播哪些場景。沒有隊友、沒有增幅資料的人，對應的場景整段拿掉，不留空白畫面。 */
export function scenesFor(data: RecapData): Scene[] {
  const all: (Scene | false)[] = [
    { id: "intro", frames: 90, view: Intro },
    { id: "volume", frames: 135, view: Volume },
    data.champions.length > 0 && { id: "champions", frames: 135, view: Champions },
    !!(data.augmentMostPicked || data.augmentBest) && { id: "augments", frames: 120, view: Augments },
    data.peak !== null && { id: "when", frames: 135, view: When },
    { id: "highlights", frames: 120, view: Highlights },
    data.partner !== null && { id: "partner", frames: 105, view: Partner },
    { id: "outro", frames: 120, view: Outro },
  ]
  return all.filter((s): s is Scene => !!s)
}

export const recapDuration = (data: RecapData) => scenesFor(data).reduce((sum, s) => sum + s.frames, 0)

export const RECAP_SIZE = { width: W, height: H, fps: FPS } as const
