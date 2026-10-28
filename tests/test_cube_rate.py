import unittest
from unittest import mock

import app


class CubeRateTests(unittest.TestCase):
    def setUp(self):
        app._cube_buckets.clear()
        app._cube_global[:] = [float(app.CUBE_GLOBAL_BURST), 0.0]
        # 時間固定在 1000 秒，之後靠 mock 推進，測試不受真實時間影響
        self.now = 1000.0
        patcher = mock.patch.object(app.time, "time", lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(app._cube_buckets.clear)

    def test_session_burst_then_rejects_with_session_layer(self):
        for _ in range(app.CUBE_BURST):
            allowed, layer, _ = app.cube_rate_check("s-a")
            self.assertTrue(allowed)
            self.assertIsNone(layer)
        allowed, layer, wait = app.cube_rate_check("s-a")
        self.assertFalse(allowed)
        self.assertEqual(layer, "session")
        self.assertAlmostEqual(wait, 1 / app.CUBE_REFILL_PER_SEC)

    def test_refill_restores_capacity_over_time(self):
        for _ in range(app.CUBE_BURST):
            app.cube_rate_check("s-a")
        self.assertFalse(app.cube_rate_check("s-a")[0])
        self.now += 1.0  # 一秒後回補 CUBE_REFILL_PER_SEC 個
        allowed = [app.cube_rate_check("s-a")[0] for _ in range(int(app.CUBE_REFILL_PER_SEC))]
        self.assertTrue(all(allowed))
        self.assertFalse(app.cube_rate_check("s-a")[0])

    def test_sessions_are_independent(self):
        for _ in range(app.CUBE_BURST):
            app.cube_rate_check("s-a")
        self.assertFalse(app.cube_rate_check("s-a")[0])
        self.assertTrue(app.cube_rate_check("s-b")[0])

    def test_global_limit_applies_across_sessions(self):
        # 每個 session 只打一次，總量撞到全站上限時應該以 global 層擋下
        for i in range(app.CUBE_GLOBAL_BURST):
            self.assertTrue(app.cube_rate_check(f"s-{i}")[0])
        allowed, layer, wait = app.cube_rate_check("s-new")
        self.assertFalse(allowed)
        self.assertEqual(layer, "global")
        self.assertAlmostEqual(wait, 1 / app.CUBE_GLOBAL_REFILL_PER_SEC)

    def test_rejected_request_does_not_consume_tokens(self):
        for _ in range(app.CUBE_BURST):
            app.cube_rate_check("s-a")
        before = app._cube_buckets["s-a"][0]
        app.cube_rate_check("s-a")
        self.assertAlmostEqual(app._cube_buckets["s-a"][0], before)


if __name__ == "__main__":
    unittest.main()
