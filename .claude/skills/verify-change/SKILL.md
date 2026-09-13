---
name: verify-change
description: 在這個專案裡驗證一個改動是否真的正確、真的變快、畫面真的對。當要確認 Cube 指標的數字、量效能的改前改後、重啟服務、或需要對網頁截圖時使用。內含這個環境特有的陷阱（內嵌瀏覽器窗格會被節流、Cube 行程跑在 UTC、孤兒行程）。
---

# 驗證改動

這個專案吃過好幾次「看起來對但其實錯」的虧。以下是每次都要照做的部分。

## 重啟服務

前端改動**不用**重啟（靜態檔每次從磁碟讀，重新 build 就好）。
後端 Python 改動要重啟。Cube 模型（`cube/model/**.yml`）會自己熱重載，等 12～15 秒。

重啟要用跟開機自動啟動一樣的方式，才不會變成我這個 shell 的子行程：

```powershell
$root = "C:\Users\User\vsdbg\Downloads\mayhem-stats"
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*app.py*' -or $_.CommandLine -like '*autostart.pyw*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Start-Process -FilePath "$root\.venv\Scripts\pythonw.exe" -ArgumentList "autostart.pyw" -WorkingDirectory $root
Start-Sleep -Seconds 45
```

**一定要連 4000 埠的 node 一起殺。** 殺掉 Python 不會帶走 Cube（Windows 不會連坐子行程），
下次啟動會看到「已經有 Cube 在 4000 埠上，沿用現有的那份」——那份跑的是舊模型。

啟動訊息在 `autostart.log` 尾端。

## 驗證數字：一律和獨立手寫的 SQL 對

Cube 算出來的東西**不能只看它自己**。已經抓到過的錯：主鍵型別、時區、
一對多 join 造成的重複計算。做法是同一個問題用兩條路各算一次：

```python
# 1) 問 Cube
import json, urllib.parse, urllib.request
def cube(q):
    url = "http://127.0.0.1:5057/api/cube/load?query=" + urllib.parse.quote(json.dumps(q))
    while True:
        d = json.loads(urllib.request.urlopen(url, timeout=90).read())
        if d.get("error") != "Continue wait":   # Cube 還沒算完的意思，再問一次
            return d["data"]

# 2) 自己寫一句 SQL 算同一件事（不要用 /api/cube/sql 拿 Cube 產生的 SQL——
#    那等於用它自己驗自己）
import sqlite3
```

逐項比對並把結果印出來。**只說「看起來對」不算驗過。**

### 這個資料模型的固定陷阱

- **場次一律用 `count_distinct(對局鍵)`，不能用 `count`。** 以增幅或裝備為維度時，
  一場對局會展開成多列。
- **不要在 Cube 裡算本地時間。** Cube 的 server 行程跑在 UTC 下，SQLite 的 `'localtime'`
  在那裡等於 UTC。時間分桶要用 `matches` 表存好的 `local_date` / `local_weekday` / `local_hour`
  （採集時用 Python 算的）。
- **主鍵不要用字串串接。** 用來源表的 `rowid`。Cube 對多指標查詢會產生「把主鍵撈出來再
  join 回本表」的 SQL，字串運算式的 join 用不到索引（實測 605ms vs 11ms）。
- **篩選值是字串送進來的。** 真實欄位靠 SQLite 的型別親和性會自動轉；但 `CASE` 運算式
  沒有親和性，`1 = '1'` 永遠為假——那種維度要宣告成 string 並回傳 `'true'`/`'false'`。

## 量效能：一定要有改前的數字

先量基準線再改。沒有基準線就不要宣稱變快了。

- Cube 端的每個請求耗時：`cube/cube.log` 裡的 `Load Request Success: <id> (Xms)`，
  可以統計中位數與 p90。
- 整頁的體感時間：用下面的無頭瀏覽器量「點下去到內容出現」。
- 後端 API：直接 `urllib` 計時，重複多次取中位數。

**假設要先驗證再動手。** 這個專案已經有好幾個「聽起來很合理但量完是錯的」紀錄：
提高 Cube 並行度反而更慢（驅動共用一條 SQLite 連線）、把子查詢攤平成實體表沒有幫助。
量不到好處的改動就還原，並把結論寫進 commit 訊息。

## 截圖與畫面驗證

> 主題配色、動畫、切頁流暢度的規則與驗證腳本在 `ui-conventions` skill。

**不要用內嵌的瀏覽器窗格判斷畫面。** 它失焦時會被節流到 0.3 fps，
後果是 ECharts 停在 0 寬不產生 canvas、`motion` 的淡入永遠跑不完，
看起來就像「圖表壞了」，但那是量測環境的問題。

用無頭 Edge + CDP（Node 22 內建 WebSocket，不用裝東西）：

```javascript
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", "--remote-debugging-port=9333", "--window-size=1500,1100",
   `--user-data-dir=${mkdtempSync(join(tmpdir(), "edge-"))}`, "--no-first-run",
   "--hide-scrollbars", "about:blank"], { stdio: "ignore" })
// 之後 fetch http://127.0.0.1:9333/json/list 取得 webSocketDebuggerUrl，
// 用 new WebSocket(...) 送 CDP 指令。
```

截圖前要做的三件事：

1. **等內容真的就緒**——招牌文字出現、沒有 `[data-slot="skeleton"]`、
   每個 `div[_echarts_instance_]` 裡都有 `canvas`。
2. **等進場動畫跑完**：動畫都是 CSS（`page-enter` / `rise` / `reveal`，最長約 500ms），
   換頁後等 1 秒再拍即可，不必再手動改 inline style。長時間跑的無頭分頁可能被當成背景節流，
   送 `Emulation.setFocusEmulationEnabled { enabled: true }` 固定焦點。

3. **不要用 `captureBeyondViewport: true`**——它會拍到空白的 canvas。
   要拍長頁面就把 viewport 調高再拍。

### 要放進 repo 的截圖：先把玩家名稱換掉

`docs/screenshots/` 底下的圖會進公開 repo，**不能帶其他玩家的遊戲帳號**。
用 `Page.addScriptToEvaluateOnNewDocument` 包一層 `window.fetch`，在資料進到畫面之前就換掉。
不要事後改 DOM——React 會把文字切成多個節點，正規表示式會切到一半（做過，會變成 `AsRiven#TW02`）。

注意 tag 不一定是英數，`#` 後面可能是日文或其他非 ASCII 字元（例如 `名字#カタカナ`），
比對整個 Riot ID 的樣式時別假設 tag 是 `[A-Za-z0-9]`。**寫文件時不要拿真實帳號當範例**——
這一行原本就是這樣寫的，得再改寫一次歷史才清掉。

最保險的做法是**只挑不會顯示他人名稱的頁面**當公開截圖（儀表板、時段、敗因分析、
增幅裝置、自由探索），隊友頁和對局戰報就不要放。

## 收尾檢查

- `cd web && npm run build`（有改前端的話）
- `npx oxlint src`——只看自己動到的檔案有沒有新警告
- `git status` 確認沒有把 `mayhem.db`、`cube/.env`、`*.log`、`icon_cache/` 帶進去
  （`.gitignore` 有擋，但改過 gitignore 時要重新確認）
