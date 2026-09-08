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
from pydantic import BaseModel

import collector as collector_module
import db
import lcu
import query

BASE_DIR = Path(__file__).parent
collector = collector_module.Collector()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    task = asyncio.create_task(collector.run_forever())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="ARAM: Mayhem 戰績 BI", lifespan=lifespan)


@app.get("/")
def index():
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
def recent_matches(limit: int = 20, queue: Optional[int] = None):
    """最近幾場的清單,給總覽頁的戰績條用。"""
    conn = db.connect()
    try:
        sql = """
            SELECT m.game_id, m.platform_id, m.game_creation, m.game_duration, m.queue_id,
                   mp.champion_id, mp.win, mp.kills, mp.deaths, mp.assists,
                   mp.dmg_to_champions, mp.gold_earned,
                   COALESCE(dc.name, '英雄 ' || mp.champion_id) AS champion_name,
                   dc.icon_path AS champion_icon
            FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            LEFT JOIN dim_champions dc ON dc.id = mp.champion_id
            WHERE mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)
        """
        params = []
        if queue is not None:
            sql += " AND m.queue_id = ?"
            params.append(queue)
        sql += " ORDER BY m.game_creation DESC LIMIT ?"
        params.append(min(limit, 200))
        return {"matches": [dict(row) for row in conn.execute(sql, params).fetchall()]}
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
