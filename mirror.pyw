"""對外開放用的唯讀鏡像。

和本機那份（autostart.pyw / app.py）共用同一個 mayhem.db 與同一份 Cube，
但只讀、其他玩家的名稱換成代號、而且要密碼才進得來。通道（Tailscale Funnel、
Cloudflare Tunnel…）只指向這個埠，本機的 5057 維持原樣：可寫、看得到真名。

為什麼要兩個行程：公開模式是整個行程的旗標。通道進來的請求來源也是 127.0.0.1，
後端分不出「這是我本人」還是「這是網址被轉出去的人」，所以要兩種行為就得跑兩份。

密碼放在 .public_password（不進版控）。沒有這個檔就不啟動——
與其開一個沒有鎖的公開網址，不如不要開。
"""

import datetime
import os
import socket
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
LOG_PATH = BASE_DIR / "mirror.log"
PASSWORD_FILE = BASE_DIR / ".public_password"
MAX_LOG_BYTES = 1_000_000
PORT = int(os.environ.get("MAYHEM_PORT", "5058"))

# 要不要把其他玩家的 Riot ID 換成代號。
# 這個站台是給一起打的朋友看的，他們要用名字查自己的戰績，所以關掉。
# 前提是站台有密碼：看得到名字的只有拿到密碼的人。
# 如果之後想把網址給不認識的人，改成 True。
MASK_NAMES = False

os.chdir(BASE_DIR)

if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_LOG_BYTES:
    LOG_PATH.replace(LOG_PATH.with_suffix(".log.old"))

sys.stdout = sys.stderr = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
print(f"\n===== 鏡像啟動 {datetime.datetime.now():%Y-%m-%d %H:%M:%S} =====")


def port_in_use(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


if not PASSWORD_FILE.is_file():
    print(f"找不到 {PASSWORD_FILE.name}，不啟動。")
    print("請先把密碼寫進去（單獨一行）：")
    print(f'  "自己想的密碼" | Out-File -Encoding utf8 -NoNewline {PASSWORD_FILE.name}')
    sys.exit(1)

password = PASSWORD_FILE.read_text(encoding="utf-8").strip()
if len(password) < 12:
    print("密碼太短（至少 12 個字元）。這是一個對全世界開放的網址，短密碼撐不住。")
    sys.exit(1)

if port_in_use(PORT):
    print(f"port {PORT} 已經有服務在跑，這次不重複啟動。")
    sys.exit(0)

os.environ["MAYHEM_PUBLIC"] = "1"
os.environ["MAYHEM_MIRROR"] = "1"
os.environ["MAYHEM_PASSWORD"] = password
os.environ["MAYHEM_PORT"] = str(PORT)
os.environ["MAYHEM_MASK_NAMES"] = "1" if MASK_NAMES else "0"

try:
    import uvicorn

    import app

    print(f"唯讀鏡像在 http://127.0.0.1:{PORT}（通道指這裡）"
          f"｜其他玩家{'顯示代號' if MASK_NAMES else '顯示真名'}")
    uvicorn.run(app.app, host="127.0.0.1", port=PORT, log_level="info")
except Exception:
    import traceback

    traceback.print_exc()
    raise
