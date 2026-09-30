import { Config } from "@remotion/cli/config"
// @ts-expect-error 純 JS 的小檔，沒有型別宣告；回傳的就是傳進去的 webpack 設定
import { dedupeReact } from "./webpack-override.mjs"

// UI 截圖要的是銳利的字，用 PNG 逐幀、H.264 CRF 18。
Config.setVideoImageFormat("png")
Config.setCodec("h264")
Config.setCrf(18)
Config.setPixelFormat("yuv420p")
Config.setOverwriteOutput(true)
Config.overrideWebpackConfig(dedupeReact)
