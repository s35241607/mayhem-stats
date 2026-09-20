"""ARAM: Mayhem 個人戰績採集 + BI 分析

在本機執行,持續把 League 客戶端的對戰紀錄收進 SQLite,並提供多維度分析前端。

為什麼要「持續採集」:客戶端的本機 API 只回傳最新 100 場(begIndex/endIndex
在目前版本會被忽略),而 Mayhem 的資料被 Riot 排除在公開 API 之外,
所以一旦對局被擠出那 100 場的視窗,就永遠拿不回來了。

用法:
    uv sync
    uv run app.py
    開瀏覽器到 http://127.0.0.1:5057
"""

import asyncio
import hashlib
import json
import os
import urllib.parse
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import collector as collector_module
import cube_process
import db
import icons

BASE_DIR = Path(__file__).parent
collector = collector_module.Collector()

# ── 對外開放模式 ────────────────────────────────────────────────────
# 服務本身只綁 127.0.0.1,外面要連進來一定是透過通道(Tailscale / ngrok /
# Cloudflare Tunnel)。通道那頭「拿到網址的人就是你」,所以對外開放前打開這個:
#
#     set MAYHEM_PUBLIC=1  &&  uv run app.py        (PowerShell: $env:MAYHEM_PUBLIC=1)
#
# 它做兩件事:
#   1. 全站唯讀——採集與追蹤名單這兩個寫入端點一律回 403。採集照常在本機自動跑,
#      要改追蹤名單就在這台電腦上開 127.0.0.1:5057。
#   2. 其他玩家的 Riot ID 換成穩定代號(預設開,見 MAYHEM_MASK_NAMES)。
#
#   3. 設了 MAYHEM_PASSWORD 的話,外面要先輸入密碼才看得到任何東西。
#      這一層是必要的:免費的通道服務(ngrok 免費版、Cloudflare Quick Tunnel、
#      Tailscale Funnel)都給你一個「誰拿到網址誰就能看」的公開網址,
#      沒有自己的網域就掛不上它們的身分驗證,所以驗證只能做在這裡。
#
# 沒設這個變數時行為完全不變,本機使用不受影響。
PUBLIC = os.environ.get("MAYHEM_PUBLIC", "").strip().lower() in {"1", "true", "yes", "on"}
PASSWORD = os.environ.get("MAYHEM_PASSWORD", "").strip()

# 鏡像實例:和本機那份共用同一個資料庫,但只讀。
#
#     $env:MAYHEM_PUBLIC="1"; $env:MAYHEM_PASSWORD="…"; $env:MAYHEM_PORT="5058"
#     $env:MAYHEM_MIRROR="1"; uv run app.py
#
# 這樣就能「對外唯讀＋代號、本機照舊可寫＋真名」同時成立——通道只指向鏡像那個埠。
# 公開模式的旗標是整個行程的(通道進來的請求來源也是 127.0.0.1,分不出誰是誰),
# 所以要兩種行為就得跑兩個行程。
#
# 鏡像不做這三件事,那些都是本機那份的工作:
#   1. 採集迴圈——兩份同時採集只是重複打客戶端,而且寫入會互相卡。
#   2. 建表與遷移——同時跑 schema 變更是自找麻煩。
#   3. 啟動與關閉 Cube——它會沿用 4000 埠上現有的那份;若由鏡像管理,
#      鏡像一關就把本機那份的語意層也一起帶走。
# 要不要把其他玩家的 Riot ID 換成代號。預設跟著公開模式走:
# 同場玩家的名稱是別人的遊戲帳號,不該因為網址被開出去就一起公開,所以預設遮。
#
# 但如果這個站台是給「同一群一起打的人」看的——他們要用名字查自己的戰績——
# 遮了反而沒得用。那種情況設 MAYHEM_MASK_NAMES=0 關掉,
# 前提是你已經用密碼把站台鎖起來:看得到名字的只有拿到密碼的人。
_mask_env = os.environ.get("MAYHEM_MASK_NAMES", "").strip().lower()
MASK_NAMES = PUBLIC if _mask_env == "" else _mask_env in {"1", "true", "yes", "on"}

MIRROR = os.environ.get("MAYHEM_MIRROR", "").strip().lower() in {"1", "true", "yes", "on"}
PORT = int(os.environ.get("MAYHEM_PORT", "5057"))

# 代號要跨重啟穩定,否則同一個人每次重開都換一個名字,隊友分析就沒得看了。
# 隨機鹽只存在本機(不進版控),換掉它等於把所有代號重新洗一次。
_SALT_FILE = BASE_DIR / ".public_salt"
_my_names_cache: Optional[set] = None


def _name_salt() -> bytes:
    if not _SALT_FILE.is_file():
        _SALT_FILE.write_bytes(secrets.token_bytes(16))
    return _SALT_FILE.read_bytes()


def _my_names() -> set:
    """本機帳號的名稱不遮——那是你自己的資料,你自己決定要不要露出來。"""
    global _my_names_cache
    if _my_names_cache is None:
        conn = db.connect()
        try:
            _my_names_cache = {
                row["riot_id"]
                for row in conn.execute("SELECT riot_id FROM accounts WHERE is_me = 1")
                if row["riot_id"]
            }
        finally:
            conn.close()
    return _my_names_cache


def mask_name(riot_id):
    """公開模式下把別人的 Riot ID 換成「玩家 A1B2」這種穩定代號。

    用帶鹽的雜湊而不是流水號:流水號要另外維護對照表,而且換個查詢順序就會變。
    六位十六進位不是密碼學等級的匿名——知道鹽又剛好猜中某個 Riot ID 的人可以自己算來對照——
    但它做到最重要的事:回應裡不再帶著別人的遊戲帳號。真的不能外流就別用公開模式。
    """
    if not MASK_NAMES or not riot_id or riot_id in _my_names():
        return riot_id
    # 三個位元組(六位十六進位)：資料庫裡已經有一千七百多個玩家，
    # 兩位元組只有 65536 種，依生日問題會撞出二十幾組同名代號，隊友分析就會把兩個人混成一個。
    digest = hashlib.blake2s(riot_id.encode("utf-8"), key=_name_salt(), digest_size=3).hexdigest().upper()
    return f"玩家 {digest}"


# Cube 回應裡會帶名稱的成員。公開模式下在代理這一層換掉,
# 前端和語意層都不用改——語意層本來就該回真名,遮不遮是對外開放的決定。
MASKED_MEMBERS = (".riot_id", ".player")


def mask_cube(payload):
    if not MASK_NAMES:
        return payload
    if isinstance(payload, dict):
        return {
            k: (mask_name(v) if isinstance(v, str) and k.endswith(MASKED_MEMBERS) else mask_cube(v))
            for k, v in payload.items()
        }
    if isinstance(payload, list):
        return [mask_cube(x) for x in payload]
    return payload


# ── 登入 ────────────────────────────────────────────────────────────
# 兩種方式,都只在公開模式下生效:
#   1. Discord 登入(.public_oauth):每個人是獨立身分,踢人就是把名字從白名單拿掉。
#   2. 共用密碼(MAYHEM_PASSWORD):沒有個別身分,外流就得全體換。留著當備援用。
# session token 放在記憶體:重啟要重新登入,
# 換來的是「不必在磁碟上多放一份可以冒充你的東西」。
SESSION_COOKIE = "mayhem_session"
SESSION_MAX_AGE = 30 * 86400
_sessions: dict = {}

# 通道後面的請求來源一律是 127.0.0.1(通道程式自己),所以按來源 IP 限制沒有意義,
# 改成全域的失敗計數:連續失敗到上限就整站冷卻,把線上暴力猜解壓到不可行。
LOGIN_MAX_FAILS = 10
LOGIN_COOLDOWN = 300
_login_fails: list = []

# Discord OAuth。設定檔不進版控,格式:
#   { "client_id": "...", "client_secret": "...",
#     "allow": ["朋友的discord帳號", "另一個", "123456789012345678"],
#     "redirect_uri": "https://…/auth/callback"   ← 可省略,省略時依請求的網域推出來
#   }
# allow 可以寫 Discord 的使用者名稱或數字 ID。名稱可以改、ID 不會,
# 所以被擋下來的人畫面上會直接顯示他的 ID,你複製進白名單就好。
OAUTH_FILE = BASE_DIR / ".public_oauth"
DISCORD_AUTH = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN = "https://discord.com/api/oauth2/token"
DISCORD_ME = "https://discord.com/api/users/@me"
# state 防的是「別人把他自己的授權碼塞給你的瀏覽器」。存在記憶體、十分鐘過期。
STATE_MAX_AGE = 600
_states: dict = {}


def oauth_config() -> dict:
    """每次讀檔:這樣加一個朋友只要改檔案,不必重啟服務。"""
    if not OAUTH_FILE.is_file():
        return {}
    try:
        cfg = json.loads(OAUTH_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        print(f"讀不到 {OAUTH_FILE.name}: {exc}")
        return {}
    return cfg if cfg.get("client_id") and cfg.get("client_secret") else {}


OAUTH_ENABLED = bool(oauth_config())


def _allowed(cfg: dict, user: dict) -> bool:
    """白名單比對使用者名稱或數字 ID,大小寫不計。"""
    allow = {str(x).strip().lower() for x in cfg.get("allow", []) if str(x).strip()}
    candidates = {
        str(user.get("id", "")).lower(),
        str(user.get("username", "")).lower(),
        str(user.get("global_name") or "").lower(),
    }
    return bool(allow & (candidates - {""}))


def _redirect_uri(request: Request, cfg: dict) -> str:
    if cfg.get("redirect_uri"):
        return cfg["redirect_uri"]
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", f"127.0.0.1:{PORT}")
    return f"{proto}://{host}/auth/callback"

LOGIN_PAGE = """<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mayhem 戰績</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         background:#0e1420; color:#eef1f8;
         font-family:-apple-system,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif }
  form { width:min(320px,90vw); display:grid; gap:12px }
  h1 { font-size:18px; margin:0 0 4px }
  p { margin:0; font-size:13px; color:#8d96ac }
  input,button { font:inherit; padding:10px 12px; border-radius:8px; border:1px solid #2a3446 }
  input { background:#161d2c; color:inherit }
  button { background:#22d3ee; color:#0e1420; font-weight:600; border:0; cursor:pointer }
  a.btn { display:block; text-align:center; text-decoration:none;
          background:#5865F2; color:#fff; font-weight:600; padding:10px 12px; border-radius:8px }
  .err { color:#ff6b6b; font-size:13px; min-height:18px }
  .hint { font-size:12px; color:#8d96ac; word-break:break-all }
</style></head>
<body><form id="f">
  <h1>Mayhem 戰績</h1>
  __INTRO__
  __DISCORD__
  __PASSWORD__
  <div class="err" id="e"></div>
</form>
<script>
const form = document.getElementById("f")
const pw = document.getElementById("p")
if (pw) form.addEventListener("submit", async (ev) => {
  ev.preventDefault()
  const e = document.getElementById("e")
  e.textContent = ""
  const res = await fetch("/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw.value }),
  })
  if (res.ok) location.replace("/")
  else e.textContent = (await res.json()).error || "登入失敗"
})
</script></body></html>"""


def login_page(note: str = "") -> str:
    """依目前設定組出登入頁:有 Discord 就放按鈕,有密碼就放輸入框。"""
    discord = '<a class="btn" href="/auth/start">用 Discord 登入</a>' if OAUTH_ENABLED else ""
    password = (
        '<input id="p" type="password" autocomplete="current-password" placeholder="密碼">'
        '<button>進入</button>'
        if PASSWORD else ""
    )
    intro = note or (
        "<p>用 Discord 登入。只有白名單上的帳號進得來。</p>" if OAUTH_ENABLED
        else "<p>這個站台需要密碼。</p>"
    )
    return (
        LOGIN_PAGE.replace("__INTRO__", intro)
        .replace("__DISCORD__", discord)
        .replace("__PASSWORD__", password)
    )


def _logged_in(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    issued = _sessions.get(token) if token else None
    if issued is None:
        return False
    if time.time() - issued > SESSION_MAX_AGE:
        _sessions.pop(token, None)
        return False
    return True


def readonly_error():
    return JSONResponse(
        status_code=403,
        content={"error": "這個站台目前是對外開放的唯讀模式,不接受寫入。請在本機開 127.0.0.1:5057 操作。"},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if MIRROR:
        # 只讀的鏡像:不建表、不採集、不碰 Cube 的生命週期,查詢直接用 4000 埠上那份。
        print(f"鏡像模式(唯讀):埠 {PORT},共用本機的資料庫與 Cube")
        if not cube_process.port_open(cube_process.CUBE_PORT):
            print("  注意:Cube 沒在跑,分析頁面會查不到東西——請先啟動本機那份服務。")
        yield
        return

    db.init()
    # Cube 由這裡一併拉起來：開機自動啟動只有一個排程工作，
    # 若要另外顧 Cube，重開機後分析頁面會壞掉而使用者不會馬上發現。
    print(await asyncio.to_thread(cube_process.start))

    async def warm_icons():
        # 背景暖快取，不擋啟動；客戶端沒開就直接跳過。
        # 連線必須開在工作執行緒裡——SQLite 預設不允許跨執行緒使用同一條連線。
        def run():
            conn = db.connect()
            try:
                return icons.warm(conn)
            finally:
                conn.close()

        try:
            warmed = await asyncio.to_thread(run)
            print(f"圖示快取已補 {warmed} 張" if warmed else "圖示快取已是最新")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # 不要靜默失敗：暖快取壞掉會讓人以為「圖就是很慢」而查不到原因
            print(f"圖示暖快取失敗: {type(exc).__name__}: {exc}")

    async def warm_cube():
        # 和圖示暖快取同樣的用意：把第一次查詢的成本挪到啟動時，
        # 使用者開頁面時就不必等 Cube 編譯 join 路徑。
        try:
            ok, total = await asyncio.to_thread(cube_process.warm)
            print(f"Cube 暖機完成 {ok}/{total} 條查詢路徑")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Cube 暖機失敗: {type(exc).__name__}: {exc}")

    warm_task = asyncio.create_task(warm_icons())
    cube_warm_task = asyncio.create_task(warm_cube())
    task = asyncio.create_task(collector.run_forever())
    try:
        yield
    finally:
        task.cancel()
        warm_task.cancel()
        cube_warm_task.cancel()
        cube_process.stop()


app = FastAPI(title="ARAM: Mayhem 戰績 BI", lifespan=lifespan)


OPEN_PATHS = {"/login", "/auth/start", "/auth/callback"}


@app.middleware("http")
async def require_login(request: Request, call_next):
    """公開模式且設了 Discord 或密碼時,沒登入就什麼都看不到——包含前端本身與圖示。"""
    if not (PUBLIC and (PASSWORD or OAUTH_ENABLED)):
        return await call_next(request)
    if request.url.path in OPEN_PATHS or _logged_in(request):
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"error": "請先登入"})
    return HTMLResponse(login_page(), status_code=401)


def _start_session(request: Request, who: str):
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time()
    print(f"登入成功: {who}")
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https",
    )
    return response


@app.get("/auth/start")
async def auth_start(request: Request):
    cfg = oauth_config()
    if not cfg:
        return HTMLResponse(login_page("<p>這個站台沒有啟用 Discord 登入。</p>"), status_code=404)
    now = time.time()
    for old, issued in [(k, v) for k, v in _states.items() if now - v > STATE_MAX_AGE]:
        _states.pop(old, None)
    state = secrets.token_urlsafe(24)
    _states[state] = now
    params = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "redirect_uri": _redirect_uri(request, cfg),
        "response_type": "code",
        # identify 只拿到 id / 使用者名稱 / 頭像,不要 email——白名單用不到,少拿一樣少一樣
        "scope": "identify",
        "state": state,
    })
    return RedirectResponse(f"{DISCORD_AUTH}?{params}", status_code=303)


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str = "", state: str = ""):
    cfg = oauth_config()
    if not cfg:
        return HTMLResponse(login_page("<p>這個站台沒有啟用 Discord 登入。</p>"), status_code=404)
    issued = _states.pop(state, None) if state else None
    if issued is None or time.time() - issued > STATE_MAX_AGE:
        # state 對不上:可能是別人把授權碼塞給你的瀏覽器,也可能只是放太久
        return HTMLResponse(login_page("<p>登入逾時或連結不對,請再試一次。</p>"), status_code=400)
    if not code:
        return HTMLResponse(login_page("<p>Discord 沒有回傳授權碼。</p>"), status_code=400)

    def exchange():
        token = requests.post(
            DISCORD_TOKEN,
            data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _redirect_uri(request, cfg),
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        token.raise_for_status()
        access = token.json()["access_token"]
        me = requests.get(DISCORD_ME, headers={"Authorization": f"Bearer {access}"}, timeout=15)
        me.raise_for_status()
        return me.json()

    try:
        user = await asyncio.to_thread(exchange)
    except (requests.exceptions.RequestException, KeyError, ValueError) as exc:
        print(f"Discord 登入失敗: {type(exc).__name__}: {exc}")
        return HTMLResponse(login_page("<p>和 Discord 交換憑證時失敗,請再試一次。</p>"), status_code=502)

    name = user.get("global_name") or user.get("username") or "?"
    if not _allowed(cfg, user):
        print(f"擋下不在白名單的帳號: {name} (id {user.get('id')})")
        return HTMLResponse(
            login_page(
                "<p>這個 Discord 帳號不在白名單上。</p>"
                f'<p class="hint">帳號：{name}<br>ID：{user.get("id")}</p>'
                "<p>把上面的帳號或 ID 給站長加進白名單就能進來。</p>"
            ),
            status_code=403,
        )
    return _start_session(request, f"{name} (id {user.get('id')}) 透過 Discord")


@app.get("/logout")
async def logout(request: Request):
    _sessions.pop(request.cookies.get(SESSION_COOKIE), None)
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.post("/login")
async def login(request: Request):
    if not (PUBLIC and PASSWORD):
        return JSONResponse(status_code=404, content={"error": "這個站台沒有啟用密碼"})
    now = time.time()
    _login_fails[:] = [t for t in _login_fails if now - t < LOGIN_COOLDOWN]
    if len(_login_fails) >= LOGIN_MAX_FAILS:
        return JSONResponse(status_code=429, content={"error": "嘗試太多次,請等幾分鐘再試。"})
    try:
        supplied = (await request.json()).get("password") or ""
    except ValueError:
        supplied = ""
    # 定時比較:一般的 == 會因為提前返回而洩漏「前幾個字元對了」
    if not secrets.compare_digest(str(supplied), PASSWORD):
        _login_fails.append(now)
        return JSONResponse(status_code=401, content={"error": "密碼不對"})
    _login_fails.clear()
    token = secrets.token_urlsafe(32)
    _sessions[token] = now
    print("登入成功: 共用密碼")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
        # 通道那端是 HTTPS,但本機直連是 HTTP;跟著實際協定走,否則本機登入的 cookie 會被瀏覽器丟掉
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https",
    )
    return response


WEB_DIST = BASE_DIR / "web" / "dist"

if (WEB_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/")
def index():
    """優先送 React 的建置產物;沒有建置過就退回舊的單檔前端。

    dist/ 有一起進版控,所以執行期只需要 uv run app.py,不需要裝 npm。
    只有要改前端時才需要進 web/ 跑 npm run build。
    """
    built = WEB_DIST / "index.html"
    if built.is_file():
        return FileResponse(built)
    return FileResponse(BASE_DIR / "index.html")


@app.get("/api/status")
def status():
    return {**collector.snapshot(), "iconCache": icons.stats(), "public": PUBLIC}


@app.post("/api/ingest")
async def ingest_now():
    if PUBLIC:
        return readonly_error()
    new = await collector._run_ingest("manual")
    return {"new": new, **collector.snapshot()}


@app.get("/api/players")
def list_players():
    """資料庫裡出現過的所有玩家，給帳號快速切換用。本機帳號排最前面。"""
    conn = db.connect()
    try:
        rows = conn.execute(
            """SELECT mp.puuid, mp.riot_id, COUNT(DISTINCT mp.game_id) AS games,
                      COALESCE(a.is_me, 0) AS is_me, COALESCE(a.tracked, 0) AS tracked
               FROM match_participants mp
               LEFT JOIN accounts a ON a.puuid = mp.puuid
               GROUP BY mp.puuid
               ORDER BY is_me DESC, tracked DESC, games DESC"""
        ).fetchall()
        return {
            "players": [{**dict(row), "riot_id": mask_name(row["riot_id"])} for row in rows]
        }
    finally:
        conn.close()


def _resolve_puuid(conn, puuid: Optional[str]) -> Optional[str]:
    """沒指定就用本機帳號。所有頁面預設看自己，但可以切換到別人。"""
    if puuid:
        return puuid
    row = conn.execute("SELECT puuid FROM accounts WHERE is_me = 1 LIMIT 1").fetchone()
    return row["puuid"] if row else None


# 下鑽路徑走到最後一層時一次送出的場次上限。對局 id 放在網址裡,
# 對局 id 目前是 9 位數,1000 個約 10KB——uvicorn(h11)整個請求標頭的上限是 16KB。
MAX_GAME_IDS = 1000


@app.get("/api/matches")
def recent_matches(
    limit: int = 30,
    offset: int = 0,
    queue: Optional[int] = None,
    puuid: Optional[str] = None,
    date: Optional[str] = None,
    weekday: Optional[int] = None,
    hour_from: Optional[int] = None,
    hour_to: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    with_puuid: Optional[str] = None,
    relation: Optional[str] = None,
    champion: Optional[str] = None,
    augment: Optional[str] = None,
    game_ids: Optional[str] = None,
):
    """指定帳號的對局清單，預設是本機帳號。

    列表與單場明細都直接讀 SQLite,不經過 Cube——語意層是為了聚合而存在,
    逐列的鑽取用它反而綁手綁腳。

    date / weekday / hour_from~hour_to 是給圖表下鑽用的,查的是 matches 裡存好的
    本地時間欄位（hour 是區間,因為熱力圖可以切成「下午」這種粗分組）,
    和 Cube 那邊的分桶是同一份資料,所以圖上點到的格子和這裡列出來的場次一定對得起來。

    date_from / date_to 是全域的期間篩選(本地日期,含頭含尾)。
    with_puuid + relation(teammate / opponent)列出和某人同隊或對上的場次,給隊友頁下鑽用。
    champion 是英雄名稱(和 Cube 的 champions.name 同一份對照),給英雄頁下鑽用。
    augment 是增幅名稱(和 Cube 的 augments.name 同一份對照),給增幅頁下鑽用。

    game_ids 是逗號分隔的對局 id:條件先交給 Cube 用語意層的定義查出是哪幾場,
    這裡只負責列出來。**新的可下鑽維度一律走這條路,不要再加參數**——
    對局長度的界線、節奏頁的「前一場」「當日第幾場」原本在這裡各有一份副本
    (後者還抄了一次視窗函數),語意層改規則時副本不會跟著動,
    會變成「圖上 12 場、點進去 9 場」而且沒有人發現。
    """
    conn = db.connect()
    try:
        subject = _resolve_puuid(conn, puuid)
        sql = """
            SELECT m.game_id, m.platform_id, m.game_creation, m.game_duration, m.queue_id,
                   m.game_mode, m.ended_surrender,
                   mp.participant_id, mp.champion_id, mp.team_id, mp.win, mp.kills, mp.deaths, mp.assists,
                   mp.dmg_to_champions, mp.gold_earned, mp.cs, mp.team_kills, mp.champ_level,
                   mp.spell1_id, mp.spell2_id,
                   mp.penta_kills, mp.quadra_kills, mp.largest_multi_kill,
                   COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                   dc.icon_path AS champion_icon
            FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
            WHERE mp.puuid = ?
        """
        params: list = [subject]
        slice_sql = ""
        slice_params: list = []
        if queue is not None:
            slice_sql += " AND m.queue_id = ?"
            slice_params.append(queue)
        if date is not None:
            slice_sql += " AND m.local_date = ?"
            slice_params.append(date)
        if weekday is not None:
            slice_sql += " AND m.local_weekday = ?"
            slice_params.append(weekday)
        if hour_from is not None:
            slice_sql += " AND m.local_hour >= ?"
            slice_params.append(hour_from)
        if hour_to is not None:
            slice_sql += " AND m.local_hour <= ?"
            slice_params.append(hour_to)
        if date_from is not None:
            slice_sql += " AND m.local_date >= ?"
            slice_params.append(date_from)
        if date_to is not None:
            slice_sql += " AND m.local_date <= ?"
            slice_params.append(date_to)
        if with_puuid is not None:
            same_team = {"teammate": "=", "opponent": "<>"}.get(relation or "", None)
            slice_sql += f"""
                AND EXISTS (SELECT 1 FROM match_participants o
                            WHERE o.platform_id = mp.platform_id AND o.game_id = mp.game_id
                              AND o.puuid = ? AND o.puuid <> mp.puuid
                              {f'AND o.team_id {same_team} mp.team_id' if same_team else ''})"""
            slice_params.append(with_puuid)
        if champion is not None:
            # 用子查詢而不是 dc.name:下面的計數查詢沒有 join dim_champions
            slice_sql += " AND mp.champion_id IN (SELECT id FROM dim_champions WHERE name = ?)"
            slice_params.append(champion)
        if game_ids is not None:
            try:
                ids = [int(x) for x in game_ids.split(",") if x.strip()]
            except ValueError:
                return JSONResponse(status_code=400, content={"error": "game_ids 必須是逗號分隔的整數"})
            if len(ids) > MAX_GAME_IDS:
                return JSONResponse(status_code=400, content={"error": f"game_ids 最多 {MAX_GAME_IDS} 個"})
            slice_sql += f" AND m.game_id IN ({','.join('?' for _ in ids) or 'NULL'})"
            slice_params.extend(ids)
        if augment is not None:
            slice_sql += """
                AND EXISTS (SELECT 1 FROM participant_augments pa JOIN dim_augments da ON da.id = pa.augment_id
                            WHERE pa.platform_id = mp.platform_id AND pa.game_id = mp.game_id
                              AND pa.participant_id = mp.participant_id AND da.name = ?)"""
            slice_params.append(augment)
        sql += slice_sql
        params.extend(slice_params)
        sql += " ORDER BY m.game_creation DESC LIMIT ? OFFSET ?"
        params.extend([min(limit, 200), max(offset, 0)])

        matches = [dict(row) for row in conn.execute(sql, params).fetchall()]
        # 清單每列要顯示裝備與增幅，各自一次撈完再併回去，避免 N+1 查詢
        keys = [(m["platform_id"], m["game_id"], m["participant_id"]) for m in matches]
        if keys:
            placeholders = ",".join("(?,?,?)" for _ in keys)
            flat = [value for key in keys for value in key]

            def attach(field: str, sub_sql: str):
                """把長格式的明細（裝備、增幅）依參賽者分組掛回每一列。"""
                grouped: dict = {}
                for row in conn.execute(sub_sql.format(placeholders=placeholders), flat).fetchall():
                    grouped.setdefault(
                        (row["platform_id"], row["game_id"], row["participant_id"]), []
                    ).append(dict(row))
                for match in matches:
                    match[field] = grouped.get(
                        (match["platform_id"], match["game_id"], match["participant_id"]), []
                    )

            attach(
                "items",
                """SELECT pi.platform_id, pi.game_id, pi.participant_id, pi.slot,
                          pi.item_id, di.name, di.icon_path
                   FROM participant_items pi
                   LEFT JOIN dim_items di ON di.id = pi.item_id
                   WHERE (pi.platform_id, pi.game_id, pi.participant_id) IN ({placeholders})
                   ORDER BY pi.slot""",
            )
            attach(
                "augments",
                """SELECT pa.platform_id, pa.game_id, pa.participant_id, pa.slot,
                          pa.augment_id, da.name, da.rarity, da.icon_path
                   FROM participant_augments pa
                   LEFT JOIN dim_augments da ON da.id = pa.augment_id
                   WHERE (pa.platform_id, pa.game_id, pa.participant_id) IN ({placeholders})
                   ORDER BY pa.slot""",
            )

            # 同場另外九個人的英雄。以對局為鍵（不是參賽者），一場只撈一次；
            # 誰是我方、誰是對手交給前端用列上的 team_id 分，後端不必知道視角。
            games = list({(m["platform_id"], m["game_id"]) for m in matches})
            roster_rows = conn.execute(
                f"""SELECT mp.platform_id, mp.game_id, mp.participant_id, mp.team_id,
                           COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                           dc.icon_path AS champion_icon
                    FROM match_participants mp
                    LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
                    WHERE (mp.platform_id, mp.game_id) IN ({",".join("(?,?)" for _ in games)})
                    ORDER BY mp.team_id, mp.participant_id""",
                [value for key in games for value in key],
            ).fetchall()
            by_game: dict = {}
            for row in roster_rows:
                by_game.setdefault((row["platform_id"], row["game_id"]), []).append(dict(row))
            for match in matches:
                match["roster"] = by_game.get((match["platform_id"], match["game_id"]), [])

        count_sql = """
            SELECT COUNT(*) AS n, COALESCE(SUM(mp.win), 0) AS wins FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            WHERE mp.puuid = ?
        """
        count_sql += slice_sql
        counts = conn.execute(count_sql, [subject, *slice_params]).fetchone()

        # wins 是整個條件的勝場，不只這一頁：列表是捲動分批載入的，勝敗摘要不能只算已載入的部分
        return {"matches": matches, "total": counts["n"], "wins": counts["wins"]}
    finally:
        conn.close()


@app.get("/api/match/{platform_id}/{game_id}")
def match_detail(platform_id: str, game_id: int, puuid: Optional[str] = None):
    """單場完整戰報:10 名玩家的數據、裝備與增幅。"""
    conn = db.connect()
    try:
        header = conn.execute(
            """SELECT platform_id, game_id, queue_id, game_mode, game_version,
                      game_creation, game_duration, ended_surrender
               FROM matches WHERE platform_id = ? AND game_id = ?""",
            (platform_id, game_id),
        ).fetchone()
        if header is None:
            return JSONResponse(status_code=404, content={"error": "找不到這場對局"})

        players = [
            {**dict(row), "riot_id": mask_name(row["riot_id"])}
            for row in conn.execute(
                """SELECT mp.*, COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                          dc.icon_path AS champion_icon,
                          (mp.puuid = ?) AS is_me
                   FROM match_participants mp
                   LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
                   WHERE mp.platform_id = ? AND mp.game_id = ?
                   ORDER BY mp.team_id, mp.participant_id""",
                (_resolve_puuid(conn, puuid), platform_id, game_id),
            ).fetchall()
        ]

        def by_participant(sql):
            grouped: dict[int, list] = {}
            for row in conn.execute(sql, (platform_id, game_id)).fetchall():
                grouped.setdefault(row["participant_id"], []).append(dict(row))
            return grouped

        augments = by_participant(
            """SELECT pa.participant_id, pa.slot, pa.augment_id,
                      da.name, da.rarity, da.icon_path
               FROM participant_augments pa
               LEFT JOIN dim_augments da ON da.id = pa.augment_id
               WHERE pa.platform_id = ? AND pa.game_id = ?
               ORDER BY pa.slot"""
        )
        items = by_participant(
            """SELECT pi.participant_id, pi.slot, pi.item_id, di.name, di.icon_path
               FROM participant_items pi
               LEFT JOIN dim_items di ON di.id = pi.item_id
               WHERE pi.platform_id = ? AND pi.game_id = ?
               ORDER BY pi.slot"""
        )

        for player in players:
            pid = player["participant_id"]
            player["augments"] = augments.get(pid, [])
            player["items"] = items.get(pid, [])
            player.pop("raw_json", None)

        return {"match": dict(header), "players": players}
    finally:
        conn.close()


@app.get("/api/accounts")
def list_accounts():
    """追蹤名單，以及可以加入追蹤的候選人（曾與你同場的玩家）。"""
    conn = db.connect()
    try:
        tracked = [
            {**dict(row), "riot_id": mask_name(row["riot_id"])}
            for row in conn.execute(
                """SELECT a.puuid, a.riot_id, a.tracked,
                          -- 和我同場的場次
                          (SELECT COUNT(DISTINCT mp.game_id) FROM match_participants mp
                           WHERE mp.puuid = a.puuid
                             AND EXISTS (SELECT 1 FROM match_participants me
                                         WHERE me.platform_id = mp.platform_id
                                           AND me.game_id = mp.game_id
                                           AND me.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1))
                          ) AS shared,
                          -- 資料庫裡他總共出現幾場（追蹤之後會包含我沒參與的）
                          (SELECT COUNT(DISTINCT mp.game_id) FROM match_participants mp
                           WHERE mp.puuid = a.puuid) AS games
                   FROM accounts a WHERE a.tracked = 1 AND a.is_me = 0
                   ORDER BY games DESC"""
            ).fetchall()
        ]
        candidates = [
            {**dict(row), "riot_id": mask_name(row["riot_id"])}
            for row in conn.execute(
                """SELECT mp.riot_id, mp.puuid, COUNT(DISTINCT mp.game_id) AS games
                   FROM match_participants mp
                   WHERE mp.puuid NOT IN (SELECT puuid FROM accounts WHERE is_me = 1)
                   GROUP BY mp.puuid
                   ORDER BY games DESC LIMIT 60"""
            ).fetchall()
        ]
        me = conn.execute(
            "SELECT puuid, riot_id FROM accounts WHERE is_me = 1"
        ).fetchall()
        return {
            "me": [dict(row) for row in me],
            "tracked": tracked,
            "candidates": candidates,
        }
    finally:
        conn.close()


class TrackRequest(BaseModel):
    puuid: Optional[str] = None
    riotId: Optional[str] = None
    tracked: bool = True


@app.post("/api/accounts/track")
def track_account(body: TrackRequest):
    """加入或移除追蹤對象。重複送同樣的請求結果一致——冪等。"""
    if PUBLIC:
        return readonly_error()
    conn = db.connect()
    try:
        puuid = body.puuid
        riot_id = body.riotId
        if not puuid and riot_id:
            puuid = db.find_puuid_by_riot_id(conn, riot_id)
        if not puuid:
            return JSONResponse(
                status_code=404,
                content={"error": "找不到這個玩家。只能追蹤曾經和你同場過的人——"
                                  "客戶端沒有提供公開的名稱查詢。"},
            )
        if puuid in {row["puuid"] for row in conn.execute(
            "SELECT puuid FROM accounts WHERE is_me = 1"
        )}:
            return JSONResponse(status_code=400, content={"error": "這是你自己的帳號,本來就會採集。"})

        if not riot_id:
            row = conn.execute(
                "SELECT riot_id FROM match_participants WHERE puuid = ? LIMIT 1", (puuid,)
            ).fetchone()
            riot_id = row["riot_id"] if row else None

        db.set_tracked(conn, puuid, riot_id, body.tracked)
        return {"puuid": puuid, "riotId": riot_id, "tracked": body.tracked}
    finally:
        conn.close()


CUBE_BASE = "http://127.0.0.1:4000/cubejs-api/v1"

# 共用連線池。原本每個請求 requests.get 一次，等於每次都重新建 TCP 連線。
# 實測同一個已快取的查詢，代理比直連 Cube 多出的時間 30ms -> 2ms。
# requests.Session 底下的 urllib3 連線池可以多執行緒共用。
cube_http = requests.Session()
cube_http.mount("http://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=16))

# 不需要「採集到新對局後重播查詢來暖快取」——試過、量過、還原了：
# refresh key 變了之後，Cube 只有在大約 15 秒內的第一個請求會回舊結果（同時背景重算），
# 50 秒、180 秒後第一次查詢都已經是新資料（在完全沒有重播的狀態下實測）。
# 打完一場到打開頁面通常不止 15 秒，重播換不到可見的好處。


@app.api_route("/api/cube/{path:path}", methods=["GET", "POST"])
async def cube_proxy(path: str, request: Request):
    """把 Cube 的查詢 API 代理到本服務底下。

    Cube 沒有提供繫結位址的設定,它的埠一律開在所有網路介面上,而開發模式
    又不驗證身分。前端改走這裡之後,瀏覽器只需要連 127.0.0.1:5057,
    Cube 的埠就不必讓任何人碰到(仍建議用防火牆擋掉對外連線)。
    順帶好處是前端與 API 同源,不必處理 CORS。
    """
    if path not in {"load", "meta", "sql"}:
        return JSONResponse(status_code=404, content={"error": "不支援的 Cube 端點"})

    url = f"{CUBE_BASE}/{path}"
    try:
        # requests 是同步的，直接在 async handler 裡呼叫會佔住 event loop：
        # 一個要跑兩秒的 Cube 查詢會讓其他查詢、甚至背景採集迴圈全部排隊等它。
        # 儀表板一次會發好幾個查詢，這條路徑一定要放到執行緒裡。
        if request.method == "POST":
            body = await request.json()
            resp = await asyncio.to_thread(
                lambda: cube_http.post(url, json=body, timeout=60)
            )
        else:
            params = dict(request.query_params)
            resp = await asyncio.to_thread(
                lambda: cube_http.get(url, params=params, timeout=60)
            )
    except requests.exceptions.RequestException as exc:
        return JSONResponse(
            status_code=503,
            content={"error": f"連不到 Cube 語意層(是不是沒啟動?): {exc}"},
        )
    if MASK_NAMES and resp.headers.get("Content-Type", "").startswith("application/json"):
        try:
            return JSONResponse(status_code=resp.status_code, content=mask_cube(resp.json()))
        except ValueError:
            pass  # 不是合法 JSON 就原樣送回,例外訊息比遮罩重要
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("Content-Type", "application/json"),
    )


@app.get("/api/icon")
def icon(path: str):
    """客戶端圖示，經磁碟快取。

    抓過的圖示不再問客戶端，所以第二次之後幾乎是零成本，客戶端關著時也還在。
    圖示內容不會變，因此標成 immutable，瀏覽器連問都不用問。
    """
    cached, status = icons.fetch(path)
    if status == "rejected":
        return JSONResponse(status_code=400, content={"error": "不允許的資源路徑"})
    if cached is None:
        # 客戶端沒開又沒快取過：回 204 讓版面留白，不要讓整頁卡住
        return Response(status_code=204)
    return FileResponse(
        cached,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


if __name__ == "__main__":
    print("=" * 62)
    print(" ARAM: Mayhem 戰績採集 + BI")
    if PUBLIC:
        print(" 公開模式:唯讀" + ("、其他玩家的名稱已換成代號" if MASK_NAMES else "、其他玩家顯示真名"))
        print(
            "  密碼保護:已啟用" if PASSWORD else
            "  ⚠ 沒有設 MAYHEM_PASSWORD——拿到網址的人就能看到全部內容"
        )
    print(f" 開瀏覽器到 http://127.0.0.1:{PORT}")
    print(" 客戶端開著的時候會自動採集,關掉也不會掉資料(下次開再補)")
    print("=" * 62)
    uvicorn.run(app, host="127.0.0.1", port=PORT)
