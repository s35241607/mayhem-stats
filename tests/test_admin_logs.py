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
        for p in (
            mock.patch.object(app, "STATE_DB", Path(tmp.name) / "state.db"),
            mock.patch.object(app, "PUBLIC", True),
        ):
            p.start()
            self.addCleanup(p.stop)
        app._state_ready = False
        app._access_last_prune = time.time()  # 測試中不要順手觸發清理
        self.now = time.time()

    def record(self, **kw):
        base = dict(method="GET", path="/api/cube/load", status=200, ms=5, who="Lan", ip="203.0.113.7")
        base.update(kw)
        app.record_access(**base)

    def insert(self, **cols):
        row = dict(ts=self.now, source="mirror", kind="api", method="GET", path="/api/x", status=200, ms=1, who="x", ip="t", detail=None)
        row.update(cols)
        keys = ",".join(row)
        with app.closing(app._state_db()) as conn, conn:
            conn.execute(f"INSERT INTO access_log ({keys}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def query(self, **kw):
        f = dict(limit=200)
        f.update(kw)
        return app.access_log_query(f)

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
        self.insert(ts=self.now - (app.ACCESS_RETENTION_DAYS + 1) * 86400, who="old")
        app._access_last_prune = 0.0  # 強制這次寫入時清理
        self.record(path="/api/matches")
        with app.closing(app._state_db()) as conn:
            who = [r["who"] for r in conn.execute("SELECT who FROM access_log")]
        self.assertNotIn("old", who)
        self.assertEqual(len(who), 2)

    def test_kind_filter_and_counts_ignore_kind(self):
        self.insert(kind="429", who="Lan")
        self.insert(kind="429", who="Friend")
        self.insert(kind="query", who="Lan")
        result = self.query(kinds=["429"])
        self.assertEqual(len(result["rows"]), 2)
        # 計數不受類型篩選影響，方便看「還有多少別的類型」
        self.assertEqual(result["counts"], {"429": 2, "query": 1})

    def test_who_and_path_are_contains_matches(self):
        self.insert(who="FengLie", path="/api/cube/load")
        self.insert(who="Domaji", path="/api/matches")
        self.assertEqual([r["who"] for r in self.query(who="feng")["rows"]], ["FengLie"])
        self.assertEqual([r["path"] for r in self.query(path="cube")["rows"]], ["/api/cube/load"])

    def test_status_class_and_latency_floor(self):
        self.insert(status=200, ms=10)
        self.insert(status=404, ms=600)
        self.insert(status=503, ms=900)
        self.assertEqual(sorted(r["status"] for r in self.query(status_min=400)["rows"]), [404, 503])
        self.assertEqual(sorted(r["status"] for r in self.query(ms_min=500)["rows"]), [404, 503])
        self.assertEqual([r["status"] for r in self.query(status_min=400, status_max=499)["rows"]], [404])

    def test_free_text_matches_path_who_or_detail(self):
        self.insert(who="Lan", path="/api/x", detail=None)
        self.insert(who="Other", path="/api/y", detail="global")
        self.assertEqual([r["detail"] for r in self.query(q="global")["rows"]], ["global"])
        self.assertEqual([r["who"] for r in self.query(q="lan")["rows"]], ["Lan"])

    def test_window_excludes_older_rows(self):
        self.insert(ts=self.now - 3 * 86400, kind="429")
        self.insert(kind="429")
        result = self.query(from_ts=self.now - 86400, to_ts=self.now + 1)
        self.assertEqual(result["counts"], {"429": 1})
        self.assertEqual(result["kpi"]["total"], 1)

    def test_kpi_error_rate_and_percentiles(self):
        for ms in (10, 20, 30, 40, 1000):
            self.insert(ms=ms, status=200)
        self.insert(ms=50, status=500)
        result = self.query()
        self.assertEqual(result["kpi"]["total"], 6)
        self.assertAlmostEqual(result["kpi"]["errorRate"], 1 / 6)
        self.assertEqual(result["kpi"]["p50"], 30)
        self.assertEqual(result["kpi"]["p95"], 1000)

    def test_histogram_sums_match_window(self):
        for i in range(5):
            self.insert(ts=self.now - i * 60, kind="query" if i % 2 else "api")
        result = self.query(from_ts=self.now - 3600, to_ts=self.now + 1)
        total = sum(sum(b["kinds"].values()) for b in result["histogram"])
        self.assertEqual(total, 5)
        self.assertGreater(len(result["histogram"]), 1)

    def test_paging_before_and_after_cursor(self):
        for i in range(25):
            self.record(path=f"/api/p{i}")
        first = self.query(limit=20)  # 下限是 20
        self.assertEqual(len(first["rows"]), 20)
        self.assertIsNotNone(first["nextBefore"])
        second = self.query(limit=20, before_id=first["nextBefore"])
        self.assertLess(second["rows"][0]["id"], first["nextBefore"])
        newer = self.query(limit=50, after_id=first["rows"][-1]["id"])
        self.assertTrue(all(r["id"] > first["rows"][-1]["id"] for r in newer["rows"]))

    def test_sort_by_latency(self):
        self.insert(ms=5)
        self.insert(ms=900)
        self.insert(ms=50)
        self.assertEqual([r["ms"] for r in self.query(sort="ms")["rows"]], [900, 50, 5])


class FilterParsingTests(unittest.TestCase):
    def test_kind_list_and_numbers(self):
        class Q(dict):
            def get(self, k, d=None):
                return super().get(k, d)

        q = Q({"kind": "429,query,bogus", "status_min": "400", "ms_min": "abc", "from": "100.5", "limit": "50"})
        f = app._filters_from_request(q)
        self.assertEqual(f["kinds"], ["429", "query"])
        self.assertEqual(f["status_min"], 400)
        self.assertIsNone(f["ms_min"])
        self.assertEqual(f["from_ts"], 100.5)
        self.assertEqual(f["limit"], 50)


if __name__ == "__main__":
    unittest.main()
