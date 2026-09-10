"""啟動與停止 Cube 語意層。

由 FastAPI 在啟動時一併拉起來,原因是開機自動啟動只有一個排程工作——
如果 Cube 要另外顧,重開機後分析頁面就會整個壞掉,而使用者不會馬上發現。

不用 .cmd shim 或 VBS 包一層:那條路要靠 cmd /c 的巢狀引號才能重導向輸出,
很容易靜默失敗。直接餵 node 進入點,由 subprocess 處理視窗與輸出。
"""

import json
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CUBE_DIR = Path(__file__).parent / "cube"
# 檔名沒有 .js 副檔名（對照 node_modules/.bin/cubejs-server 這支 shim 的內容）
CUBE_ENTRY = CUBE_DIR / "node_modules" / "@cubejs-backend" / "server" / "bin" / "server"
CUBE_LOG = CUBE_DIR / "cube.log"
CUBE_PORT = 4000
STARTUP_TIMEOUT = 60
LOG_MAX_BYTES = 5 * 1024 * 1024

_process: subprocess.Popen | None = None


def port_open(port, host="127.0.0.1"):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def status():
    return {
        "installed": CUBE_ENTRY.is_file(),
        "running": port_open(CUBE_PORT),
        "managedByUs": _process is not None and _process.poll() is None,
    }


def _rotate_log():
    """日誌超過上限就輪替一份。

    Cube 每個查詢都會寫好幾行,這個檔沒人管的話會一路長到幾百 MB。
    只留當前和前一份,舊的直接覆蓋掉。
    """
    try:
        if CUBE_LOG.is_file() and CUBE_LOG.stat().st_size > LOG_MAX_BYTES:
            previous = CUBE_LOG.with_suffix(".log.1")
            previous.unlink(missing_ok=True)
            CUBE_LOG.rename(previous)
    except OSError:
        pass  # 輪替失敗不值得擋住 Cube 啟動


def start():
    """啟動 Cube。已經在跑(或使用者自己開了一份)就不重複啟動。"""
    global _process

    if port_open(CUBE_PORT):
        return "已經有 Cube 在 4000 埠上,沿用現有的那份。"

    if not CUBE_ENTRY.is_file():
        return f"找不到 {CUBE_ENTRY},請先在 cube/ 執行 npm install。分析頁面在那之前不會有資料。"

    # Windows 上要明確指定不建立主控台視窗，否則開機時會閃一個黑框
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0

    _rotate_log()
    log = CUBE_LOG.open("a", encoding="utf-8", errors="replace")
    log.write(f"\n===== Cube 啟動 {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
    log.flush()

    _process = subprocess.Popen(
        ["node", str(CUBE_ENTRY)],
        cwd=CUBE_DIR,
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creation_flags,
    )

    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        if _process.poll() is not None:
            return f"Cube 啟動後隨即結束(exit {_process.returncode}),詳見 cube/cube.log。"
        if port_open(CUBE_PORT):
            return "Cube 已啟動。"
        time.sleep(1)

    return f"Cube 在 {STARTUP_TIMEOUT} 秒內沒有就緒,詳見 cube/cube.log。"


def stop():
    """關閉我們自己啟動的那份。使用者手動開的不去動它。"""
    global _process
    if _process is None or _process.poll() is not None:
        return
    _process.terminate()
    try:
        _process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        _process.kill()
    _process = None


# 每條 join 路徑第一次被查到時，Cube 要花一到兩秒編譯，之後同一條路徑只要幾十毫秒。
# （對照組：同一句 SQL 直接丟給 SQLite 只要 4 毫秒，所以那一兩秒全是編譯成本。）
# 不先暖起來的話，開機後第一次進儀表板就得等兩秒以上，每個分頁各卡一次。
WARM_QUERIES = [
    {"measures": ["participants.games"]},
    {"measures": ["participants.games"], "dimensions": ["champions.name"], "limit": 1},
    {"measures": ["participants.games"], "dimensions": ["augments.name"], "limit": 1},
    {"measures": ["participants.games"], "dimensions": ["items.name"], "limit": 1},
    {"measures": ["participants.games"], "dimensions": ["matches.weekday", "matches.hour_of_day"], "limit": 1},
    {"measures": ["participants.games"],
     "timeDimensions": [{"dimension": "matches.played_at", "granularity": "day"}], "limit": 1},
    {"measures": ["teammates.games"], "dimensions": ["teammates.player"], "limit": 1},
    {"measures": ["my_games.games"], "dimensions": ["my_games.prev_result"], "limit": 1},
]


def warm():
    """把每條 join 路徑各查一次，回傳 (成功數, 總數)。

    失敗不要緊——暖機只是把成本提前，沒暖到的路徑第一次查詢會慢一點而已。
    """
    ok = 0
    for query in WARM_QUERIES:
        url = (f"http://127.0.0.1:{CUBE_PORT}/cubejs-api/v1/load?query="
               + urllib.parse.quote(json.dumps(query)))
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                resp.read()
            ok += 1
        except Exception:
            pass
    return ok, len(WARM_QUERIES)
