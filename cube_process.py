"""啟動與停止 Cube 語意層。

由 FastAPI 在啟動時一併拉起來,原因是開機自動啟動只有一個排程工作——
如果 Cube 要另外顧,重開機後分析頁面就會整個壞掉,而使用者不會馬上發現。

不用 .cmd shim 或 VBS 包一層:那條路要靠 cmd /c 的巢狀引號才能重導向輸出,
很容易靜默失敗。直接餵 node 進入點,由 subprocess 處理視窗與輸出。
"""

import socket
import subprocess
import sys
import time
from pathlib import Path

CUBE_DIR = Path(__file__).parent / "cube"
# 檔名沒有 .js 副檔名（對照 node_modules/.bin/cubejs-server 這支 shim 的內容）
CUBE_ENTRY = CUBE_DIR / "node_modules" / "@cubejs-backend" / "server" / "bin" / "server"
CUBE_LOG = CUBE_DIR / "cube.log"
CUBE_PORT = 4000
STARTUP_TIMEOUT = 60

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


def start():
    """啟動 Cube。已經在跑(或使用者自己開了一份)就不重複啟動。"""
    global _process

    if port_open(CUBE_PORT):
        return "已經有 Cube 在 4000 埠上,沿用現有的那份。"

    if not CUBE_ENTRY.is_file():
        return f"找不到 {CUBE_ENTRY},請先在 cube/ 執行 npm install。分析頁面在那之前不會有資料。"

    # Windows 上要明確指定不建立主控台視窗，否則開機時會閃一個黑框
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0

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
