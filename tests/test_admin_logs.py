import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import app


class AccessLogTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        patchers = [
            mock.patch.object(app, "STATE_DB", Path(tmp.name) / "state.db"),
            mock.patch.object(app, "PUBLIC", True),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        app._state_ready = False
        app._access_last_prune = time.time()  # 測試中不要順手觸發清理
        self.now = time.time()

    def record(self, **kw):
        base = dict(method="GET", path="/api/cube/load", status=200, ms=5, who="Lan", ip="203.0.113.7")
        base.update(kw)
        app.record_access(**base)

    def test_kinds(self):
        cases = [
            (429, "/api/cube/load", "429"),
            (500, "/api/match/TW2/1", "error"),
            (200, "/login", "login"),
            (200, "/auth/callback", "login"),
            (401, "/api/config", "denied"),
            (200, "/api/cube/load", "query"),
            (200, "/api/matches", "api"),
        ]
        for status, path, kind in cases:
            with self.subTest(status=status, path=path):
                self.assertEqual(app._access_kind(path, status), kind)

    def test_row_is_written_and_ip_is_hashed(self):
        self.record(status=429, detail="session")
        with app.closing(app._state_db()) as conn:
            row = conn.execute("SELECT * FROM access_log").fetchone()
        self.assertEqual((row["kind"], row["source"], row["who"], row["detail"]), ("429", "mirror", "Lan", "session"))
        self.assertEqual(row["ip"], app._ip_tag("203.0.113.7"))
        self.assertNotIn("203.0.113.7", row["ip"])
        self.assertEqual(len(row["ip"]), 12)

    def test_retention_removes_old_rows(self):
        self.record(path="/api/matches")
        with app.closing(app._state_db()) as conn, conn:
            conn.execute("INSERT INTO access_log (ts, source, kind, who) VALUES (?, 'mirror', 'api', 'old')",
                         (self.now - (app.ACCESS_RETENTION_DAYS + 1) * 86400,))
        app._access_last_prune = 0.0  # 強制這次寫入時清理
        self.record(path="/api/matches")
        with app.closing(app._state_db()) as conn:
            who = [r["who"] for r in conn.execute("SELECT who FROM access_log")]
        self.assertNotIn("old", who)
        self.assertEqual(len(who), 2)

    def test_query_filters_and_counts(self):
        self.record(status=429, detail="global", who="Lan")
        self.record(status=429, detail="session", who="Friend")
        self.record(status=200, path="/api/cube/load", who="Lan")
        result = app.access_log_query(kind="429", hours=24)
        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual(result["counts"], {"429": 2, "query": 1})
        self.assertEqual(sorted(result["topWho"], key=lambda r: r["who"])[0]["who"], "Friend")
        only_friend = app.access_log_query(who="Friend", hours=24)
        self.assertEqual([r["who"] for r in only_friend["rows"]], ["Friend"])

    def test_window_excludes_older_rows_and_series_is_filled(self):
        with app.closing(app._state_db()) as conn, conn:
            conn.execute("INSERT INTO access_log (ts, source, kind, who) VALUES (?, 'mirror', '429', 'x')",
                         (self.now - 3 * 86400,))
        self.record(status=429, detail="session")
        result = app.access_log_query(hours=24)
        self.assertEqual(result["counts"], {"429": 1})
        self.assertEqual(len(result["series429"]), 24)
        self.assertEqual(sum(b["n"] for b in result["series429"]), 1)

    def test_paging_uses_before_cursor(self):
        for i in range(5):
            self.record(path=f"/api/p{i}")
        first = app.access_log_query(limit=2, hours=24)
        self.assertEqual(len(first["rows"]), 2)
        self.assertIsNotNone(first["nextBefore"])
        second = app.access_log_query(limit=2, hours=24, before=first["nextBefore"])
        self.assertEqual(len(second["rows"]), 2)
        self.assertLess(second["rows"][0]["id"], first["nextBefore"])


if __name__ == "__main__":
    unittest.main()
