"""本機 League 客戶端 (LCU) 存取層。

lockfile 每次客戶端重啟都會換 port 和 password,所以連線物件都是用完即棄,
每次採集重新建立,不做長連線快取。
"""

import base64
import glob
import os
import platform
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MAYHEM_QUEUE_ID = 2400
PAGE_SIZE = 100


class LCUUnavailable(Exception):
    """客戶端沒開、找不到 lockfile,或連不上本機 API。"""


def default_lockfile_candidates():
    system = platform.system()
    candidates = []
    if system == "Windows":
        candidates.append(r"C:\Riot Games\League of Legends\lockfile")
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            candidates.append(os.path.join(local_appdata, "Riot Games", "League of Legends", "lockfile"))
        for drive in "DEFGH":
            candidates.append(rf"{drive}:\Riot Games\League of Legends\lockfile")
    elif system == "Darwin":
        candidates.append("/Applications/League of Legends.app/Contents/LoL/lockfile")
    else:
        candidates += glob.glob(os.path.expanduser("~/Games/league-of-legends/**/lockfile"), recursive=True)
    return candidates


def find_lockfile(override_path=None):
    if override_path:
        return override_path if os.path.isfile(override_path) else None
    for path in default_lockfile_candidates():
        if os.path.isfile(path):
            return path
    return None


def read_lockfile(path):
    content = Path(path).read_text(encoding="utf-8").strip()
    parts = content.split(":")
    if len(parts) != 5:
        raise ValueError(f"lockfile 格式不正確: {content!r}")
    _, _pid, port, password, protocol = parts
    return port, password, protocol


class LCUClient:
    def __init__(self, port, password, protocol="https"):
        self.base = f"{protocol}://127.0.0.1:{port}"
        token = base64.b64encode(f"riot:{password}".encode()).decode()
        self.headers = {"Authorization": f"Basic {token}"}

    @classmethod
    def connect(cls, override_path=None):
        path = find_lockfile(override_path)
        if not path:
            raise LCUUnavailable("找不到 lockfile,League 客戶端可能沒有執行。")
        port, password, protocol = read_lockfile(path)
        client = cls(port, password, protocol)
        client.lockfile_path = path
        return client

    def get(self, path, params=None, timeout=15):
        try:
            resp = requests.get(
                self.base + path, headers=self.headers, params=params,
                verify=False, timeout=timeout,
            )
        except requests.exceptions.RequestException as exc:
            raise LCUUnavailable(f"連不到本機客戶端 API: {exc}") from exc
        resp.raise_for_status()
        return resp.json()

    def current_summoner(self):
        return self.get("/lol-summoner/v1/current-summoner")

    def gameflow_phase(self):
        return self.get("/lol-gameflow/v1/gameflow-phase")

    def recent_matches(self):
        """最新 100 場。

        注意:這支 API 的 begIndex/endIndex 在目前的客戶端版本會被忽略,
        永遠回傳最新 100 場,所以這裡不做翻頁——翻頁拿到的是同一批資料。
        """
        data = self.get(
            "/lol-match-history/v1/products/lol/current-summoner/matches",
            params={"begIndex": 0, "endIndex": PAGE_SIZE - 1},
        )
        return data.get("games", {}).get("games", [])

    def matches_by_puuid(self, puuid):
        """查指定玩家的對戰紀錄。

        實測別人的紀錄只回傳最新 20 場(自己是 100),而且和自己的清單一樣
        只含該玩家本人;要拿到完整 10 人一樣得再打明細端點。
        """
        data = self.get(f"/lol-match-history/v1/products/lol/{puuid}/matches")
        return data.get("games", {}).get("games", [])

    def game_detail(self, game_id):
        """單場完整明細,包含全部 10 名玩家(清單 API 只給自己一個人)。"""
        return self.get(f"/lol-match-history/v1/games/{game_id}")

    def asset(self, name):
        return self.get(f"/lol-game-data/assets/v1/{name}.json")


def _icon(row, *keys):
    for key in keys:
        if row.get(key):
            return row[key]
    return None


def fetch_dimensions(client):
    """抓英雄/增幅/裝備/符文/召喚師技能的名稱對照表。"""
    champions = [
        {"id": c["id"], "name": c.get("name"), "alias": c.get("alias"),
         "icon_path": _icon(c, "squarePortraitPath")}
        for c in client.asset("champion-summary") if c.get("id", -1) > 0
    ]
    augments = [
        {"id": a["id"], "name": a.get("nameTRA") or a.get("name"),
         "rarity": a.get("rarity"), "icon_path": _icon(a, "augmentSmallIconPath", "iconPath")}
        for a in client.asset("cherry-augments")
    ]
    items = [
        {"id": i["id"], "name": i.get("name"), "icon_path": _icon(i, "iconPath")}
        for i in client.asset("items")
    ]
    perks = [
        {"id": p["id"], "name": p.get("name"), "icon_path": _icon(p, "iconPath")}
        for p in client.asset("perks")
    ]
    spells = [
        {"id": s["id"], "name": s.get("name"), "icon_path": _icon(s, "iconPath")}
        for s in client.asset("summoner-spells")
    ]
    return {
        "dim_champions": champions,
        "dim_augments": augments,
        "dim_items": items,
        "dim_perks": perks,
        "dim_spells": spells,
    }
