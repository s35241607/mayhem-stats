---
name: ui-conventions
description: 這個專案前端的主題與動畫規範。只要動到 web/src 的畫面——新增或修改頁面、元件、圖表、顏色、動畫、主題——就必須先讀。內含：顏色只能用主題變數、圖表取色與 ECharts 的陷阱、新增主題的配色驗證、切頁不卡頓的動畫規則，以及對應的驗證腳本。
---

# 前端主題與動畫規範

這些規則每一條都來自實際踩過的坑，括號裡是當時量到或看到的結果。
改完要跑最後一節的驗證，不是看起來對就算數。

## 一、主題

### 結構

- 主題定義在 `web/src/index.css`，以 `<html data-theme="...">` 切換；清單與分組在 `web/src/lib/theme.tsx`。
- 兩大類各四種：**暗色**（霓虹 neon、終端 matrix、熔岩 lava、紫電 violet）、**亮色**（晨光 daylight、薄荷 mint、櫻花 sakura、沙丘 sand）。預設霓虹。
- 選擇存在 `localStorage`（`mayhem-theme`），切換時用 View Transition 交叉淡化。

### 顏色規則

1. **不准寫死顏色。** 一律用主題 token：Tailwind 的 `bg-card`、`text-muted-foreground`、`text-win`、`bg-icon-tile`……
   或 CSS 變數。寫死的 `#fff`、`rgba(255,255,255,.04)` 在亮色主題會直接看不見。
2. **語意 token 各司其職，不要混用：**
   | token | 用途 |
   |---|---|
   | `--primary` | 介面強調（選中、按鈕、平均線、焦點） |
   | `--win` / `--loss` | 發散配色的兩極：勝率高於／低於你的平均 |
   | `--data` | 單一系列資料（勝率走勢、場次長條、散布點）。刻意和勝敗不同色，才不會被讀成好壞 |
   | `--icon-tile` | 圖示底塊。增幅圖示是白色線條的透明圖，亮色主題也必須墊深色（沒墊的話白線直接消失） |
   | `--glow` / `--grid-line` | 頁面底的光暈與格線 |
3. **勝敗不用紅綠。** 紅綠色盲分不出來。現有每組兩極都是冷色對暖色。
4. **發散配色的中點是無彩的灰。** 用 `neutralGray()`，不要直接混主題的灰字色——霓虹的灰字偏藍，混出來的中性格和勝方藍色撞色。

### 圖表（ECharts）取色

- 只能透過 `charts.tsx` 的 `useTheme()` 取色，它依主題名稱重算，切換主題時圖表才會跟著換。
- `cssVar()` 會先把顏色轉成 `rgba()`。**不要把 CSS 變數原值直接交給 ECharts**：原值可能是 `oklch()`，
  滑鼠移上去時 zrender 做 hover 內插解析失敗，拋出 `reading 'colorStops'`，接著的 click 事件不觸發
  （時段頁「點某天」在真實瀏覽器裡一直沒反應就是這個）。
- 半透明、漸層用 `alpha()`、`fade()`；座標軸用 `axisLabel()`、`splitLine()`；tooltip 用 `baseTooltip()`。
- 折線要自訂點的填色時，必須指定 `symbol: "circle"`。預設的 `emptyCircle` 會無視 `itemStyle.color` 一律填白。
- **不准雙 y 軸。** 兩個量級不同的指標，拆成上下兩個 grid 共用 x 軸（見 `DailyChart`）。
- AG Grid 的配色在 `AgTable.tsx` 的 `useGridTheme()`，同樣依主題重算，亮色主題用 `colorSchemeLight`。

### 新增或修改一個主題

1. 在 `index.css` 複製一個同類（暗色或亮色）的區塊，改 `data-theme` 與所有變數——**每個變數都要給**，
   漏一個就會吃到預設主題的值。亮色主題要給深色的 `--icon-tile`。
2. 在 `theme.tsx` 的 `THEMES` 加一筆（`dark`、`swatch` 依序是底色、介面強調、勝、敗）。
3. **勝／敗／資料色必須跑 dataviz 驗證器**，不准憑感覺挑（載入 `dataviz` skill，腳本在它的 `scripts/`）：
   ```bash
   node scripts/validate_palette.js "<勝>,<敗>,<資料>" --mode dark --surface "<--card 的值>" --pairs all
   ```
   亮色主題用 `--mode light`。要全部 PASS；只允許「資料色 vs 勝或敗」的 WARN（它們不會出現在同一張圖），
   勝敗兩極之間必須 PASS。暗色的亮度帶是 L 0.48–0.67，太亮的霓虹色會被擋，調暗再試。
4. 跑下面的主題截圖腳本，暗色、亮色各至少看一個，確認圖示、資料點、熱力圖中性格都看得見。

## 二、動畫

動畫分兩種：**版面動畫**（卡片、清單、頁面怎麼出現）和**資料動畫**（數字怎麼跑、圖表怎麼長）。
只有淡入淡出太單調，資料要讓人看得出「從哪裡長上來」。

### 規則

1. **版面動畫只用 CSS，只動 `opacity` / `transform`。** 這兩個屬性在合成器執行緒跑，主執行緒被 AG Grid 或
   ECharts 卡住時動畫不會停。不要用 `motion` / JS 逐幀做進場效果
   （原本用 motion，實測英雄頁切換最長停一格 201ms，動畫跟著停）。
2. 用現成的 utility（定義在 `index.css`），錯開量用 `style={{ "--stagger": "…ms" }}` 給：
   | class | 用途 | 時長 |
   |---|---|---|
   | `page-enter` | 換頁（App 已套用，頁面不用自己加） | 200ms |
   | `rise` | 卡片由下浮現；`Kpi` / `Panel` 已內建，傳 `index` 會依序錯開（上限 240ms） | 280ms |
   | `slide-in` | 清單列由左滑入（對局卡片、最常用清單），每列錯開 30～40ms（上限 400ms） | 320ms |
   | `reveal` | 沒有自己資料動畫的內容（表格、逐場列表外框）從骨架換上時淡入 | 220ms |
   不要自己另寫時長。需要新的動畫就加 utility 並更新這張表。
3. **資料動畫可以用 JS，但有兩個條件**：等換頁進場動畫結束才開始（`useAfterPageEnter()`），
   而且**不准每一幀都 setState**（七個 KPI × 60 幀 = 420 次重新渲染）。現成的做法：
   | 對象 | 怎麼做 | 時長 |
   |---|---|---|
   | 數字（KPI、清單裡的場次與勝率） | `<CountUp text="45.3%" />`：從 0 或上一次的值跑到目標，逐幀直接改 textContent。字串裡多個數字會一起跑；時間、日期、區間（`21:00`、`0-5`）自動不跑 | 900ms，easeOutExpo |
   | 長條 | 從軸線長出、依序錯開（`animationDelay: (i) => stagger(i)`）；長條上的數字加 `label.valueAnimation: true` 跟著跑 | 900ms，每根錯開 45ms（上限 500ms） |
   | 折線 | 由左往右畫（ECharts 預設），比長條慢一點 | 1200ms |
   | 參考線（平均、50%） | `markLine.animationDelay` 設在主資料長到約 60～70% 時才出現 | 400ms |
   | 熱力圖格子 | 由左往右一欄一欄掃進來 | 500ms |
   | 散布點 | 從中心彈出（`backOut`）、依序錯開 | 700ms |
   時長常數在 `lib/motion.ts`（`COUNT_UP_MS`、`CHART_GROW_MS`、`STAGGER_MS`、`STAGGER_CAP_MS`），
   預設值由 `ResponsiveChart` 統一套上，個別圖表只加錯開和特例。資料更新（換篩選、換主題）走 450ms 的過渡，
   不重長一次，所以錯開一律加 `animationDelayUpdate: 0`。
4. **絕對不要無條件呼叫 ECharts 的 `chart.resize()`。** 它會把進行中的動畫直接跳到終點——
   原本 `onChartReady` 和 ResizeObserver 都無條件 resize，結果每張圖的生長動畫都被吃掉，長條一出現就是滿的。
   只在 `chart.getWidth()` 和容器寬度真的不同時才 resize（`ResponsiveChart` 已處理）。
5. **不做離場動畫。** 新頁要等舊頁離場才掛載，查詢會晚送出（實測回訪一頁 280ms 裡 214ms 在等動畫）。
6. **重元件等進場動畫結束才掛。** AG Grid、ECharts 已經用 `useAfterPageEnter()`（`lib/motion.ts`）處理。
   新增其他重元件（大型清單、編輯器……）照做，等待期間畫**同高度**的佔位，版面才不會跳。
7. **骨架與內容等高。** 骨架高度要接近真正內容，否則換上內容時整頁往下推（CLS）。
8. **尊重「減少動態」。** CSS 那邊由 `index.css` 的 `prefers-reduced-motion` 縮成 1ms；JS 的資料動畫要自己檢查
   `prefersReducedMotion()`（`CountUp` 直接顯示最終值、`ResponsiveChart` 關掉 ECharts 動畫）。新動畫不要繞過它。

## 三、驗證

服務要先在 `127.0.0.1:5057` 跑著（重啟方式見 `verify-change` skill）。前端改動要先 `cd web && npm run build`。

### 切頁流暢度（動到版面、動畫、重元件時）

```bash
node .claude/skills/ui-conventions/scripts/perf_nav.mjs before.json 9450
# 改完、build 之後
node .claude/skills/ui-conventions/scripts/perf_nav.mjs after.json 9451
```

看每一頁的三個數字：
- **動畫期最長**：點下去 250ms 內最長的一格停頓。回訪頁應在 ~40ms 以內，超過 60ms 就是看得出來的卡頓。
- **CLS**：版面跳動，應接近 0（目前除儀表板 0.025 外都 ≤ 0.005）。
- **long tot / max**：長任務。表格頁有 50～140ms 是 AG Grid 本身的成本，重點是它不能落在動畫期間。

量測陷阱：
- 某些列出現「幀數 0」或上萬毫秒的長任務，是機器被別的東西佔住或分頁被節流，**那一輪作廢重跑**，不要拿來比。
- 改前改後要在同一台機器、同一份資料上量。要量舊版可以 `git stash push -- web`（`web/dist` 有進版控，
  stash 後服務就是舊版），量完 `git stash pop`。
- 前一次的 Edge 還沒完全關時，同一個除錯埠會連不上——換一個埠號。

### 資料動畫（動到數字或圖表動畫時）

- **數字最終值必須和不跑動畫時一模一樣**：CDP 送 `Emulation.setEmulatedMedia`
  `{ features: [{ name: "prefers-reduced-motion", value: "reduce" }] }` 讀一次卡片文字，
  和正常模式等 3 秒後的文字逐字比對（格式化千分位、小數位最容易出錯）。
- **圖表真的有在長**：在頁面內用 `setTimeout` 每 40ms 對 canvas 取一條 `getImageData`（整條一次讀，
  不要逐像素讀——那樣一次取樣就要好幾秒），數彩色像素，數量要隨時間遞增到穩定。
  一出現就是最終值，代表動畫被吃掉了（先查有沒有人呼叫 `resize()`）。

### 主題（動到顏色、圖表、主題時）

```bash
node .claude/skills/ui-conventions/scripts/theme_check.mjs neon
node .claude/skills/ui-conventions/scripts/theme_check.mjs daylight
```

輸出每頁截圖 `th_<主題>_<序號>.png`，並對每張圖做滑鼠 hover 掃描，回報例外數——**必須是 0**
（hover 例外代表有顏色沒轉成 rgba）。打開截圖實際看，亮色主題特別檢查圖示與資料點。

### 收尾

- `cd web && npx tsc -b && npx oxlint src`，只看自己動到的檔案有沒有新警告。
- `git status` 確認 `web/dist` 有重新 build 進去。
