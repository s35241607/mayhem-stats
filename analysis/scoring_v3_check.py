"""本場貢獻 v3 的獨立重算：不讀 yml 的 SQL 邏輯，直接從原始表用 Python 算一次，和 mat_contribution 逐筆比對。唯讀。

只從 yml 讀校正常數（「校正常數開始」到「結束」之間的數字），計算步驟、權重、換算常數都在這裡另外寫一份。
出裝定位直接讀 mat_builds（規則在 builds.yml，有自己的測試）。

用法：uv run python analysis/scoring_v3_check.py [mayhem.db]
"""
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

DB = sys.argv[1] if len(sys.argv) > 1 else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
ANTI_HEAL = {3033, 3075, 3076, 3123, 3165, 3916, 6609, 223033, 223075, 223165, 226609, 323075, 773075, 773123, 773165}
ANTI_SHIELD = {6695, 226695}
WEIGHTS = {"d": 0.25, "t": 0.20, "h": 0.13, "c": 0.12, "kda": 0.12, "o": 0.08, "w": 0.06, "a": 0.04}
GENE_COL = {"d": "gene_d", "w": "gene_w", "o": "gene_o", "t": "gene_t", "c": "gene_c", "h": "gene_h", "a": "gene_a", "kda": "gene_kda"}

text = YML.read_text(encoding="utf-8")
blk = re.search(r"-- 校正常數開始[^\n]*\n(.*?)-- 校正常數結束", text, re.S).group(1)
MU = {}
for m in re.finditer(r"\('([^']+)', ([^)]*)\)", blk):
    v = [float(x) for x in m.group(2).split(",")]
    MU[m.group(1)] = dict(zip(["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda"], v))
sdv = [float(x) for x in re.search(r"VALUES \(([\d., ]+)\)\s*$", blk.strip()).group(1).split(",")]
SD = dict(zip(["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda", "work"], sdv))

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
c.row_factory = sqlite3.Row
items = defaultdict(set)
for r in c.execute("SELECT platform_id, game_id, participant_id, item_id FROM participant_items WHERE slot < 6 AND item_id > 0"):
    items[(r[0], r[1], r[2])].add(r[3])
eog = {(r[0], r[1]): (r[2], r[3]) for r in c.execute("SELECT game_id, puuid, heal_on_teammates, shield_on_teammates FROM eog_player_stats")}
role = dict(c.execute("SELECT participant_rowid, build_role FROM mat_builds"))
games = defaultdict(list)
for r in c.execute("""SELECT mp.rowid AS rid, mp.*, m.queue_id, m.is_remake, m.game_duration AS dur FROM match_participants mp
                      JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id"""):
    games[(r["platform_id"], r["game_id"])].append(dict(r))


def rel(x, others):
    e = sum(others) / len(others)
    return 0.0 if x == 0 else 100.0 if e == 0 else 100.0 * x / (x + e)


mine = {}
for (pl, gid), ps in games.items():
    p0 = ps[0]
    if p0["queue_id"] != 2400:
        reason = "other_queue"
    elif p0["is_remake"] == 1 or p0["dur"] < 360:
        reason = "remake_or_short_game"
    elif len(ps) != 10 or sum(p["team_id"] == 100 for p in ps) != 5:
        reason = "incomplete_5v5"
    else:
        reason = None
    if reason:
        for p in ps:
            mine[p["rid"]] = {"work_score": None, "unscored_reason": reason}
        continue
    m = p0["dur"] / 60
    has_eog = all((gid, p["puuid"]) in eog for p in ps)
    for p in ps:
        p["_d"] = p["dmg_to_champions"] / m
        p["_w"] = max(0, p["total_damage"] - p["dmg_to_champions"] - p["dmg_to_objectives"]) / m
        p["_o"] = p["dmg_to_objectives"] / m
        p["_t"] = (p["dmg_taken"] + p["dmg_mitigated"]) / m
        p["_c"] = p["time_ccing_others"] / m
        # 參團率（v3.1）：擊殺＋助攻 ÷ 我方擊殺；我方 0 殺時是 0
        team_kills = sum(q["kills"] for q in ps if q["team_id"] == p["team_id"])
        p["_k"] = (p["kills"] + p["assists"]) / team_kills if team_kills else 0.0
        p["_death"] = p["deaths"] / m
        if has_eog:
            h, s = eog[(gid, p["puuid"])]
            p["_h"] = (h + s) / m
            p["_shield"] = s / m
        else:
            p["_h"] = p["total_heal"] / m if p["units_healed"] >= 2 else 0.0
            p["_shield"] = 0.0
        own = items.get((pl, gid, p["participant_id"]), set())
        p["_ah"] = bool(own & ANTI_HEAL)
        p["_ash"] = bool(own & ANTI_SHIELD)
    for p in ps:
        team = [q for q in ps if q["team_id"] == p["team_id"]]
        foe = [q for q in ps if q["team_id"] != p["team_id"]]
        foe_heal = sum(q["total_heal"] for q in foe) / m
        foe_shield = sum(q["_shield"] for q in foe)
        a = 0.0
        if p["_ah"]:
            a += 0.4 * foe_heal / sum(q["_ah"] for q in team)
        if p["_ash"]:
            a += 0.4 * foe_shield / sum(q["_ash"] for q in team)
        others = [q for q in ps if q is not p]
        P = {k: rel(p["_" + k], [q["_" + k] for q in others]) for k in ("d", "w", "o", "t", "c", "k")}
        e_death = sum(q["_death"] for q in others) / 9
        P["s"] = 100.0 if p["_death"] == 0 else 0.0 if e_death == 0 else 100.0 * e_death / (p["_death"] + e_death)
        P["kda"] = (P["k"] + P["s"]) / 2
        src = "eog" if has_eog else "flag"
        P["h"] = 100.0 * p["_h"] / (p["_h"] + (1250.0 if has_eog else 1100.0))
        P["a"] = 100.0 * a / (a + 630.0)
        mu = MU[role.get(p["rid"]) or "未成形"]
        z = {}
        for k in WEIGHTS:
            if k == "h":
                z[k] = (P["h"] - mu["h_" + src]) / SD["h_" + src]
            else:
                z[k] = (P[k] - mu[k]) / SD[k]
        raw = sum(WEIGHTS[k] * z[k] for k in WEIGHTS)
        out = {"work_score": min(100.0, max(0.0, 50 + 20 * raw / SD["work"])), "work_raw": raw, "unscored_reason": None,
               "score_status": "complete" if has_eog else "estimate", "x_a": a}
        for k in WEIGHTS:
            out[GENE_COL[k]] = min(100.0, max(0.0, 50 + 20 * z[k]))
        for k, col in (("d", "p_d"), ("w", "p_w"), ("o", "p_o"), ("t", "p_t"), ("c", "p_c"), ("h", "p_h"), ("a", "p_a"), ("kda", "p_kda")):
            out[col] = P[k]
        mine[p["rid"]] = out

theirs = {r["participant_rowid"]: dict(r) for r in c.execute("SELECT * FROM mat_contribution")}
assert set(theirs) == set(mine), (len(theirs), len(mine))
worst = defaultdict(float)
mismatch = defaultdict(int)
for rid, a in mine.items():
    b = theirs[rid]
    for k, v in a.items():
        if isinstance(v, (int, float)) and v is not None and not isinstance(v, bool):
            if b[k] is None:
                mismatch[k] += 1
            else:
                worst[k] = max(worst[k], abs(v - b[k]))
        elif v != b[k]:
            mismatch[k] += 1
scored = sum(1 for a in mine.values() if a["work_score"] is not None)
print(f"{len(mine)} 列（有分數 {scored}）；最大差：" + "、".join(f"{k} {v:.1e}" for k, v in sorted(worst.items())))
print("不一致的筆數：", dict(mismatch) or 0)
