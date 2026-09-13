# mayhem-stats

ARAM: Mayhem 的本機戰績採集與分析工具。FastAPI（`app.py`）+ Cube 語意層（`cube/`）+ React 前端（`web/`）。
一個人開發：改動直接 commit 到 `main`，不走分支／PR。

## 動手前必讀的 skill

| 要做的事 | skill |
|---|---|
| 動到 `web/src` 的任何畫面：頁面、元件、圖表、顏色、動畫、主題 | `ui-conventions` |
| 驗證數字、量效能、重啟服務、截圖 | `verify-change` |

## 不能違反的規則

- **顏色只用主題 token**（`bg-card`、`text-win`、CSS 變數），不寫死色碼；圖表只透過 `charts.tsx` 的 `useTheme()` 取色。
- **動畫只用 `index.css` 的 CSS utility**（`page-enter` / `rise` / `reveal`），只動 opacity / transform，不新增 JS 逐幀的進場動畫。
- **新增或改主題配色必須跑 dataviz 的 `validate_palette.js`**，並用 `ui-conventions` 的腳本做截圖與 hover 檢查。
- **數字一律和獨立手寫的 SQL 對過**才算驗證；效能改動要有改前的數字。
- **repo 是公開的**：不能提交其他玩家的 Riot ID、puuid（程式、文件、commit 訊息、截圖都算）；`mayhem.db`、`cube/.env`、`*.log` 不進版控。
- 前端改完要 `cd web && npm run build`：`web/dist` 有進版控，服務直接讀它。
