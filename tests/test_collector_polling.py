import time
import unittest
from unittest import mock

import collector


class FakeClient:
    def __init__(self, phase):
        self.phase = phase
        self.eog_calls = 0

    def gameflow_phase(self):
        return self.phase

    def eog_stats_block(self):
        self.eog_calls += 1
        raise RuntimeError("404")


class PollingTests(unittest.IsolatedAsyncioTestCase):
    def make(self, phase, connected=True):
        gatherer = collector.Collector()
        gatherer._was_connected = connected
        gatherer.status["phase"] = phase
        gatherer.ingests = []

        async def record(trigger):
            gatherer.ingests.append(trigger)
            gatherer._last_sweep = time.monotonic()
            return 0

        gatherer._run_ingest = record
        return gatherer

    def test_interval_is_short_only_while_a_game_or_its_post_game_screen_is_up(self):
        gatherer = self.make(None)
        self.assertEqual(gatherer._poll_interval(), collector.POLL_INTERVAL)
        for phase in ("InProgress", "WaitingForStats", "PreEndOfGame", "EndOfGame"):
            gatherer.status["phase"] = phase
            self.assertEqual(gatherer._poll_interval(), collector.FAST_POLL_INTERVAL, phase)
        gatherer.status["phase"] = "Lobby"
        gatherer._saw_in_game = True  # 剛離開對局、還沒採集過
        self.assertEqual(gatherer._poll_interval(), collector.FAST_POLL_INTERVAL)

    async def tick(self, gatherer, phase):
        client = FakeClient(phase)
        with mock.patch.object(collector.lcu.LCUClient, "connect", return_value=client):
            await gatherer._tick()
        return client

    async def test_sweep_runs_only_after_five_minutes_since_the_last_ingest(self):
        gatherer = self.make("Lobby")
        gatherer._last_sweep = time.monotonic()  # 剛採集過
        await self.tick(gatherer, "Lobby")
        self.assertEqual(gatherer.ingests, [])
        gatherer._last_sweep = time.monotonic() - collector.SWEEP_EVERY - 1
        await self.tick(gatherer, "Lobby")
        self.assertEqual(gatherer.ingests, ["sweep"])
        await self.tick(gatherer, "Lobby")  # 剛掃過，不會連著再掃
        self.assertEqual(gatherer.ingests, ["sweep"])

    async def test_post_game_screen_is_captured_every_tick_without_breaking_collection(self):
        gatherer = self.make("EndOfGame")
        gatherer._last_sweep = time.monotonic()
        client = await self.tick(gatherer, "EndOfGame")
        self.assertEqual(client.eog_calls, 1)  # 客戶端回 404 也不會拋出來
        client = await self.tick(gatherer, "Lobby")
        self.assertEqual(client.eog_calls, 0)  # 離開賽後畫面就不抓

    async def test_just_finished_game_triggers_a_realtime_ingest_after_the_delay(self):
        gatherer = self.make("InProgress")
        gatherer._last_sweep = time.monotonic()
        await self.tick(gatherer, "InProgress")
        self.assertTrue(gatherer._saw_in_game)
        with mock.patch.object(collector, "POST_GAME_DELAY", 0):
            await self.tick(gatherer, "EndOfGame")
        self.assertEqual(gatherer.ingests, ["realtime"])
        self.assertFalse(gatherer._saw_in_game)


if __name__ == "__main__":
    unittest.main()
