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
- **有視窗函數的衍生表 cube（builds、comp_context、contribution、participant_context、swing）讀的是預先算好的 `mat_*` 表**：
  規則寫在各 cube 的 `meta.materialize.sql`，`features.py` 在啟動時與每輪採集後照它重建。
  改這段 SQL **不會**被 Cube 的熱重載套用——要重啟服務或 `uv run features.py`。
  新的衍生表 cube 若要對全部參賽者跑視窗函數，也照這個做法，不要每個查詢現算（資料十倍時一個查詢十幾秒）。
  swing（翻盤）讀時間軸：`match_timelines.raw_gz` 是 zlib 壓縮的 JSON，SQL 裡用 `features.py` 註冊的 `inflate()` 解開再 `json_each`；
  yml 的 `sql: >` 會把多行接成一行，SQL 註解要用 `/* */`，不能用 `--`。
- **貢獻分數的規格與實測依據在 `docs/contribution-scoring.md`**：規則本體在 `contribution.yml` 的 `meta.materialize.sql`，兩邊一起改。
  全站只有一個分數：**本場貢獻 v5.4**（設計代號 `v5-B` 修訂版，`contribution.yml` → `mat_contribution`，欄位 `work_score`）。計分板、對局卡片、MVP／ACE、英雄頁、
  好友比較頁（含「打法」、稱號、徽章）都用它；不要再加第二套分數（v3、v2、perf、score、builds 的 perf_index 都已停用或刪除）。
  九個計分基因（輸出＝依敵方前排數 `enemy_front` 與對局血腥度 `pace_k` 調整，高輸出時享動態轉型斜率加成、承受＝0.62 減免＋0.38 承受〔高輸出享負向承傷豁免〕、擊殺〔坦／輔高輸出解鎖有效擊殺加分〕、參團＝依敵方前排數與 `pace_k` 調整、治療護盾隊友、控場＝時間與 cc_duration 融合〔射/刺正控場只加不扣，其餘定位高輸出／高承傷享以攻代守負分豁免〕、推塔 `turret_dmg`、清兵、功能裝）採 **100% 跨場絕對基準**（同出裝定位中位數／IQR 與全局中位數／IQR，並以 16.5 分鐘為基準做冪次去時長修正 `α` 與抗尾端冪次縮放 `p=0.84`），依定位權重加總（輔助以 `tank_w` 連續混合承受與保人，並以 70% 同定位＋30% 全局混比 `ka_mix`；暫估局將 `0.06×(1-tank_w)` 移往參團與控場；高位 `c_pts0 > 15` 乘 `1.18` 延伸）；不再強迫每位玩家或每個定位收斂到 50。
  另納入 `match_kill_events`（單殺、>=65% 後期參團、±10s 換頭／真孤立死亡〔無友方擊殺且友方僅自己死亡〕／後期掉點）、`match_building_events`（僅純單人拆毀建築加分，不計首塔與多人分攤）、連殺／輔助團戰連鎖、對塔傷害、金幣轉換效率（移除一血／終結／負向經濟懲罰）、坦／輔／鬥跨界高輸出（`b_util_dmg`）、EOG 限定非坦輔順手治療與 `b_util_cc` 高控場獎勵等高光加分（`pts_bonus`，連同 `pts_a` 與跨界／控場加分總上限 +15）與關鍵失誤／消極扣分（`pts_penalty`，下限 -18），加上單一全域基準校正 `pts_base`（`score_status='complete'` 用 EOG `-11.295682`，`estimate` 用 `-9.569918`），保證 12 項 `pts_*` 與 `pts_base` 加總精確等於 `work_score - 50`（再裁 `[0, 100]`）。
  **改任何常數、權重或對照表都要升 `score_version`，跑 `uv run python analysis/scoring_v5_fit.py --write`、`uv run features.py` 與 `uv run python analysis/scoring_v5_check.py`（獨立 Python 逐筆比對）**。
  `gene_kda` 仍算出來給「打法」看，不直接作為核心權重；不要把勝負放進輸入。
  前端門檻 `WORK_GAP`（4）與 `WORK_SD`（20.8）跟同玩家組內標準差綁在一起；九個基因標籤在 `hooks/useContribution.ts` 的 `WORK_PARTS`，加減修正項在 `WORK_MODS`，全域校正標籤在 `WORK_BASE`。
  對局明細沒有護盾與治療隊友的量；賽後統計端點有，採集器自動存進 `eog_snapshots` 並拆進 `eog_player_stats`，
  「治療護盾」有這份資料（本場十人齊全）就用它，沒有的場次對治療依 `units_healed >= 2 ? total_heal/mins : 0` 乘 `h_scale`（`0.620922`）對齊，輔助另依 `calib_champ_shield`＋終場輔助裝數量（`max(0, 240×min(3, n_sup_items) - 0.25×h_scale×x_h)`）貝氏先驗乘參團活躍度估算未捕獲的隊友護盾，並標暫估（`score_status = 'estimate'`）。
- **`cube/model/views/` 是給 AI Agent 與外部工具的查詢入口**，前端不用、自由探索頁會濾掉。在 cube 加了對外有用的欄位，記得一併加進對應的 view，並補上 description。
- **聚合走 Cube，逐列走 `/api/matches`；新的可下鑽維度一律用 `game_ids`**，不要再往 `/api/matches` 加篩選參數。
  作法：用和圖表同一組條件向 Cube 查 `<cube>.game_id`，再交給 `<DrillPanel query gameIdKey>`（`components/MatchList.tsx`）。
  維度的定義只能有語意層一份——後端自己再抄一份分組界線或視窗函數，語意層改規則時副本不會跟著動，
  會變成「圖上 12 場、點進去 9 場」而且沒有人發現。
  留在後端的只有範圍條件（帳號、模式、日期／星期／時段、同場某人）與英雄、增幅這種單純等值。
- **自由探索工作台**（`web/src/explore/`）只組語意層已有的成員：分析規格 `Spec` 裡沒有 SQL。樞紐表的小計／總計由語意層逐層重算，
  不准把下一層加起來；計算欄位只對聚合結果做四則運算，要對明細算就回 `cube/model` 加指標。存下來的卡片與儀表板在 `.explore_items.json`
  （`/api/explore/items`，本機與鏡像兩個行程讀同一個檔），篩選值可能含玩家名稱，不進版控。細節見 `ui-conventions`。
- **repo 是公開的**：不能提交其他玩家的 Riot ID、puuid（程式、文件、commit 訊息、截圖都算）；`mayhem.db`、`cube/.env`、`*.log` 不進版控。
- **PWA**：`web/public/` 的 `manifest.webmanifest`、`sw.js`、圖示（PNG 由 `web/scripts/build-icons.mjs` 從 `app-icon.svg` 產生）由 `app.py` 的 `PWA_FILES` 逐檔放行（公開模式未登入也要拿得到）。
  `sw.js` 只快取外殼與 `/assets/`，**絕對不要讓它快取 `/api`、`/auth`、`/login`**（資料有登入與名稱遮罩）。新增頁面要同時加進 `app.py` 的頁面白名單與 `sw.js` 的 `PAGES`。
- 前端改完要 `cd web && npm run build`：服務（含鏡像）直接讀 `web/dist`。`web/dist` 不進版控，commit 只放原始碼。
- **這台機器上跑著一個對外開放的唯讀鏡像**（`mirror.pyw`，5058 埠，Tailscale Funnel 指向它，
  排程工作 `MayhemStatsMirror`）。動到 `app.py` 時記得它也會載入同一份程式：
  `MAYHEM_PUBLIC` 會開啟唯讀、名稱遮罩（可用 `MAYHEM_MASK_NAMES` 關）、Discord 登入與查詢速率限制；
  `MAYHEM_MIRROR` 讓它不建表、不採集、不管 Cube 的生死。改完要一併重啟鏡像，
  不然外面跑的是舊版。`.public_oauth`（含 client secret）、`.public_salt`、`.public_state.db`（登入 session 與朋友各自綁定的帳號）絕對不能進版控。
