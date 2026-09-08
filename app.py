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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import requests
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import collector as collector_module
import cube_process
import db
import lcu
import query

BASE_DIR = Path(__file__).parent
collector = collector_module.Collector()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    # Cube 由這裡一併拉起來：開機自動啟動只有一個排程工作，
    # 若要另外顧 Cube，重開機後分析頁面會壞掉而使用者不會馬上發現。
    print(await asyncio.to_thread(cube_process.start))
    task = asyncio.create_task(collector.run_forever())
    try:
        yield
    finally:
        task.cancel()
        cube_process.stop()


app = FastAPI(title="ARAM: Mayhem 戰績 BI", lifespan=lifespan)


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
    return collector.snapshot()


@app.post("/api/ingest")
async def ingest_now():
    new = await collector._run_ingest("manual")
    return {"new": new, **collector.snapshot()}


@app.get("/api/meta")
def meta():
    """給前端組查詢介面用的維度/指標清單。"""
    return {
        "dimensions": [
            {"name": name, "title": dim["title"]} for name, dim in query.DIMENSIONS.items()
        ],
        "metrics": [
            {"name": name, "title": metric["title"], "unit": metric.get("unit")}
            for name, metric in query.METRICS.items()
        ],
        "filters": list(query.FILTERS.keys()),
        "mayhemQueueId": lcu.MAYHEM_QUEUE_ID,
    }


class QuerySpec(BaseModel):
    dimensions: list[str] = []
    metrics: list[str] = ["games", "winrate"]
    filters: list[dict[str, Any]] = []
    sort: Optional[dict[str, Any]] = None
    minGames: Optional[int] = None
    limit: Optional[int] = 200


@app.post("/api/query")
def run_query(spec: QuerySpec):
    conn = db.connect()
    try:
        return query.run(conn, spec.model_dump())
    except query.QueryError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    finally:
        conn.close()


@app.get("/api/matches")
def recent_matches(limit: int = 30, offset: int = 0, queue: Optional[int] = None):
    """我的對局清單。

    列表與單場明細都直接讀 SQLite,不經過 Cube——語意層是為了聚合而存在,
    逐列的鑽取用它反而綁手綁腳。
    """
    conn = db.connect()
    try:
        sql = """
            SELECT m.game_id, m.platform_id, m.game_creation, m.game_duration, m.queue_id,
                   m.game_mode, m.ended_surrender,
                   mp.champion_id, mp.win, mp.kills, mp.deaths, mp.assists,
                   mp.dmg_to_champions, mp.gold_earned, mp.cs, mp.team_kills,
                   mp.penta_kills, mp.quadra_kills, mp.largest_multi_kill,
                   COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                   dc.icon_path AS champion_icon
            FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
            WHERE mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)
        """
        params: list = []
        if queue is not None:
            sql += " AND m.queue_id = ?"
            params.append(queue)
        sql += " ORDER BY m.game_creation DESC LIMIT ? OFFSET ?"
        params.extend([min(limit, 200), max(offset, 0)])

        matches = [dict(row) for row in conn.execute(sql, params).fetchall()]

        count_sql = """
            SELECT COUNT(*) AS n FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            WHERE mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)
        """
        count_params: list = []
        if queue is not None:
            count_sql += " AND m.queue_id = ?"
            count_params.append(queue)
        total = conn.execute(count_sql, count_params).fetchone()["n"]

        return {"matches": matches, "total": total}
    finally:
        conn.close()


@app.get("/api/match/{platform_id}/{game_id}")
def match_detail(platform_id: str, game_id: int):
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
            dict(row)
            for row in conn.execute(
                """SELECT mp.*, COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                          dc.icon_path AS champion_icon,
                          (mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)) AS is_me
                   FROM match_participants mp
                   LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
                   WHERE mp.platform_id = ? AND mp.game_id = ?
                   ORDER BY mp.team_id, mp.participant_id""",
                (platform_id, game_id),
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


CUBE_BASE = "http://127.0.0.1:4000/cubejs-api/v1"


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
        if request.method == "POST":
            resp = requests.post(url, json=await request.json(), timeout=60)
        else:
            resp = requests.get(url, params=dict(request.query_params), timeout=60)
    except requests.exceptions.RequestException as exc:
        return JSONResponse(
            status_code=503,
            content={"error": f"連不到 Cube 語意層(是不是沒啟動?): {exc}"},
        )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("Content-Type", "application/json"),
    )


@app.get("/api/icon")
def icon(path: str):
    """代理客戶端的圖示資源。

    瀏覽器沒有 LCU 的認證憑證,所以圖示得由後端帶著 Basic Auth 取回。
    限制只能取 /lol-game-data/assets/ 底下的路徑,避免這個代理被拿來
    存取其他需要授權的客戶端端點。
    """
    if not path.startswith("/lol-game-data/assets/"):
        return JSONResponse(status_code=400, content={"error": "不允許的資源路徑"})
    try:
        client = lcu.LCUClient.connect()
        resp = requests.get(
            client.base + path, headers=client.headers, verify=False, timeout=10
        )
    except (lcu.LCUUnavailable, requests.exceptions.RequestException):
        return Response(status_code=204)
    if resp.status_code != 200:
        return Response(status_code=204)
    return Response(
        content=resp.content,
        media_type=resp.headers.get("Content-Type", "image/png"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


if __name__ == "__main__":
    print("=" * 62)
    print(" ARAM: Mayhem 戰績採集 + BI")
    print(" 開瀏覽器到 http://127.0.0.1:5057")
    print(" 客戶端開著的時候會自動採集,關掉也不會掉資料(下次開再補)")
    print("=" * 62)
    uvicorn.run(app, host="127.0.0.1", port=5057)
