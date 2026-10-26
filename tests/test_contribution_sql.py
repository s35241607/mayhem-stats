"""本場貢獻 v3 的 SQL（contribution.yml）：用小型合成資料釘住規格裡最容易悄悄壞掉的性質——
只和同場比、每一項多做不會變少、坦克打出高輸出會加分、基準依出裝定位、K/DA 的死亡會扣、功能裝的算法、
治療護盾哪一種場次走哪一種資料、不完整的對局不計分。整套分數和獨立 Python 實作的逐筆比對見 analysis/scoring_v3_check.py。"""
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

import yaml

import db

YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
SQL = yaml.safe_load(YML.read_text(encoding="utf-8"))["cubes"][0]["meta"]["materialize"]["sql"]
SD_WORK = float(re.search(r"VALUES \([\d., ]+, ([\d.]+)\)\s*-- 校正常數結束", SQL).group(1))
WEIGHTS = {"d": 0.25, "t": 0.20, "h": 0.13, "c": 0.12, "kda": 0.12, "o": 0.08, "w": 0.06, "a": 0.04}


class Fixture:
    def __init__(self, path):
        db.init(path)
        self.conn = db.connect(path)
        # 出裝定位由 builds.yml 決定（有自己的測試）；這裡直接給
        self.conn.execute("CREATE TABLE mat_builds (participant_rowid INTEGER PRIMARY KEY, build_role TEXT)")
        self.rows = {}

    def game(self, game_id, *, players=10, minutes=15, queue=2400, over=None, roles=None, items=None, eog=None):
        """over：{序號: {欄位: 值}} 改某人的數字；roles：{序號: 出裝定位}，沒給的是法師；items：{序號: [裝備]}；
        eog：{序號: (治療隊友, 護盾隊友)}，十人都給才算有賽後統計。"""
        over, roles, items, eog = over or {}, roles or {}, items or {}, eog or {}
        c = self.conn
        c.execute(
            """INSERT INTO matches (platform_id,game_id,queue_id,game_mode,game_version,map_id,game_creation,
                 game_duration,ended_surrender,raw_json,ingested_at) VALUES ('TW2',?,?,'KIWI','16.20',12,1000,?,0,'{}',1)""",
            (game_id, queue, minutes * 60),
        )
        for i in range(1, players + 1):
            v = dict(dmg_to_champions=20000 + i * 1000, dmg_taken=25000 + i * 500, dmg_mitigated=10000, time_ccing_others=20 + i,
                     total_damage=90000 + i * 2000, dmg_to_objectives=1000 * (i % 3 + 1), kills=3, deaths=5, assists=5,
                     total_heal=3000, units_healed=1)
            v.update(over.get(i, {}))
            cur = c.execute(
                f"""INSERT INTO match_participants (platform_id, game_id, participant_id, puuid, team_id, win, champion_id,
                      {", ".join(v)}) VALUES ('TW2', ?, ?, ?, ?, ?, 1, {", ".join("?" * len(v))})""",
                (game_id, i, f"p{game_id}-{i}", 100 if i <= 5 else 200, 1 if i <= 5 else 0, *v.values()),
            )
            self.rows[(game_id, i)] = cur.lastrowid
            c.execute("INSERT INTO mat_builds VALUES (?, ?)", (cur.lastrowid, roles.get(i, "法師")))
            for slot, iid in enumerate(items.get(i, [])):
                c.execute("INSERT INTO participant_items VALUES ('TW2', ?, ?, ?, ?)", (game_id, i, slot, iid))
            if i in eog:
                c.execute("INSERT INTO eog_player_stats (game_id, puuid, team_id, champion_id, heal_on_teammates, shield_on_teammates) VALUES (?,?,?,1,?,?)",
                          (game_id, f"p{game_id}-{i}", 100 if i <= 5 else 200, *eog[i]))
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

    def test_only_compared_within_the_same_game(self):
        self.fx.game(1)
        before = self.score(1, 3)
        self.fx.game(2, over={i: {"dmg_to_champions": 90000} for i in range(1, 11)})
        self.assertEqual(self.score(1, 3), before)
        # 同一場十個人的傷害同乘一個倍數（對英雄、對建築、總輸出一起，清兵量才跟著乘），相對分數不變
        self.fx.game(3, over={i: {"dmg_to_champions": 2 * (20000 + i * 1000), "total_damage": 2 * (90000 + i * 2000),
                                  "dmg_to_objectives": 2 * 1000 * (i % 3 + 1)} for i in range(1, 11)})
        self.assertAlmostEqual(self.score(3, 3), before, places=6)

    def test_more_work_in_any_gene_never_lowers_the_score(self):
        self.fx.game(1)
        base = self.score(1, 3)
        for g, field, value in ((2, "dmg_to_champions", 60000), (3, "dmg_taken", 80000), (4, "dmg_mitigated", 60000),
                                (5, "time_ccing_others", 120), (6, "dmg_to_objectives", 9000), (7, "total_damage", 200000),
                                (8, "kills", 15), (9, "assists", 25)):
            self.fx.game(g, over={3: {field: value}})
            self.assertGreater(self.score(g, 3), base, field)
        self.fx.game(10, over={3: {"deaths": 1}})
        self.assertGreater(self.score(10, 3), base, "死得少")
        self.fx.game(11, over={3: {"deaths": 12}})
        self.assertLess(self.score(11, 3), base, "K/DA 的死亡會扣分")

    def test_a_tank_who_deals_carry_damage_scores_high(self):
        """使用者 2026-10-24：坦克輸出高，就是這場打出了其他價值，分數要高。"""
        roles = {3: "坦克"}
        self.fx.game(1, roles=roles, over={3: {"dmg_to_champions": 15000, "dmg_taken": 60000, "dmg_mitigated": 50000}})
        self.fx.game(2, roles=roles, over={3: {"dmg_to_champions": 45000, "dmg_taken": 60000, "dmg_mitigated": 50000}})
        quiet, loud = self.at(self.fx.result(), 1, 3), self.at(self.fx.result(), 2, 3)
        self.assertGreater(loud["gene_d"], 80)
        self.assertGreater(loud["work_score"], quiet["work_score"] + 15)

    def test_baseline_depends_on_build_role(self):
        """同樣的數字，坦克的輸出比坦克平常多、射手的輸出只是射手平常的量"""
        self.fx.game(1, roles={3: "坦克"})
        self.fx.game(2, roles={3: "射手"})
        tank, adc = self.at(self.fx.result(), 1, 3), self.at(self.fx.result(), 2, 3)
        self.assertEqual(tank["p_d"], adc["p_d"])
        self.assertGreater(tank["gene_d"], adc["gene_d"])
        self.assertLess(tank["gene_t"], adc["gene_t"])

    def test_points_add_up_to_the_score(self):
        self.fx.game(1)
        for i in range(1, 11):
            r = self.at(self.fx.result(), 1, i)
            pts = sum(r[k] for k in ("pts_d", "pts_w", "pts_o", "pts_t", "pts_c", "pts_h", "pts_a", "pts_kda"))
            self.assertAlmostEqual(pts, 20 * r["work_raw"] / SD_WORK, places=6)
            if 0 < r["work_score"] < 100:
                self.assertAlmostEqual(r["work_score"], 50 + pts, places=6)

    def test_weights_sum_to_one(self):
        m = re.search(r"SELECT \*,\s*(0\.\d+ \* z_\w+(?: \+ 0\.\d+ \* z_\w+)*) AS work_raw", SQL)
        weights = {w.split(" * z_")[1]: float(w.split(" * ")[0]) for w in m.group(1).split(" + ")}
        self.assertEqual(weights, WEIGHTS)
        self.assertAlmostEqual(sum(weights.values()), 1.0)

    def test_heal_source_needs_all_ten_end_of_game_stats(self):
        full = {i: (0, 0) for i in range(1, 11)}
        full[3] = (30000, 5000)
        self.fx.game(1, eog=full)
        partial = dict(full)
        del partial[7]
        self.fx.game(2, eog=partial, over={3: {"units_healed": 3, "total_heal": 20000}})
        res = self.fx.result()
        a, b = self.at(res, 1, 3), self.at(res, 2, 3)
        self.assertEqual((a["heal_src"], a["score_status"]), ("eog", "complete"))
        self.assertAlmostEqual(a["x_h"], 35000 / 15)
        self.assertEqual((b["heal_src"], b["score_status"]), ("flag", "estimate"))
        self.assertAlmostEqual(b["x_h"], 20000 / 15)
        # flag：只算有治療到隊友（units_healed ≥ 2）的人
        self.assertEqual(self.at(res, 2, 4)["x_h"], 0.0)
        # v3.4：flag 場次的治療護盾不計分（自補不能算成輔助），基因與加減分都是中性
        self.assertEqual(b["gene_h"], 50.0)
        self.assertEqual(b["pts_h"], 0.0)
        self.assertNotEqual(a["gene_h"], 50.0)

    def test_anti_heal_prevented_healing_is_split_between_owners(self):
        enemy_heal = {i: {"total_heal": 6000} for i in range(6, 11)}
        self.fx.game(1, items={3: [3075]}, over=enemy_heal)
        self.fx.game(2, items={3: [3075], 4: [3165]}, over=enemy_heal)
        res = self.fx.result()
        self.assertAlmostEqual(self.at(res, 1, 3)["x_a"], 0.4 * 30000 / 15)
        self.assertAlmostEqual(self.at(res, 2, 3)["x_a"], 0.4 * 30000 / 15 / 2)
        self.assertEqual(self.at(res, 1, 4)["x_a"], 0.0)
        self.assertGreater(self.at(res, 1, 3)["gene_a"], self.at(res, 1, 4)["gene_a"])

    def test_kda_uses_kill_participation(self):
        """v3.1：參團率＝擊殺＋助攻 ÷ 我方擊殺，所以全隊一起多殺時參團率不變、同一場的相對分數也不變"""
        self.fx.game(1)
        self.fx.game(2, over={i: {"kills": 6, "assists": 10} for i in range(1, 6)})
        a, b = self.at(self.fx.result(), 1, 3), self.at(self.fx.result(), 2, 3)
        self.assertAlmostEqual(a["x_kp"], (3 + 5) / 15)
        self.assertAlmostEqual(b["x_kp"], (6 + 10) / 30)
        self.assertAlmostEqual(a["p_k"], 50.0)
        # 我方 0 殺：參團率是 0
        self.fx.game(3, over={i: {"kills": 0, "assists": 0} for i in range(1, 6)})
        self.assertEqual(self.at(self.fx.result(), 3, 3)["x_kp"], 0.0)

    def test_unscored_games(self):
        self.fx.game(1, minutes=5)
        self.fx.game(2, players=9)
        self.fx.game(3, queue=450)
        res = self.fx.result()
        for g, reason in ((1, "remake_or_short_game"), (2, "incomplete_5v5"), (3, "other_queue")):
            r = self.at(res, g, 1)
            self.assertIsNone(r["work_score"])
            self.assertEqual((r["score_status"], r["unscored_reason"]), ("unscored", reason))

    def test_missing_build_role_uses_the_overall_baseline(self):
        self.fx.game(1)
        self.fx.conn.execute("DELETE FROM mat_builds WHERE participant_rowid = ?", (self.fx.rows[(1, 3)],))
        self.fx.conn.commit()
        r = self.at(self.fx.result(), 1, 3)
        self.assertEqual(r["build_role"], "未成形")
        self.assertIsNotNone(r["work_score"])


if __name__ == "__main__":
    unittest.main()
