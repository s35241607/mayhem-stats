"""翻盤（swing.yml → mat_swing）的規則與戰報時間軸端點。用自己造的對局與時間軸，不碰真實資料。"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app
import db
import features

DURATION = 1200


def tower(ms, owner, kind="NEXUS_TURRET"):
    return {"type": "BUILDING_KILL", "timestamp": ms, "teamId": owner, "towerType": kind, "buildingType": "TOWER_BUILDING", "laneType": "MID_LANE"}


def kill(ms, victim):
    return {"type": "CHAMPION_KILL", "timestamp": ms, "killerId": 0, "victimId": victim}


def timeline(gold100, gold200, events=()):
    """每分鐘一格；goldNNN[i] 是那一格整隊的累積經濟（平均分給五個人）。events 依時間放進對應的那一格。"""
    frames = []
    for i, (a, b) in enumerate(zip(gold100, gold200)):
        pf = {str(p): {"participantId": p, "totalGold": (a if p <= 5 else b) // 5} for p in range(1, 11)}
        frames.append({"timestamp": i * 60000, "participantFrames": pf, "events": [e for e in events if i * 60000 <= e["timestamp"] < (i + 1) * 60000]})
    return {"frames": frames}


class SwingTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "test.db"
        db.init(self.path)
        self.conn = db.connect(self.path)
        self.addCleanup(self.conn.close)

    def add_match(self, game_id, winner, tl=None):
        self.conn.execute(
            "INSERT INTO matches (platform_id, game_id, queue_id, game_creation, game_duration, raw_json, ingested_at, is_remake) VALUES ('TW2', ?, 2400, ?, ?, '{}', 0, 0)",
            (game_id, game_id * 1000, DURATION),
        )
        for p in range(1, 11):
            team = 100 if p <= 5 else 200
            self.conn.execute(
                "INSERT INTO match_participants (platform_id, game_id, participant_id, puuid, team_id, win, champion_id) VALUES ('TW2', ?, ?, ?, ?, ?, 1)",
                (game_id, p, f"p{game_id}-{p}", team, int(team == winner)),
            )
        self.conn.commit()
        if tl is not None:
            db.store_timeline(self.conn, "TW2", game_id, tl)

    def labels(self, game_id):
        return dict(self.conn.execute("SELECT team_id, label FROM mat_swing WHERE game_id = ? GROUP BY team_id", (game_id,)).fetchall())

    def test_labels(self):
        flat = [10000 * i for i in range(21)]
        # 1：藍方 15:30 先拆光紅方主堡塔，紅方 19:00 才拆光藍方的、贏了 → 藍方門開被翻盤、紅方門破仍翻盤
        self.add_match(1, 200, timeline(flat, flat, [tower(900_000, 200), tower(930_000, 200), tower(1_130_000, 100), tower(1_140_000, 100)]))
        # 2：對面故意不拆、我們一波反打到底：藍方 18:50 拆光紅方主堡塔，紅方 70 秒內一路推回去贏了
        #    （舊規則要求門開後再撐 2 分鐘，這種會被標成正常）
        self.add_match(2, 200, timeline(flat, flat, [tower(1_120_000, 200), tower(1_130_000, 200), tower(1_170_000, 100), tower(1_180_000, 100)]))
        # 3：雙方門都開在比快、紅方的門先倒但紅方輸了 → 紅方是正常（對面的門後開），藍方贏得正常
        self.add_match(3, 100, timeline(flat, flat, [tower(1_080_000, 200), tower(1_090_000, 200), tower(1_110_000, 100), tower(1_120_000, 100)]))
        # 4：沒拆到主堡塔，經濟曾領先 6,000 卻輸 → 領先被逆轉；另一邊落後逆轉勝
        lead = [g + (6000 if 5 <= i <= 8 else 0) for i, g in enumerate(flat)]
        self.add_match(4, 200, timeline(lead, flat))
        # 5：只倒了一座主堡塔、經濟差不到 5,000 → 兩邊都正常
        self.add_match(5, 100, timeline([g + 4000 for g in flat], flat, [tower(600_000, 200)]))
        # 6：沒有時間軸
        self.add_match(6, 100)
        features.rebuild(self.conn)

        self.assertEqual(self.labels(1), {100: "門開被翻盤", 200: "門破仍翻盤"})
        self.assertEqual(self.labels(2), {100: "門開被翻盤", 200: "門破仍翻盤"})
        self.assertEqual(self.labels(3), {100: "正常", 200: "正常"})
        self.assertEqual(self.labels(4), {100: "領先被逆轉", 200: "落後逆轉勝"})
        self.assertEqual(self.labels(5), {100: "正常", 200: "正常"})
        self.assertEqual(self.labels(6), {100: "沒有時間軸", 200: "沒有時間軸"})
        left, lead_max = self.conn.execute("SELECT own_open_left, max_lead FROM mat_swing WHERE game_id = 2 AND team_id = 200").fetchone()
        self.assertAlmostEqual(left, DURATION - 1130)
        self.assertEqual(lead_max, 0)
        self.assertEqual(self.conn.execute("SELECT max_lead FROM mat_swing WHERE game_id = 4 AND team_id = 100").fetchone()[0], 6000)

    def test_late_timeline_marks_features_stale(self):
        self.add_match(7, 100)
        features.rebuild(self.conn)
        self.assertFalse(features.stale(self.conn))
        db.store_timeline(self.conn, "TW2", 7, timeline([0, 100], [0, 50]))
        self.assertTrue(features.stale(self.conn))  # 時間軸晚到也要重算，不然一直是「沒有時間軸」

    def test_timeline_endpoint(self):
        flat = [10000 * i for i in range(21)]
        self.add_match(6, 200, timeline(flat, [g + 500 for g in flat], [tower(890_000, 200), tower(930_000, 200), kill(60_000, 7), kill(70_000, 2)]))
        features.rebuild(self.conn)
        with mock.patch.object(db, "DB_PATH", self.path):
            out = app.match_timeline("TW2", 6)
            missing = app.match_timeline("TW2", 999)
        self.assertEqual(missing, {"available": False})
        self.assertTrue(out["available"])
        self.assertEqual(len(out["frames"]), 21)
        self.assertEqual(out["frames"][3], {"t": 180.0, "gold100": 30000, "gold200": 30500})
        self.assertEqual([(b["t"], b["owner"], b["kind"]) for b in out["buildings"]], [(890.0, 200, "NEXUS_TURRET"), (930.0, 200, "NEXUS_TURRET")])
        # 被殺的是紅方 7 號 → 藍方得分；被殺的是藍方 2 號 → 紅方得分
        self.assertEqual(out["kills"], [{"t": 60.0, "team": 100}, {"t": 70.0, "team": 200}])
        self.assertEqual(out["swing"][100]["label"], "門開被翻盤")
        self.assertEqual(out["swing"][200]["label"], "門破仍翻盤")


if __name__ == "__main__":
    unittest.main()
