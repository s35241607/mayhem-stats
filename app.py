"""
ARAM: Mayhem 個人戰績小工具 (FastAPI 版)
----------------------------------
在本機執行,讀取 League of Legends 客戶端的 lockfile 連上本地 LCU API,
撈出目前登入帳號的完整對戰紀錄,篩出 queueId = 2400 (ARAM: Mayhem) 的場次,
統計每個英雄的場次數與勝率,提供一個網頁前端瀏覽/排序/搜尋。

用法(uv):
    uv sync
    uv run app.py
    開瀏覽器到 http://127.0.0.1:5057

前提:
    - League of Legends 客戶端要在背景開著(不需要在遊玩中,登入大廳畫面即可)
    - 只能查「目前登入這個客戶端的帳號」自己的資料,查不到別人的
"""

import base64
import glob
import os
import platform
from pathlib import Path
from typing import Optional

import requests
import urllib3
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = Path(__file__).parent
app = FastAPI(title="ARAM: Mayhem 個人戰績")

MAYHEM_QUEUE_ID = 2400
PAGE_SIZE = 100
MAX_PAGES = 60  # safety cap: 60 * 100 = 6000 games max per scan
DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
DDRAGON_CHAMPION_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json"
DDRAGON_ICON_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{image}"

_champion_cache = {"version": None, "by_id": {}}


# ---------------------------------------------------------------------------
# lockfile discovery
# ---------------------------------------------------------------------------

def default_lockfile_candidates():
    system = platform.system()
    candidates = []
    if system == "Windows":
        candidates += [
            r"C:\Riot Games\League of Legends\lockfile",
        ]
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            candidates.append(os.path.join(local_appdata, "Riot Games", "League of Legends", "lockfile"))
        # scan other drive letters just in case
        for drive in "DEFGH":
            candidates.append(rf"{drive}:\Riot Games\League of Legends\lockfile")
    elif system == "Darwin":
        candidates += [
            "/Applications/League of Legends.app/Contents/LoL/lockfile",
        ]
    else:
        candidates += glob.glob(os.path.expanduser("~/Games/league-of-legends/**/lockfile"), recursive=True)
    return candidates


def find_lockfile(override_path: Optional[str] = None):
    if override_path:
        if os.path.isfile(override_path):
            return override_path
        return None
    for path in default_lockfile_candidates():
        if os.path.isfile(path):
            return path
    return None


def read_lockfile(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    parts = content.split(":")
    if len(parts) != 5:
        raise ValueError(f"lockfile 格式不正確: {content!r}")
    _, _pid, port, password, protocol = parts
    return port, password, protocol


# ---------------------------------------------------------------------------
# LCU client
# ---------------------------------------------------------------------------

class LCUClient:
    def __init__(self, port, password, protocol="https"):
        self.base = f"{protocol}://127.0.0.1:{port}"
        token = base64.b64encode(f"riot:{password}".encode()).decode()
        self.headers = {"Authorization": f"Basic {token}"}

    def get(self, path, params=None, timeout=10):
        resp = requests.get(self.base + path, headers=self.headers, params=params, verify=False, timeout=timeout)
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Data Dragon champion lookup
# ---------------------------------------------------------------------------

def load_champion_map():
    if _champion_cache["by_id"]:
        return _champion_cache
    versions = requests.get(DDRAGON_VERSIONS_URL, timeout=10).json()
    version = versions[0]
    champ_data = requests.get(DDRAGON_CHAMPION_URL.format(version=version), timeout=10).json()
    by_id = {}
    for _key, champ in champ_data.get("data", {}).items():
        champ_id = int(champ["key"])
        by_id[champ_id] = {
            "name": champ["name"],
            "icon": DDRAGON_ICON_URL.format(version=version, image=champ["image"]["full"]),
        }
    _champion_cache["version"] = version
    _champion_cache["by_id"] = by_id
    return _champion_cache


# ---------------------------------------------------------------------------
# core scan logic
# ---------------------------------------------------------------------------

def scan_mayhem_history(lcu: LCUClient):
    summoner = lcu.get("/lol-summoner/v1/current-summoner")
    my_puuid = summoner.get("puuid")
    display_name = summoner.get("gameName") or summoner.get("displayName") or "Summoner"
    tag_line = summoner.get("tagLine", "")

    champ_map = load_champion_map()["by_id"]

    stats = {}  # championId -> {games, wins}
    total_scanned = 0
    mayhem_found = 0
    oldest_date = None
    newest_date = None
    hit_end = False
    total_available = None
    pagination_broken = False
    seen_game_ids = set()

    for page in range(MAX_PAGES):
        beg = page * PAGE_SIZE
        end = beg + PAGE_SIZE - 1
        data = lcu.get(
            "/lol-match-history/v1/products/lol/current-summoner/matches",
            params={"begIndex": beg, "endIndex": end},
        )
        games_block = data.get("games", {})
        games = games_block.get("games", [])
        if total_available is None:
            total_available = games_block.get("gameCount")

        if not games:
            hit_end = True
            break

        # 有些客戶端版本的這個 API 不會真的按 begIndex/endIndex 翻頁,
        # 而是每次都回傳同一批最新對局。用 gameId 偵測:如果這一頁完全
        # 沒有新的對局,代表已經在原地打轉,直接停止避免重複計算戰績。
        new_games = [g for g in games if g.get("gameId") not in seen_game_ids]
        if not new_games:
            hit_end = True
            pagination_broken = page > 0
            break

        total_scanned += len(new_games)

        for game in new_games:
            seen_game_ids.add(game.get("gameId"))
            game_date = game.get("gameCreationDate")
            if game_date:
                if oldest_date is None or game_date < oldest_date:
                    oldest_date = game_date
                if newest_date is None or game_date > newest_date:
                    newest_date = game_date

            if game.get("queueId") != MAYHEM_QUEUE_ID:
                continue

            my_participant_id = None
            for identity in game.get("participantIdentities", []):
                player = identity.get("player", {})
                if player.get("puuid") == my_puuid:
                    my_participant_id = identity.get("participantId")
                    break
            if my_participant_id is None:
                continue

            me = next((p for p in game.get("participants", []) if p.get("participantId") == my_participant_id), None)
            if me is None:
                continue

            champion_id = me.get("championId")
            team_id = me.get("teamId")
            team = next((t for t in game.get("teams", []) if t.get("teamId") == team_id), None)
            won = bool(team) and team.get("win") == "Win"

            mayhem_found += 1
            bucket = stats.setdefault(champion_id, {"games": 0, "wins": 0})
            bucket["games"] += 1
            if won:
                bucket["wins"] += 1

        # if this page returned fewer than a full page, we've reached the end
        if len(games) < PAGE_SIZE:
            hit_end = True
            break

    champions = []
    for champion_id, bucket in stats.items():
        info = champ_map.get(champion_id, {"name": f"Champion {champion_id}", "icon": ""})
        games = bucket["games"]
        wins = bucket["wins"]
        champions.append({
            "id": champion_id,
            "name": info["name"],
            "icon": info["icon"],
            "games": games,
            "wins": wins,
            "losses": games - wins,
            "winRate": round(wins / games * 100, 1) if games else 0,
        })
    champions.sort(key=lambda c: (-c["games"], -c["winRate"]))

    return {
        "summonerName": f"{display_name}#{tag_line}" if tag_line else display_name,
        "totalScanned": total_scanned,
        "totalAvailable": total_available,
        "mayhemFound": mayhem_found,
        "oldestDate": oldest_date,
        "newestDate": newest_date,
        "hitEnd": hit_end,
        "cappedBySafetyLimit": (not hit_end),
        "paginationBroken": pagination_broken,
        "champions": champions,
    }


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    lockfilePath: Optional[str] = None


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/api/status")
def status(lockfile: Optional[str] = None):
    path = find_lockfile(lockfile or None)
    return {
        "lockfileFound": path is not None,
        "lockfilePath": path,
        "candidatesTried": default_lockfile_candidates(),
    }


@app.post("/api/scan")
def scan(body: ScanRequest):
    override = body.lockfilePath or None

    path = find_lockfile(override)
    if not path:
        return JSONResponse(
            status_code=404,
            content={"error": "找不到 League of Legends 的 lockfile。請確認客戶端已經開著,或手動輸入 lockfile 路徑。"},
        )

    try:
        port, password, protocol = read_lockfile(path)
        lcu = LCUClient(port, password, protocol)
        result = scan_mayhem_history(lcu)
        result["lockfilePath"] = path
        return result
    except requests.exceptions.ConnectionError:
        return JSONResponse(
            status_code=502,
            content={"error": "連不到本機客戶端 API,請確認 League of Legends 客戶端正在執行。"},
        )
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response is not None else None
        if status_code == 401:
            return JSONResponse(
                status_code=401,
                content={"error": "驗證失敗(401)。客戶端可能剛重啟過,lockfile 已過期,請重新整理再試一次。"},
            )
        return JSONResponse(
            status_code=502,
            content={"error": f"客戶端 API 回應錯誤: HTTP {status_code}"},
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": f"發生未預期的錯誤: {e}"},
        )


if __name__ == "__main__":
    print("=" * 60)
    print(" ARAM: Mayhem 個人戰績小工具")
    print(" 開瀏覽器到 http://127.0.0.1:5057")
    print(" 請確保 League of Legends 客戶端在背景開著")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=5057)
