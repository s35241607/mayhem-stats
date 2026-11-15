"""本場貢獻 v5.4（v5-B 修訂版）的 SQL（contribution.yml）：用小型合成資料釘住規格裡的關鍵性質——
100% 跨場絕對尺度（全場打好都高分、打爛都低分，加上敵方前排數 enemy_front 與血腥度 pace_k 校正）、不強制各定位歸 50、
有效承傷與混合控場、坦輔／功能輔平滑權重（暫估局採英雄保人殘差先驗＋輔助裝數量估算護盾、調整不確定性權重並提供輔助團戰高光）、
非主 C 定位高傷害動態轉型加成與「以攻代守」副軸負分豁免（core_d 斜率遞增、坦輔高輸出解鎖有效擊殺 core_ks、高輸出豁免負向控場／承傷）、
非坦輔順手治療僅在 EOG 局計分、輸出與輔助正向控場加分與 b_util_cc、
擊殺與建築時間軸（拿掉首殺／首塔／終結／多人推塔次數；僅單人拆毀建築或高 turret_dmg 加分；純單抓孤立死亡與後期孤死）、
各項加減分加總一致與不完整對局門檻。
整套分數與獨立 Python 實作的逐筆比對見 analysis/scoring_v5_check.py。"""
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

import yaml

import db

YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
SQL = yaml.safe_load(YML.read_text(encoding="utf-8"))["cubes"][0]["meta"]["materialize"]["sql"]
_M_GLOB = re.search(
    r"calib_global\([^)]+\)\s*AS\s*\(\s*VALUES\s*\(([-\d., eE+]+)\)\s*-- 校正常數結束",
    SQL,
    re.S,
)
assert _M_GLOB
_G_VALS = [float(x) for x in _M_GLOB.group(1).split(",")]
H_SCALE = _G_VALS[0]
G_MEAN_EOG, G_MEAN_EST = _G_VALS[-3], _G_VALS[-2]


class Fixture:
    def __init__(self, path):
        db.init(path)
        self.conn = db.connect(path)
        self.conn.execute("CREATE TABLE mat_builds (participant_rowid INTEGER PRIMARY KEY, build_role TEXT)")
        self.conn.execute("CREATE TABLE mat_comp_context (participant_rowid INTEGER PRIMARY KEY, enemy_front INTEGER)")
        self.rows = {}

    def game(
        self,
        game_id,
        *,
        players=10,
        minutes=16.5,
        queue=2400,
        over=None,
        roles=None,
        items=None,
        eog=None,
        kill_events=None,
        building_events=None,
        enemy_front=None,
    ):
        """over：{序號: {欄位: 值}}；roles：{序號: 出裝定位}，沒給的是法師；
        items：{序號: [裝備]}；eog：{序號: (治療隊友, 護盾隊友)}；
        kill_events：[(event_index, time_ms, killer_id, victim_id, assist_ids_list)]；
        building_events：[(event_index, time_ms, killer_id, assist_ids_list)]；
        enemy_front：整數或 {序號: 敵方前排數}，預設 2。"""
        over, roles, items, eog = over or {}, roles or {}, items or {}, eog or {}
        kill_events, building_events = kill_events or [], building_events or []
        c = self.conn
        c.execute(
            """INSERT INTO matches (platform_id,game_id,queue_id,game_mode,game_version,map_id,game_creation,
                 game_duration,ended_surrender,raw_json,ingested_at) VALUES ('TW2',?,?,'KIWI','16.20',12,1000,?,0,'{}',1)""",
            (game_id, queue, int(round(minutes * 60))),
        )
        for i in range(1, players + 1):
            v = dict(
                dmg_to_champions=32000 + i * 500,
                dmg_taken=18000 + i * 300,
                dmg_mitigated=18000,
                time_ccing_others=28 + i,
                cc_duration=150 + i * 5,
                total_damage=95000 + i * 1000,
                dmg_to_objectives=1500,
                kills=8,
                deaths=6,
                assists=26,
                gold_earned=15500,
                total_heal=4000,
                units_healed=1,
            )
            v.update(over.get(i, {}))
            cur = c.execute(
                f"""INSERT INTO match_participants (platform_id, game_id, participant_id, puuid, team_id, win, champion_id,
                      {", ".join(v)}) VALUES ('TW2', ?, ?, ?, ?, ?, 1, {", ".join("?" * len(v))})""",
                (game_id, i, f"p{game_id}-{i}", 100 if i <= 5 else 200, 1 if i <= 5 else 0, *v.values()),
            )
            self.rows[(game_id, i)] = cur.lastrowid
            c.execute("INSERT INTO mat_builds VALUES (?, ?)", (cur.lastrowid, roles.get(i, "法師")))
            ef = enemy_front.get(i, 2) if isinstance(enemy_front, dict) else (2 if enemy_front is None else enemy_front)
            c.execute("INSERT INTO mat_comp_context VALUES (?, ?)", (cur.lastrowid, ef))
            for slot, iid in enumerate(items.get(i, [])):
                c.execute("INSERT INTO participant_items VALUES ('TW2', ?, ?, ?, ?)", (game_id, i, slot, iid))
            if i in eog:
                c.execute(
                    "INSERT INTO eog_player_stats (game_id, puuid, team_id, champion_id, heal_on_teammates, shield_on_teammates) VALUES (?,?,?,1,?,?)",
                    (game_id, f"p{game_id}-{i}", 100 if i <= 5 else 200, *eog[i]),
                )
        for idx, tms, kid, vid, aids in kill_events:
            c.execute(
                "INSERT INTO match_kill_events (platform_id, game_id, event_index, time_ms, killer_id, victim_id, assist_ids) VALUES ('TW2',?,?,?,?,?,?)",
                (game_id, idx, tms, kid, vid, str(list(aids)).replace(" ", "")),
            )
        for idx, tms, kid, aids in building_events:
            c.execute(
                "INSERT INTO match_building_events (platform_id, game_id, event_index, time_ms, killer_id, assist_ids) VALUES ('TW2',?,?,?,?,?)",
                (game_id, idx, tms, kid, str(list(aids)).replace(" ", "")),
            )
        c.commit()

    def result(self):
        self.conn.row_factory = sqlite3.Row
        return {r["participant_rowid"]: dict(r) for r in self.conn.execute(SQL)}


class ContributionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.fx = Fixture(Path(self._tmp.name) / "t.db")
        self.addCleanup(self.fx.conn.close)

    def at(self, res, g, i):
        return res[self.fx.rows[(g, i)]]

    def score(self, g, i):
        return self.at(self.fx.result(), g, i)["work_score"]

    def test_cross_match_absolute_scale_good_vs_bad_lobbies(self):
        """v5.2 核心性質：絕對尺度——新增別場不改舊分；全員表現好都高分、全員擺爛低輸出參團都低分"""
        self.fx.game(1)
        before = self.score(1, 3)
        high_lobby = {
            i: {
                "dmg_to_champions": 60000,
                "total_damage": 150000,
                "dmg_to_objectives": 5000,
                "time_ccing_others": 60,
                "cc_duration": 300,
                "kills": 18,
                "assists": 40,
                "gold_earned": 18000,
            }
            for i in range(1, 11)
        }
        low_lobby = {
            i: {
                "dmg_to_champions": 10000,
                "total_damage": 35000,
                "dmg_to_objectives": 100,
                "time_ccing_others": 5,
                "cc_duration": 20,
                "kills": 2,
                "assists": 4,
                "gold_earned": 12000,
            }
            for i in range(1, 11)
        }
        self.fx.game(2, over=high_lobby)
        self.fx.game(3, over=low_lobby)
        res = self.fx.result()
        self.assertAlmostEqual(self.at(res, 1, 3)["work_score"], before, places=6)
        self.assertGreater(self.at(res, 2, 3)["work_score"], 75.0)
        self.assertLess(self.at(res, 3, 3)["work_score"], 25.0)

    def test_more_core_work_never_lowers_the_score(self):
        self.fx.game(1, roles={3: "鬥士"})
        base = self.score(1, 3)
        for g, field, value in (
            (2, "dmg_to_champions", 65000),
            (3, "dmg_taken", 80000),
            (4, "dmg_mitigated", 70000),
            (5, "time_ccing_others", 100),
            (6, "cc_duration", 450),
            (7, "dmg_to_objectives", 10000),
            (8, "assists", 45),
        ):
            self.fx.game(g, roles={3: "鬥士"}, over={3: {field: value}})
            self.assertGreater(self.score(g, 3), base, field)
        # 清兵主要看射／刺／法
        self.fx.game(9, roles={3: "射手"})
        b_adc = self.score(9, 3)
        self.fx.game(10, roles={3: "射手"}, over={3: {"total_damage": 220000}})
        self.assertGreater(self.score(10, 3), b_adc)

    def test_a_tank_who_deals_carry_damage_scores_high(self):
        """坦克打出高輸出時，gene_d 明顯高且另享坦輔高輸出獎賞"""
        roles = {3: "坦克"}
        self.fx.game(1, roles=roles, over={3: {"dmg_to_champions": 15000, "dmg_taken": 50000, "dmg_mitigated": 50000}})
        self.fx.game(2, roles=roles, over={3: {"dmg_to_champions": 55000, "dmg_taken": 50000, "dmg_mitigated": 50000}})
        res = self.fx.result()
        quiet, loud = self.at(res, 1, 3), self.at(res, 2, 3)
        self.assertGreater(loud["gene_d"], 80)
        self.assertGreater(loud["work_score"], quiet["work_score"] + 12)

    def test_baseline_depends_on_build_role(self):
        self.fx.game(1, roles={3: "坦克"})
        self.fx.game(2, roles={3: "射手"})
        res = self.fx.result()
        tank, adc = self.at(res, 1, 3), self.at(res, 2, 3)
        self.assertGreater(tank["gene_d"], adc["gene_d"])
        self.assertLess(tank["gene_t"], adc["gene_t"])

    def test_effective_soak_and_hybrid_cc(self):
        """有效承傷 0.62×減免 + 0.38×承受：相同總和下，減免占比高者承傷分較高；cc_duration 高也能提升控場分"""
        roles = {3: "坦克"}
        self.fx.game(1, roles=roles, over={3: {"dmg_mitigated": 20000, "dmg_taken": 80000, "time_ccing_others": 25, "cc_duration": 80}})
        self.fx.game(2, roles=roles, over={3: {"dmg_mitigated": 80000, "dmg_taken": 20000, "time_ccing_others": 25, "cc_duration": 360}})
        res = self.fx.result()
        a, b = self.at(res, 1, 3), self.at(res, 2, 3)
        self.assertGreater(b["gene_t"], a["gene_t"])
        self.assertGreater(b["pts_t"], a["pts_t"])
        self.assertGreater(b["gene_c"], a["gene_c"])
        self.assertGreater(b["pts_c"], a["pts_c"])

    def test_protein_shake_reclassifies_support_champions_with_tank_builds(self):
        tank_item, ap_item = 9001, 9002
        self.fx.game(1, items={i: [tank_item] for i in (1, 2, 3)} | {4: [ap_item]})
        conn = self.fx.conn
        conn.execute("UPDATE match_participants SET champion_id = 2 WHERE game_id = 1 AND participant_id = 3")
        conn.executemany("INSERT INTO dim_champion_roles VALUES (?, ?)", [(1, "tank"), (1, "support"), (2, "tank")])
        conn.executemany("INSERT INTO dim_items (id, price_total) VALUES (?, 2500)", [(tank_item,), (ap_item,)])
        conn.executemany("INSERT INTO dim_item_categories VALUES (?, ?)", [(tank_item, "Health"), (ap_item, "SpellDamage")])
        conn.executemany("INSERT INTO participant_augments VALUES ('TW2', 1, ?, 0, 1324)", [(1,), (3,), (4,)])
        builds_sql = yaml.safe_load(YML.with_name("builds.yml").read_text(encoding="utf-8"))["cubes"][0]["meta"]["materialize"]["sql"]
        conn.execute("DROP TABLE mat_builds")
        conn.execute(f"CREATE TABLE mat_builds AS {builds_sql}")
        rows = self.fx.result()
        self.assertEqual([self.at(rows, 1, i)["build_role"] for i in range(1, 5)], ["輔助", "坦克", "坦克", "法師"])

    def test_points_add_up_to_the_score(self):
        """九項核心與功能加高光／失誤加減分之和 == work_raw，加上 pts_base（EOG 補償）即等於 work_score - 50"""
        eog = {i: (2000 if i == 3 else 0, 1000) for i in range(1, 11)}
        self.fx.game(1, roles={3: "輔助"}, eog=eog)
        self.fx.game(2, roles={3: "輔助"})
        res = self.fx.result()
        for g in (1, 2):
            for i in range(1, 11):
                r = self.at(res, g, i)
                self.assertEqual(r["score_version"], "v5.4")
                pts = sum(
                    r[k]
                    for k in (
                        "pts_d",
                        "pts_w",
                        "pts_o",
                        "pts_t",
                        "pts_c",
                        "pts_h",
                        "pts_a",
                        "pts_ks",
                        "pts_ka",
                        "pts_bonus",
                        "pts_penalty",
                    )
                )
                self.assertAlmostEqual(pts, r["work_raw"], places=6)
                if 0 < r["work_score"] < 100:
                    self.assertAlmostEqual(r["work_score"], 50 + pts + r["pts_base"], places=6)
        self.assertAlmostEqual(self.at(res, 1, 1)["pts_base"], -G_MEAN_EOG, places=5)
        self.assertAlmostEqual(self.at(res, 2, 1)["pts_base"], -G_MEAN_EST, places=5)

    def test_kills_need_damage(self):
        """低輸出搶頭被 k_eff = min(zr_k, zr_d + 0.4) 限制"""
        self.fx.game(1, over={3: {"kills": 20, "dmg_to_champions": 9000}, 4: {"kills": 20, "dmg_to_champions": 65000}})
        res = self.fx.result()
        steal, carry = self.at(res, 1, 3), self.at(res, 1, 4)
        self.assertGreater(carry["pts_ks"], steal["pts_ks"] + 4.0)

    def test_support_smooth_tank_blend_and_non_support_utility_heal(self):
        """軟輔靠保人（pts_h 主導），坦輔平滑混入承傷（pts_t 顯著提升）；非坦輔順手補血 > 500/min 僅在 EOG 局拿正 pts_h"""
        no_eog = {i: (0, 0) for i in range(1, 11)}
        # tank support (eff_t >= 3600 -> tank_w = 0.55) with low heal
        self.fx.game(
            1,
            roles={3: "輔助", 4: "射手"},
            eog={**no_eog, 3: (2000, 2000), 4: (18000, 0)},
            over={3: {"dmg_mitigated": 55000, "dmg_taken": 50000}},
        )
        # pure enchanter (eff_t < 1400 -> tank_w = 0) with strong heal
        self.fx.game(
            2,
            roles={3: "輔助"},
            eog={**no_eog, 3: (22000, 22000)},
            over={3: {"dmg_mitigated": 8000, "dmg_taken": 12000}},
        )
        # estimate-only game (no EOG): non-tank/sup with high units_healed/total_heal must NOT get self-heal utility bonus
        self.fx.game(
            3,
            roles={4: "射手"},
            over={4: {"units_healed": 3, "total_heal": 18000}},
        )
        res = self.fx.result()
        tank_sup = self.at(res, 1, 3)
        adc_healer = self.at(res, 1, 4)
        enchanter = self.at(res, 2, 3)
        est_adc_self_heal = self.at(res, 3, 4)
        self.assertGreater(tank_sup["pts_t"], 5.0)
        self.assertEqual(enchanter["pts_t"], 0.0)
        self.assertGreater(enchanter["pts_h"], tank_sup["pts_h"] + 10.0)
        self.assertGreater(adc_healer["pts_h"], 0.5)
        self.assertEqual(est_adc_self_heal["pts_h"], 0.0)

    def test_kill_events_bonuses_and_penalties(self):
        """驗證 match_kill_events：單殺／後期參團／換命死＋多殺推塔加分；高頻孤死＋後期孤死＋隱身扣分"""
        # 16.5m game = 990_000 ms; 65% = 643_500 ms
        events = [
            # Player 3 gets 2 solo kills + first blood + 2 late kills
            (1, 60_000, 3, 6, []),
            (2, 120_000, 3, 7, []),
            (3, 700_000, 3, 8, [1, 2]),
            (4, 720_000, 3, 9, [1]),
            # Player 3 dies once inside a big teamfight where >=2 allies get kills within +-10s (trade death)
            (5, 300_000, 6, 3, [7]),
            (6, 303_000, 1, 7, [3]),
            (7, 305_000, 2, 8, [3]),
            # Player 4 has 5 isolated deaths cleanly separated by > 20s, 3 of them late (>= 643_500 ms)
            (8, 200_000, 6, 4, []),
            (9, 250_000, 7, 4, []),
            (10, 660_000, 8, 4, []),
            (11, 760_000, 9, 4, []),
            (12, 860_000, 10, 4, []),
        ]
        self.fx.game(
            1,
            over={
                3: {"first_blood": 1, "first_tower": 1, "double_kills": 4, "triple_kills": 1, "turret_kills": 3, "dmg_to_champions": 55000, "turret_dmg": 4500, "dmg_to_objectives": 4500},
                4: {"deaths": 6, "dmg_to_champions": 8000, "kills": 0, "assists": 4, "gold_earned": 12000},
            },
            kill_events=events,
            building_events=[(1, 500_000, 3, [])],
        )
        res = self.fx.result()
        star,feeder = self.at(res, 1, 3), self.at(res, 1, 4)
        self.assertGreater(star["pts_bonus"], 5.0)
        self.assertEqual(star["pts_penalty"], 0.0)
        self.assertGreater(star["pts_ka"], feeder["pts_ka"])
        self.assertLess(feeder["pts_penalty"], -5.0)
        self.assertGreaterEqual(feeder["pts_penalty"], -18.0)

    def test_v51_teamfight_wipe_not_isolated_and_no_econ_penalty(self):
        """v5.1 修正：團滅（0 擊殺但 ±10s 內隊友也有死）不計孤立死亡；高金錢刷發育也不再觸發負向 p_econ 扣分"""
        # Player 4 dies 4 times during lost teamfights (0 ally kills, but >= 1 ally dies within +-4s each time)
        wipe_events = [
            (1, 200_000, 6, 4, []),
            (2, 203_000, 7, 1, [6]),
            (3, 400_000, 8, 4, []),
            (4, 404_000, 9, 2, [8]),
            (5, 700_000, 6, 4, []),
            (6, 702_000, 7, 3, [6]),
            (7, 850_000, 8, 4, []),
            (8, 853_000, 9, 5, [8]),
        ]
        self.fx.game(
            1,
            over={
                4: {"deaths": 5, "gold_earned": 45000},
            },
            kill_events=wipe_events,
        )
        res = self.fx.result()
        p4 = self.at(res, 1, 4)
        self.assertEqual(p4["pts_penalty"], 0.0)

    def test_heal_source_needs_all_ten_eog_and_estimate_scales_by_h_scale(self):
        full = {i: (0, 0) for i in range(1, 11)}
        full[3] = (20000, 5000)
        self.fx.game(1, roles={3: "輔助"}, eog=full)
        partial = dict(full)
        del partial[7]
        self.fx.game(2, roles={3: "輔助"}, eog=partial, over={3: {"units_healed": 3, "total_heal": 20000}})
        res = self.fx.result()
        a, b = self.at(res, 1, 3), self.at(res, 2, 3)
        self.assertEqual((a["heal_src"], a["score_status"]), ("eog", "complete"))
        self.assertAlmostEqual(a["x_h"], 25000 / 16.5)
        self.assertEqual((b["heal_src"], b["score_status"]), ("flag", "estimate"))
        self.assertAlmostEqual(b["x_h"], 20000 / 16.5)
        # v5.2：暫估場次隊友治療乘 h_scale 對齊（輔助另估護盾），不會再凍結為 50 / 0
        self.assertNotEqual(b["gene_h"], 50.0)
        self.assertNotEqual(b["pts_h"], 0.0)
        # flag 僅計 units_healed >= 2
        self.assertEqual(self.at(res, 2, 4)["x_h"], 0.0)

    def test_v52_no_first_blood_and_solo_only_structure_bonus(self):
        """v5.2：首殺／首塔／多人分攤拆塔都不加 pts_bonus；僅單人拆塔或高 turret_dmg 才加分"""
        base_over = {3: {"dmg_to_champions": 32000, "gold_earned": 15500, "turret_dmg": 600, "dmg_to_objectives": 600}}
        # Game 1: first_blood + first_tower + 4 group turret kills + assisted building event -> ZERO pts_bonus
        self.fx.game(
            1,
            over={3: {**base_over[3], "first_blood": 1, "first_tower": 1, "first_tower_assist": 1, "turret_kills": 4, "inhibitor_kills": 2}},
            building_events=[(1, 450_000, 3, [1, 2])],
        )
        # Game 2: same turret_dmg (600) + solo BUILDING_KILL (assist_ids=[]) -> positive pts_bonus
        self.fx.game(
            2,
            over=base_over,
            building_events=[(1, 450_000, 3, [])],
        )
        # Game 3: no solo building kill, no first tower/blood, high turret_dmg (5000) -> positive pts_bonus
        self.fx.game(
            3,
            over={3: {"dmg_to_champions": 32000, "gold_earned": 15500, "turret_dmg": 5000, "dmg_to_objectives": 5000}},
        )
        res = self.fx.result()
        g1, g2, g3 = self.at(res, 1, 3), self.at(res, 2, 3), self.at(res, 3, 3)
        self.assertEqual(g1["pts_bonus"], 0.0)
        self.assertGreater(g2["pts_bonus"], 1.5)
        self.assertGreater(g3["pts_bonus"], 1.0)

    def test_v52_enemy_front_and_carry_cc_bonus(self):
        """v5.2：敵方 0 前排補償提高 adj_d；射手 0 控場不倒扣，高控場額外拿 core_c + b_util_cc"""
        self.fx.game(1, roles={3: "射手"}, enemy_front=0, over={3: {"time_ccing_others": 0, "cc_duration": 0}})
        self.fx.game(2, roles={3: "射手"}, enemy_front=4, over={3: {"time_ccing_others": 0, "cc_duration": 0}})
        self.fx.game(3, roles={3: "射手"}, enemy_front=2, over={3: {"time_ccing_others": 15, "cc_duration": 50}})
        self.fx.game(4, roles={3: "射手"}, enemy_front=2, over={3: {"time_ccing_others": 120, "cc_duration": 550}})
        res = self.fx.result()
        sq, tk = self.at(res, 1, 3), self.at(res, 2, 3)
        no_cc_carry, mod_cc_carry, hi_cc_carry = self.at(res, 1, 3), self.at(res, 3, 3), self.at(res, 4, 3)
        self.assertGreater(sq["gene_d"], tk["gene_d"] + 5.0)
        self.assertGreater(sq["work_score"], tk["work_score"] + 4.0)
        self.assertEqual(no_cc_carry["pts_c"], 0.0)
        self.assertEqual(mod_cc_carry["pts_c"], 0.0)
        self.assertGreater(hi_cc_carry["pts_c"], 1.5)
        self.assertGreater(hi_cc_carry["work_score"], mod_cc_carry["work_score"] + 1.5)

    def test_v52_support_estimate_items_and_uncertainty_weight_shift(self):
        """v5.2/v5.3：暫估局輔助帶輔助裝會先驗估算護盾提升 pts_h，且不確定性權重會轉移到參團／控場"""
        sup_stats = {"units_healed": 2, "total_heal": 10000, "assists": 42, "time_ccing_others": 60, "cc_duration": 300}
        self.fx.game(1, roles={3: "輔助"}, items={3: []}, over={3: sup_stats})
        self.fx.game(2, roles={3: "輔助"}, items={3: [6617, 3504, 124011]}, over={3: sup_stats})
        full = {i: (0, 0) for i in range(1, 11)}
        full[3] = (int(round(10000 * H_SCALE)), 0)
        self.fx.game(3, roles={3: "輔助"}, items={3: []}, eog=full, over={3: sup_stats})
        res = self.fx.result()
        est_bare, est_geared, eog_bare = self.at(res, 1, 3), self.at(res, 2, 3), self.at(res, 3, 3)
        self.assertGreater(est_geared["gene_h"], est_bare["gene_h"] + 4.0)
        self.assertGreater(est_geared["pts_h"], est_bare["pts_h"])
        # 暫估局將 0.06*(1-tank_w) 從保人轉到參團 +0.04、控場 +0.02
        self.assertGreater(est_bare["pts_ka"], eog_bare["pts_ka"])
        self.assertGreater(est_bare["pts_c"], eog_bare["pts_c"])

    def test_v53_enemy_front_and_bloodiness_ka_and_support_highlight(self):
        """v5.3：無前排或少頭拉扯局對參團與輸出給予環境補償；輔助高參團＋後期保排協同可拿高光加分（pts_bonus）"""
        # Game 1 vs Game 2: same personal K/A (8/6/26), enemy_front=0 vs enemy_front=4
        self.fx.game(1, roles={3: "法師"}, enemy_front=0)
        self.fx.game(2, roles={3: "法師"}, enemy_front=4)
        # Game 3 vs Game 4: player 3 has identical stats, but other 9 players are in a low-kill standoff vs high-kill brawl
        standoff = {i: {"kills": 4, "assists": 10} for i in range(1, 11) if i != 3}
        brawl = {i: {"kills": 14, "assists": 34} for i in range(1, 11) if i != 3}
        self.fx.game(3, roles={3: "法師"}, over=standoff)
        self.fx.game(4, roles={3: "法師"}, over=brawl)
        # Game 5 vs Game 6: passive support vs high-participation clutch enchanter support (0 multi-kills, 0 solo kills)
        late_events = [(idx, 700_000 + idx * 5_000, 1, 6 + (idx % 5), [3]) for idx in range(1, 16)]
        self.fx.game(5, roles={3: "輔助"}, over={3: {"kills": 0, "assists": 18, "units_healed": 2, "total_heal": 8000}})
        self.fx.game(
            6,
            roles={3: "輔助"},
            items={3: [6617, 3504, 3107]},
            over={3: {"kills": 1, "assists": 46, "units_healed": 4, "total_heal": 32000, "time_ccing_others": 65, "cc_duration": 280}},
            kill_events=late_events,
        )
        res = self.fx.result()
        ef0, ef4 = self.at(res, 1, 3), self.at(res, 2, 3)
        p_standoff, p_brawl = self.at(res, 3, 3), self.at(res, 4, 3)
        sup_quiet, sup_star = self.at(res, 5, 3), self.at(res, 6, 3)
        self.assertGreater(ef0["gene_ka"], ef4["gene_ka"] + 3.0)
        self.assertGreater(ef0["pts_ka"], ef4["pts_ka"] + 1.5)
        self.assertGreater(p_standoff["pts_ka"], p_brawl["pts_ka"] + 2.0)
        self.assertGreater(p_standoff["pts_d"], p_brawl["pts_d"] + 1.0)
        self.assertGreater(sup_star["pts_bonus"], sup_quiet["pts_bonus"] + 4.0)
        self.assertGreater(sup_star["pts_bonus"], 5.0)

    def test_v54_off_role_high_damage_conversion_and_exemption(self):
        """v5.4：非主 C 定位（坦克／鬥士／輔助）打出主 C 級高傷害時，享動態輸出轉型加成、有效擊殺加分與『以攻代守』本業副軸負分豁免"""
        # Game 1: Low-damage zero-CC tank with high kills (kill-stealing) -> 0 pts_ks, negative pts_c
        self.fx.game(
            1,
            roles={3: "坦克"},
            over={3: {"dmg_to_champions": 14000, "kills": 18, "time_ccing_others": 0, "cc_duration": 0, "dmg_taken": 32000, "dmg_mitigated": 32000}},
        )
        # Game 2: Juggernaut Tank (Olaf/Mordekaiser style: 75k dmg, 18 kills, 0 CC) -> high pts_d, positive pts_ks, pts_c negative exempted to 0
        self.fx.game(
            2,
            roles={3: "坦克"},
            over={3: {"dmg_to_champions": 75000, "kills": 18, "time_ccing_others": 0, "cc_duration": 0, "dmg_taken": 55000, "dmg_mitigated": 55000}},
        )
        # Game 3: Ranged/kiting Bruiser (Gangplank/Brand style: 68k dmg, 15 kills, low soak, 0 CC) -> pts_t & pts_c negative exempted to 0
        self.fx.game(
            3,
            roles={3: "鬥士"},
            over={3: {"dmg_to_champions": 68000, "kills": 15, "dmg_taken": 14000, "dmg_mitigated": 8000, "time_ccing_others": 0, "cc_duration": 0}},
        )
        # Game 4: AP Carry Support (Sona/Seraphine style: 48k dmg, 12 kills, modest heal) -> high pts_d, positive pts_ks
        self.fx.game(
            4,
            roles={3: "輔助"},
            over={3: {"dmg_to_champions": 48000, "kills": 12, "assists": 28, "units_healed": 2, "total_heal": 9000, "time_ccing_others": 15, "cc_duration": 60}},
        )
        res = self.fx.result()
        ks_tank, jug_tank, rng_bruiser, ap_sup = (self.at(res, g, 3) for g in (1, 2, 3, 4))
        self.assertEqual(ks_tank["pts_ks"], 0.0)
        self.assertLess(ks_tank["pts_c"], -5.0)
        self.assertGreater(jug_tank["pts_d"], 18.0)
        self.assertGreater(jug_tank["pts_ks"], 3.0)
        self.assertEqual(jug_tank["pts_c"], 0.0)
        self.assertGreater(jug_tank["work_score"], 80.0)
        self.assertGreater(rng_bruiser["pts_d"], 18.0)
        self.assertEqual(rng_bruiser["pts_t"], 0.0)
        self.assertEqual(rng_bruiser["pts_c"], 0.0)
        self.assertGreater(rng_bruiser["work_score"], 75.0)
        self.assertGreater(ap_sup["pts_d"], 14.0)
        self.assertGreater(ap_sup["pts_ks"], 2.0)
        self.assertGreater(ap_sup["work_score"], 68.0)

    def test_anti_heal_prevented_healing_is_split_and_adds_pts_a(self):
        enemy_heal = {i: {"total_heal": 6000} for i in range(6, 11)}
        self.fx.game(1, items={3: [3075]}, over=enemy_heal)
        self.fx.game(2, items={3: [3075], 4: [3165]}, over=enemy_heal)
        res = self.fx.result()
        self.assertAlmostEqual(self.at(res, 1, 3)["x_a"], 0.4 * 30000 / 16.5)
        self.assertAlmostEqual(self.at(res, 2, 3)["x_a"], 0.4 * 30000 / 16.5 / 2)
        self.assertEqual(self.at(res, 1, 4)["x_a"], 0.0)
        self.assertGreater(self.at(res, 1, 3)["gene_a"], self.at(res, 1, 4)["gene_a"])
        self.assertGreater(self.at(res, 1, 3)["pts_a"], 0.0)

    def test_missing_gold_and_unscored_games_and_missing_role_are_safe(self):
        self.fx.game(1, over={3: {"gold_earned": None}})
        self.fx.conn.execute("DELETE FROM mat_builds WHERE participant_rowid = ?", (self.fx.rows[(1, 4)],))
        self.fx.game(2, minutes=5)
        self.fx.game(3, players=9)
        self.fx.game(4, queue=450)
        res = self.fx.result()
        r3, r4 = self.at(res, 1, 3), self.at(res, 1, 4)
        self.assertIsNotNone(r3["work_score"])
        self.assertEqual(r4["build_role"], "未成形")
        self.assertIsNotNone(r4["work_score"])
        for g, reason in ((2, "remake_or_short_game"), (3, "incomplete_5v5"), (4, "other_queue")):
            r = self.at(res, g, 1)
            self.assertIsNone(r["work_score"])
            self.assertEqual((r["score_status"], r["unscored_reason"]), ("unscored", reason))


if __name__ == "__main__":
    unittest.main()
