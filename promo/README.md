# 宣傳影片

62 秒、1920×1080、30 fps 的 Mayhem 戰績功能介紹片，用 [Remotion](https://www.remotion.dev/)（用 React 寫影片）製作。
獨立於 `web/`：不影響前端建置、`web/dist` 與對外鏡像。

成品在 `promo/out/mayhem-promo.mp4`（約 47 MB，`out/` 不進版控，隨時可以重渲染）。要分享的小檔可以再壓一份：

```bash
npx remotion ffmpeg -i out/mayhem-promo.mp4 -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart out/mayhem-promo-web.mp4
```

## 內容

節奏刻意放慢：每個功能一個場景（6 秒，儀表板 8 秒），左邊固定一欄文字（功能名、一句話、要點），右邊是那一頁的**整頁長圖**。
鏡頭在兩到三個停靠點各停約 2 秒，圈出那塊區域、其餘畫面壓暗，左邊對應的要點同步亮起；頂端的導覽列標出現在講到哪個功能。

| 秒 | 內容 |
|---|---|
| 0–6 | 三個問題（勝率多少？哪個增幅最強？什麼時候最會贏？）→ Mayhem 戰績 |
| 6–14 | 儀表板：整體勝率與近況／每日趨勢／出裝、增幅、時段一覽 |
| 14–50 | 英雄、增幅裝置、陣容、時段、敗因分析、自由探索（各 6 秒） |
| 50–54 | 「12 個分析頁面」總覽牆，加上沒有單獨介紹的頁面名稱 |
| 54–62 | 客戶端開著就自動採集、資料留在你的電腦、Logo 與「接住每一場。」 |

文案要對得上畫面上真的看得到的東西（`src/features.ts`）；網站改版後重拍截圖，再回來檢查。

## 技術

| 效果 | 做法 |
|---|---|
| 3D 運鏡 | `src/parts/Stage.tsx`：真實畫面截圖當 3D 平面，鏡頭 = 反向移動整個世界；`src/motion.ts` 的 `steps()` 寫鏡頭腳本（步驟可重疊） |
| 聚光 | `Spotlight`：圈出區域並把其餘畫面壓暗；區域座標來自截圖時量到的真實 DOM 位置，不靠目測 |
| 動態字幕 | `src/parts/Type.tsx`：`Slam`（重擊）、`MaskUp`（遮罩滑出） |
| 動態模糊 | `@remotion/motion-blur` 的 `CameraMotionBlur`：每幀 5 個子幀、快門 180° |
| 節拍同步 | 120 BPM，一拍 15 幀、一小節 60 幀；停靠點與換圖表都落在拍點上 |
| 音樂與音效 | `scripts/make-audio.mjs` 純程式合成（無素材、無版權問題），畫面事件的時間全從 `timeline.json` 算出 |
| 真實 UI | `scripts/capture.mjs` 從本機服務拍整頁長圖，**玩家名稱在資料進畫面前就換成代號** |

### 動態模糊的兩個坑

- **子幀數不能無限加。** 每個子幀層是 8-bit、不透明度 1/n，深色（背景 `#070b16` 的紅色 7/n）會被四捨五入掉，
  n 一大整個暗部就偏色（試過 24：發綠、出現色塊）；n ≤ 10 才安全。要讓殘影不梳齒，靠的是降低鏡頭的峰值速度
  （`easeCam`、鏡頭步驟重疊），不是加子幀。
- 動態模糊會給元件小數幀：動畫函式要能吃小數；會跳變的東西（倒數數字）用 `Math.floor(frame)`，否則相鄰兩個數字會疊成重影。

### 響度

音軌用純線性增益校正到約 −15 LUFS（真峰值不超過 −1.5 dBTP）。**不要改回 ffmpeg 的 `loudnorm` 兩段式**：
它的「線性模式」在量測值超出範圍時會悄悄切成動態模式，把安靜的開場拉高，段落之間的音量對比就被抹掉了。

## 賽季回顧（個人化影片）

和上面那支宣傳片不同：這支是**每個人不一樣**的，資料來自本機的語意層。合成放在 `web/src/recap/`，
兩個地方共用同一份：

- 網頁的「賽季回顧」頁用 `@remotion/player` 直接播放，配色是目前主題的 CSS 變數（切主題就跟著換）；
- 這裡渲染成 mp4 給人分享，配色是 `src/theme.ts` 的 `RECAP_PALETTE`（霓虹主題的實際色碼）。

```bash
npm run recap                                   # 本機帳號、全部期間 → out/recap.mp4（約 32 秒，渲染約 80 秒）
npm run recap -- --from 2026-09-01 --to 2026-09-30
npm run recap -- --puuid <puuid>                # 指定帳號（預設是標成「我」的那個）
npm run recap -- --names                        # 保留隊友真名。預設換成「固定隊友」，因為影片是拿去分享的
npm run recap -- --frames 30,200,450            # 不渲染影片，只把這幾幀存成 out/recap-stills/*.png 檢查版面
npm run recap -- --json                         # 只印出撈到的資料
```

需要本機服務開著（預設 `http://127.0.0.1:5057`，`--server` 可改）。場景長度依資料決定：沒有隊友、沒有增幅資料的人，對應場景整段拿掉。

- **查詢與亮點的挑法只有一份**：`web/src/recap/data.ts`。網頁和這支腳本都呼叫它，所以兩邊數字一定一樣；
  改了要用手寫 SQL 對過（場次、勝場、擊殺、時數、英雄前三、增幅、星期與時段、連勝連敗、隊友）。
- **`web/src/recap/` 裡不能碰 `@/` 別名、Tailwind 或瀏覽器全域**，只有相對路徑的 import——渲染這邊的 webpack 讀不到它們。
- **兩份 React 會互相看不到 context**：那些檔案預設從 `web/node_modules` 找 `react`／`remotion`，而這個專案也有一份。
  `webpack-override.mjs` 把它們一律指向這裡的那份（`remotion.config.ts` 與 `scripts/recap.mjs` 都套用）；
  兩邊的 `remotion`、`@remotion/*` 版本也必須相同（目前 4.0.529）。
- 字型：拉丁字母與數字用宣傳片載入的 Geist，中文用系統字型——英雄與增幅名稱每個人不同，事先切好的 Noto 切片不會涵蓋。
- Studio 預覽（`npm run studio` → Recap）用的是 `src/recapSample.ts` 的虛構資料。

## 常用指令

```bash
cd promo && npm install
npm run audio           # 第一次要先合成音軌（public/audio/ 不進版控）
npm run studio          # 開 Remotion Studio，拖時間軸預覽
npm run render          # 輸出 out/mayhem-promo.mp4
npx remotion render src/index.ts Promo out/silent.mp4 --muted   # 無聲版，自己配音樂
node scripts/stills.mjs 30,90,150 0.5                            # 抽幾幀存成 out/stills/*.jpg 快速看版面
```

這台機器（16 核心、RTX 3060 Ti）整片約 10～16 分鐘。`--concurrency=12 --gl=angle` 比預設快 2.5 倍（用 GPU）：

```bash
npx remotion render src/index.ts Promo out/mayhem-promo.mp4 --concurrency=12 --gl=angle
```

## 改時間軸

`src/timeline.json` 是單一來源：場景長度（小節數）、鏡頭停靠點（幀，落在 15 的倍數）、換圖表的幀、開場問題的幀。
畫面（`src/Promo.tsx`、`src/features.ts`）與音軌（`scripts/make-audio.mjs`）都讀它。改完重跑 `npm run audio` 再渲染。

## 素材怎麼重做

- **畫面截圖**（`public/shots/`）：服務在跑的狀態下 `npm run shots`。拍整頁長圖（視窗拉到頁面高度），並把各卡片的位置寫進 `shots.json`。
  截完會用 `/api/accounts` 的真實名單反查畫面文字，撞到任何一個就整批作廢、不寫檔。只拍不會顯示他人名稱的頁面。
  這台機器正在跑的後端若比前端舊，不認得新頁面的網址（會回 404），所以腳本是用點側邊欄切頁，不直接開網址。
- **字型**（`public/fonts/`）：Noto Sans TC、Geist（OFL 授權）。`node scripts/fetch-fonts.mjs` 依 `src/` 裡實際出現的字只下載需要的切片；
  改了畫面文字後重跑一次。
- **音軌**：`npm run audio`。
- **噪點**（`public/noise.png`）：`npm run noise`。疊在暗色背景上抖色，避免 H.264 出現色帶。

## 配色

`src/theme.ts` 複製自 `web/src/index.css` 的「霓虹」主題。這個專案讀不到網站的 CSS 變數，網站改預設主題時請一併更新。

## 授權

Remotion 對個人與 3 人以下的公司免費；超過要買公司授權，見 [remotion.pro](https://www.remotion.pro/license)。
