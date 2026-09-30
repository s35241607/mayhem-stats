import { AbsoluteFill, Sequence } from "remotion"
import type { RecapProps } from "./types.ts"
import { Backdrop, SceneFrame } from "./kit.tsx"
import { scenesFor } from "./timeline.ts"

export function Recap({ data, palette, fontFamily, origin }: RecapProps) {
  const scenes = scenesFor(data)
  // 每個場景的起點 = 前面所有場景的長度加總
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((sum, s) => sum + s.frames, 0))
  return (
    <AbsoluteFill style={{ fontFamily, color: palette.fg }}>
      <Backdrop palette={palette} />
      {scenes.map(({ id, frames, view: View }, i) => (
        <Sequence key={id} from={starts[i]} durationInFrames={frames} layout="none">
          <SceneFrame duration={frames}>
            <View data={data} palette={palette} origin={origin} />
          </SceneFrame>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
