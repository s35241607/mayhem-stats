# Mayhem 戰績

在自己的電腦上，把 ARAM: Mayhem 的對戰紀錄自動存下來並做分析。

**為什麼要自己存？** Riot 官方 API 對 Mayhem 直接回 403（[官方說這是刻意的](https://github.com/RiotGames/developer-relations/issues/1109)），
所以 op.gg、u.gg 都查不到任何人的 Mayhem 戰績。而遊戲客戶端只留最新 100 場——
**被擠出去的對局就永遠消失了**。這個工具就是趁資料還在的時候把它接住。

![儀表板](docs/screenshots/dashboard.png)

## 快速開始

需要 [uv](https://docs.astral.sh/uv/) 和 [Node.js](https://nodejs.org/)。

```bash
uv sync
cd cube && npm install && cd ..
uv run app.py
```

打開 <http://127.0.0.1:5057>。League 客戶端開著（停在大廳就行）它就會自動採集，不用按任何按鈕。

<details>
<summary>建議再做一件事：擋掉 Cube 的對外連線</summary>

Cube 沒有繫結位址的設定，它的三個埠一律開在所有網路介面上，而開發模式不驗證身分。
前端已經改走 FastAPI 代理，但那些埠本身仍然開著。用**系統管理員**執行一次：

```powershell
New-NetFirewallRule -DisplayName "Mayhem: 封鎖 Cube 對外連線" -Direction Inbound -Protocol TCP -LocalPort 4000,3030,15432 -Action Block
```

不影響本機使用，Windows 防火牆不過濾 loopback。
</details>

## 畫面

### 一路挖下去：圖表 → 那一天的每一場 → 單場完整戰報

![下鑽示範](docs/screenshots/drilldown.gif)

點每日圖裡的某一天，就列出那天的每一場；再雙擊一列，就是那場 10 個人的完整戰報
（出裝、增幅、KDA、經濟）。熱力圖的格子也可以這樣點。

### 自由探索：換個圖表型態看同一份資料

![自由探索示範](docs/screenshots/explore.gif)

維度和指標可以拖曳配置，右上角隨時切換表格／長條／散布／佔比。

### 敗因分析——輸的時候，哪些數字和贏的時候不一樣

![敗因分析](docs/screenshots/losses.png)

比較一律用每分鐘，不用總量：敗局平均 17.0 分、勝局 15.1 分，光時間差就會讓敗局的雙方總傷害都變高。
除完之後才看得出「我方輸出掉 9%、敵方多 23%」——被打爆的成分大於打不動。

### 時段——什麼時候打、什麼時候贏

![時段](docs/screenshots/time.png)

熱力圖的顏色錨在你自己的平均勝率，而且會依樣本多寡收斂：一場 100% 的格子顏色很淡，
場次夠多才會真的往兩端跑。點任一天或任一格，就列出那一塊的每一場，再點進去看完整戰報。

### 增幅裝置——第三方網站給不了的資料

![增幅裝置](docs/screenshots/augments.png)

指標定義集中在語意層，自由探索的選單直接由模型產生——模型裡加一個指標，那頁就多一個選項。

## 全部分頁

| 分頁 | 看什麼 |
|---|---|
| 儀表板 | 總覽：KPI、每日趨勢、最常用英雄與增幅、什麼時候打——每張卡都連到對應分頁 |
| 對局紀錄 | 逐場瀏覽，點進去看 10 人完整戰報（出裝、增幅、數據） |
| 英雄 | 勝率排行、每隻英雄的場次、勝率、KDA、傷害佔比、參團率 |
| 增幅裝置 | 勝率排行與全部增幅；選一隻英雄就多出「加成」，看哪些增幅特別適合它 |
| 隊友 / 對手 | 同隊朋友數與勝率、和誰同隊會贏、遇到誰會輸；點進去看同場時的英雄與定位拆解、每一場戰報，也能直接追蹤 |
| 時段 | 每天的場次與勝率、星期 × 時段熱力圖、星期別勝率，都能點進去看每一場 |
| 節奏與連敗 | 上一場的結果、當日第幾場（分段／逐場）對表現的影響 |
| 敗因分析 | 勝局與敗局的數字對照、對局長度與勝率 |
| 自由探索 | 三種模式：**自由組合**（維度與指標自選，可拖曳配置、可看產生的 SQL）、**下鑽路徑**（例如英雄 › 增幅 › 對局長度、同場玩家 › 隊友或對手 › 我的英雄，一層一層點下去，每層都能換維度，走到底列出每一場）、**交叉矩陣**（任兩個維度交叉看勝率或其他指標，點一格接著往下鑽） |
| 追蹤對象 | 除了自己以外，還要一併採集誰的戰績 |

表格都可以排序、逐欄篩選、匯出 CSV。雙擊維度可以下鑽——例如點某隻英雄，
再切到其他分頁就只看這隻英雄。

## 架構

```
League 客戶端 ──LCU API──> FastAPI（採集器 + 靜態站台）──> SQLite mayhem.db
                              │                                    ↑
                              └── /api/cube 代理 ──> Cube 語意層 ───┘
                                        ↓
                            React + shadcn/ui + AG Grid + ECharts
```

只有一個行程要顧：`uv run app.py` 會一併把 Cube 拉起來。
指標定義集中在 `cube/model/cubes/`，所以「勝率」在每一頁的算法保證一致。

<details>
<summary>採集怎麼運作（含冪等性）</summary>

兩層保險：

- **即時層（每 30 秒）**——監看客戶端狀態，偵測到「剛打完一場」就立刻採集。
- **補漏層（每 5 分鐘）**——固定掃最新 100 場清單補缺，兜住工具沒開、當機、客戶端重啟。

去重靠三層，重複執行不會產生重複資料：

1. 先查資料庫已有哪些 `game_id`，已知的連明細都不用抓
2. 寫入用 `INSERT OR IGNORE`，主鍵是 `(platform_id, game_id)`
3. 整場包在單一 transaction 裡

每場的**原始 JSON 也會完整存下來**。舊資料無法重抓，將來想分析目前沒解析的欄位時只能靠它——
目前資料庫裡有 20 幾個欄位就是後來靠這份備份補回去的。
</details>

<details>
<summary>想從外面連進來（手機、朋友）</summary>

服務只綁 `127.0.0.1`，所以要從外面連一定得透過通道（Tailscale、ngrok、Cloudflare Tunnel），
不需要也不應該開 port forwarding。通道那頭「拿到網址的人就是你」，所以**對外開放前先打開公開模式**：

```powershell
$env:MAYHEM_PUBLIC = "1"
$env:MAYHEM_PASSWORD = "自己想一個夠長的密碼"
uv run app.py
```

公開模式做三件事：

1. **全站唯讀**——`POST /api/ingest` 與 `POST /api/accounts/track` 一律回 403，畫面上的寫入入口也收起來。
   採集照常在本機自動跑；要改追蹤名單就在這台電腦上開 `127.0.0.1:5057`。
2. **其他玩家的 Riot ID 換成穩定代號**（`玩家 A1B2C3`）。同場玩家的名稱是做隊友分析的必要資料，
   但那是別人的遊戲帳號，不該因為你把網站開出去就一起公開。代號用帶鹽的雜湊，鹽存在 `.public_salt`（不進版控）。

   站台是給「一起打的那群人」看的話，代號反而讓他們查不到自己——
   設 `MAYHEM_MASK_NAMES=0` 可以關掉（`mirror.pyw` 裡有一個 `MASK_NAMES` 開關）。
   **前提是站台有密碼**：看得到名字的只有拿到密碼的人。網址要給不認識的人就別關。
3. **設了 `MAYHEM_PASSWORD` 就要先登入**才看得到任何東西（含前端本身與圖示）。
   session 放在記憶體，重啟要重新登入；連續猜錯 10 次會整站冷卻 5 分鐘。

沒設這個變數時行為完全不變。

**密碼這層是必要的**：免費的通道服務都只給你「誰拿到網址誰就能看」的公開網址，
沒有自己的網域就掛不上它們的身分驗證（Cloudflare Access 需要你自己的網域、
ngrok 的 OAuth 要付費），所以驗證只能做在這裡。

通道怎麼選（都不需要訪客安裝任何東西）：

| | 網址 | 免費額度 | 備註 |
|---|---|---|---|
| **Tailscale Funnel** | 固定 `機器名.tailnet.ts.net` | 有頻寬限速，沒有月請求上限 | 只有你這台要裝 Tailscale |
| Cloudflare Quick Tunnel | 隨機，**每次重啟就換** | 沒有實質上限 | 不用帳號，一行指令 |
| ngrok 免費版 | 固定 `*.ngrok-free.app` | **20k 請求／月**、1GB／月 | 每個新瀏覽器要按掉警告頁 |

這個站台的圖示是一張一個請求，實測一次全新瀏覽器冷啟動（儀表板 + 對局紀錄）約 **400 個請求、8.9MB**，
所以 ngrok 的 20k／月大約只夠 50 次。要常開建議用前兩個。

### 對外唯讀、本機照舊：跑一個鏡像

公開模式是整個行程的旗標——通道進來的請求來源也是 `127.0.0.1`，後端分不出
「這是我本人」還是「這是網址被轉出去的人」。所以要兩種行為就跑兩個行程：

```powershell
.\.venv\Scripts\pythonw.exe mirror.pyw       # 唯讀鏡像，預設 5058
tailscale funnel --bg 5058                    # 通道只指向鏡像那個埠
```

鏡像要有驗證才會啟動，兩種擇一（都有就兩種都能進）：

**Discord 登入**（建議：每個人是獨立身分，踢人就是把名字從白名單拿掉）。
到 [Discord Developer Portal](https://discord.com/developers/applications) 建一個 application，
在 OAuth2 分頁把 `https://你的網址/auth/callback` 加進 Redirects，然後寫 `.public_oauth`：

```json
{
  "client_id": "你的 Client ID",
  "client_secret": "你的 Client Secret",
  "allow": ["朋友的discord帳號", "另一個", "123456789012345678"],
  "redirect_uri": "https://你的網址/auth/callback"
}
```

`allow` 可以寫 Discord 使用者名稱或數字 ID。**名稱會變、ID 不會**，所以被擋下來的人
畫面上會直接顯示他的 ID，複製進白名單就好。改白名單不用重啟——每次登入都重讀這個檔。

要「某個 Discord 群的人都能看」就加 `allow_guild`（在 Discord 開啟開發者模式後，
右鍵伺服器 → 複製伺服器 ID）；想再限縮就加 `allow_roles`（右鍵身分組 → 複製身分組 ID）：

```json
{
  "allow": ["自己的帳號"],
  "allow_guild": "伺服器 ID",
  "allow_roles": ["身分組 ID"]
}
```

三者可以並存：在 `allow` 上、或是那個群的成員（且有指定身分組），兩者之一成立就放行。

權限只要 `identify`（id、使用者名稱、頭像）；有設 `allow_guild` 時才多要
`guilds.members.read`——它只問「這個人在不在**你指定的那一個**群」，
而不是 `guilds` 那種把對方加入的所有伺服器清單都拿回來的做法。不拿 email。

**共用密碼**（備援）：把密碼寫進 `.public_password`，單獨一行、至少 12 個字元。
沒有個別身分，外流就得全體換。

- **5057（本機）**：照舊。可寫、真名、不用登入。
- **5058（鏡像）**：唯讀、要登入。名稱遮不遮由 `mirror.pyw` 的 `MASK_NAMES` 決定。和本機共用同一個 `mayhem.db` 與同一份 Cube，
  但不採集、不建表、不管 Cube 的生死——那些都是本機那份的工作。
- 記錄在 `mirror.log`（誰登入成功、誰被白名單擋下來都會寫進去）。
  兩個設定檔都沒有就不啟動：與其開一個沒有鎖的公開網址，不如不要開。
- `/logout` 可以登出自己；重啟服務則是把所有人的 session 一起作廢。

鏡像和本機服務一樣有排程工作（`MayhemStatsMirror`），登入後 90 秒啟動——
比本機那份（30 秒）晚，讓 Cube 先起來。不然重開機之後 Funnel 還在、
但 5058 沒人聽，朋友點進去會拿到 502。

```powershell
Get-ScheduledTaskInfo -TaskName MayhemStatsMirror    # 看上次執行狀況
Disable-ScheduledTask -TaskName MayhemStatsMirror    # 暫時停用（下次開機不自動開）
Unregister-ScheduledTask -TaskName MayhemStatsMirror -Confirm:$false   # 移除
```

關掉對外：`tailscale funnel --https=443 off`。

另外兩件事：

- **Cube 那三個埠的防火牆規則是必做的**（上面「擋掉 Cube 的對外連線」那節）。
  它的開發模式不驗證身分，4000 埠等於整個資料庫任人讀。用 Tailscale 時尤其重要——
  tailnet 上的其他裝置也算「外面」。
- **通道只能指向 5057**，不要指向 4000。

代號不是密碼學等級的匿名：知道鹽、又剛好猜中某個 Riot ID 的人可以自己算來對照。
它做到的是「回應裡不再帶著別人的遊戲帳號」。真的一點都不能外流，就別開公開網址，用只有自己連得到的通道。

</details>

<details>
<summary>開機自動啟動（Windows）</summary>

已註冊排程工作 `MayhemStatsCollector`，登入後 30 秒以隱藏視窗啟動，執行 [autostart.pyw](autostart.pyw)。

```powershell
Get-ScheduledTaskInfo -TaskName MayhemStatsCollector   # 看上次執行狀況
Disable-ScheduledTask -TaskName MayhemStatsCollector   # 暫時停用
Enable-ScheduledTask  -TaskName MayhemStatsCollector   # 恢復
Unregister-ScheduledTask -TaskName MayhemStatsCollector -Confirm:$false   # 移除
```

服務已經在跑時再手動執行一次不會出事——`autostart.pyw` 偵測到 port 5057 被佔用就自己退出。
</details>

<details>
<summary>資料存在哪</summary>

專案目錄下的 `mayhem.db`（SQLite）。**裡面的舊資料無法重建，建議偶爾備份。**

| 表 | 內容 |
|---|---|
| `matches` | 對局表頭 + 原始 JSON + 本地時間欄位 |
| `match_participants` | 每場 10 人的完整數據 |
| `participant_augments` / `participant_items` | 長格式，方便統計 |
| `dim_*` | 英雄／增幅／裝備的名稱與圖示對照 |
| `ingest_runs` | 採集稽核紀錄 |

時間欄位（`local_date` / `local_weekday` / `local_hour`）是採集時就用本地時區算好存進去的。
不能留給查詢層算——Cube 的 server 行程跑在 UTC 下，SQLite 的 `'localtime'` 在那裡等於 UTC，
時段分析會整個偏移。
</details>

<details>
<summary>改前端</summary>

原始碼在 `web/`。**建置產物 `web/dist` 有一起進版控**，所以平常執行不需要 npm：

```bash
cd web && npm install && npm run build
```

開發時可以 `npm run dev`（另一個埠），API 會自動代理到 5057。
</details>

<details>
<summary>找不到客戶端 / 連線失敗</summary>

- 確認 League 客戶端**正在執行**（登入大廳就可以）。
- 工具會自動嘗試 Windows / Mac 的常見安裝路徑。
- 剛重開過客戶端的話 lockfile 會變，採集器下一輪自動重讀，不用手動處理。
- 客戶端沒開時工具照常可用，只是英雄和增幅的圖示會空白——那些圖檔是即時跟客戶端要的。
</details>

## 隱私

所有運算和儲存都在你自己的電腦上，不會把任何資料送到任何伺服器。

資料庫裡會有同場其他玩家的名稱（做隊友分析的必要資料），一樣只留在本機。

**上面的截圖與 GIF 裡，所有玩家名稱都是假的**——錄製時在 API 層就換成假名了，
不是事後修圖。隊友頁和對局列表這種會整排列出他人帳號的畫面，一律不放進 repo。
