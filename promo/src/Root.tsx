import React from "react"
import { Composition } from "remotion"
import { DURATION, Promo } from "./Promo"
import { FPS, H, W } from "./theme"

export const Root: React.FC = () => (
  <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={W} height={H} defaultProps={{ audio: true }} />
)
