"""SQLite 儲存層。

設計重點:舊對局在客戶端只保留最新 100 場,一旦被擠出視窗就永遠拿不回來,
所以每場都連同原始 JSON 一起存,將來想分析新欄位時不必(也無法)重抓。
"""

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
    with connect(path) as conn:
        conn.executescript(SCHEMA)


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
                game_creation, game_duration, ended_surrender, raw_json, ingested_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
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
                    team_kills, team_dmg)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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
    with conn:
        conn.execute(
            """INSERT INTO accounts (puuid, riot_id, is_me, added_at) VALUES (?,?,1,?)
               ON CONFLICT(puuid) DO UPDATE SET riot_id = excluded.riot_id""",
            (puuid, riot_id, int(time.time())),
        )


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
