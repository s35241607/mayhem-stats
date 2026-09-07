# ARAM: Mayhem 戰績採集 + BI 分析

在**你自己的電腦**上執行,持續把 League of Legends 客戶端的對戰紀錄收進本機資料庫,
再對「你自己」在 ARAM: Mayhem 模式的資料做多維度分析——英雄、增幅裝置、隊友、時段都能拆開看。

## 為什麼需要「持續採集」而不是查一次就好

兩個限制疊在一起,逼出了這個設計:

1. **Riot 官方 API 完全封鎖 Mayhem。** 查詢 Mayhem 對局會直接回 403,而且這是刻意的——
   官方在 [developer-relations#1109](https://github.com/RiotGames/developer-relations/issues/1109)
   以「Expected behavior. Mayhem matches are private.」結案,2026/03 的最新回覆仍是「沒有計畫要開放」。
   所以 op.gg、u.gg 等任何第三方網站都查不到**任何人**的 Mayhem 戰績,包含你自己。

2. **客戶端本機 API 只給最新 100 場。** 這支 API 的 `begIndex`/`endIndex` 參數在目前的客戶端版本
   會被完全忽略(不管送 0、500 還是 5000,永遠回傳同一批最新 100 場),沒有已知的繞法。

兩者合起來的結論是:**對局一旦被擠出「最新 100 場」的視窗,資料就永遠消失了。**
所以這個工具的核心不是「查詢」,而是**趁資料還在的時候把它存下來**——只要客戶端開著就自動採集,
一場一場累積成你自己的歷史資料庫。開始採集得越早,能累積的歷史就越完整。

## 使用方式

需要先安裝 [uv](https://docs.astral.sh/uv/)。

```bash
uv sync
uv run app.py
```

打開 <http://127.0.0.1:5057>。只要 League 客戶端在背景開著(登入大廳即可,不用在遊玩中),
工具就會自動採集,不需要手動按任何按鈕。

建議讓它跟著客戶端一起開著。關掉也不會馬上掉資料——只要在對局被擠出 100 場視窗之前重開,
補漏掃描就會把中間漏掉的收回來。

客戶端沒開的時候工具也能正常執行:採集器會靜靜跳過,分析頁面照常可用(資料讀的是本機資料庫)。
唯一差別是英雄和增幅的圖示會空白,因為那些圖檔是即時跟客戶端要的。

## 開機自動啟動

已註冊為 Windows 排程工作 `MayhemStatsCollector`,登入後 30 秒自動以隱藏視窗啟動,
不需要手動執行任何東西。它跑的是 [autostart.pyw](autostart.pyw)(用 `pythonw.exe`,所以沒有主控台視窗),
執行記錄會寫到 `autostart.log`。

```powershell
Get-ScheduledTaskInfo -TaskName MayhemStatsCollector   # 看上次執行狀況
Stop-ScheduledTask   -TaskName MayhemStatsCollector    # 停掉這次
Disable-ScheduledTask -TaskName MayhemStatsCollector   # 暫時停用(不再開機啟動)
Enable-ScheduledTask  -TaskName MayhemStatsCollector   # 恢復
Unregister-ScheduledTask -TaskName MayhemStatsCollector -Confirm:$false   # 完全移除
```

服務已經在跑的時候再手動執行一次不會出事——`autostart.pyw` 會偵測到 port 5057 已被佔用,
記一行 log 就自己退出,不會撞埠或產生第二份採集器。

## 採集怎麼運作

兩層保險:

- **即時層(每 30 秒)** — 監看客戶端的遊戲狀態,偵測到「剛打完一場」就立刻採集。
- **補漏層(每 5 分鐘)** — 固定掃一次最新 100 場清單補缺,兜住工具沒開、當機、客戶端重啟等意外。

去重靠 `(platform_id, game_id)` 主鍵加 `INSERT OR IGNORE`,重複掃描不會產生重複資料。
採集前會先查資料庫哪些對局已經有了,只對新的打明細 API——所以沒有新對局時,一次掃描幾乎是零成本。

每場對局的**原始 JSON 也會完整存下來**。因為舊資料無法重抓,將來想分析目前沒解析的欄位時,
只能靠這份原始備份。

## 分析頁面

| 分頁 | 內容 |
|---|---|
| 總覽 | 總場次、勝率、KDA、每分鐘傷害/經濟,以及每日勝率趨勢 |
| 英雄 | 每個英雄的場次、勝率、KDA、傷害佔比、參團率 |
| 增幅裝置 | 各增幅的選取次數與勝率(含稀有度)——第三方網站給不了的資料 |
| 隊友 / 對手 | 和某人同隊時的勝率、對上某人時的勝率 |
| 時段 | 星期 × 時段的勝率熱力圖 |
| 自由樞紐 | 維度與指標自選的通用查詢台,可看產生的 SQL |

點表格任一列可以「下鑽」該項目(例如點某個英雄,再切到增幅分頁,就只看這隻英雄的增幅表現)。
場次太少的列會標灰——5 場 80% 勝率是雜訊不是洞察。

## 資料存在哪

專案目錄下的 `mayhem.db`(SQLite)。**這個檔案裡的舊資料是無法重建的**,建議偶爾備份。

主要資料表:`matches`(對局表頭 + 原始 JSON)、`match_participants`(每場 10 人的完整數據)、
`participant_augments` / `participant_items`(長格式,方便統計)、`dim_*`(名稱對照表)、
`ingest_runs`(採集稽核紀錄)。

## 找不到客戶端 / 連線失敗

- 確認 League of Legends 客戶端**正在執行**(登入大廳就可以)。
- 工具會自動嘗試 Windows / Mac 常見安裝路徑。
- 剛重開過客戶端的話 lockfile 內容會變,採集器下一輪會自動重讀,不用手動處理。

## 隱私

所有運算和儲存都在你自己的電腦上,不會把任何資料送到任何伺服器。
英雄、增幅、裝備的名稱和圖示取自客戶端內建的資源檔,也是本機讀取。

資料庫裡會包含同場其他玩家的名稱(這是做隊友/對手分析的必要資料),同樣只留在本機。
