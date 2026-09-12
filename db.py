"""SQLite 儲存層。

設計重點:舊對局在客戶端只保留最新 100 場,一旦被擠出視窗就永遠拿不回來,
所以每場都連同原始 JSON 一起存,將來想分析新欄位時不必(也無法)重抓。
"""

import datetime
import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "mayhem.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS matches (
  platform_id     TEXT    NOT NULL,
  game_id         INTEGER NOT NULL,
  queue_id        INTEGER NOT NULL,
  game_mode       TEXT,
  game_version    TEXT,
  map_id          INTEGER,
  game_creation   INTEGER NOT NULL,
  game_duration   INTEGER NOT NULL,
  ended_surrender INTEGER DEFAULT 0,
  -- 開打當下「你這台機器」的本地日期/星期/小時。
  -- 這三個值一定要在寫入時就用 Python 算好,不能留給查詢層。
  -- Cube 的 server 行程跑在 UTC 下,SQLite 的 'localtime' 在那裡等於 UTC,
  -- 時段分析會整個偏移 8 小時(實測「最常打 07:00」其實是下午 3 點)。
  local_date      TEXT,
  local_weekday   INTEGER,
  local_hour      INTEGER,
  raw_json        TEXT    NOT NULL,
  ingested_at     INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id)
);

CREATE TABLE IF NOT EXISTS match_participants (
  platform_id        TEXT    NOT NULL,
  game_id            INTEGER NOT NULL,
  participant_id     INTEGER NOT NULL,
  puuid              TEXT    NOT NULL,
  riot_id            TEXT,
  team_id            INTEGER NOT NULL,
  win                INTEGER NOT NULL,
  champion_id        INTEGER NOT NULL,
  champ_level        INTEGER,
  kills              INTEGER, deaths INTEGER, assists INTEGER,
  gold_earned        INTEGER, gold_spent INTEGER,
  dmg_to_champions   INTEGER,
  dmg_physical       INTEGER, dmg_magic INTEGER, dmg_true INTEGER,
  dmg_taken          INTEGER, dmg_mitigated INTEGER,
  total_heal         INTEGER, cs INTEGER, vision_score INTEGER,
  time_ccing_others  INTEGER, largest_multi_kill INTEGER,
  spell1_id          INTEGER, spell2_id INTEGER,
  perk_primary_style INTEGER, perk_sub_style INTEGER,
  team_kills         INTEGER,
  team_dmg           INTEGER,
  game_duration      INTEGER,
  double_kills       INTEGER, triple_kills INTEGER,
  quadra_kills       INTEGER, penta_kills INTEGER,
  first_blood        INTEGER, first_tower INTEGER,
  dmg_to_objectives  INTEGER, longest_time_living INTEGER,
  taken_physical     INTEGER, taken_magic INTEGER, taken_true INTEGER,
  total_damage       INTEGER, cc_duration INTEGER,
  largest_spree      INTEGER, killing_sprees INTEGER,
  turret_kills       INTEGER, largest_crit INTEGER, units_healed INTEGER,
  PRIMARY KEY (platform_id, game_id, participant_id),
  FOREIGN KEY (platform_id, game_id) REFERENCES matches(platform_id, game_id)
);

CREATE TABLE IF NOT EXISTS participant_augments (
  platform_id TEXT NOT NULL, game_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL, slot INTEGER NOT NULL,
  augment_id INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id, participant_id, slot)
);

CREATE TABLE IF NOT EXISTS participant_items (
  platform_id TEXT NOT NULL, game_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL, slot INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id, participant_id, slot)
);

CREATE TABLE IF NOT EXISTS dim_champions (id INTEGER PRIMARY KEY, name TEXT, alias TEXT, icon_path TEXT);
CREATE TABLE IF NOT EXISTS dim_augments  (id INTEGER PRIMARY KEY, name TEXT, rarity TEXT, icon_path TEXT);
CREATE TABLE IF NOT EXISTS dim_items     (id INTEGER PRIMARY KEY, name TEXT, icon_path TEXT);
CREATE TABLE IF NOT EXISTS dim_perks     (id INTEGER PRIMARY KEY, name TEXT, icon_path TEXT);
CREATE TABLE IF NOT EXISTS dim_spells    (id INTEGER PRIMARY KEY, name TEXT, icon_path TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  puuid    TEXT PRIMARY KEY,
  riot_id  TEXT,
  is_me    INTEGER NOT NULL DEFAULT 1,
  tracked  INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  trigger     TEXT,
  games_seen  INTEGER DEFAULT 0,
  games_new   INTEGER DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_mp_puuid_champ ON match_participants(puuid, champion_id);
CREATE INDEX IF NOT EXISTS idx_mp_game        ON match_participants(platform_id, game_id);
CREATE INDEX IF NOT EXISTS idx_m_creation     ON matches(game_creation);
CREATE TABLE IF NOT EXISTS dim_champion_roles (
  champion_id INTEGER NOT NULL,
  role        TEXT    NOT NULL,
  PRIMARY KEY (champion_id, role)
);

CREATE INDEX IF NOT EXISTS idx_m_queue        ON matches(queue_id);
CREATE INDEX IF NOT EXISTS idx_pa_augment     ON participant_augments(augment_id);
CREATE INDEX IF NOT EXISTS idx_pi_item        ON participant_items(item_id);
"""


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init(path=None):
    conn = connect(path)
    try:
        with conn:
            conn.executescript(SCHEMA)
        _migrate(conn)
    finally:
        conn.close()


# 後來才補拆的欄位 -> raw_json 裡 stats 的對應鍵。
# 舊對局在客戶端早就消失,能補回來完全是因為當初把原始 JSON 一起存了。
LATE_COLUMNS = {
    "double_kills": "doubleKills",
    "triple_kills": "tripleKills",
    "quadra_kills": "quadraKills",
    "penta_kills": "pentaKills",
    "first_blood": "firstBloodKill",
    "first_tower": "firstTowerKill",
    "dmg_to_objectives": "damageDealtToObjectives",
    "longest_time_living": "longestTimeSpentLiving",
    # 承受傷害的三種類型：能回答「我是被 AP 還是 AD 打死的」
    "taken_physical": "physicalDamageTaken",
    "taken_magic": "magicalDamageTaken",
    "taken_true": "trueDamageTaken",
    # 總輸出（含小兵與建築）。和對英雄傷害相比可看出清兵 vs 團戰取向
    "total_damage": "totalDamageDealt",
    "cc_duration": "totalTimeCrowdControlDealt",
    "largest_spree": "largestKillingSpree",
    "killing_sprees": "killingSprees",
    "turret_kills": "turretKills",
    "largest_crit": "largestCriticalStrike",
    "units_healed": "totalUnitsHealed",
}


def _migrate(conn):
    """補上舊資料庫缺少的欄位,並從 raw_json 回填。"""
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(match_participants)")}

    # 對局長度反正規化到事實表,事實表才能自給自足算出每分鐘類的指標
    # (team_kills / team_dmg 也是同樣理由)。對局結束後資料不再變動,沒有一致性風險。
    if "game_duration" not in existing:
        with conn:
            conn.execute("ALTER TABLE match_participants ADD COLUMN game_duration INTEGER")
        with conn:
            conn.execute("""
                UPDATE match_participants AS mp
                SET game_duration = (
                    SELECT m.game_duration FROM matches m
                    WHERE m.platform_id = mp.platform_id AND m.game_id = mp.game_id
                )
                WHERE mp.game_duration IS NULL
            """)

    match_cols = {row["name"] for row in conn.execute("PRAGMA table_info(matches)")}
    if "local_date" not in match_cols:
        with conn:
            conn.execute("ALTER TABLE matches ADD COLUMN local_date TEXT")
            conn.execute("ALTER TABLE matches ADD COLUMN local_weekday INTEGER")
            conn.execute("ALTER TABLE matches ADD COLUMN local_hour INTEGER")
        _backfill_local_time(conn)

    account_cols = {row["name"] for row in conn.execute("PRAGMA table_info(accounts)")}
    if "tracked" not in account_cols:
        with conn:
            conn.execute("ALTER TABLE accounts ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0")

    missing = [col for col in LATE_COLUMNS if col not in existing]
    if missing:
        with conn:
            for col in missing:
                conn.execute(f"ALTER TABLE match_participants ADD COLUMN {col} INTEGER")
        _backfill_from_raw(conn, missing)


def _backfill_local_time(conn):
    """用 game_creation 重算本地時間欄位。換過時區的話手動清空這三欄再跑一次就會重建。"""
    rows = conn.execute(
        "SELECT platform_id, game_id, game_creation FROM matches WHERE local_date IS NULL"
    ).fetchall()
    with conn:
        conn.executemany(
            """UPDATE matches SET local_date = ?, local_weekday = ?, local_hour = ?
               WHERE platform_id = ? AND game_id = ?""",
            [(*local_buckets(r["game_creation"]), r["platform_id"], r["game_id"]) for r in rows],
        )
    return len(rows)


def _backfill_from_raw(conn, columns):
    import json as _json

    updates = []
    for row in conn.execute("SELECT platform_id, game_id, raw_json FROM matches"):
        game = _json.loads(row["raw_json"])
        for participant in game.get("participants", []):
            stats = participant.get("stats", {})
            values = [int(stats.get(LATE_COLUMNS[col]) or 0) for col in columns]
            updates.append((*values, row["platform_id"], row["game_id"],
                            participant.get("participantId")))

    assignments = ", ".join(f"{col} = ?" for col in columns)
    with conn:
        conn.executemany(
            f"""UPDATE match_participants SET {assignments}
                WHERE platform_id = ? AND game_id = ? AND participant_id = ?""",
            updates,
        )


def local_buckets(game_creation_ms):
    """把對局開始時間換算成本地的 (日期, 星期, 小時)。星期 0 = 週日,和 strftime('%w') 一致。"""
    if not game_creation_ms:
        return None, None, None
    moment = datetime.datetime.fromtimestamp(game_creation_ms / 1000)
    return (
        moment.strftime("%Y-%m-%d"),
        (moment.weekday() + 1) % 7,   # Python 的 weekday() 週一=0,這裡改成週日=0
        moment.hour,
    )


def _num(stats, key, default=0):
    value = stats.get(key)
    return default if value is None else value


def existing_game_ids(conn, platform_id):
    rows = conn.execute(
        "SELECT game_id FROM matches WHERE platform_id = ?", (platform_id,)
    ).fetchall()
    return {row["game_id"] for row in rows}


def store_match(conn, game):
    """寫入一場對局。回傳 True 表示這是新對局,False 表示已存在。

    整場(表頭 + 10 名玩家 + 增幅 + 裝備)包在單一 transaction 裡,
    避免中途失敗留下半筆資料。
    """
    platform_id = game.get("platformId") or ""
    game_id = game.get("gameId")
    participants = game.get("participants", [])
    identities = {
        ident.get("participantId"): ident.get("player", {})
        for ident in game.get("participantIdentities", [])
    }

    team_kills, team_dmg = {}, {}
    for p in participants:
        team = p.get("teamId")
        stats = p.get("stats", {})
        team_kills[team] = team_kills.get(team, 0) + _num(stats, "kills")
        team_dmg[team] = team_dmg.get(team, 0) + _num(stats, "totalDamageDealtToChampions")

    first_stats = participants[0].get("stats", {}) if participants else {}

    with conn:
        cur = conn.execute(
            """INSERT OR IGNORE INTO matches
               (platform_id, game_id, queue_id, game_mode, game_version, map_id,
                game_creation, game_duration, ended_surrender,
                local_date, local_weekday, local_hour, raw_json, ingested_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                platform_id,
                game_id,
                game.get("queueId"),
                game.get("gameMode"),
                game.get("gameVersion"),
                game.get("mapId"),
                game.get("gameCreation"),
                game.get("gameDuration"),
                1 if _num(first_stats, "gameEndedInSurrender") else 0,
                *local_buckets(game.get("gameCreation")),
                json.dumps(game, ensure_ascii=False),
                int(time.time()),
            ),
        )
        if cur.rowcount == 0:
            return False

        for p in participants:
            pid = p.get("participantId")
            stats = p.get("stats", {})
            player = identities.get(pid, {})
            game_name = player.get("gameName") or player.get("summonerName") or ""
            tag = player.get("tagLine") or ""
            riot_id = f"{game_name}#{tag}" if tag else game_name
            team = p.get("teamId")

            conn.execute(
                """INSERT OR IGNORE INTO match_participants
                   (platform_id, game_id, participant_id, puuid, riot_id, team_id, win,
                    champion_id, champ_level, kills, deaths, assists,
                    gold_earned, gold_spent, dmg_to_champions,
                    dmg_physical, dmg_magic, dmg_true, dmg_taken, dmg_mitigated,
                    total_heal, cs, vision_score, time_ccing_others, largest_multi_kill,
                    spell1_id, spell2_id, perk_primary_style, perk_sub_style,
                    team_kills, team_dmg, game_duration,
                    double_kills, triple_kills, quadra_kills, penta_kills,
                    first_blood, first_tower, dmg_to_objectives, longest_time_living,
                    taken_physical, taken_magic, taken_true, total_damage, cc_duration,
                    largest_spree, killing_sprees, turret_kills, largest_crit, units_healed)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                           ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    platform_id, game_id, pid,
                    player.get("puuid") or "",
                    riot_id,
                    team,
                    1 if _num(stats, "win") else 0,
                    p.get("championId"),
                    _num(stats, "champLevel"),
                    _num(stats, "kills"), _num(stats, "deaths"), _num(stats, "assists"),
                    _num(stats, "goldEarned"), _num(stats, "goldSpent"),
                    _num(stats, "totalDamageDealtToChampions"),
                    _num(stats, "physicalDamageDealtToChampions"),
                    _num(stats, "magicDamageDealtToChampions"),
                    _num(stats, "trueDamageDealtToChampions"),
                    _num(stats, "totalDamageTaken"),
                    _num(stats, "damageSelfMitigated"),
                    _num(stats, "totalHeal"),
                    _num(stats, "totalMinionsKilled"),
                    _num(stats, "visionScore"),
                    _num(stats, "timeCCingOthers"),
                    _num(stats, "largestMultiKill"),
                    p.get("spell1Id"), p.get("spell2Id"),
                    _num(stats, "perkPrimaryStyle"), _num(stats, "perkSubStyle"),
                    team_kills.get(team, 0), team_dmg.get(team, 0),
                    game.get("gameDuration"),
                    _num(stats, "doubleKills"), _num(stats, "tripleKills"),
                    _num(stats, "quadraKills"), _num(stats, "pentaKills"),
                    1 if _num(stats, "firstBloodKill") else 0,
                    1 if _num(stats, "firstTowerKill") else 0,
                    _num(stats, "damageDealtToObjectives"),
                    _num(stats, "longestTimeSpentLiving"),
                    _num(stats, "physicalDamageTaken"), _num(stats, "magicalDamageTaken"),
                    _num(stats, "trueDamageTaken"), _num(stats, "totalDamageDealt"),
                    _num(stats, "totalTimeCrowdControlDealt"),
                    _num(stats, "largestKillingSpree"), _num(stats, "killingSprees"),
                    _num(stats, "turretKills"), _num(stats, "largestCriticalStrike"),
                    _num(stats, "totalUnitsHealed"),
                ),
            )

            for slot in range(1, 7):
                augment_id = _num(stats, f"playerAugment{slot}")
                if augment_id:
                    conn.execute(
                        """INSERT OR IGNORE INTO participant_augments
                           (platform_id, game_id, participant_id, slot, augment_id)
                           VALUES (?,?,?,?,?)""",
                        (platform_id, game_id, pid, slot, augment_id),
                    )

            for slot in range(0, 7):
                item_id = _num(stats, f"item{slot}")
                if item_id:
                    conn.execute(
                        """INSERT OR IGNORE INTO participant_items
                           (platform_id, game_id, participant_id, slot, item_id)
                           VALUES (?,?,?,?,?)""",
                        (platform_id, game_id, pid, slot, item_id),
                    )

    return True


def upsert_account(conn, puuid, riot_id):
    """記錄本機登入的帳號。名稱可能改，puuid 不會，所以用 puuid 當鍵。"""
    with conn:
        conn.execute(
            """INSERT INTO accounts (puuid, riot_id, is_me, added_at) VALUES (?,?,1,?)
               ON CONFLICT(puuid) DO UPDATE SET riot_id = excluded.riot_id, is_me = 1""",
            (puuid, riot_id, int(time.time())),
        )


def tracked_accounts(conn):
    """除了自己以外，還要一併採集戰績的對象。"""
    return [
        dict(row)
        for row in conn.execute(
            "SELECT puuid, riot_id FROM accounts WHERE tracked = 1 AND is_me = 0"
            " ORDER BY riot_id"
        )
    ]


def set_tracked(conn, puuid, riot_id, tracked):
    """加入或移除追蹤對象。重複呼叫結果相同——冪等。"""
    with conn:
        conn.execute(
            """INSERT INTO accounts (puuid, riot_id, is_me, tracked, added_at)
               VALUES (?,?,0,?,?)
               ON CONFLICT(puuid) DO UPDATE SET
                 tracked = excluded.tracked,
                 riot_id = COALESCE(excluded.riot_id, accounts.riot_id)""",
            (puuid, riot_id, 1 if tracked else 0, int(time.time())),
        )


def find_puuid_by_riot_id(conn, riot_id):
    """從既有對局裡把 Riot ID 換成 puuid。

    只找得到曾經和你同場過的人——客戶端沒有提供公開的名稱查詢，
    要追蹤完全沒同場過的對象目前做不到。
    """
    row = conn.execute(
        "SELECT puuid FROM match_participants WHERE riot_id = ? LIMIT 1", (riot_id,)
    ).fetchone()
    return row["puuid"] if row else None


def replace_dimension(conn, table, rows):
    """整表換掉維度資料(版本更新會有新英雄/新增幅)。"""
    columns = {
        "dim_champions": ("id", "name", "alias", "icon_path"),
        "dim_augments": ("id", "name", "rarity", "icon_path"),
        "dim_items": ("id", "name", "icon_path"),
        "dim_perks": ("id", "name", "icon_path"),
        "dim_spells": ("id", "name", "icon_path"),
    }[table]
    placeholders = ",".join("?" * len(columns))
    with conn:
        conn.executemany(
            f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) VALUES ({placeholders})",
            [tuple(row.get(c) for c in columns) for row in rows],
        )
        if table == "dim_champions":
            # 定位是長格式,一隻英雄可能有兩個。整批換掉,改版新增定位才跟得上。
            conn.execute("DELETE FROM dim_champion_roles")
            conn.executemany(
                "INSERT OR IGNORE INTO dim_champion_roles (champion_id, role) VALUES (?,?)",
                [(row["id"], role) for row in rows for role in (row.get("roles") or [])],
            )


def start_run(conn, trigger):
    with conn:
        cur = conn.execute(
            "INSERT INTO ingest_runs (started_at, trigger) VALUES (?,?)",
            (int(time.time()), trigger),
        )
    return cur.lastrowid


def finish_run(conn, run_id, seen, new, error=None):
    with conn:
        conn.execute(
            """UPDATE ingest_runs
               SET finished_at = ?, games_seen = ?, games_new = ?, error = ?
               WHERE id = ?""",
            (int(time.time()), seen, new, error, run_id),
        )
