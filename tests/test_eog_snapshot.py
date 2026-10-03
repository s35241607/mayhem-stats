import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import collector
import db
import features


def block(game_id=1234, team_keys=("A",), player_keys=("B", "C")):
    return {
        "gameId": game_id,
        "teams": [
            {"stats": {k: 1 for k in team_keys}, "players": [{"stats": {k: 2 for k in player_keys}}]},
        ],
        "localPlayer": {"stats": {"LOCAL": 3}},
    }


class FakeClient:
    def __init__(self, result):
        self.result = result

    def eog_stats_block(self):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class EogSnapshotTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name) / "test.db"
        db.init(self.path)
        self.conn = db.connect(self.path)
        self.addCleanup(self.conn.close)

    def rows(self):
        return self.conn.execute("SELECT game_id, stat_keys FROM eog_snapshots").fetchall()

    def test_stores_union_of_stat_keys(self):
        stored, keys = db.store_eog_snapshot(self.conn, block())
        self.assertTrue(stored)
        self.assertEqual(keys, ["A", "B", "C", "LOCAL"])
        row = self.conn.execute("SELECT stat_keys, raw_json FROM eog_snapshots WHERE game_id = 1234").fetchone()
        self.assertEqual(json.loads(row["stat_keys"]), keys)
        self.assertEqual(json.loads(row["raw_json"])["gameId"], 1234)

    def test_same_game_is_kept_once(self):
        db.store_eog_snapshot(self.conn, block())
        stored, _ = db.store_eog_snapshot(self.conn, block())
        self.assertFalse(stored)
        self.assertEqual(len(self.rows()), 1)

    def test_richer_snapshot_overwrites_poorer_one_does_not(self):
        db.store_eog_snapshot(self.conn, block(player_keys=("B",)))
        stored, _ = db.store_eog_snapshot(self.conn, block(player_keys=("B", "C", "D")))
        self.assertTrue(stored)
        self.assertEqual(json.loads(self.rows()[0]["stat_keys"]), ["A", "B", "C", "D", "LOCAL"])
        stored, _ = db.store_eog_snapshot(self.conn, block(player_keys=("B",)))
        self.assertFalse(stored)
        self.assertEqual(len(json.loads(self.rows()[0]["stat_keys"])), 5)

    def test_block_without_game_id_is_ignored(self):
        stored, _ = db.store_eog_snapshot(self.conn, {"teams": []})
        self.assertFalse(stored)
        self.assertEqual(self.rows(), [])

    def test_capture_swallows_missing_post_game_screen(self):
        old = db.DB_PATH
        db.DB_PATH = self.path
        try:
            gatherer = collector.Collector()
            # 賽後畫面已經關掉：客戶端回 404。不能拋出去，否則會擋住對局採集
            self.assertFalse(gatherer._capture_eog(FakeClient(RuntimeError("404"))))
            self.assertTrue(gatherer._capture_eog(FakeClient(block(game_id=77))))
        finally:
            db.DB_PATH = old
        self.assertEqual([r["game_id"] for r in self.rows()], [77])


class DerivedTablesTests(unittest.TestCase):
    def test_every_materialized_sql_runs_on_an_empty_database(self):
        """衍生表的 SQL 在空資料庫上也要能執行：語法錯誤、欄位拼錯會在這裡現形。"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.db"
            db.init(path)
            conn = sqlite3.connect(path)
            try:
                features.rebuild(conn)
                for table, _, _ in features.definitions():
                    self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
            finally:
                conn.close()

    def test_contribution_is_built_after_builds(self):
        order = [table for table, _, _ in features.definitions()]
        self.assertLess(order.index("mat_builds"), order.index("mat_contribution"))


if __name__ == "__main__":
    unittest.main()
