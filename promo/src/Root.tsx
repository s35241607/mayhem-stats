import React from "react"
import { Composition } from "remotion"
import { DURATION, Promo } from "./Promo"
import { FPS, H, RECAP_PALETTE, W } from "./theme"
import { Recap } from "../../web/src/recap/Recap"
import { recapDuration, RECAP_SIZE } from "../../web/src/recap/timeline"
import { RECAP_SAMPLE } from "./recapSample"

// 賽季回顧的字：拉丁字母與數字走宣傳片載入的 Geist，中文交給系統字型——
// 英雄與增幅的名稱每個人都不一樣，事先切好的 Noto 字型切片不會涵蓋到。
const RECAP_FONT = "PromoGeist, 'Microsoft JhengHei', 'PingFang TC', sans-serif"

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={W} height={H} defaultProps={{ audio: true }} />
    <Composition
      id="Recap"
      component={Recap}
      durationInFrames={recapDuration(RECAP_SAMPLE)}
      {...RECAP_SIZE}
      defaultProps={{ data: RECAP_SAMPLE, palette: RECAP_PALETTE, fontFamily: RECAP_FONT, origin: "" }}
      // 長度依實際資料決定：沒有隊友、沒有增幅資料的人會少幾個場景
      calculateMetadata={({ props }) => ({ durationInFrames: recapDuration(props.data) })}
    />
  </>
)
