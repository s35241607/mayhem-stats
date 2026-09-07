"""開機自動啟動用的進入點。

用 pythonw.exe 執行(副檔名 .pyw),所以不會跳出主控台視窗。
代價是 stdout/stderr 會被直接丟棄,因此這裡把輸出導向 autostart.log,
否則背景服務出問題時會完全查不到原因。

一般手動執行請用 `uv run app.py`,這支是給排程器用的。
"""

import datetime
import os
import socket
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
LOG_PATH = BASE_DIR / "autostart.log"
MAX_LOG_BYTES = 1_000_000
PORT = 5057

os.chdir(BASE_DIR)

if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_LOG_BYTES:
    LOG_PATH.replace(LOG_PATH.with_suffix(".log.old"))

sys.stdout = sys.stderr = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
print(f"\n===== 啟動 {datetime.datetime.now():%Y-%m-%d %H:%M:%S} =====")


def port_in_use(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


# 使用者可能已經手動跑了一份;重複啟動只會撞埠,直接讓出比較乾淨
if port_in_use(PORT):
    print(f"port {PORT} 已經有服務在跑,這次不重複啟動。")
    sys.exit(0)

try:
    import uvicorn

    import app

    uvicorn.run(app.app, host="127.0.0.1", port=PORT, log_level="info")
except Exception:
    import traceback

    traceback.print_exc()
    raise
