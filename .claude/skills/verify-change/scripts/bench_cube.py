"""Cube 查詢效能量測。改動前後各跑一次比較；同一台機器、同一份資料才有意義。

用法（服務要先在 127.0.0.1:5057 跑著）：
  python bench_cube.py shapes [輸出.json]    重播 cube.log 裡出現過的每一種查詢：SQLite 本身、冷（快取落空）、熱
  python bench_cube.py burst                 重播紀錄裡每一頁「同時送出」的那批查詢：依序 vs 同時，看第一個結果何時回來
  python bench_cube.py scale N [目錄]        把對局複製成 N 倍存到目錄（預設系統暫存），量重查詢的 SQL 耗時怎麼成長

兩種「冷」：
- shapes：把 LIMIT 改成沒用過的值，Cube 的結果快取就會落空（SQL 字串不同）。
  代價是查詢要重新編譯（30～50ms，卡在 Cube 唯一的 JS 執行緒上），比「入庫後第一次」高。
- burst：跟真的入庫一樣讓快取失效——重建衍生表讓 mat_state.version 變動（refresh key 的一部分），
  等 Cube 發現之後用原本的查詢重播。編譯好的 SQL 還在，量到的就是打完一場後打開頁面的情況。
  不能量完馬上重播：refresh key 變了之後約 15 秒內的第一個請求會先回舊結果。
不用 renewQuery：它會先回舊結果、在背景重算，量到的是快取。

查詢是從 cube.log 讀出來的，裡面有 puuid——只印出 measures / dimensions，不要把輸出貼進 repo。
"""
import concurrent.futures as cf
import datetime
import itertools
import json
import random
import sqlite3
import statistics
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
import features  # noqa: E402

DB = ROOT / "mayhem.db"
LOG = ROOT / "cube" / "cube.log"
API = "http://127.0.0.1:5057/api/cube/"
MAX_LIMIT = 50000  # Cube 的上限，超過回 400


def cube(endpoint: str, query: dict):
    url = API + endpoint + "?query=" + urllib.parse.quote(json.dumps(query))
    while True:
        try:
            data = json.loads(urllib.request.urlopen(url, timeout=120).read())
        except urllib.error.HTTPError as err:
            data = json.loads(err.read() or b"{}")
        if data.get("error") != "Continue wait":  # Cube 還沒算完的意思，再問一次
            return data


def timed(fn, repeat=1):
    runs = []
    for _ in range(repeat):
        start = time.perf_counter()
        fn()
        runs.append((time.perf_counter() - start) * 1000)
    return statistics.median(runs)


def uncached(query: dict, salt: int) -> dict:
    limit = query.get("limit") or 10000
    return dict(query, limit=limit + salt if limit + salt <= MAX_LIMIT else limit - salt)


def canon(query: dict) -> str:
    """同一種查詢：拿掉時區、篩選值換成佔位，只留形狀。"""
    q = json.loads(json.dumps(query))
    q.pop("timezone", None)
    for f in q.get("filters", []):
        if "values" in f:
            f["values"] = ["?"] + (["..."] if len(f["values"]) > 1 else [])
    return json.dumps(q, sort_keys=True, ensure_ascii=False)


def logged_queries():
    """(時間, 查詢) 依序列出；含已輪替的 cube.log.1。"""
    files = [p for p in (LOG.with_suffix(".log.1"), LOG) if p.is_file()]
    for line in itertools.chain.from_iterable(open(p, encoding="utf-8", errors="replace") for p in files):
        if '"REST API Request"' not in line or "/load?" not in line:
            continue
        try:
            entry = json.loads(line)
            query = json.loads(urllib.parse.parse_qs(urllib.parse.urlparse(entry["path"]).query)["query"][0])
        except (ValueError, KeyError):
            continue
        if isinstance(query, dict):
            at = datetime.datetime.fromisoformat(entry["time"].replace("Z", "+00:00")).timestamp()
            yield at, query


def label(query: dict) -> str:
    return f"M={query.get('measures')} D={query.get('dimensions')}"


def cmd_shapes(out: str = "bench_shapes.json"):
    shapes: dict = {}
    counts: dict = {}
    for _, q in logged_queries():
        key = canon(q)
        shapes[key] = q
        counts[key] = counts.get(key, 0) + 1
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    results = []
    for key, q in shapes.items():
        compiled = cube("sql", q)
        if "sql" not in compiled:
            continue  # 舊版前端留下、現在已不存在的欄位
        sql, params = compiled["sql"]["sql"]
        row = {"n": counts[key], "label": label(q)}
        row["sqlite_ms"] = timed(lambda: conn.execute(sql, params).fetchall(), 3)
        row["cold_ms"] = timed(lambda: cube("load", uncached(q, random.randint(100, 9000))))
        row["warm_ms"] = timed(lambda: cube("load", q), 3)
        results.append(row)
    results.sort(key=lambda r: -r["cold_ms"])
    Path(out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    for key in ("sqlite_ms", "cold_ms", "warm_ms"):
        values = sorted(r[key] for r in results)
        print(f"{key:10s} 中位數 {statistics.median(values):6.0f}  p90 {values[int(len(values) * .9)]:6.0f}  最大 {values[-1]:6.0f}")
    print(f"\n{len(results)} 種查詢，最慢的十種（冷）：")
    for r in results[:10]:
        print(f"  冷 {r['cold_ms']:5.0f}  SQLite {r['sqlite_ms']:5.0f}  請求數 {r['n']:4d}  {r['label']}")


def page_bursts():
    """紀錄裡「一頁同時送出」的每一批查詢（相鄰請求間隔 < 0.8 秒視為同一批），
    同樣組合只留最近一次。先跑一次 ui-conventions 的 perf_nav.mjs，紀錄裡就有每一頁的那批。"""
    bursts, current = [], []
    for at, q in logged_queries():
        if current and at - current[-1][0] > 0.8:
            bursts.append(current)
            current = []
        current.append((at, q))
    bursts.append(current)
    distinct = {}
    for burst in bursts:
        if not 2 <= len(burst) <= 30:  # 排除量測腳本自己一次送出的大批
            continue
        queries = list({canon(q): q for _, q in burst}.values())
        distinct[tuple(sorted(canon(q) for q in queries))] = queries
    return list(distinct.values())


def invalidate(wait: float = 20):
    """讓所有查詢結果失效，和入庫後一樣（見檔頭說明）。"""
    features.rebuild()
    time.sleep(wait)


def replay(queries, concurrent: bool):
    """重播一批，回傳 (第一個結果, 全部完成) 毫秒。"""
    t0 = time.perf_counter()
    ends = []

    def one(q):
        cube("load", q)
        ends.append((time.perf_counter() - t0) * 1000)

    if concurrent:
        with cf.ThreadPoolExecutor(len(queries)) as pool:
            list(pool.map(one, queries))
    else:
        for q in queries:
            one(q)
    return min(ends), max(ends)


def cmd_burst():
    """每一頁的那批查詢在快取失效後重播：依序送出 vs 同時送出（瀏覽器實際上是同時送）。
    兩種各自先讓快取失效一次；不同頁共用的查詢第二次會命中快取，兩種模式條件相同。"""
    bursts = sorted(page_bursts(), key=len, reverse=True)
    print(f"{len(bursts)} 批（每批 = 一頁同時送出的查詢）")
    results = {}
    for concurrent in (False, True):
        invalidate()
        results[concurrent] = [replay(queries, concurrent) for queries in bursts]
    print("  查詢數   依序：第一個／全部     同時：第一個／全部")
    for i, queries in enumerate(bursts):
        seq, par = results[False][i], results[True][i]
        print(f"  {len(queries):4d}     {seq[0]:6.0f} / {seq[1]:6.0f}     {par[0]:6.0f} / {par[1]:6.0f}")
    for concurrent, rows in results.items():
        print(f"{'同時' if concurrent else '依序'}合計：第一個結果 {sum(r[0] for r in rows):7.0f} ms，"
              f"全部完成 {sum(r[1] for r in rows):7.0f} ms")


def heavy_queries() -> dict:
    """和頁面同形狀的重查詢。玩家條件執行時才從 accounts 讀（本機帳號＋追蹤中的好友），
    不寫死在這裡——repo 是公開的。沒有玩家條件的話會把一千多個玩家全部分組，比實際頁面慢一個數量級。"""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    crew = [r[0] for r in conn.execute("SELECT puuid FROM accounts WHERE is_me = 1 OR tracked = 1")]
    cards = [f"{p}:{g}:{i}" for p, g, i in conn.execute(
        """SELECT mp.platform_id, mp.game_id, mp.participant_id FROM match_participants mp
           JOIN accounts a ON a.puuid = mp.puuid AND a.is_me = 1 ORDER BY mp.game_id DESC LIMIT 30""")]
    mayhem = {"member": "matches.queue_id", "operator": "equals", "values": ["2400"]}
    of_crew = {"member": "participants.puuid", "operator": "equals", "values": crew}
    return {
        "好友比較：陣容×貢獻": {
            "measures": ["participants.games", "participants.wins", "participants.winrate", "contribution.score"],
            "dimensions": ["participants.puuid", "builds.build_role", "comp_context.ally_frontline"],
            "filters": [mayhem, of_crew],
        },
        "好友比較：英雄×貢獻": {
            "measures": ["participants.games", "participants.winrate", "contribution.score"],
            "dimensions": ["participants.puuid", "champions.name"],
            "filters": [mayhem, of_crew],
        },
        "好友比較：定位×貢獻": {
            "measures": ["participants.games", "participants.winrate", "contribution.score"],
            "dimensions": ["participants.puuid", "builds.build_role"],
            "filters": [mayhem, of_crew],
        },
        "連敗：前一場結果": {
            "measures": ["participants.games", "participants.winrate"],
            "dimensions": ["participant_context.prev_result"],
            "segments": ["participants.mine"],
        },
        "英雄×perf_index": {
            "measures": ["participants.games", "builds.perf_index"],
            "dimensions": ["participants.puuid", "champions.name"],
            "filters": [of_crew],
        },
        "對局卡片定位（30 張）": {
            "dimensions": ["participants.participant_key", "builds.build_role"],
            "filters": [{"member": "participants.participant_key", "operator": "equals", "values": cards}],
            "limit": 30,
        },
        "一般：總覽": {"measures": ["participants.games", "participants.wins", "participants.kda"], "segments": ["participants.mine"]},
    }


def scaled_copy(n: int, folder: Path) -> Path:
    """對局複製成 n 倍：game_id 加位移、時間往前推，其餘欄位照抄。"""
    target = folder / f"mayhem_x{n}.db"
    if target.is_file():
        return target
    src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    out = sqlite3.connect(target)
    src.backup(out)
    src.close()
    for table in ("matches", "match_participants", "participant_items", "participant_augments"):
        cols = [r[1] for r in out.execute(f"PRAGMA table_info({table})")]
        for k in range(1, n):
            select = ",".join(
                f"game_id + {k}0000000000" if c == "game_id"
                else f"game_creation - {k} * 34560000000" if c == "game_creation"
                else c
                for c in cols
            )
            out.execute(f"INSERT INTO {table} ({','.join(cols)}) SELECT {select} FROM {table} WHERE game_id < 10000000000")
    out.commit()
    out.close()
    return target


def cmd_scale(n: str, folder: str = ""):
    base = Path(folder) if folder else Path(tempfile.gettempdir())
    compiled = {name: cube("sql", q)["sql"]["sql"] for name, q in heavy_queries().items()}
    for factor in sorted({1, int(n)}):
        path = DB if factor == 1 else scaled_copy(factor, base)
        if factor > 1:
            # 衍生表（mat_*）是入庫後才算的，副本要自己重建，不然查到的是一倍資料的表
            print(f"\n{factor} 倍副本重建衍生表 {features.rebuild(sqlite3.connect(path)):.0f} ms")
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        rows = conn.execute("SELECT COUNT(*) FROM match_participants").fetchone()[0]
        print(f"\n{factor} 倍（{rows} 列參賽者）")
        for name, (sql, params) in compiled.items():
            print(f"  {name:22s} {timed(lambda: conn.execute(sql, params).fetchall(), 3):8.0f} ms")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in {"shapes", "burst", "scale"}:
        sys.exit(__doc__)
    {"shapes": cmd_shapes, "burst": cmd_burst, "scale": cmd_scale}[sys.argv[1]](*sys.argv[2:])
