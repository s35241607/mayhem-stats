"""背景採集器。

雙層保險:
1. 即時層 — 每 30 秒看一次 gameflow 狀態,偵測到「剛打完」就立刻採集。
2. 補漏層 — 每 5 分鐘固定掃一次最新 100 場清單補缺,兜住工具沒開、
   當機、客戶端重啟等所有意外。

只要在舊對局被擠出「最新 100 場」視窗之前跑過任一層,資料就不會遺失。
"""

import asyncio
import time

import db
import lcu

POLL_INTERVAL = 30          # 秒
SWEEP_EVERY_TICKS = 10      # 30s * 10 = 5 分鐘
POST_GAME_DELAY = 20        # 打完後等客戶端寫完戰績再抓

IN_GAME_PHASES = {"GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame"}


class Collector:
    def __init__(self):
        self.status = {
            "running": False,
            "clientConnected": False,
            "phase": None,
            "lastRun": None,
            "lastError": None,
            "dimensionsLoaded": False,
        }
        self._saw_in_game = False
        self._dimensions_loaded = False

    # ---------------------------------------------------------------- ingest

    def _ingest(self, trigger):
        """同步採集一次。回傳 (掃到幾場, 新增幾場)。"""
        client = lcu.LCUClient.connect()
        conn = db.connect()
        try:
            if not self._dimensions_loaded:
                try:
                    for table, rows in lcu.fetch_dimensions(client).items():
                        db.replace_dimension(conn, table, rows)
                    self._dimensions_loaded = True
                    self.status["dimensionsLoaded"] = True
                except Exception:
                    pass  # 維度表抓不到不該擋住對局採集,下輪再試

            summoner = client.current_summoner()
            puuid = summoner.get("puuid")
            name = summoner.get("gameName") or summoner.get("displayName") or ""
            tag = summoner.get("tagLine") or ""
            if puuid:
                db.upsert_account(conn, puuid, f"{name}#{tag}" if tag else name)

            run_id = db.start_run(conn, trigger)
            seen = new = 0
            error = None
            try:
                games = client.recent_matches()
                seen = len(games)
                by_platform = {}
                for game in games:
                    by_platform.setdefault(game.get("platformId") or "", []).append(game)

                for platform_id, platform_games in by_platform.items():
                    known = db.existing_game_ids(conn, platform_id)
                    for game in platform_games:
                        game_id = game.get("gameId")
                        if game_id in known:
                            continue
                        # 清單只回傳自己一個人,要拿全部 10 人得打明細
                        detail = client.game_detail(game_id)
                        if db.store_match(conn, detail):
                            new += 1
            except Exception as exc:
                error = str(exc)
                raise
            finally:
                db.finish_run(conn, run_id, seen, new, error)

            return seen, new
        finally:
            conn.close()

    # ------------------------------------------------------------------ loop

    async def _run_ingest(self, trigger):
        try:
            seen, new = await asyncio.to_thread(self._ingest, trigger)
            self.status["lastRun"] = {
                "at": int(time.time()), "trigger": trigger,
                "seen": seen, "new": new,
            }
            self.status["lastError"] = None
            return new
        except lcu.LCUUnavailable as exc:
            self.status["clientConnected"] = False
            self.status["lastError"] = str(exc)
        except Exception as exc:
            self.status["lastError"] = f"{type(exc).__name__}: {exc}"
        return 0

    async def run_forever(self):
        self.status["running"] = True
        ticks = 0
        while True:
            try:
                await self._tick(ticks)
            except Exception as exc:
                self.status["lastError"] = f"{type(exc).__name__}: {exc}"
            ticks += 1
            await asyncio.sleep(POLL_INTERVAL)

    async def _tick(self, ticks):
        try:
            client = await asyncio.to_thread(lcu.LCUClient.connect)
            phase = await asyncio.to_thread(client.gameflow_phase)
            self.status["clientConnected"] = True
            self.status["phase"] = phase
        except lcu.LCUUnavailable as exc:
            # 客戶端沒開是常態,不是錯誤,靜靜等下一輪
            self.status["clientConnected"] = False
            self.status["phase"] = None
            self.status["lastError"] = str(exc)
            return

        if phase in IN_GAME_PHASES:
            self._saw_in_game = True
        elif self._saw_in_game:
            # 剛打完一場 -> 即時採集
            self._saw_in_game = False
            await asyncio.sleep(POST_GAME_DELAY)
            await self._run_ingest("realtime")
            return

        if ticks % SWEEP_EVERY_TICKS == 0:
            await self._run_ingest("sweep")

    # ---------------------------------------------------------------- status

    def snapshot(self):
        conn = db.connect()
        try:
            total = conn.execute("SELECT COUNT(*) AS n FROM matches").fetchone()["n"]
            mayhem = conn.execute(
                "SELECT COUNT(*) AS n FROM matches WHERE queue_id = ?",
                (lcu.MAYHEM_QUEUE_ID,),
            ).fetchone()["n"]
            oldest = conn.execute("SELECT MIN(game_creation) AS t FROM matches").fetchone()["t"]
            newest = conn.execute("SELECT MAX(game_creation) AS t FROM matches").fetchone()["t"]
        finally:
            conn.close()
        return {
            **self.status,
            "totalMatches": total,
            "mayhemMatches": mayhem,
            "oldestGame": oldest,
            "newestGame": newest,
        }
