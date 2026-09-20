# 分析能力與 Cube 語意層擴充清單

檢視日期：2026-09-19。這份文件同時記錄檢視結果、已完成的第一階段修正，以及後續實作順序。

## 判斷

導入 Cube 的方向符合「新增分析不用重新組大表」的目標。現有 participants 已定義 50 個 measures，主要缺口是不同分析情境之間的連結、跨玩家計算粒度，以及少數指標的解讀。建議先修正定義，再增加可重用的 dimensions 與 measures。

保留長格式的增幅、裝備與英雄定位；在 Cube 定義正確的主鍵、關係與聚合；用少數用途明確的 views 對外提供可一起查詢的欄位。序列與團隊情境可以使用固定粒度的 SQL cube，無須替每一頁建立新的實體寬表。

## 檢查範圍與證據

- 來源：本機 SQLite（使用 `mode=ro`）、正在執行的 `/api/cube/meta` 與 `/api/cube/load`、`db.py`、`collector.py`、`cube/model/`、React 查詢與顯示程式。
- 查詢時資料庫有 246 場，其中 244 場 Mayhem、2 場其他模式。Mayhem 每場都有 10 位參與者，共 2,440 筆玩家對局；期間為 2026-08-28 至 2026-09-19，涵蓋 16.17、16.18。
- 本機帳號有 152 場 Mayhem，74 勝，勝率 48.6842%。76 隻英雄中，70 隻少於 5 場，只有 6 隻達到 5 場；最多的一隻為 12 場。
- 目前有 11 個 cubes、4 個 views。這是本次查詢快照，採集器後續新增資料後會改變。
- 已完成第一階段：participants 的 `games/wins/losses/winrate` 改為玩家對局粒度，新增 `match_count` 保留不重複遊戲對局數；增幅頁改用未按增幅分組的整體勝率與 DPM 基準線。
- 已完成第二階段的模型欄位：召喚師技能、技能組合、傷害類型、增幅數、結束方式、時段區塊、平日／週末，以及每分鐘戰鬥／生存／資源／輸出 measures。這些欄位已加入 `my_performance` view。
- 已完成第三階段 `participant_context`：以完整歷史計算前一場結果、休息分鐘、session 內場次、session 階段與累積對局分鐘，並能和 participants 的 DPM 等指標同查。
- 已完成第四階段 `team_context`：每場每隊一列，從玩家列聚合我方／敵方擊殺、傷害、經濟與每分鐘差距，並回填 raw teams 的首殺、首塔、首兵營、塔數、兵營數；已接到 `participants` 與 `my_performance`。
- 已完成第五階段 `augment_pairs`：每位玩家每場的兩個增幅組合一列，透過 `a.augment_id < b.augment_id` 正規化方向，並提供獨立的 `augment_analysis` view。
- 驗證：個人總場次、勝場、勝率、DPM、KDA 與獨立 SQL 一致；6 個英雄定位分組的場次、勝率、平均擊殺一致；150 個增幅分組的場次、勝場、平均擊殺、DPM、五殺、多殺、首殺率、多殺場次率全部一致。
- 上述驗證不代表任意跨 cube 組合已全部驗過，也不代表每項數字的解讀都正確。
- 同場其他玩家及追蹤帳號形成的是已收錄對局樣本，不能當成全服隨機樣本。2,440 筆玩家對局也不是 2,440 場獨立試驗。

## 現在可以回答的問題

| 分析主題 | 現有可分析資訊 | 適合回答的問題與邊界 |
|---|---|---|
| 個人表現 | 場次、勝率、KDA、參團率、DPM、GPM、傷害／承受佔比、治療、控場、多殺 | 同一英雄或定位下，我的表現是否改變？不同定位不要只用 DPM 排優劣。 |
| 英雄與定位 | 英雄、六類定位、版本、勝敗、長度、隊伍方位 | 我在什麼定位較穩定？英雄可有多重定位，分類場次不能直接相加。 |
| 增幅與裝備 | 增幅名稱、稀有度、槽位；終場裝備；與英雄／版本的交叉 | 某種組合在已記錄對局中的結果如何？只記錄最後配置，不能推出可選選項或出裝順序。 |
| 時間 | 日期、星期、小時、版本、對局長度 | 哪些時段表現有差異？須同時看樣本、英雄組成、朋友同隊情境。 |
| 人際關係 | 同場玩家、隊友／對手、雙方英雄、自己的英雄定位、目前追蹤的同隊朋友數 | 和誰同隊或遇到誰時結果不同？目前關係 cube 只有場次與勝率，不能直接交叉查自己的 DPM。 |
| 遊玩節奏 | 上一場結果、當日第幾場、當日階段 | 連續記錄中的結果有什麼關聯？「當日階段」不是依休息間隔定義的遊玩 session。 |
| 遊玩 session | 前一場結果、休息區間、session 內第幾場、累積對局分鐘 | 連敗後下一場、休息長度與 DPM／勝率是否一起變化？60 分鐘切 session 是分析規則。 |
| 團隊情境 | 我方／敵方擊殺、傷害、經濟、DPM／GPM 差、首殺／首塔／首兵營、塔與兵營數 | 個人輸出是否和隊伍差距一起變化？這些是終場結果的描述，不能直接當成開局預測特徵。 |
| 勝敗差異 | 個人數據、雙方傷害／經濟／擊殺及每分鐘差距 | 勝局與敗局有哪些差異？這是描述性比較；終場數據與局長也受勝負過程影響，不能直接當成敗因。 |
| 資料品質 | 原始 JSON、採集紀錄、參與者與字典表 | 哪些資料缺漏、多久沒有成功採集、哪些字段可以回填？這些尚未形成對外品質 view。 |

目前建議優先比較「定位 × 版本」與「同英雄的表現變化」，再下鑽增幅。不要把五場門檻視為統計可信度保證；多數英雄樣本尚不足以穩定排名，多維交叉後更稀疏。

## P0：先修正會影響解讀的定義

### 1. 區分對局數與玩家對局數

第一階段前，`participants.games/wins/losses` 都以對局鍵去重。因此全部玩家查詢會回傳 244 場、244 勝、244 敗、100% 勝率。每場都有勝方與敗方，所以當時的跨玩家 wins 是「有勝方出現的對局數」。按日期分組亦會重現 100%。目前已改為玩家對局粒度，並保留 `match_count` 表示遊戲對局數。

建議明確分開：

- `match_count`：distinct `(platform_id, game_id)`。
- `games`：distinct participant rowid，也就是玩家對局數。
- `wins`、`losses`：依 win 條件對 participant rowid 去重。
- `winrate`：`100 × wins / games`。
- 目前個人頁沿用 `games` 這個相容名稱；單一玩家視角下仍等同對局數。跨玩家探索改用玩家對局口徑；需要真正遊戲場數時使用 `match_count`。關係分析仍須明確指定視角玩家。

驗收例：這批 Mayhem 應得到 244 場、2,440 玩家對局、1,220 玩家勝場、50% 玩家勝率；單一帳號仍是 152 場、74 勝。

### 2. 增幅頁整體基準線不可從分組列重新加總

`Augments.tsx` 的 `avgWr` 將所有增幅分組的勝場與場次相加。程式註解假設每場增幅數相同，但本機帳號實際有 1～5 個增幅的對局。

實測顯示基準線為 **47.3322%**，同範圍的正確整體勝率為 **48.6842%**。各個增幅分組本身與 SQL 一致，問題出在把互相重疊的分組加回整體。

已修正：另查一筆不含增幅分組、但保留同帳號／模式／期間／英雄等篩選的總計。依增幅加權算出的 DPM 基準也一併改為同一筆整體查詢。

### 3. 「剩餘金錢」目前不是已驗證的錢包餘額

`unspent_gold = gold_earned - gold_spent`。2,440 筆 Mayhem 玩家對局中，有 174 筆為負數；自己的 152 場中有 8 場為負數。

目前只能確認這兩個累積欄位的差額，尚未驗證負數的遊戲機制或來源口徑。建議暫稱 `earned_spent_gap`，移除「死亡時留太多錢」「沒有積極買裝」的推論，也不要直接把負數截成 0。死亡當下持有金錢需要事件或時間序列資料。

### 4. View 的 segment 目前是選項，不是強制篩選

`my_performance` 納入了 `mine` 與 `mayhem`，但不會自動套用。實測只加 mayhem、不加 mine，仍得到 100% 勝率。

建議個人查詢入口要求明確的視角玩家，由共用查詢層驗證／補上；跨玩家入口提供前述玩家對局 measures。篩選以穩定玩家 ID 為準，Riot ID 只負責顯示，避免改名拆成兩個人。

### 5. 明確區分現況欄位與歷史事實

`party_size` 是「依目前追蹤名單，同隊有幾位追蹤帳號」，不是已驗證的預組隊人數；更改追蹤名單會改變歷史分組。可保留欄位，但名稱／description 要明確。若要真正的 premade party 分析，需取得對應來源；若只想固定當時追蹤狀態，需另存採集時快照。

## P1：現有結構化資料即可增加的 dimensions

| 建議欄位 | 資料來源／定義 | 分析價值與注意事項 |
|---|---|---|
| `spell_1`、`spell_2`、`spell_pair` | `spell1_id/spell2_id` + 已存在的 `dim_spells`；pair 依 ID 排序正規化 | 比較相同英雄／定位的技能配置。Mayhem 2,440 筆兩格都有值；技能字典可對應。兩個位置接同一字典時使用明確別名 cube。 |
| `damage_profile` | 依對英雄物理／魔法／真傷占比分類；例如某類 ≥60%，其餘為混合；零傷害為未知 | 比較實際傷害形態與對手／終場裝備的關聯。60% 是待確認的分析門檻；這是終場表現，不能當成開局已知特徵。 |
| `augment_count` | 每玩家對局的增幅列數 | 分開看不同增幅數、資料異常與局長關係；不能直接解讀成多一個增幅的因果收益。 |
| `augment_slot` | 現有 `augments.slot` | view 已有，探索頁目前被 HIDDEN 規則排除。補 title、description 與顯示規則即可；尚未驗證槽位等於選取時間順序。 |
| `end_type` | 已有 `ended_surrender`，之後可加入 raw 的提前結束旗標 | 區分投降與正常結束。現有 surrender 維度也被探索頁隱藏；本批 51 場投降旗標與 raw 一致。 |
| `time_block`、`is_weekend` | 已落地的 `local_hour/local_weekday` | 把前端時段分桶集中到模型；保留既有本地時間定義。 |
| `player_scope`、`is_tracked` | `accounts` 與玩家鍵 | 區分本機、目前追蹤、其他已收錄玩家；不得把其他玩家標成全服樣本。 |

共同要求：每個可探索欄位補中文 title、description、meta.group；每個可對外查詢欄位同步加入用途相符的 view。新增 YAML 不保證自動出現在 UI，還須符合目前 `useCubeMeta.ts` 的 public、中文標題與 HIDDEN 規則。

## P1：現有資料即可增加的 measures

以下每分鐘指標預設採「先逐玩家對局計算、再平均」，與現有 DPM/GPM 一致；秒數為 0 時回傳 NULL。若另需時間加權口徑，命名要清楚區別。

| 建議 measure | 定義 | 可回答的問題 |
|---|---|---|
| `deaths_per_10min` | AVG(`600 × deaths / duration_seconds`) | 不同局長下的死亡頻率是否改變？搭配定位與承傷看，不把低死亡一律視為好。 |
| `taken_per_min` | AVG(`60 × dmg_taken / duration_seconds`) | 承傷型英雄的參與量與負擔。 |
| `mitigated_per_min` | AVG(`60 × dmg_mitigated / duration_seconds`) | 減免傷害的每分鐘量；不能直接等同減傷效率或減傷百分比。 |
| `heal_per_min` | AVG(`60 × total_heal / duration_seconds`) | 治療型玩法的表現；此欄包含自療，不能當成隊友治療。 |
| `cc_time_per_min` | AVG(`60 × time_ccing_others / duration_seconds`) | 增加另一種控場口徑。保留與 `cc_duration/totalTimeCrowdControlDealt` 的來源區別，先驗證定義，不宣稱是硬控時間。 |
| `cs_per_min` | AVG(`60 × cs / duration_seconds`) | 清兵與資源取得的節奏。 |
| `physical_damage_share`、`magic_damage_share`、`true_damage_share` | AVG(`100 × 對應對英雄傷害 / 三類對英雄傷害合計`) | 輸出組成；目前三類合計與總對英雄傷害有 0～2 點差異，使用同一組分母可避免百分比因來源差異不合計為 100%。 |
| `taken_true_share` | AVG(`100 × taken_true / 三類承受傷害合計`) | 補齊目前已有的物理、魔法承受占比。 |
| `gold_share` | AVG(`100 × gold_earned / team_gold`) | 自己取得多少團隊經濟；與傷害佔比對照，不以輸出需求評價所有定位。 |
| `objective_damage_per_min` | AVG(`60 × dmg_to_objectives / duration_seconds`) | 把既有目標傷害轉成可比較的速率。 |
| `first_tower_kill_rate` | `100 × 首塔擊殺的玩家對局數 / player_games` | 自己拿首塔尾刀的比例；不等於我方團隊拿首塔比例。 |
| `play_minutes` | SUM(`duration_seconds / 60`) at player-game grain | 投入多少時間。跨玩家是「人分鐘」；真正對局總分鐘須在 matches grain 計算。 |
| `duration_weighted_dpm` | `60 × SUM(dmg_to_champions) / SUM(duration_seconds)` | 整段遊玩時間的傷害速率；不可覆蓋現有每場等權 DPM。 |

底層可先補 `total_kills`、`total_deaths`、`total_assists`、`total_damage`、`total_gold`、`total_duration_seconds` 等可重用聚合，再定義比值。不要對已聚合的 KDA／勝率直接求平均；每項分子分母必須使用同一 grain。

## P2：新增少量可重用情境 cube

### 遊玩情境：每玩家對局一列（已落地）

現有 `my_games` 沒有 joins，實測 `my_games.prev_result × participants.dpm` 回傳 `Can't find join path`。

已以 CTE／視窗函數產生 `participant_context`，以 participants 的 `rowid` 與玩家列一對一連結，集中定義：

- `break_minutes_before`：本場開始減去前場結束；前場結束由開始時間加局長得到。沒有前場為 NULL；負間隔另標異常。
- `session_id`、`game_in_session`：例如休息超過 60 分鐘視為新 session；60 分鐘是可調的分析規則，不是已知真實界線。
- `minutes_played_before_game`：同 session 內，本場開打前的累積對局分鐘，不含本場，也不混入休息。
- `loss_streak_before`、`win_streak_before`：本場之前、同 session 的連敗／連勝；不含本場結果。
- `champion_experience_before`：已收錄歷史中，該玩家在本場之前使用該英雄的場數；不是帳號生涯熟練度。

窗口先在完整已收錄歷史上計算，再套顯示日期／英雄篩選，避免篩選範圍把序列重新編號。以玩家、模式分區，時間相同時加入確定的對局鍵排序。是否跨模式定義休息需另立清楚口徑。別人的紀錄可能只來自同場，因此標為「已觀測到的前一場」。

能新增的問題：「連敗兩場後，我的死亡／10 分鐘是否增加？」「休息後的 DPM 是否恢復？」「同英雄已玩場數增加時，表現是否穩定？」這些仍是相關性分析。

### 團隊情境：每對局每隊一列（已落地）

目前 `participants` 原本就有部分 `team_*`／`enemy_*` 子查詢；現在另外提供 `team_context`，把團隊分析固定在每場每隊一列。

`team_context` 每 `(platform_id, game_id, team_id)` 一列，先從 participants 聚合可用數據；以 own-team／enemy-team 欄位接入 `my_performance`。原始 JSON 的 teams 區塊已回填團隊首殺、首塔、首兵營、塔數、兵營數；本批確實有非零值。

- Dimensions：我方／敵方坦克數、射手數、輔助數、是否缺少特定定位、團隊首塔狀態。
- Measures：團隊首塔率、兵營取得率、塔差、兵營差、團隊治療／控場速率。
- 定位計數按玩家條件計數；一名英雄可屬於兩種定位，各定位數相加可以大於五。它描述英雄標籤，不能保證實際隊伍有前排或足夠控制。
- 團隊首塔狀態等是對局進行後才知道的資訊，不應拿來預測開局勝率。

### 組合與同場關係

- `augment_pairs` 已落地：每玩家對局、每不重複增幅 ID 組合一列（正規化 A < B），提供組合出現場次、勝場、勝率、DPM 與獲得金錢；本機 Mayhem 目前 151 個玩家對局含至少一組 pair、73 勝，與獨立 SQL 一致。多選兩個增幅的普通 OR filter 並不等於同時擁有兩個。
- `teammates` 可明確連到視角玩家與另一位玩家的 participant 別名 cube；避免只透過 game_id 連回整場十人。實測現有 `teammates.relation × participants.dpm` 無 join path。
- 這些組合先當探索工具；以目前個人樣本量，不適合推出細到「英雄 × 增幅 A × 增幅 B × 裝備」的可靠推薦排行。

## P2：需要比較基準或統計層的 measures

- `winrate_ci_low/high`：與玩家對局樣本數一起顯示的勝率區間；個人可先採 Wilson 區間並標明方法。跨玩家同場觀測有群聚，不能把十人視為十個獨立樣本套同一不確定性解讀。
- `observed_augment_delta_pp`：同玩家／英雄／版本／期間，選到與未選到某增幅的勝率差；需為分子分母建立不同篩選情境。沒有可選候選集與選取時間，不能稱為增幅的因果加成。
- `recent_winrate`／`recent_dpm`：明確區分「最近 N 場」與「最近 N 天」；前者是序列窗口，後者是時間窗口。
- 同類型的基準比較統一定義在模型或共用分析層，避免前端每頁拼不同的母體。先驗證本機 Cube 1.7.35 與 SQLite 實際支援，再考慮 multi-stage 等能力；也可以由小型 SQL context cube 提供。

## 原始 JSON 可以回填，但目前無法支持的分析

| 類別 | 本次檢查結果 | 決策 |
|---|---|---|
| 團隊首殺／首塔／首兵營、塔／兵營數 | teams 區塊有值且有變化 | 值得回填成 team grain，收益高。 |
| 首殺助攻、首塔助攻、提前結束旗標、對塔傷害 | stats 有值；本批對塔傷害與目標傷害數值相同 | 可回填；避免把相同數據包裝成兩個新發現。 |
| 符文系別、perk0–5 | 2,440 筆 Mayhem 玩家對局均為 0 | 不建議現在增加符文勝率；有欄位與字典不等於有有效觀測。 |
| timeline 的金錢／經驗／補兵／承傷分段 | 所有分段字典均為空 | 無法從現有 raw 還原十分鐘經濟差、前中後期曲線。 |
| timeline lane／role | 有值但包含多種召喚峽谷式分類 | 尚無足夠證據解讀為 Mayhem 真實職責，不推薦直接作核心維度。 |
| 視野、插眼、野怪目標 | 多數為 0，部分全為 0 | 優先度低，先確認 Mayhem 的實際語義。 |
| 買裝時間／先後、死亡時持有金錢、增幅候選池、重抽次數、選取時間、治療隊友與自療拆分、護盾隊友量 | 已檢查的 raw 中沒有相應有效明細 | 需要新的資料來源或額外採集，單加 Cube measure 無法產生。 |

## 如何達成「不用每次組大表」

1. **底層保存原始事實與 grain**：matches、participants、增幅／裝備 bridge；原始 JSON 保留供補欄位。
2. **少量可重用的情境**：participant_context、team_context、augment_pairs。先用 SQL cube／CTE，只有量測到需要才物化或建立預聚合。
3. **Cube 統一 measures 與關係**：使用正確的 PK、one_to_one／one_to_many／many_to_one；同一字典的雙重角色使用別名／extends。
4. **Views 定義分析入口**：個人表現、團隊對抗、連續遊玩、同場關係、配置分析。View 是邏輯入口，無須另存一份大表。
5. **消費端使用相容欄位集合**：目前前端直接查 cubes 且排除 views，因此「自由組合」仍可挑出無法連接的欄位。可漸進改用 view 作分析主題，或以相同模型資訊限制可選欄位；不必為此重寫所有專用頁面。
6. **集中資料與指標品質**：檢查玩家對局唯一性、每場人數、每隊人數、字典覆蓋、NULL／0 區分、欄位回填與 metadata 更新的快取失效。現在 `_num` 將缺值轉 0，未來新欄位應保留「未提供」狀態。

Cube 可以替查詢產生 join 並處理模型所描述的重複列，但不會自動決定應該計算「場」、「人次」、「隊伍」或「配置曝光」。這些定義仍須在模型中先確立。官方文件：[Joins](https://docs.cube.dev/docs/data-modeling/joins)、[Views](https://docs.cube.dev/docs/data-modeling/views)。

## 建議實作順序與驗收

| 順序 | 工作 | 最小驗收 |
|---|---|---|
| 1 | 修玩家對局口徑、增幅基準、金錢欄位解讀、個人視角約束 | 已完成玩家對局口徑與增幅基準；金錢欄位解讀與個人視角約束仍待後續前端／view 改造。 |
| 2 | 技能配置、傷害組成、每分鐘生存與控場、現有隱藏維度 | 已完成模型與 view；新 measures 的個人總計已與獨立 SQL 對上，仍需補一對多組合回歸。 |
| 3 | participant_context 接回 participants | 已完成：日期／英雄篩選不重算歷史序號；間隔從前場結束計；前一場結果不含本場；可查「前場結果 × DPM」，並與獨立 SQL 對上。 |
| 4 | team_context 與 raw 回填 | 已完成：每場每隊唯一；首塔狀態與個人 DPM 可同查；團隊總量以隊伍 grain 計算，不會因同隊五個玩家而乘五；152 場本機 Mayhem 總計與獨立 SQL 對上。 |
| 5 | augment_pairs 組合分析 | 已完成模型與 `augment_analysis` view；組合勝率仍需顯示樣本量，不把共現稱為最佳選擇。 |
| 6 | 共用比較基準、區間與穩定性呈現 | 待後續：顯示樣本與資料母體；不把群聚樣本當獨立觀測。 |

主要程式依據：`cube/model/cubes/participants.yml`、`my_games.yml`、`teammates.yml`、`dimensions.yml`、`matches.yml`、`cube/model/views/agent_views.yml`、`web/src/pages/Augments.tsx`、`web/src/pages/Explore.tsx`、`web/src/hooks/useCubeMeta.ts`、`web/src/lib/filters.tsx`、`db.py`。
