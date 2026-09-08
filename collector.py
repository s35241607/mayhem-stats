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
                seen, new = self._ingest_games(conn, client, client.recent_matches())

                # 追蹤中的好友。清單一樣只回傳該玩家一個人,而且別人的紀錄
                # 只給最新 20 場(自己是 100),所以更容易漏——但漏掉的部分
                # 若是和你同場的對局,你自己的掃描本來就會收到。
                for account in db.tracked_accounts(conn):
                    try:
                        friend_games = client.matches_by_puuid(account["puuid"])
                    except Exception:
                        continue  # 單一好友抓失敗不該中斷整輪採集
                    friend_seen, friend_new = self._ingest_games(conn, client, friend_games)
                    seen += friend_seen
                    new += friend_new
            except Exception as exc:
                error = str(exc)
                raise
            finally:
                db.finish_run(conn, run_id, seen, new, error)

            return seen, new
        finally:
            conn.close()

    def _ingest_games(self, conn, client, games):
        """把一批對局收進資料庫,回傳 (掃到幾場, 新增幾場)。

        冪等性由三層保證,重複執行不會產生重複資料:
        1. 先查資料庫已有哪些 game_id,已知的連明細都不用抓
        2. 寫入用 INSERT OR IGNORE,主鍵是 (platform_id, game_id)
        3. 整場包在單一 transaction 裡

        因此同一場對局不論從你自己還是從好友的清單掃到,都只會存在一份。
        """
        seen = new = 0
        by_platform = {}
        for game in games:
            by_platform.setdefault(game.get("platformId") or "", []).append(game)

        for platform_id, platform_games in by_platform.items():
            known = db.existing_game_ids(conn, platform_id)
            seen += len(platform_games)
            for game in platform_games:
                game_id = game.get("gameId")
                if game_id in known:
                    continue
                # 清單只回傳一名玩家,要拿全部 10 人得打明細
                detail = client.game_detail(game_id)
                if db.store_match(conn, detail):
                    new += 1
                    known.add(game_id)
        return seen, new

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
            # 追蹤好友之後，資料庫會包含「你沒參與的對局」，所以自己的場次
            # 要跟資料庫總數分開報，否則畫面上的數字會讓人以為自己打了那麼多。
            mine = conn.execute(
                """SELECT COUNT(*) AS n FROM matches m
                   WHERE EXISTS (
                     SELECT 1 FROM match_participants mp
                     WHERE mp.platform_id = m.platform_id AND mp.game_id = m.game_id
                       AND mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)
                   ) AND m.queue_id = ?""",
                (lcu.MAYHEM_QUEUE_ID,),
            ).fetchone()["n"]
            total = conn.execute("SELECT COUNT(*) AS n FROM matches").fetchone()["n"]
            mayhem = conn.execute(
                "SELECT COUNT(*) AS n FROM matches WHERE queue_id = ?",
                (lcu.MAYHEM_QUEUE_ID,),
            ).fetchone()["n"]
            oldest = conn.execute("SELECT MIN(game_creation) AS t FROM matches").fetchone()["t"]
            newest = conn.execute("SELECT MAX(game_creation) AS t FROM matches").fetchone()["t"]
            tracked = db.tracked_accounts(conn)
        finally:
            conn.close()
        return {
            **self.status,
            "myMayhemMatches": mine,
            "totalMatches": total,
            "mayhemMatches": mayhem,
            "oldestGame": oldest,
            "newestGame": newest,
            "trackedCount": len(tracked),
        }
