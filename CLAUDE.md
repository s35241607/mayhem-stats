# mayhem-stats

ARAM: Mayhem 的本機戰績採集與分析工具。FastAPI（`app.py`）+ Cube 語意層（`cube/`）+ React 前端（`web/`）。
一個人開發：改動直接 commit 到 `main`，不走分支／PR。

## 動手前必讀的 skill

| 要做的事 | skill |
|---|---|
| 動到 `web/src` 的任何畫面：頁面、元件、圖表、顏色、動畫、主題 | `ui-conventions` |
| 驗證數字、量效能、重啟服務、截圖 | `verify-change` |

## 測試

- 後端：`uv run python -m unittest discover -s tests`（`tests/`）。
- 前端與整條路徑：`cd web && npm run test:e2e`（Playwright，`web/e2e/`，約 14 分鐘）。打在已經在跑的服務上、用真實資料，
  數字一律和 `e2e/oracle.py` 讀 `mayhem.db` 的獨立 SQL 對；寫入類請求（採集、追蹤、綁定）一律攔下，不會動到資料。
  改了前端要先 `npm run build`，測的是 `web/dist`。標成 `test.fail` 的是已知問題，修好後它會「意外通過」而失敗，到時把 `test.fail` 拿掉。
  細節見 `web/e2e/README.md`。

## 不能違反的規則

- **顏色只用主題 token**（`bg-card`、`text-win`、CSS 變數），不寫死色碼；圖表只透過 `charts.tsx` 的 `useTheme()` 取色。
- **版面動畫只用 `index.css` 的 CSS utility**（`page-enter` / `rise` / `slide-in` / `reveal`），只動 opacity / transform。
  **資料動畫**用現成的 `<CountUp>` 與 `ResponsiveChart` 的生長動畫，要等進場動畫結束、不准逐幀 setState；不要無條件呼叫 ECharts `resize()`。
- **新增或改主題配色必須跑 dataviz 的 `validate_palette.js`**，並用 `ui-conventions` 的腳本做截圖與 hover 檢查。
- **數字一律和獨立手寫的 SQL 對過**才算驗證；效能改動要有改前的數字。
- **語意層只手動改 `cube/model/**.yml`**。不要用 Cube Playground 的 Generate Data Model，它會把整個模型換成自動產生的版本（被蓋掉時 `git restore cube/model` 並刪掉多出來的檔案）。
- **Cube 跑正式模式**（`cube/.env` 的 `CUBEJS_DEV_MODE=false`）：開發模式不驗證身分，而 4000 埠開在所有網卡上。
  直接打 4000 要帶 `cube_process.auth_header()` 的 JWT；Playground 與 SQL API 都關了。
  改 yml 仍會自動生效（`cube/cube.js` 的 `schemaVersion`），不要為了方便改回開發模式。
- **有視窗函數的衍生表 cube（builds、comp_context、contribution、participant_context）讀的是預先算好的 `mat_*` 表**：
  規則寫在各 cube 的 `meta.materialize.sql`，`features.py` 在啟動時與每輪採集後照它重建。
  改這段 SQL **不會**被 Cube 的熱重載套用——要重啟服務或 `uv run features.py`。
  新的衍生表 cube 若要對全部參賽者跑視窗函數，也照這個做法，不要每個查詢現算（資料十倍時一個查詢十幾秒）。
- **貢獻分數的規格與實測依據在 `docs/contribution-scoring.md`**：規則本體在 `contribution.yml` 的 `meta.materialize.sql`，兩邊一起改。
  全站只有一個分數：**本場貢獻 v3**（`contribution.yml` → `mat_contribution`，欄位 `work_score`）。計分板、對局卡片、MVP／ACE、英雄頁、
  好友比較頁（含「打法」、稱號、徽章）都用它；不要再加第二套分數（v2、perf、score、builds 的 perf_index 都已刪除）。
  八個基因（輸出、承傷＝承受＋自身減免、治療護盾隊友、控場、K/DA、推塔、清兵、功能裝）先和同一場的人比、再和同出裝定位的平均比，
  固定權重加總；**每個人八項都算，不依定位挑項目**（使用者要求：坦克打出高輸出就要高分）。校正常數與權重寫死，
  **改任何常數、權重或對照表都要升 `score_version`，跑 `analysis/scoring_v3_fit.py --write` 與 `analysis/scoring_v3_check.py`（獨立 Python 逐筆比對）**。
  K/DA 是使用者 2026-10-24 要求加回來的（取代「死亡不扣分」），它和推塔有一半是結果，權重刻意壓低；不要把金錢、勝負放進輸入。
  前端門檻 `WORK_GAP` 與 `WORK_SD` 跟本場貢獻的標準差綁在一起；基因的標籤與權重在 `hooks/useContribution.ts` 的 `WORK_PARTS`。
  對局明細沒有護盾與治療隊友的量；賽後統計端點有，採集器自動存進 `eog_snapshots` 並拆進 `eog_player_stats`，
  「治療護盾」有這份資料（本場十人齊全）就用它，沒有的場次退回含自補的治療量並標暫估（`score_status = 'estimate'`）。
- **`cube/model/views/` 是給 AI Agent 與外部工具的查詢入口**，前端不用、自由探索頁會濾掉。在 cube 加了對外有用的欄位，記得一併加進對應的 view，並補上 description。
- **聚合走 Cube，逐列走 `/api/matches`；新的可下鑽維度一律用 `game_ids`**，不要再往 `/api/matches` 加篩選參數。
  作法：用和圖表同一組條件向 Cube 查 `<cube>.game_id`，再交給 `<DrillPanel query gameIdKey>`（`components/MatchList.tsx`）。
  維度的定義只能有語意層一份——後端自己再抄一份分組界線或視窗函數，語意層改規則時副本不會跟著動，
  會變成「圖上 12 場、點進去 9 場」而且沒有人發現。
  留在後端的只有範圍條件（帳號、模式、日期／星期／時段、同場某人）與英雄、增幅這種單純等值。
- **repo 是公開的**：不能提交其他玩家的 Riot ID、puuid（程式、文件、commit 訊息、截圖都算）；`mayhem.db`、`cube/.env`、`*.log` 不進版控。
- 前端改完要 `cd web && npm run build`：`web/dist` 有進版控，服務直接讀它。
- **這台機器上跑著一個對外開放的唯讀鏡像**（`mirror.pyw`，5058 埠，Tailscale Funnel 指向它，
  排程工作 `MayhemStatsMirror`）。動到 `app.py` 時記得它也會載入同一份程式：
  `MAYHEM_PUBLIC` 會開啟唯讀、名稱遮罩（可用 `MAYHEM_MASK_NAMES` 關）、Discord 登入與查詢速率限制；
  `MAYHEM_MIRROR` 讓它不建表、不採集、不管 Cube 的生死。改完要一併重啟鏡像，
  不然外面跑的是舊版。`.public_oauth`（含 client secret）、`.public_salt`、`.public_state.db`（登入 session 與朋友各自綁定的帳號）絕對不能進版控。
