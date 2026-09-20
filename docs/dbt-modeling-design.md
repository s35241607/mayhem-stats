# dbt 資料建模設計

設計日期：2026-09-19。狀態：提案；本文件沒有安裝 dbt、執行資料遷移或修改現行 Cube。

## 1. 決策與範圍

保留 Python 採集器、SQLite 與 Cube，引入 dbt 管理可重用資料轉換。採「多個明確粒度的事實表 + 共用維度 + 多值關聯表」，不建立每個頁面一張寬表。

- Python：採集、保存原始 JSON、來源版本、排程、建置與發布。
- dbt：清理、拆 JSON、去重、團隊聚合、完整歷史序列、組合關聯、資料測試。
- Cube：關係、查詢時的 dimensions／measures、分析入口、快取與 API。
- 前端：查詢、呈現、互動；不自行重組重疊分組的 overall baseline。
- 第一版不另導入 dbt Semantic Layer／MetricFlow，避免和既有 Cube 重複維護同一組聚合指標。

先用 dbt Core + dbt-sqlite 做相容性驗證。adapter 是社群維護，版本須根據實際可安裝組合鎖定；本設計不指定未经本機驗證的版本。

## 2. 部署拓樸

~~~mermaid
flowchart LR
  A[LCU 採集器] --> B[(mayhem.db 來源)]
  B -->|SQLite backup API| C[(隔離 build.db)]
  C --> D[dbt staging / intermediate / marts]
  D --> E[dbt tests + 獨立 SQL 對帳]
  E -->|通過才發布| F[(analytics.db 穩定讀取端)]
  F --> G[Cube 語意層]
  G --> H[前端 / AI]
~~~

來源仍由現有程式管理。build.db 是一致性來源快照與 dbt 工作區；analytics.db 只存已驗證的最終模型、必要維度／bridge、發布 metadata。

採 SQLite backup API 建立一致性快照，不能只複製正在使用 WAL 的 .db 檔案。每次 build 使用獨立目錄；所有 dbt source 和 models 都位於該 build.db 的 main schema，以名稱前綴區分層級。schema_directory 不指向正式來源目錄。

理由：dbt-sqlite 的 schema 對應 attached database；SQLite 的永久 view 不允許跨 database 引用，而且 adapter 的 materialization 採 drop/recreate。避免依賴跨檔 view 或直接對線上 tables 執行 dbt build。[SQLite adapter 限制](https://docs.getdbt.com/docs/local/connect-data-platform/sqlite-setup)

## 3. 分層與模型

### Sources：承認既有採集表已經做過部分轉換

來源包括 matches、match_participants、participant_augments、participant_items、accounts、各 dim_*、dim_champion_roles、ingest_runs。matches.raw_json 是原始證據；其餘是既有採集程式拆出的來源，不把它們假稱為完全未處理 raw。

第一階段沿用已拆好的個人數值，避免同時重寫採集器。隊伍 totals 的新 canonical 來源是玩家事實聚合；來源中已保存的 team_*／enemy_* 用來對帳，避免維護兩套定義。

### Staging：只做命名、型別與來源品質

| 模型 | 每列代表 | 工作 |
|---|---|---|
| stg_matches | 一場對局 | 時間、模式、版本、局長；保留採集時本地日期／小時 |
| stg_participants | 一位玩家的一場對局 | 個人數值、自然鍵、勝負、英雄與召喚師技能 ID |
| stg_participant_augments | 一位玩家一場的一個增幅槽 | 保留 slot 和 augment_id |
| stg_participant_items | 一位玩家一場的一個裝備槽 | 保留終場配置；不推測購買順序 |
| stg_match_teams | 一場的一隊 | 按 raw teams.teamId 拆 JSON，禁止假定陣列順序 |
| stg_accounts / stg_*_dictionary | 一個帳號或字典 ID | 現況 metadata，保留來源未知值 |

新增 JSON 欄位的缺漏保留 NULL，與 false／0 分開。既有 _num 已轉成 0 的歷史數據，若沒有 raw 證據，不能重新判定成真實零。每隊 JSON 缺失不視為「沒有拿首塔」。

### Intermediate：放入目前 Cube 的複雜 SQL

| 模型 | 邏輯 | 注意事項 |
|---|---|---|
| int_team_totals | 按對局、team_id 聚合個人數值 | COUNT、SUM 之前驗證玩家唯一；檢查隊伍勝負一致 |
| int_player_ordered_games | 玩家、模式的完整歷史排序、LAG | 以開打時間、platform_id、game_id 確定順序 |
| int_player_sessions | 休息、session 邊界、session 內場次 | 前場結束後 >60 分鐘算新 session；門檻由 dbt var 管理 |
| int_player_prior_context | 本場前連勝敗、同英雄已觀測場數 | 嚴格排除本場；連勝敗按 session 重置，英雄經驗跨 session |
| int_augment_pairs | 同場同玩家 distinct augment_id 兩兩配對 | 先去重 ID，再以 A < B 配對；不是 OR filter |
| int_team_roles | 隊內各英雄定位人數 | 同英雄可多定位；各類總和可超過五 |

序列描述使用「已收錄／已觀測歷史」，尤其對同場路人不能稱帳號的完整遊玩歷史。負休息間隔保留並加異常旗標，不偷偷截成零。

### Marts：供 Cube 使用的資料契約

| 模型 | 粒度／自然鍵 | 主要內容 |
|---|---|---|
| fct_matches | platform_id + game_id | 開始時間、局長、模式、版本、結束旗標 |
| fct_player_games | 對局鍵 + participant_id | puuid、英雄、team_key、opponent_team_key、kills/deaths/assists、傷害、治療、金錢、局長 |
| fct_team_games | 對局鍵 + team_id | 隊伍與對手鍵、總擊殺／傷害／金錢、局長、首殺／首塔／首兵營、塔與兵營數、有效觀測旗標 |
| ctx_player_games | player_game_key（一對一） | 前場、休息、session_key、場次、累積分鐘、前置連勝敗、已觀測英雄經驗 |
| bridge_player_augments | player_game_key + slot | augment_id；可有多個不同 slot |
| bridge_player_items | player_game_key + slot | item_id；同裝備不同槽保留 |
| bridge_player_augment_pairs | player_game_key + augment_a_id + augment_b_id | 只保留共現關係，不複製 DPM／金錢 |
| bridge_champion_roles | champion_id + role | 共用定位字典關係 |
| ctx_team_composition | team_key（一對一） | 隊伍與敵方各定位人數；清楚標示為英雄標籤 |
| dim_players | puuid | 全部已收錄玩家的最新觀測顯示名 + 當前 is_me/tracked；accounts 只涵蓋其中一部分 |
| dim_champions / dim_augments / dim_items / dim_spells | 各來源 ID | 目前字典 metadata；不假稱歷史版本屬性 |

第一版不必為低基數欄位強行建立 dim_result、dim_side、dim_patch；patch、queue_id 和本地日期可直接放在對局模型。需要節假日／完整日期補零時再引入 dim_date。

fct_matches 與 fct_player_games 不是一張巨大的星型表；它們與 fct_team_games 形成共享維度的多事實模型。

## 4. 主鍵與歷史策略

- 對局、玩家對局、隊伍、pair 均使用完整自然鍵建立持久識別，platform_id 不可省略。
- 建议將無歧義序列化的自然鍵儲存成實際 TEXT key 欄位並建立 UNIQUE index；join 使用已落地的 key，不在查詢當下反覆串接字串。
- 不用來源 rowid、MIN(rowid) 或 ROW_NUMBER 作為跨 build 的持久 ID。row_number 只用於序列排序與分析場次。
- 若實測 key join 成為瓶頸，再引入有持久 mapping 的整數 surrogate key；不先增加這份維護成本。
- session_key 由玩家、模式及該 session 第一場對局鍵構成；補入舊資料可能改變 session 邊界與 key，因此它是衍生識別，外部不把它當永久業務 ID。
- 玩家顯示名稱可在 dim_players 使用最新觀測值；若要看採集當時名稱，留在玩家對局來源欄位。按 puuid 聚合，避免改名拆成兩人。
- tracked／is_me 是目前設定；「追蹤朋友數」不能當預組隊人數。若將來要歷史設定，從開始記錄事件那天起建立有效期間，不回造歷史。
- 字典初版採目前值。版本化分類需要額外保存各 patch 的字典證據，單加 SCD2 不會還原已遺失的歷史。

## 5. Cube 保留什麼

| 現有 Cube | 遷移後來源 | Cube 保留 |
|---|---|---|
| matches | fct_matches | 對局 dimensions、對局時長 |
| participants | fct_player_games | 玩家場次、勝敗、KDA、DPM、GPM、share、個人 segments |
| participant_context | ctx_player_games | 前場／session 等 dimensions |
| team_context | fct_team_games + 明確 opponent alias | 隊伍粒度 measures、敵我差距 |
| augments / items | 對應 bridge + 共用字典 | 長格式 dimensions，保留相容公開 member 名稱 |
| augment_pairs | bridge_player_augment_pairs | pair dimensions；表現 measures 取玩家事實 |
| teammates | 同場 participant 關係模型（後續） | 明確 subject／other 角色與 subject grain |

Cube 的 groups、中文標題、description、views 與過濾後聚合仍由 Cube 管理。

- 玩家 games = distinct player_game_key；match_count = distinct match_key。
- 隊伍 games = distinct team_key；不要與玩家場次混用。
- DPM = AVG(60 × 個人傷害 / duration_seconds)，每場等權。
- duration_weighted_dpm = 60 × SUM(傷害) / SUM(duration_seconds)，另名保存。
- team／enemy 使用明確 join path 或 alias，避免只按 game_id 連到兩隊。
- bridge 造成 fanout 時，個人平均與總和也必須按玩家事實 PK 去重；不只修正 COUNT。
- pair 不分組時，DPM 應是至少有一組 pair 的玩家對局等權平均；不能按 pair 列數加權。現行 pair cube 複製個人數值，遷移驗收要特別檢查這一點。
- 首塔率分母使用「有首塔欄位觀測的隊伍數」，並提供 coverage；NULL 不能當沒有首塔。
- 個人首殺率、多殺率的 numerator 與 denominator 都用 player_game_key；既有以 match key 計 numerator 的地方要一起校正。
- 不預先落地某英雄的最終勝率表，否則查詢新的日期／版本組合時仍要另造聚合表。

初版保留現有 Cube API 名稱以降低前端遷移量，另用 description 清楚區分個人與隊伍粒度。已有重複 team measures 時先維持 alias 相容，再規劃棄用，不再增加 team_team_dpm 這類重複命名。

## 6. Materialization 與增量

初版 staging 用 view，intermediate 視重用程度選 view 或 ephemeral，供 Cube 的 marts／bridges／dimensions 全部 table。隔離建置中的 view 留在同一個 main schema；發布只搬實體最終表，所以讀取端沒有 build.db 依賴。

初版每次全量重建。現有資料规模小，先把正確性與失敗恢復做好；不宣稱尚未量測的效能收益。dbt 的 view、table、incremental 是不同物化策略，模型可依成本調整。[Materializations](https://docs.getdbt.com/docs/build/materializations)

之後若建置時間成為問題：

1. 新增／修正對局以 ingestion change log 或單調 source_version 偵測；不要只用 game_creation > MAX(game_creation)，會漏補入舊局。
2. fct_matches／player_games／team_games 與配置 bridges 以「受影響對局」整批替換，包含刪除舊 bridge 列；只 upsert 現存 pair 不能刪除已不成立的 pair。
3. ctx_player_games 重算受影響玩家、模式的完整歷史；英雄經驗也需重算該玩家的相关歷史。初期繼續全量較容易驗證。
4. 純字典名稱改變與追蹤設定改變也要觸發更新，不能只在 games_new > 0 時執行。
5. 增量資料與全量重算結果需一致；unique_key 本身不是 uniqueness test。

## 7. 建置、發布與快取

建議加獨立 worker，不在 FastAPI 查詢或每一筆 match insert 裡同步跑 dbt。

1. 採集完成後標記來源版本；帳號、字典、歷史回填也標記版本。
2. worker 合併密集觸發，單次只跑一個 build。dbt-sqlite threads 固定為 1。
3. 用 backup API 抓取快照與該快照的 source_version。
4. dbt build：依依賴執行、測試，留 manifest／run_results 與建置耗時。
5. 執行獨立 SQL 對帳與新舊 Cube 查詢比較；測試失敗不發布。
6. publisher 把最終表載入穩定的 analytics.db，在單一目標庫 transaction 內完成所有對外表與索引替換、更新 analytics_release，成功才 commit。禁止直接覆蓋／更名 Cube 正在開啟的 SQLite 檔案。
7. Cube 共同 refresh_key 改讀 analytics_release.release_id；帳號／字典／模型定義改變也產生新 release。前端顯示最近發布時間及來源版本。
8. build 期间又有來源變更，完成後追加下一輪；失敗保留前一份已發布資料與錯誤狀態。

analytics_release 至少包含 release_id、source_version、source_snapshot_at、built_at、published_at、model_revision、status。publisher 保存可回復的前一個已驗證 build。

「先 dbt build 再測試」不代表整條 DAG 原子更新：可能已有前面模型被改寫。因此需要上述隔離與額外發布步驟；這是 Python orchestration 的責任。

發布前必須 PoC 驗證 SQLite transaction／DDL／索引與目前 Cube driver 的長連線行為。單一查詢不能看到半套表；同一頁的多個 API 請求仍可能跨發布邊界，若要求整頁同版本，需要在應用層傳递 release 並在版本改變時重新抓取。

## 8. 測試與驗收

### dbt 資料測試

- 每個模型自然鍵 unique + not_null，所有關聯鍵可解析。
- Mayhem 有 10 位玩家、2 隊、每隊 5 人；不對其他模式硬套這個規則。異常先隔離並回報，不默默遺失對局。
- 同隊 win 一致；完整 Mayhem 對局有一勝一敗；win 值僅 0/1。
- team totals 等於對應玩家 SUM；敵我 mapping 對稱。
- pair A < B，無 self pair、無重複；k 個 distinct 增幅產生 k(k−1)/2 個 pair。
- 缺 JSON 欄位保留 NULL，coverage 不假裝 100%。
- 修改追蹤名單／字典名稱且没有新對局，也能觸發新 release。

### 固定合成 fixture，避免把真實玩家資料放入 repo

- 兩場間隔恰為 60 分、超過 60 分；session 規則邊界一致。
- 晚補中間一場後，session、前場、前置連勝敗重算正確。
- 切日期／英雄篩選不重新編號完整歷史 context。
- 同一對局 2／4 個增幅，pair 總計 DPM 仍按玩家對局等權。
- 同英雄多定位、同裝備多槽，場次／DPM／傷害總和不被展開倍增。
- 未提供首塔 vs 明確 false，分母正確。
- build 失敗、publisher 中斷、Cube 並行查詢：仍能使用前一成功 release。

### 遷移對帳

用同一份來源快照比較來源獨立 SQL、舊 Cube、新 Cube：總計、英雄、版本、日期、增幅、裝備、pair、session、team，以及所有不加 mine 的跨玩家查詢。

前一輪資料快照的 244 場 Mayhem、2,440 玩家對局、152 場本機、74 勝可作人工參考，不能硬編碼為持續成長的正式資料測試。未經驗證的舊 Cube 結果不是唯一 truth；查到舊指標錯誤須以獨立 SQL 及粒度契約判定。

## 9. 專案結構

~~~text
analytics/
  dbt_project.yml
  profiles.example.yml
  models/
    staging/        # source YAML + stg_*
    intermediate/   # int_*
    marts/
      facts/        # fct_*
      contexts/     # ctx_*
      dimensions/   # dim_*
      bridges/      # bridge_*
  tests/            # 粒度、完整性、總量與序列 invariant SQL
  fixtures/         # 合成資料
  macros/           # key、日期、adapter-specific index 等共用實作
scripts/
  build_analytics.py
  publish_analytics.py
~~~

實際 profile、來源／建置／serving DB、logs、run_results 與含資料的 artifacts 全部 gitignore；公開 repo 只放模型、合成 fixture 與範例設定。獨立 dbt 執行環境，避免影響採集器的 Python dependencies。

## 10. 遷移順序與完成標準

1. **相容性 PoC**：鎖定 dbt／adapter／Python，驗證 JSON1、window functions、索引、build/test、發布與 Cube 重連；失敗先解決環境，不接管正式查詢。
2. **影子建模**：建立 staging、共同 dimensions、三張 facts 與 bridges；正式 Cube 仍讀原始庫。
3. **搬出複雜 SQL**：session、prior context、team JSON／composition、augment pairs；加合成 fixture 和獨立 SQL 對帳。
4. **影子 Cube 驗收**：另用隔離 Cube 設定讀 analytics.db，保持相同 API member names，比較相同快照。不能讓單一 Cube 查詢無意混合兩份資料版本。
5. **整組切換核心模型**：發布完整模型包，切正式 Cube 到 analytics.db，重建快取；採集／設定 API 繼續讀寫 mayhem.db。回復方式是切回原連線與舊模型。
6. **刪除重複定義**：通過回歸後移除 Cube 的序列／JSON／pair 生成 SQL。再評估採集器既有團隊衍生欄位是否仍被其他 API 使用，不能直接刪掉。
7. **按量測优化**：記錄快照、dbt build、發布、Cube query 時間；有需求才引入增量、整數 surrogate key 或其他分析引擎。

完成後新增「英雄 × 首塔 × session 階段」分析應只選已有 Cube members；只有出現新的原始資料處理或新粒度，才新增 dbt 模型。

## 11. 來源與待驗證項

本地依據：db.py 的 schema／回填、collector.py 的採集交易流程、cube/model/cubes/participant_context.yml、team_context.yml、augment_pairs.yml、participants.yml 與 views/agent_views.yml。

外部依據：

- [dbt SQLite setup](https://docs.getdbt.com/docs/local/connect-data-platform/sqlite-setup)：社群 adapter、單 thread、attached schema、view 與 materialization 限制。
- [dbt materializations](https://docs.getdbt.com/docs/build/materializations)：view/table/ephemeral/incremental 的選擇。
- [Cube 與 dbt 整合說明](https://cube.dev/blog/introducing-dbt-integration-with-cube)：轉換層與語意層分工；本設計不依賴特定自動匯入套件。

尚未執行的實作驗證：Windows 上 adapter 版本相容性、發布交易與 Cube 長連線並行、實際 build 時間。這些是第一階段的驗收工作，而非已完成能力。
