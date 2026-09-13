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
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import collector as collector_module
import cube_process
import db
import icons

BASE_DIR = Path(__file__).parent
collector = collector_module.Collector()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    return {**collector.snapshot(), "iconCache": icons.stats()}


@app.post("/api/ingest")
async def ingest_now():
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
        return {"players": [dict(row) for row in rows]}
    finally:
        conn.close()


def _resolve_puuid(conn, puuid: Optional[str]) -> Optional[str]:
    """沒指定就用本機帳號。所有頁面預設看自己，但可以切換到別人。"""
    if puuid:
        return puuid
    row = conn.execute("SELECT puuid FROM accounts WHERE is_me = 1 LIMIT 1").fetchone()
    return row["puuid"] if row else None


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
):
    """指定帳號的對局清單，預設是本機帳號。

    列表與單場明細都直接讀 SQLite,不經過 Cube——語意層是為了聚合而存在,
    逐列的鑽取用它反而綁手綁腳。

    date / weekday / hour_from~hour_to 是給圖表下鑽用的,查的是 matches 裡存好的
    本地時間欄位（hour 是區間,因為熱力圖可以切成「下午」這種粗分組）,
    和 Cube 那邊的分桶是同一份資料,所以圖上點到的格子和這裡列出來的場次一定對得起來。
    """
    conn = db.connect()
    try:
        subject = _resolve_puuid(conn, puuid)
        sql = """
            SELECT m.game_id, m.platform_id, m.game_creation, m.game_duration, m.queue_id,
                   m.game_mode, m.ended_surrender,
                   mp.participant_id, mp.champion_id, mp.win, mp.kills, mp.deaths, mp.assists,
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
        sql += slice_sql
        params.extend(slice_params)
        sql += " ORDER BY m.game_creation DESC LIMIT ? OFFSET ?"
        params.extend([min(limit, 200), max(offset, 0)])

        matches = [dict(row) for row in conn.execute(sql, params).fetchall()]
        # 清單每列要顯示裝備，另外一次撈完再併回去，避免 N+1 查詢
        keys = [(m["platform_id"], m["game_id"], m["participant_id"]) for m in matches]
        if keys:
            placeholders = ",".join("(?,?,?)" for _ in keys)
            flat = [value for key in keys for value in key]
            item_rows = conn.execute(
                f"""SELECT pi.platform_id, pi.game_id, pi.participant_id, pi.slot,
                           pi.item_id, di.name, di.icon_path
                    FROM participant_items pi
                    LEFT JOIN dim_items di ON di.id = pi.item_id
                    WHERE (pi.platform_id, pi.game_id, pi.participant_id) IN ({placeholders})
                    ORDER BY pi.slot""",
                flat,
            ).fetchall()
            grouped: dict = {}
            for row in item_rows:
                grouped.setdefault(
                    (row["platform_id"], row["game_id"], row["participant_id"]), []
                ).append(dict(row))
            for match in matches:
                match["items"] = grouped.get(
                    (match["platform_id"], match["game_id"], match["participant_id"]), []
                )

        count_sql = """
            SELECT COUNT(*) AS n FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            WHERE mp.puuid = ?
        """
        count_sql += slice_sql
        total = conn.execute(count_sql, [subject, *slice_params]).fetchone()["n"]

        return {"matches": matches, "total": total}
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
            dict(row)
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
            dict(row)
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
            dict(row)
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
    print(" 開瀏覽器到 http://127.0.0.1:5057")
    print(" 客戶端開著的時候會自動採集,關掉也不會掉資料(下次開再補)")
    print("=" * 62)
    uvicorn.run(app, host="127.0.0.1", port=5057)
