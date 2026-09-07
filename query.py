"""BI 查詢編譯器。

把宣告式的查詢規格編譯成 SQL。所有欄位名走白名單映射,所有值走參數綁定,
任何情況都不做字串拼接組 SQL。

關於「一場對局被算成多列」:以增幅或裝備為維度時,一場對局會展開成多列
(一場 4 個增幅 = 4 列)。因此場次類指標一律用 COUNT(DISTINCT 對局鍵),
平均類指標則不受影響——展開出來的列在 mp.* 欄位上完全相同,平均值不變。
"""

GAME_KEY = "(mp.platform_id || ':' || mp.game_id)"

# 需要時才 JOIN,避免無謂的列展開
JOINS = {
    "augments": "LEFT JOIN participant_augments pa ON pa.platform_id = mp.platform_id"
                " AND pa.game_id = mp.game_id AND pa.participant_id = mp.participant_id",
    "dim_augments": "LEFT JOIN dim_augments da ON da.id = pa.augment_id",
    "items": "LEFT JOIN participant_items pi ON pi.platform_id = mp.platform_id"
             " AND pi.game_id = mp.game_id AND pi.participant_id = mp.participant_id",
    "dim_items": "LEFT JOIN dim_items di ON di.id = pi.item_id",
    "dim_champions": "LEFT JOIN dim_champions dc ON dc.id = mp.champion_id",
    "teammate": "JOIN match_participants other ON other.platform_id = mp.platform_id"
                " AND other.game_id = mp.game_id AND other.puuid <> mp.puuid"
                " AND other.team_id = mp.team_id",
    "opponent": "JOIN match_participants other ON other.platform_id = mp.platform_id"
                " AND other.game_id = mp.game_id AND other.team_id <> mp.team_id",
}

DIMENSIONS = {
    "champion": {
        "key": "mp.champion_id",
        "label": "COALESCE(dc.name, '英雄 ' || mp.champion_id)",
        "icon": "dc.icon_path",
        "joins": ["dim_champions"],
        "title": "英雄",
    },
    "augment": {
        "key": "pa.augment_id",
        "label": "COALESCE(da.name, '增幅 ' || pa.augment_id)",
        "icon": "da.icon_path",
        "extra": {"rarity": "da.rarity"},
        "joins": ["augments", "dim_augments"],
        "title": "增幅裝置",
    },
    "item": {
        "key": "pi.item_id",
        "label": "COALESCE(di.name, '裝備 ' || pi.item_id)",
        "icon": "di.icon_path",
        "joins": ["items", "dim_items"],
        "title": "裝備",
    },
    "teammate": {
        "key": "other.puuid",
        "label": "other.riot_id",
        "joins": ["teammate"],
        "title": "隊友",
    },
    "opponent": {
        "key": "other.puuid",
        "label": "other.riot_id",
        "joins": ["opponent"],
        "title": "對手",
    },
    "date": {
        "key": "date(m.game_creation / 1000, 'unixepoch', 'localtime')",
        "title": "日期",
    },
    "week": {
        "key": "strftime('%Y-W%W', m.game_creation / 1000, 'unixepoch', 'localtime')",
        "title": "週",
    },
    "hour_of_day": {
        "key": "CAST(strftime('%H', m.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER)",
        "title": "時段",
    },
    "weekday": {
        "key": "CAST(strftime('%w', m.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER)",
        "title": "星期",
    },
    "patch": {
        "key": "substr(m.game_version, 1, instr(m.game_version || '.', '.') - 1) || '.' || "
               "substr(m.game_version, instr(m.game_version, '.') + 1, "
               "instr(substr(m.game_version, instr(m.game_version, '.') + 1) || '.', '.') - 1)",
        "title": "版本",
    },
    "team_side": {"key": "mp.team_id", "title": "隊伍"},
    "result": {"key": "mp.win", "title": "勝負"},
    "champ_level": {"key": "mp.champ_level", "title": "等級"},
    "duration_bucket": {
        "key": "CASE WHEN m.game_duration < 900 THEN '< 15 分'"
               " WHEN m.game_duration < 1200 THEN '15-20 分'"
               " WHEN m.game_duration < 1500 THEN '20-25 分'"
               " ELSE '25 分以上' END",
        "title": "對局長度",
    },
}

METRICS = {
    "games": {"sql": f"COUNT(DISTINCT {GAME_KEY})", "title": "場次"},
    "wins": {"sql": f"COUNT(DISTINCT CASE WHEN mp.win = 1 THEN {GAME_KEY} END)", "title": "勝場"},
    "losses": {"sql": f"COUNT(DISTINCT CASE WHEN mp.win = 0 THEN {GAME_KEY} END)", "title": "敗場"},
    "winrate": {
        "sql": f"ROUND(COUNT(DISTINCT CASE WHEN mp.win = 1 THEN {GAME_KEY} END) * 100.0"
               f" / NULLIF(COUNT(DISTINCT {GAME_KEY}), 0), 1)",
        "title": "勝率", "unit": "%",
    },
    "kda": {
        "sql": "ROUND((AVG(mp.kills) + AVG(mp.assists)) / NULLIF(AVG(mp.deaths), 0), 2)",
        "title": "KDA",
    },
    "avg_kills": {"sql": "ROUND(AVG(mp.kills), 1)", "title": "平均擊殺"},
    "avg_deaths": {"sql": "ROUND(AVG(mp.deaths), 1)", "title": "平均死亡"},
    "avg_assists": {"sql": "ROUND(AVG(mp.assists), 1)", "title": "平均助攻"},
    "dpm": {
        "sql": "ROUND(AVG(mp.dmg_to_champions * 60.0 / NULLIF(m.game_duration, 0)), 0)",
        "title": "每分鐘傷害",
    },
    "gpm": {
        "sql": "ROUND(AVG(mp.gold_earned * 60.0 / NULLIF(m.game_duration, 0)), 0)",
        "title": "每分鐘經濟",
    },
    "dmg_share": {
        "sql": "ROUND(AVG(mp.dmg_to_champions * 100.0 / NULLIF(mp.team_dmg, 0)), 1)",
        "title": "傷害佔比", "unit": "%",
    },
    "kill_participation": {
        "sql": "ROUND(AVG((mp.kills + mp.assists) * 100.0 / NULLIF(mp.team_kills, 0)), 1)",
        "title": "參團率", "unit": "%",
    },
    "avg_damage": {"sql": "ROUND(AVG(mp.dmg_to_champions), 0)", "title": "平均傷害"},
    "avg_taken": {"sql": "ROUND(AVG(mp.dmg_taken), 0)", "title": "平均承受傷害"},
    "avg_gold": {"sql": "ROUND(AVG(mp.gold_earned), 0)", "title": "平均經濟"},
    "avg_cs": {"sql": "ROUND(AVG(mp.cs), 1)", "title": "平均補兵"},
    "avg_duration": {
        "sql": "ROUND(AVG(m.game_duration) / 60.0, 1)", "title": "平均時長", "unit": "分",
    },
}

# 篩選欄位 -> (SQL 表達式, 需要的 JOIN)
FILTERS = {
    "queue": ("m.queue_id", []),
    "champion": ("mp.champion_id", []),
    "augment": ("pa.augment_id", ["augments"]),
    "augment_rarity": ("da.rarity", ["augments", "dim_augments"]),
    "item": ("pi.item_id", ["items", "dim_items"]),
    "patch": ("m.game_version", []),
    "result": ("mp.win", []),
    "team_side": ("mp.team_id", []),
    "teammate": ("other.puuid", ["teammate"]),
    "opponent": ("other.puuid", ["opponent"]),
    "date": ("date(m.game_creation / 1000, 'unixepoch', 'localtime')", []),
    "hour_of_day": (
        "CAST(strftime('%H', m.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER)", []
    ),
    "weekday": (
        "CAST(strftime('%w', m.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER)", []
    ),
}

OPERATORS = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


class QueryError(ValueError):
    pass


def _resolve_joins(names, needed):
    """依固定順序展開 JOIN,確保相依的 JOIN 先出現。"""
    order = ["augments", "dim_augments", "items", "dim_items", "dim_champions",
             "teammate", "opponent"]
    for name in names:
        needed.add(name)
    return [JOINS[n] for n in order if n in needed]


def build(spec):
    dimensions = spec.get("dimensions") or []
    metrics = spec.get("metrics") or ["games", "winrate"]
    filters = spec.get("filters") or []

    for name in dimensions:
        if name not in DIMENSIONS:
            raise QueryError(f"未知的維度: {name}")
    for name in metrics:
        if name not in METRICS:
            raise QueryError(f"未知的指標: {name}")

    needed_joins = set()
    select_parts, group_parts, columns = [], [], []
    params = []

    for i, name in enumerate(dimensions):
        dim = DIMENSIONS[name]
        needed_joins.update(dim.get("joins", []))
        alias = f"d{i}"
        select_parts.append(f"{dim['key']} AS {alias}_key")
        group_parts.append(dim["key"])
        column = {"name": name, "title": dim["title"], "type": "dimension",
                  "keyField": f"{alias}_key"}
        if dim.get("label"):
            select_parts.append(f"{dim['label']} AS {alias}_label")
            column["labelField"] = f"{alias}_label"
        if dim.get("icon"):
            select_parts.append(f"{dim['icon']} AS {alias}_icon")
            column["iconField"] = f"{alias}_icon"
        for extra_name, extra_sql in (dim.get("extra") or {}).items():
            select_parts.append(f"{extra_sql} AS {alias}_{extra_name}")
            column.setdefault("extraFields", {})[extra_name] = f"{alias}_{extra_name}"
        columns.append(column)

    for name in metrics:
        metric = METRICS[name]
        select_parts.append(f"{metric['sql']} AS {name}")
        columns.append({"name": name, "title": metric["title"], "type": "metric",
                        "unit": metric.get("unit")})

    where = ["mp.puuid IN (SELECT puuid FROM accounts WHERE is_me = 1)"]

    for clause in filters:
        field = clause.get("field")
        if field not in FILTERS:
            raise QueryError(f"未知的篩選欄位: {field}")
        expr, joins = FILTERS[field]
        needed_joins.update(joins)
        op = clause.get("op", "eq")
        value = clause.get("value")

        if op == "in":
            if not isinstance(value, list) or not value:
                raise QueryError(f"{field} 的 in 條件需要非空陣列")
            where.append(f"{expr} IN ({','.join('?' * len(value))})")
            params.extend(value)
        elif op == "between":
            if not isinstance(value, list) or len(value) != 2:
                raise QueryError(f"{field} 的 between 條件需要兩個值")
            where.append(f"{expr} BETWEEN ? AND ?")
            params.extend(value)
        elif op == "contains":
            where.append(f"{expr} LIKE ?")
            params.append(f"%{value}%")
        elif op in OPERATORS:
            where.append(f"{expr} {OPERATORS[op]} ?")
            params.append(value)
        else:
            raise QueryError(f"未知的運算子: {op}")

    sql = ["SELECT " + ", ".join(select_parts)]
    sql.append("FROM match_participants mp")
    sql.append("JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id")
    sql.extend(_resolve_joins([], needed_joins))
    sql.append("WHERE " + " AND ".join(where))

    if group_parts:
        sql.append("GROUP BY " + ", ".join(group_parts))

    min_games = spec.get("minGames")
    if min_games:
        sql.append(f"HAVING COUNT(DISTINCT {GAME_KEY}) >= ?")
        params.append(int(min_games))

    sort = spec.get("sort") or {}
    sort_field = sort.get("field", "games" if "games" in metrics else None)
    if sort_field:
        if sort_field in METRICS:
            sort_expr = sort_field
        elif sort_field in DIMENSIONS and sort_field in dimensions:
            sort_expr = f"d{dimensions.index(sort_field)}_key"
        else:
            raise QueryError(f"無法用 {sort_field} 排序")
        direction = "DESC" if str(sort.get("dir", "desc")).lower() == "desc" else "ASC"
        sql.append(f"ORDER BY {sort_expr} {direction} NULLS LAST")

    limit = min(int(spec.get("limit") or 200), 2000)
    sql.append("LIMIT ?")
    params.append(limit)

    return "\n".join(sql), params, columns


def run(conn, spec):
    sql, params, columns = build(spec)
    rows = [dict(row) for row in conn.execute(sql, params).fetchall()]
    return {"columns": columns, "rows": rows, "sql": sql}
