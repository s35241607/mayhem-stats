"""Web Push：採集到新對局時通知訂閱的瀏覽器「你有 N 場新對局」。

誰負責什麼（本機服務與對外鏡像是兩個行程）：
- 訂閱：誰服務那個瀏覽器就由誰收。站長在本機 5057 訂閱，朋友在鏡像 5058 訂閱。
  兩邊都寫進 .public_state.db 的 push_subscriptions 表——這個檔本來就是兩個行程共用、
  可寫、不進版控的那份（鏡像對 mayhem.db 是唯讀的）。
- 發送：只有本機行程會採集，所以只有它會發。採集一輪結束、場次變多時，
  在背景執行緒裡逐一推送，失敗只記 log，絕不影響採集。
- 金鑰：兩個行程要用同一把 VAPID 金鑰（鏡像給瀏覽器公鑰、本機用私鑰簽），
  存在 .push_vapid.json（不進版控），第一次用到時產生。

每個訂閱只存推送服務給的端點與加密金鑰，加上「是誰」：
- scope='local'：本機訂閱的，對象是 accounts.is_me 的帳號。
- scope='discord'：鏡像上 Discord 登入的人，只存 discord_id；
  對象在發送當下才查 links 表（綁定改了就跟著變），而且他的登入還要有效
  （被踢掉、session 過期、登出的人就不再收到）。不另外存 puuid 或名字。
"""

import base64
import json
import os
import re
import sqlite3
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Callable, Iterable, Optional

TITLE = "Mayhem 戰績"
TAG = "mayhem-new-matches"
TTL = 12 * 3600          # 推送服務最多替離線的裝置保留 12 小時，過了就不必再通知
SEND_TIMEOUT = 10
MAX_PER_OWNER = 10        # 一個人（或本機）最多幾個裝置
MAX_TOTAL = 300
DEFAULT_SUBJECT = "mailto:mayhem-stats@users.noreply.github.com"

SCHEMA = """CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,   -- 推送服務給的網址（本身就是這個裝置的收件憑證）
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    scope TEXT NOT NULL,         -- local / discord
    discord_id TEXT,             -- scope='discord' 時是誰；本機是 NULL
    created REAL NOT NULL);"""

# 只接受各瀏覽器的推送服務。端點是使用者送來的網址，發送時伺服器會對它發 POST；
# 不設白名單等於讓登入的人叫本機去打任意網址（包含內網）。
PUSH_HOSTS = (
    "fcm.googleapis.com",            # Chrome、Android
    "android.googleapis.com",
    "push.services.mozilla.com",     # Firefox
    ".push.services.mozilla.com",
    ".push.apple.com",               # Safari、iOS（web.push.apple.com）
    ".notify.windows.com",           # Edge 舊版走 WNS
)
_B64URL = re.compile(r"^[A-Za-z0-9_\-]+=*$")


def body_text(count: int) -> str:
    return f"你有 {count} 場新對局，戰報已更新"


# ── VAPID 金鑰 ───────────────────────────────────────────────────────

_vapid_lock = threading.Lock()
_vapid_cache: dict = {}


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _generate_vapid() -> dict:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid

    vapid = Vapid()
    vapid.generate_keys()
    public = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return {
        "public_key": _b64url(public),
        "private_pem": vapid.private_pem().decode("ascii"),
        "subject": DEFAULT_SUBJECT,
    }


def load_vapid(path: Path) -> dict:
    """讀金鑰；沒有就產生一份。兩個行程可能同時第一次用到，
    所以先寫暫存檔再 rename：Windows 的 rename 遇到已存在的目標會失敗，輸的那邊改讀贏的那份。"""
    key = str(path)
    with _vapid_lock:
        if key in _vapid_cache:
            return _vapid_cache[key]
        if not path.exists():
            tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(_generate_vapid(), indent=2), encoding="utf-8")
            try:
                if path.exists():
                    raise FileExistsError(key)
                os.rename(tmp, path)
            except FileExistsError:
                tmp.unlink(missing_ok=True)
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("subject", DEFAULT_SUBJECT)
        _vapid_cache[key] = data
        return data


# ── 訂閱的儲存 ───────────────────────────────────────────────────────

def ensure_schema(conn: sqlite3.Connection):
    conn.executescript(SCHEMA)


def clean_subscription(raw) -> Optional[dict]:
    """把瀏覽器的 PushSubscription JSON 收斂成要存的三個欄位；不合格回 None。"""
    if not isinstance(raw, dict):
        return None
    endpoint = raw.get("endpoint")
    keys = raw.get("keys") or {}
    if not isinstance(endpoint, str) or not isinstance(keys, dict) or len(endpoint) > 1024:
        return None
    parsed = urllib.parse.urlsplit(endpoint)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username or parsed.password:
        return None
    if not any(host == h or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS):
        return None
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    for value, limit in ((p256dh, 200), (auth, 64)):
        if not isinstance(value, str) or not value or len(value) > limit or not _B64URL.match(value):
            return None
    return {"endpoint": endpoint, "p256dh": p256dh, "auth": auth}


def save_subscription(conn: sqlite3.Connection, sub: dict, scope: str, discord_id: Optional[str]) -> bool:
    """新增或更新（同一個瀏覽器換人登入就換主人）。超過上限回 False。"""
    owner_sql = "discord_id IS ?" if discord_id is None else "discord_id = ?"
    exists = conn.execute("SELECT 1 FROM push_subscriptions WHERE endpoint = ?", (sub["endpoint"],)).fetchone()
    if not exists:
        mine = conn.execute(
            f"SELECT COUNT(*) FROM push_subscriptions WHERE scope = ? AND {owner_sql}", (scope, discord_id)
        ).fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM push_subscriptions").fetchone()[0]
        if mine >= MAX_PER_OWNER or total >= MAX_TOTAL:
            return False
    conn.execute(
        "INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, scope, discord_id, created)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (sub["endpoint"], sub["p256dh"], sub["auth"], scope, discord_id, time.time()),
    )
    return True


def delete_subscription(conn: sqlite3.Connection, endpoint: str, scope: Optional[str] = None,
                        discord_id: Optional[str] = None) -> int:
    """scope 給了就只刪自己的（鏡像上不讓別人憑端點刪掉你的訂閱）。"""
    if scope is None:
        cur = conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    else:
        cur = conn.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ? AND scope = ? AND discord_id IS ?",
            (endpoint, scope, discord_id),
        )
    return cur.rowcount


def all_subscriptions(conn: sqlite3.Connection) -> list:
    return [dict(zip(("endpoint", "p256dh", "auth", "scope", "discord_id"), row)) for row in conn.execute(
        "SELECT endpoint, p256dh, auth, scope, discord_id FROM push_subscriptions"
    )]


# ── 誰該收到幾場 ─────────────────────────────────────────────────────

def new_match_players(conn: sqlite3.Connection, after_rowid: int, queue_id: int) -> dict:
    """這一輪新寫入的大亂鬥對局（排除重開局）→ 該場十位參賽者的 puuid。"""
    games: dict = {}
    for platform_id, game_id, puuid in conn.execute(
        """SELECT m.platform_id, m.game_id, mp.puuid
             FROM matches m
             JOIN match_participants mp ON mp.platform_id = m.platform_id AND mp.game_id = m.game_id
            WHERE m.rowid > ? AND m.queue_id = ? AND m.is_remake = 0""",
        (after_rowid or 0, queue_id),
    ):
        games.setdefault((platform_id, game_id), set()).add(puuid)
    return games


def plan_notifications(targets: Iterable, new_matches: dict) -> dict:
    """targets：(訂閱, 該訂閱關心的 puuid 集合)。回傳 {endpoint: 場數}，只列大於 0 的。
    同一場裡有兩個自己的帳號（大小號同場）只算一場。"""
    plan = {}
    for sub, puuids in targets:
        puuids = set(puuids or ())
        if not puuids:
            continue
        n = sum(1 for players in new_matches.values() if players & puuids)
        if n:
            plan[sub["endpoint"]] = n
    return plan


# ── 發送 ─────────────────────────────────────────────────────────────

def payload(count: int, url: str = "/") -> str:
    return json.dumps(
        {"title": TITLE, "body": body_text(count), "url": url, "count": count, "tag": TAG},
        ensure_ascii=False,
    )


def send_all(subs: list, plan: dict, vapid: dict, send: Optional[Callable] = None,
             log: Callable = print) -> tuple:
    """逐一推送。回傳 (成功數, 已失效要刪掉的端點)。任何單一失敗都不往外丟。"""
    if send is None:
        from pywebpush import webpush as send
    from py_vapid import Vapid

    signer = Vapid.from_pem(vapid["private_pem"].encode("ascii"))
    sent, gone = 0, []
    by_endpoint = {s["endpoint"]: s for s in subs}
    for endpoint, count in plan.items():
        sub = by_endpoint.get(endpoint)
        if not sub:
            continue
        try:
            send(
                subscription_info={"endpoint": endpoint, "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                data=payload(count),
                vapid_private_key=signer,
                vapid_claims={"sub": vapid["subject"]},  # webpush 會往裡面加 aud/exp，每次給新的
                ttl=TTL,
                timeout=SEND_TIMEOUT,
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001 - 推送失敗不能影響其他人或採集
            status = getattr(exc, "status_code", None)
            if status is None:
                status = getattr(getattr(exc, "response", None), "status_code", None)
            host = urllib.parse.urlsplit(endpoint).hostname
            if status in (404, 410):
                gone.append(endpoint)
                log(f"推送通知：{host} 的訂閱已失效（{status}），移除")
            else:
                log(f"推送通知失敗（{host}）: {type(exc).__name__} {status or ''}".rstrip())
    return sent, gone
