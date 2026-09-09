"""客戶端圖示的代理與快取。

瀏覽器沒有 LCU 的認證憑證，圖示得由後端帶著 Basic Auth 取回。原本每個請求
都重新讀 lockfile 並重建連線，實測每張要 69ms；一頁對局列表有 150 張以上，
光是圖示就要等十秒。

這裡做兩件事：
1. 存到磁碟。圖示內容不會變，抓過一次就不必再問客戶端——順帶讓客戶端關著
   的時候圖示也還在。
2. 連線重用。lockfile 只在失效時重讀，HTTP 連線用 Session 保持。
"""

import hashlib
import threading
from pathlib import Path

import requests

import lcu

CACHE_DIR = Path(__file__).parent / "icon_cache"
ALLOWED_PREFIX = "/lol-game-data/assets/"

_lock = threading.Lock()
_client: lcu.LCUClient | None = None
_session: requests.Session | None = None


def _cache_path(asset_path: str) -> Path:
    digest = hashlib.sha1(asset_path.encode("utf-8")).hexdigest()
    suffix = Path(asset_path).suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}:
        suffix = ".png"
    return CACHE_DIR / f"{digest}{suffix}"


def _connect():
    """取得可用的 LCU 連線，沿用既有的那條；失效時才重讀 lockfile。"""
    global _client, _session
    if _client is None:
        _client = lcu.LCUClient.connect()
        _session = requests.Session()
        _session.verify = False
        _session.headers.update(_client.headers)
    return _client, _session


def _reset():
    global _client, _session
    if _session is not None:
        _session.close()
    _client = None
    _session = None


def fetch(asset_path: str) -> tuple[Path | None, str]:
    """回傳 (快取檔路徑, 狀態)。狀態為 hit / fetched / unavailable / rejected。"""
    if not asset_path.startswith(ALLOWED_PREFIX):
        # 限制路徑前綴，避免這個帶認證的代理被拿來打其他客戶端端點
        return None, "rejected"

    cached = _cache_path(asset_path)
    if cached.is_file():
        return cached, "hit"

    with _lock:
        # 等鎖的期間可能已經有人抓好了
        if cached.is_file():
            return cached, "hit"
        for attempt in (1, 2):
            try:
                client, session = _connect()
                resp = session.get(client.base + asset_path, timeout=10)
            except (lcu.LCUUnavailable, requests.exceptions.RequestException):
                _reset()
                if attempt == 2:
                    return None, "unavailable"
                continue

            if resp.status_code == 401:
                # 客戶端重開過，lockfile 換了新的 port 與密碼
                _reset()
                if attempt == 2:
                    return None, "unavailable"
                continue
            if resp.status_code != 200:
                return None, "unavailable"

            CACHE_DIR.mkdir(exist_ok=True)
            # 先寫暫存檔再改名，避免同時請求讀到寫到一半的檔案
            temp = cached.with_suffix(cached.suffix + ".part")
            temp.write_bytes(resp.content)
            temp.replace(cached)
            return cached, "fetched"

    return None, "unavailable"


def stats() -> dict:
    if not CACHE_DIR.is_dir():
        return {"files": 0, "bytes": 0}
    files = [f for f in CACHE_DIR.iterdir() if f.is_file() and not f.name.endswith(".part")]
    return {"files": len(files), "bytes": sum(f.stat().st_size for f in files)}


def warm(conn, limit_per_kind: int = 400) -> int:
    """把常用圖示先抓下來，讓第一次開頁面不用等。

    只暖英雄與增幅：裝備有八百多種但單場只會用到少數幾件，
    全抓反而拖慢啟動，交給實際使用時逐張補。
    """
    paths: list[str] = []
    for table in ("dim_champions", "dim_augments"):
        rows = conn.execute(
            f"SELECT icon_path FROM {table} WHERE icon_path IS NOT NULL AND icon_path <> ''"
            f" LIMIT {limit_per_kind}"
        ).fetchall()
        paths.extend(row["icon_path"] for row in rows)

    warmed = 0
    for path in paths:
        if _cache_path(path).is_file():
            continue
        cached, status = fetch(path)
        if status == "fetched":
            warmed += 1
        elif status == "unavailable":
            break  # 客戶端關了就別再試，下次啟動再說
    return warmed
