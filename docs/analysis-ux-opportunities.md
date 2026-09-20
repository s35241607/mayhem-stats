# 分析功能與 UI/UX 改善建議

檢視日期：2026-09-20。範圍：目前工作目錄（包含既有未提交變更）、執行中的網站、Cube API、SQLite 唯讀查詢。本文件同時記錄已落地的第一輪優化與後續分析方向。

## 本輪已落地

- 儀表板新增「近期動能」，以最近 7 個有資料日和前 7 個有資料日比較加權勝率，並顯示樣本場次與日期。
- 自由探索的 Saved View 會保存分析對象、筆數、排序、模式與矩陣指標；欄位支援點擊、Enter／Space 加入，所有圖示操作補上可及性標籤。
- 以分析粒度檢查 Cube join graph；不相容欄位會在送出查詢前說明原因，避免直接出現 opaque join path 錯誤。
- 增幅組合 cube 補上帳號、模式、日期範圍的 scope 對應，能獨立查詢 `augment_pairs`；勝因、時段、增幅頁補上查詢錯誤狀態。
- 頁面語言改為 `zh-Hant`，頁籤標題改為「Mayhem 戰績｜本機 BI」。本輪沿用既有 ECharts、Motion、AG Grid、Radix、dnd-kit，沒有再增加圖表或動畫套件。

## 建議方向

優先做「可重現的比較分析」：讓使用者知道目前看誰、哪段期間、和什麼比較、樣本有多少，再把既有 Cube 模型接到容易操作的入口。現有 ECharts、Motion、AG Grid、Radix、dnd-kit 已能支援大部分圖表與互動需求。

第一批建議：修正查詢與篩選一致性、保存完整檢視、近期比較與樣本區間。第二批：session 分析與角色表現。增幅配對適合做探索，現階段不適合可靠推薦排行。

## 本次查到的資料條件

| 項目 | 本次快照 | 對功能排序的意義 |
|---|---|---|
| 已收錄 Mayhem | 266 場，2026-08-28～2026-09-20 | 描述本機收錄樣本，不能稱為全服統計 |
| 本機帳號 | 167 場、81 勝，48.503% 勝率 | 場次、勝場、勝率、DPM 已用獨立 SQL 與 Cube 對帳一致 |
| 英雄分布 | 81 隻；75 隻不到 5 場；最高 12 場 | 優先看較粗的定位與近期變化；5 場只是顯示門檻，不代表可靠 |
| 個人增幅配對 | 828 種，沒有一種達到 5 場，最高 4 場 | 初版依出現次數排序、顯示不確定性；避免「最強組合」結論 |
| 版本 | 個人 16.17 有 98 場；16.18 有 69 場 | 可做版本比較，但須同看英雄與定位組成差異 |
| 模型 | 11 個 cubes、4 個 views；participants 有 64 個 measures | 分析資料已相當完整，前端需要整理入口與相容性 |
| Cube | 本機安裝 1.7.35 | 最新官網功能不代表這版 SQLite 組合已支援，須做小型驗證 |

所有數量都會隨採集改變。個人樣本以 accounts.is_me = 1、queue_id = 2400 定義；配對以同玩家同場、不重複增幅 ID 的 A < B 組合計算。

## 值得新增的分析

| 優先 | 功能與使用問題 | 介面／圖表 | 現有基礎與待補工作 |
|---|---|---|---|
| P1 | 近期表現：最近 20 場比前 20 場有進步嗎？ | KPI 顯示本期、基期、差值；逐場趨勢加移動平均 | 已有時間、勝負、DPM、每 10 分鐘死亡、參團率。補「最近 N 場」序列窗口；與「最近 N 天」分開，兩個比較期間不重疊 |
| P1 | 版本／定位比較：改版後變化來自表現還是選角？ | 兩期點線比較圖、定位小圖；顯示每組場數 | matches.patch、champion_roles 已有。先做分層描述，基期不足時明示；英雄可有多定位，分類場次不能直接相加 |
| P1 | 勝率可靠程度：6 場 83% 有多穩？ | 排名旁直接顯示勝／敗、n、勝率區間；樣本篩選 | 用 wins/games 共用計算區間。個人可採 Wilson；跨玩家同場資料有群聚，不把 10 人當 10 次獨立試驗 |
| P1 | Session 與休息：同一輪連打越久，死亡頻率或輸出如何改變？ | Session 內第幾場 × 指標，休息區間比較；展開該輪每場 | participant_context 已有休息、場次與前累積分鐘，也已確認能與 participants.dpm 同查。Tilt 仍用 my_games 的當日分組；先接入新模型，連勝敗長度則仍需補計算 |
| P2 | 角色貢獻：坦克／輔助是否被 DPM 排名低估？ | 每個角色 2～3 個指標的子彈圖、分布圖 | 已有承傷、減免、治療、控場、目標傷害速率。比較同玩家同定位；不先拼一個任意加權總分，治療含自療，角色標籤不等於實際玩法 |
| P2 | 增幅配對：拿到 A 時，曾和哪些 B 一起出現？ | 先選 A，再列 B 的次數、勝敗、區間；可切配對矩陣 | augment_pairs 已接上前端查詢 family／scope。現有樣本稀疏，預設依次數排序、完整保留少量樣本提示 |
| P2 | 團隊與終場配置：個人輸出和隊伍差距如何一起變化？ | DPM × 團隊差距散布圖、終場裝備配置比較、首塔分組 | team_context、items 已有；團隊定位人數仍待建模。終場裝備受局長、經濟、勝負過程影響，不解讀成出裝順序或裝備因果收益 |

共同互動：選期間／英雄／定位 → 圖表聚焦 → 顯示樣本與比較基準 → 開啟該組每場戰報。以現有 DrillPanel 和麵包屑延伸，維持使用習慣。

「增幅契合度」目前是某增幅在指定英雄的勝率，減去同增幅在所有英雄的勝率。這不等於該英雄選 A 相對於沒選 A 的差異。建議先將名稱改成「相對整體差異」，再增加同英雄、同版本、同期間的有／無 A 比較；仍只能解讀為觀察到的關聯。沒有候選池資料，無法計算真正的選取率或最佳選項效果。

## 已確認的問題與具體改善

| 優先 | 位置 | 問題／改善 |
|---|---|---|
| P1 | web/src/pages/Explore.tsx:211；web/src/lib/drill.ts:32；web/src/hooks/useCubeMeta.ts:76 | 自由探索會露出不同查詢入口的欄位，卻使用預設 participants 指標與篩選。實測 participants.games + participants.winrate + augment_pairs.pair 回傳 Can't find join path。獨立 augment_pairs 查詢可成功。已建立分析 family 檢查、相容欄位提示與 augment_pairs scope 對應 |
| P1 | web/src/pages/Tilt.tsx:20 | Tilt 自行組 subjectFilter／timeFilter，沒有套用全域 drills，頁首仍可能顯示全域英雄條件。接入 participant_context 後統一篩選，或像 useDrillScope 一樣明示哪些條件不適用 |
| P1 | web/src/lib/filters.tsx:84 | /api/players 失敗後仍 ready=true，而 account=null 不會加玩家條件。應顯示帳號載入失敗與重試，避免個人頁默默查成全部玩家 |
| P1 | web/src/pages/Losses.tsx:168；web/src/pages/Tilt.tsx:142 | 沒有處理對應 useCube.error，查詢失敗可能呈現「沒有資料／缺少勝敗」。已加入 QueryError，將錯誤和空結果分開，並提供縮小期間／清除篩選的建議 |
| P1 | web/src/App.tsx:56；web/src/lib/filters.tsx:77 | 頁面、期間與下鑽只在 React state。重新整理會回預設狀態，也不能用網址重現分析。保存 URL 狀態，支持上一頁／下一頁；標題依頁面更新 |
| P1 | web/src/pages/Explore.tsx:86、263 | 已有儲存檢視，並非缺少此功能；SavedView 已補保存 scope、排序、limit、pivotMetric、模式與下鑽。全域期間仍由頁面篩選控制，後續可再決定是否加入固定期間選項 |
| P1 | web/src/pages/Tilt.tsx:125、140；web/src/pages/Augments.tsx:234、294 | 固定差 5pp 就稱「明顯」、兩柱差就說前一場有影響、把混合英雄基準差稱為加成，容易過度解讀。改成描述性差異，把樣本與基準放在數字旁 |
| P1 | web/src/pages/Losses.tsx:159、166、182 | 「下面一律每分鐘」與實際仍包含總擊殺、平均承傷、最長存活不符；文案說紅綠但主題採其他配色；傷害佔比上升不能證明不是自己拖累。標清單位、改用語意圖例，移除歸責判斷 |
| P2 | web/src/components/FieldBuilder.tsx:110、193 | 只有 PointerSensor，加入欄位靠拖曳／雙擊，缺少可靠的鍵盤與單擊入口。已補單擊、Enter／Space、搜尋框 label 與帶欄位名稱的移除鈕 |
| P2 | web/src/components/charts.tsx:59；web/src/components/AgTable.tsx:323 | 圖表可見，但 AX 樹沒有圖表資料摘要；應提供圖名、目前範圍、資料表替代及鍵盤下鑽。AG Grid animateRows 也應跟隨 reduced motion |
| P2 | web/index.html:2、7；web/src/pages/Explore.tsx:686 | 中文站仍 lang=en、頁籤 title=web；查詢程式碼圖示按鈕沒有 aria-label。已改 zh-Hant、頁名＋產品名，並為圖示操作補標籤 |
| P2 | web/src/components/AppShell.tsx:108、136 | 採集狀態已存在，但僅顯示上次時間；立即採集不檢查 HTTP 成功，也不連動刷新頁面數據。顯示完整時間／資料截止、成功新增場數、失敗與重試；成功入庫後使相關查詢失效 |

另有可整理的指標名稱：participants.unspent_gold 仍顯示「平均剩餘金錢」，但只是 earned − spent；本次個人 167 場有 8 場為負。先改成「獲得與花費金錢差額」，不要解讀成死亡時的錢包餘額。

## 版面與操作建議

- 儀表板：目前 7 個 KPI 同等權重，主要回答累積總覽。把「近期勝率／近期 DPM／死亡頻率」設成主列，附基期與差值；總場數、用過英雄等移到較小的摘要。現有主題與圖示可保留。
- 自由探索：已有左側配置、右側結果與三種模式。新增「近期變化」「休息與連打」「版本差異」「增幅配對」等問題範本，讓使用者先選問題；進階欄位配置再展開。這是延伸已有預設路徑與儲存檢視。
- 欄位選單：實際畫面出現多個同名「日期」「勝率」「前一場結果」。用「對局日期」「隊伍勝率」「Session 前一場結果」等可理解名稱，搭配來源粒度與定義說明；依當前入口過濾。
- 圖表：保留既有熱力圖、散布圖、交叉篩選與表格。新增區間圖、分布圖、兩期點線比較；折線平滑應可關閉，稀疏日期不營造連續上升／下降的錯覺。
- 動畫：讓篩選後的數值與資料點從舊位置過渡到新位置，幫助追蹤改變；避免每次查詢先拆掉圖表、換骨架再整張重長。跨帳號切換則先清楚顯示載入，不能把前一個人的資料當成目前資料。
- 窄螢幕候選：配置區收成抽屜、結果優先、保留清楚的已套用條件摘要；需另外在指定寬度驗收。本次實際檢視的是桌面預設視窗，未完成手機或多主題視覺驗收。

## 套件取捨

| 選擇 | 建議 | 能解決什麼／整合條件 |
|---|---|---|
| ECharts（已有） | 繼續使用 | 用現有引擎做比較圖、箱形／分布圖、區間圖與資料轉場，無須先增加第二套圖表庫。沿用 charts.tsx 的主題與 reduced-motion 規則 |
| Motion（已有）＋CSS | 延伸現有策略 | 版面進場依專案規範用 CSS opacity／transform；數字與圖表沿用 CountUp／ResponsiveChart。不要加入第二套動畫引擎；先處理更新時重掛載，保留穩定的 series／data identity |
| @tanstack/react-query（未裝） | 優先候選 | 現有 useCube 有取消請求，但沒有跨掛載結果快取。加入查詢快取、背景更新、錯誤重試、採集成功後失效。query key 包含帳號、模式、實際日期邊界與完整查詢；保留 Continue wait 的現有處理，設定 staleTime 與 retry，避免預設自動重試把長查詢再放大 |
| nuqs（未裝） | 優先候選 | 支援目前 React／Vite SPA，把期間、頁面、檢視、下鑽同步至 URL。導航操作使用 push，連續輸入使用 replace／節流，不讓返回鍵變成逐字退回 |
| Recharts／Nivo／Plotly／第二套動畫庫 | 暫無必要 | 目前沒有證據顯示 ECharts 能力不足；新增引擎會增加主題、事件、載入與可及性的維護面。等有 ECharts 明確做不到或難以維護的視覺需求再選型 |

ECharts 官方說明支援資料更新的轉場與 ARIA 描述，ARIA 須主動配置；自動摘要也不能取代完整的鍵盤操作與資料表替代。[資料轉場](https://echarts.apache.org/handbook/en/how-to/animation/transition/)、[ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/)

TanStack Query 的快取資料預設立即視為 stale、失敗預設重試 3 次，導入時必須依本機採集節奏設定。[官方 defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)

nuqs 有 React SPA adapter，可直接用於 Vite；不必為 URL 狀態先改成 Next.js。[官方 adapters](https://nuqs.dev/docs/adapters)

## Cube 如何繼續擴充

1. 維持明確粒度：participants 是玩家對局、team_context 是隊伍對局、augment_pairs 是玩家對局配對、teammates 是同場關係。前端選入口後只提供相容的欄位、measures、帳號與日期篩選。
2. 優先接好已存在的 participant_context／team_context／augment_pairs。配對可選擇獨立 scope，或補經去重驗證的 join；不能只增加一條 join 就假定所有聚合正確。明細 API 也要支援相同條件，讓圖上場次與明細總數一致。
3. 時間型移動窗口可評估 Cube rolling_window；前期比較可評估 time_shift。最近 N 場則用按玩家／模式的 SQL row window，不能拿 N 天取代。勝率由窗口 wins／games 求比值，不平均每日勝率。
4. 複雜基準與固定粒度計算可評估 multi-stage；目前安裝版為 1.7.35，SQLite driver 為社群支援，應先用少量代表查詢驗證語法、結果與效能。若不合適，延伸現有 SQL context cube 即可。官網新版模型語法不要直接套進舊版。
5. 目前數百場規模，不以新增 pre-aggregation 作為第一個效能改動。先量真實慢查詢、首屏與切頁；確有瓶頸再設計符合主要查詢形狀的 rollup，並確認命中、更新與去重。dbt 文件目前是設計提案，這批 UI 改善不需以落地 dbt 為前置條件。

Cube 的官方 measures 文件涵蓋 rolling window、time shift 與多階段計算；這些是可評估能力，並非本次對本機所有功能的相容性保證。[Measures](https://docs.cube.dev/docs/data-modeling/measures)、[SQLite driver](https://cube.dev/docs/product/configuration/data-sources/sqlite)、[Pre-aggregations](https://docs.cube.dev/docs/pre-aggregations/using-pre-aggregations)

## 目前資料無法支持的功能

- 對戰時間軸、逐分鐘經濟曲線、死亡時持有金錢、逆轉發生時刻：目前保存的是終場資料。本次檢查 2,660 筆 Mayhem participant JSON，補兵、經濟、經驗、承傷的 timeline delta 欄位全部為空；沒有可用事件序列。
- 增幅候選選項的最佳推薦、真正選取率、重抽效果：沒有當時候選池或重抽紀錄。
- 終場裝備的購買順序：槽位不是時間順序。
- 預組隊因果收益：目前同隊朋友數依現有追蹤名單推得，追蹤狀態變動會影響歷史分組；不能當歷史組隊事實。
- 用終場傷害／經濟／塔差預測開局勝率：這些欄位含結果資訊。

## 建議實作順序與驗收

| 階段 | 交付 | 驗收 |
|---|---|---|
| 1 | 查詢 family、篩選一致性、錯誤狀態、文案修正 | 不相容選項選前可辨識；個人頁不默默查全體；失敗與零筆不同；每個可見篩選確實影響數字 |
| 2 | URL／完整儲存檢視、查詢快取與入庫更新 | 重新整理與前進後退還原條件；保存前後結果口徑一致；切帳號不閃另一人的數據；新對局入庫後數字更新 |
| 3 | 近期比較、版本／定位分析、勝率區間 | 兩期分子分母與手寫 SQL 一致；零分母／少量樣本有明確顯示；N 場與 N 天分開 |
| 4 | Session、增幅配對探索、角色／團隊分析 | 圖表場次＝明細 total＝獨立 SQL；不把觀察性差異寫成因果；逐頁驗收鍵盤、窄螢幕與 reduced motion |

視覺改動依專案 ui-conventions，數字與效能驗證依 verify-change。UI 審查也參照 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。本次沒有改程式，因此未執行前端建置、效能改前改後比較或全站回歸測試。
