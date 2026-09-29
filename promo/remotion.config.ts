import { Config } from "@remotion/cli/config"

// UI 截圖要的是銳利的字，用 PNG 逐幀、H.264 CRF 18。
Config.setVideoImageFormat("png")
Config.setCodec("h264")
Config.setCrf(18)
Config.setPixelFormat("yuv420p")
Config.setOverwriteOutput(true)
