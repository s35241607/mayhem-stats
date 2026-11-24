import asyncio
import base64
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app
import push

FCM = "https://fcm.googleapis.com/fcm/send/abc123"
APPLE = "https://web.push.apple.com/QWxhZGRpbg"
KEYS = {"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        "auth": "tBHItJI5svbpez7KI4CCXg"}


def sub(endpoint=FCM, **keys):
    return {"endpoint": endpoint, "expirationTime": None, "keys": {**KEYS, **keys}}


class CleanSubscriptionTests(unittest.TestCase):
    def test_accepts_known_push_services(self):
        for endpoint in (FCM, APPLE, "https://updates.push.services.mozilla.com/wpush/v2/x",
                         "https://wns2-par02p.notify.windows.com/w/?token=x"):
            self.assertEqual(push.clean_subscription(sub(endpoint))["endpoint"], endpoint)

    def test_keeps_only_needed_fields(self):
        self.assertEqual(set(push.clean_subscription(sub())), {"endpoint", "p256dh", "auth"})

    def test_rejects_other_hosts_and_schemes(self):
        for endpoint in ("http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://localhost/x",
                         "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x",
                         "https://notpush.apple.com/x", "https://fcm.googleapis.com:8443/x",
                         "https://user@fcm.googleapis.com/x"):
            self.assertIsNone(push.clean_subscription(sub(endpoint)), endpoint)

    def test_rejects_bad_keys_and_shapes(self):
        self.assertIsNone(push.clean_subscription(sub(auth="")))
        self.assertIsNone(push.clean_subscription(sub(p256dh="not base64!")))
        self.assertIsNone(push.clean_subscription({"endpoint": FCM}))
        self.assertIsNone(push.clean_subscription("x"))
        self.assertIsNone(push.clean_subscription(sub(FCM + "a" * 1100)))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        push.ensure_schema(self.conn)

    def endpoints(self):
        return {(s["endpoint"], s["scope"], s["discord_id"]) for s in push.all_subscriptions(self.conn)}

    def test_save_is_idempotent_and_switches_owner(self):
        clean = push.clean_subscription(sub())
        self.assertTrue(push.save_subscription(self.conn, clean, "discord", "111"))
        self.assertTrue(push.save_subscription(self.conn, clean, "discord", "111"))
        self.assertTrue(push.save_subscription(self.conn, clean, "discord", "222"))
        self.assertEqual(self.endpoints(), {(FCM, "discord", "222")})

    def test_per_owner_limit(self):
        for i in range(push.MAX_PER_OWNER):
            self.assertTrue(push.save_subscription(self.conn, push.clean_subscription(sub(f"{FCM}{i}")), "discord", "111"))
        self.assertFalse(push.save_subscription(self.conn, push.clean_subscription(sub(f"{FCM}x")), "discord", "111"))
        # 已存在的那筆仍可更新；別人不受影響
        self.assertTrue(push.save_subscription(self.conn, push.clean_subscription(sub(f"{FCM}0")), "discord", "111"))
        self.assertTrue(push.save_subscription(self.conn, push.clean_subscription(sub(f"{FCM}x")), "local", None))

    def test_scoped_delete_only_removes_own(self):
        push.save_subscription(self.conn, push.clean_subscription(sub()), "discord", "111")
        self.assertEqual(push.delete_subscription(self.conn, FCM, "discord", "222"), 0)
        self.assertEqual(push.delete_subscription(self.conn, FCM, "local", None), 0)
        self.assertEqual(push.delete_subscription(self.conn, FCM, "discord", "111"), 1)
        push.save_subscription(self.conn, push.clean_subscription(sub()), "local", None)
        self.assertEqual(push.delete_subscription(self.conn, FCM, "local", None), 1)

    def test_unscoped_delete(self):
        push.save_subscription(self.conn, push.clean_subscription(sub()), "discord", "111")
        self.assertEqual(push.delete_subscription(self.conn, FCM), 1)
        self.assertEqual(push.all_subscriptions(self.conn), [])


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.executescript(
            """CREATE TABLE matches (platform_id TEXT, game_id INTEGER, queue_id INTEGER, is_remake INTEGER,
                                     PRIMARY KEY (platform_id, game_id));
               CREATE TABLE match_participants (platform_id TEXT, game_id INTEGER, puuid TEXT);"""
        )

    def add(self, game_id, players, queue=2400, remake=0):
        self.conn.execute("INSERT INTO matches VALUES ('TW2', ?, ?, ?)", (game_id, queue, remake))
        self.conn.executemany("INSERT INTO match_participants VALUES ('TW2', ?, ?)", [(game_id, p) for p in players])

    def test_new_matches_only_after_rowid_mayhem_and_not_remake(self):
        self.add(1, ["me", "x"])
        before = self.conn.execute("SELECT MAX(rowid) FROM matches").fetchone()[0]
        self.add(2, ["me", "y"])
        self.add(3, ["me"], queue=450)
        self.add(4, ["me"], remake=1)
        self.add(5, ["friend", "y"])
        games = push.new_match_players(self.conn, before, 2400)
        self.assertEqual(games, {("TW2", 2): {"me", "y"}, ("TW2", 5): {"friend", "y"}})
        self.assertEqual(len(push.new_match_players(self.conn, None, 2400)), 3)

    def test_plan_counts_distinct_matches_per_subscription(self):
        games = {("TW2", 2): {"me", "alt", "y"}, ("TW2", 5): {"friend", "y"}, ("TW2", 6): {"alt"}}
        targets = [
            ({"endpoint": "a"}, {"me", "alt"}),   # 大小號同場只算一場 → 2
            ({"endpoint": "b"}, {"friend"}),
            ({"endpoint": "c"}, {"nobody"}),
            ({"endpoint": "d"}, set()),
        ]
        self.assertEqual(push.plan_notifications(targets, games), {"a": 2, "b": 1})


class FakePushError(Exception):
    def __init__(self, status):
        self.response = mock.Mock(status_code=status)


class SendTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        push._vapid_cache.clear()
        self.vapid = push.load_vapid(Path(tmp.name) / ".push_vapid.json")
        self.path = Path(tmp.name) / ".push_vapid.json"

    def test_vapid_generated_once_and_reused(self):
        raw = base64.urlsafe_b64decode(self.vapid["public_key"] + "==")
        self.assertEqual((len(raw), raw[0]), (65, 4))  # 未壓縮的 P-256 公鑰
        push._vapid_cache.clear()
        self.assertEqual(push.load_vapid(self.path)["public_key"], self.vapid["public_key"])

    def test_sends_payload_and_reports_gone(self):
        subs = [{"endpoint": e, "p256dh": "k", "auth": "a"} for e in ("ok", "gone", "notfound", "boom")]
        calls = []

        def fake(subscription_info, data, **kwargs):
            calls.append((subscription_info["endpoint"], json.loads(data), kwargs))
            status = {"gone": 410, "notfound": 404, "boom": 500}.get(subscription_info["endpoint"])
            if status:
                raise FakePushError(status)

        logs = []
        sent, gone = push.send_all(subs, {"ok": 3, "gone": 1, "notfound": 1, "boom": 2, "missing": 1},
                                   self.vapid, send=fake, log=logs.append)
        self.assertEqual(sent, 1)
        self.assertEqual(gone, ["gone", "notfound"])
        endpoint, data, kwargs = calls[0]
        self.assertEqual(data["title"], "Mayhem 戰績")
        self.assertEqual(data["body"], "你有 3 場新對局，戰報已更新")
        self.assertEqual(data["url"], "/")
        self.assertEqual(kwargs["vapid_claims"], {"sub": push.DEFAULT_SUBJECT})
        self.assertEqual(len(calls), 4)  # 不在訂閱清單裡的不送
        self.assertTrue(any("500" in line for line in logs))


class Req:
    def __init__(self, body):
        self._body = body
        self.cookies = {}

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class EndpointTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patcher in (
            mock.patch.object(app, "STATE_DB", Path(tmp.name) / "state.db"),
            mock.patch.object(app, "PUSH_VAPID_FILE", Path(tmp.name) / ".push_vapid.json"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app._state_ready = False
        self.addCleanup(setattr, app, "_state_ready", False)

    def call(self, fn, body):
        return asyncio.run(fn(Req(body)))

    def stored(self):
        with app.closing(app._state_db()) as conn:
            return push.all_subscriptions(conn)

    def test_local_subscribe_and_unsubscribe(self):
        with mock.patch.object(app, "PUBLIC", False):
            self.assertEqual(self.call(app.push_subscribe, sub()), {"ok": True})
            self.assertEqual([(s["scope"], s["discord_id"]) for s in self.stored()], [("local", None)])
            self.assertEqual(self.call(app.push_unsubscribe, {"endpoint": FCM})["removed"], 1)
            self.assertEqual(self.stored(), [])

    def test_bad_body_is_400(self):
        with mock.patch.object(app, "PUBLIC", False):
            self.assertEqual(self.call(app.push_subscribe, sub("https://evil.example/x")).status_code, 400)
            self.assertEqual(self.call(app.push_subscribe, ValueError("bad json")).status_code, 400)

    def test_public_needs_discord_identity(self):
        with mock.patch.object(app, "PUBLIC", True), \
             mock.patch.object(app, "_session", return_value={"discord_id": None, "name": "密碼登入"}):
            self.assertEqual(self.call(app.push_subscribe, sub()).status_code, 403)
        with mock.patch.object(app, "PUBLIC", True), \
             mock.patch.object(app, "_session", return_value={"discord_id": "111", "name": "F"}):
            self.assertEqual(self.call(app.push_subscribe, sub()), {"ok": True})
        self.assertEqual([(s["scope"], s["discord_id"]) for s in self.stored()], [("discord", "111")])
        with mock.patch.object(app, "PUBLIC", True), \
             mock.patch.object(app, "_session", return_value={"discord_id": "222", "name": "G"}):
            self.assertEqual(self.call(app.push_unsubscribe, {"endpoint": FCM})["removed"], 0)
        self.assertEqual(len(self.stored()), 1)

    def test_key_endpoint(self):
        key = app.push_key()["publicKey"]
        self.assertEqual(app.push_key()["publicKey"], key)

    def test_targets_follow_links_and_live_sessions(self):
        now = app.time.time()
        with app.closing(app._state_db()) as conn, conn:
            conn.executemany("INSERT INTO sessions (token_hash, issued, discord_id, name, username, via)"
                             " VALUES (?, ?, ?, 'n', ?, 'list')", [
                                 ("t1", now, "111", "friend"),
                                 ("t2", now, "222", "kicked"),
                                 ("t3", now - app.SESSION_MAX_AGE - 10, "333", "expired"),
                             ])
            conn.executemany("INSERT INTO links VALUES (?, ?)",
                             [("111", "p-friend"), ("111", "p-alt"), ("222", "p-kicked"), ("333", "p-old")])
        subs = [{"endpoint": e, "scope": s, "discord_id": d, "p256dh": "k", "auth": "a"}
                for e, s, d in (("L", "local", None), ("A", "discord", "111"), ("B", "discord", "222"),
                                ("C", "discord", "333"), ("D", "discord", "444"))]
        fake_db = sqlite3.connect(":memory:")
        fake_db.executescript("CREATE TABLE accounts (puuid TEXT, is_me INTEGER);"
                              "INSERT INTO accounts VALUES ('p-me', 1), ('p-tracked', 0);")
        with mock.patch.object(app, "oauth_config", return_value={"allow": ["friend", "kicked"], "deny": ["kicked"]}), \
             mock.patch.object(app.db, "connect", return_value=fake_db):
            targets = {s["endpoint"]: p for s, p in app._push_targets(subs)}
        self.assertEqual(targets, {"L": {"p-me"}, "A": {"p-friend", "p-alt"}})

    def test_send_failure_never_raises(self):
        with mock.patch.object(app, "_state_db", side_effect=RuntimeError("db locked")), \
             mock.patch("builtins.print") as printed:
            app._send_new_match_pushes(0)
        self.assertIn("推送通知失敗", printed.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
