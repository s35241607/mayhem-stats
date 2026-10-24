"""本場貢獻 v3 的前置分析：把評分拆成「基因」，逐一實測，再比較幾種組合方式。唯讀。

基因（每分鐘，只和同一場的人比）：
  D 對英雄輸出、W 對小兵傷害（總輸出 − 對英雄 − 對建築；大亂鬥沒有野怪）、O 對建築傷害、
  T 承傷（承受＋自身減免）、C 控場（time_ccing_others）、H 治療＋護盾隊友（有賽後統計才有；沒有時退回含自補的治療量）、
  A 功能裝（重創、破盾）擋掉的敵方治療／護盾估計、K 擊殺參與（K＋A）、S 存活（死亡少）。
另外測幾個候選因子：參團率、死亡佔隊伍比、每次死亡的承傷、每單位金錢的輸出、技能施放次數（只有賽後統計有）。

每一項看：
  1. 隊伍層級：兩隊的差距能不能預測勝負（同時放進去的邏輯斯迴歸，係數是「其他項固定時」的獨立關係）；
  2. 個人層級：同一個人奇數場與偶數場的平均相關（是不是穩定的個人特質，而不是運氣）；
  3. 出裝依賴：各出裝的平均差多少（要不要校正）；
  4. 和其他基因的相關（是不是重複）。
再把幾種權重組合跑一遍，看各出裝平均、和勝負的相關、個人穩定度、坦克高輸出的人拿幾分。

用法：uv run --with numpy python analysis/scoring_v3_genes.py [mayhem.db]
輸出：印在畫面上，並寫 analysis/scoring_v3_genes.json（不含玩家名稱或 puuid）。
"""
import json
import math
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

DB = sys.argv[1] if len(sys.argv) > 1 else "mayhem.db"
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

ANTI_HEAL = (3033, 3075, 3076, 3123, 3165, 3916, 6609, 223033, 223075, 223165, 226609, 323075, 773075, 773123, 773165)
ANTI_SHIELD = (6695, 226695)

rows = c.execute(f"""
SELECT mp.rowid, mp.platform_id || ':' || mp.game_id AS g, mp.team_id, mp.win, mp.puuid, m.game_duration,
  mp.dmg_to_champions, mp.total_damage, mp.dmg_to_objectives, mp.dmg_taken, mp.dmg_mitigated, mp.time_ccing_others, mp.cc_duration,
  mp.total_heal, mp.units_healed, e.heal_on_teammates, e.shield_on_teammates, e.time_spent_dead,
  mp.kills, mp.deaths, mp.assists, mp.gold_earned, mp.champ_level,
  (SELECT MAX(pi.item_id IN {ANTI_HEAL}) FROM participant_items pi WHERE pi.platform_id = mp.platform_id AND pi.game_id = mp.game_id AND pi.participant_id = mp.participant_id AND pi.slot < 6) AS ah,
  (SELECT MAX(pi.item_id IN {ANTI_SHIELD}) FROM participant_items pi WHERE pi.platform_id = mp.platform_id AND pi.game_id = mp.game_id AND pi.participant_id = mp.participant_id AND pi.slot < 6) AS ash,
  COALESCE(b.build_role, '未成形'), v.work_score, b.ad_gold, b.ap_gold, b.tank_gold, b.sup_gold,
  EXISTS (SELECT 1 FROM dim_champion_roles cr WHERE cr.champion_id = mp.champion_id AND cr.role = 'marksman')
FROM match_participants mp
JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
JOIN mat_contribution v ON v.participant_rowid = mp.rowid
LEFT JOIN mat_builds b ON b.participant_rowid = mp.rowid
LEFT JOIN eog_player_stats e ON e.game_id = mp.game_id AND e.puuid = mp.puuid
WHERE v.work_score IS NOT NULL
""").fetchall()
cols = ["rid", "g", "team", "win", "puuid", "dur", "dmg", "total", "obj", "taken", "mit", "cc", "ccdur", "heal", "units_healed",
        "heal_tm", "shield_tm", "dead_time", "k", "d", "a", "gold", "lvl", "ah", "ash", "build", "v3", "ad_g", "ap_g", "tank_g", "sup_g", "is_mk"]
P = [dict(zip(cols, r)) for r in rows]
# 「只用裝備比例校正」的比較組用 builds.yml 的金額比例（AD、AP、坦度、輔助；都是 0 的人各 1/6、1/6、1/3、1/3）
for p in P:
    tot = sum(p[k] or 0 for k in ("ad_g", "ap_g", "tank_g", "sup_g"))
    p["f_ad"], p["f_ap"], p["r_t"], p["r_h"] = ((p["ad_g"] / tot, p["ap_g"] / tot, p["tank_g"] / tot, p["sup_g"] / tot)
                                                if tot else (1 / 6, 1 / 6, 1 / 3, 1 / 3))

# 技能施放次數只在賽後統計的原始 JSON 裡
casts = {}
for gid, raw in c.execute("SELECT game_id, raw_json FROM eog_snapshots"):
    try:
        d = json.loads(raw)
    except Exception:
        continue
    for t in d.get("teams", []):
        for p in t.get("players", []):
            s = p.get("stats", {})
            n = sum(s.get(k, 0) or 0 for k in ("spell1Casts", "spell2Casts", "spell3Casts", "spell4Casts"))
            if p.get("puuid"):
                casts[(gid, p["puuid"])] = n

games = defaultdict(list)
for p in P:
    games[p["g"]].append(p)

for g, ps in games.items():
    eog_ok = all(p["heal_tm"] is not None for p in ps)
    for p in ps:
        m = p["dur"] / 60
        p["x_D"] = p["dmg"] / m
        p["x_O"] = p["obj"] / m
        p["x_W"] = max(0, p["total"] - p["dmg"] - p["obj"]) / m
        p["x_T"] = (p["taken"] + p["mit"]) / m
        p["x_C"] = p["cc"] / m
        p["x_C2"] = p["ccdur"] / m
        p["eog"] = eog_ok
        p["x_H"] = ((p["heal_tm"] + p["shield_tm"]) / m) if eog_ok else ((p["heal"] / m) if p["units_healed"] >= 2 else 0.0)
        p["x_K"] = (p["k"] + p["a"]) / m
        p["x_deaths"] = p["d"] / m
        gid = int(g.split(":")[1])
        p["casts"] = casts.get((gid, p["puuid"])) if eog_ok else None
    for team in (100, 200):
        mine = [p for p in ps if p["team"] == team]
        foe = [p for p in ps if p["team"] != team]
        m = mine[0]["dur"] / 60
        team_kills = sum(p["k"] for p in mine)
        team_deaths = sum(p["d"] for p in mine)
        foe_heal = sum(p["heal"] for p in foe) / m  # 敵方全部治療（含自補，重創擋的就是這個）
        foe_shield = sum(p["shield_tm"] for p in foe) / m if eog_ok else 0.0  # 只有賽後統計有，且只有給隊友的護盾
        n_ah = sum(p["ah"] or 0 for p in mine)
        n_ash = sum(p["ash"] or 0 for p in mine)
        for p in mine:
            # 重創 40%、破盾（巨蛇鋒牙）近戰 50%／遠程 35%，這裡取 40%；同隊多人帶重創不疊加，平分
            p["x_A"] = ((0.4 * foe_heal / n_ah) if p["ah"] else 0.0) + ((0.4 * foe_shield / n_ash) if p["ash"] else 0.0)
            p["foe_heal"] = foe_heal
            p["kp"] = (p["k"] + p["a"]) / team_kills if team_kills else 0.0
            p["death_share"] = p["d"] / team_deaths if team_deaths else 0.0
            p["soak_per_life"] = (p["taken"] + p["mit"]) / (p["d"] + 1)
            p["dmg_per_gold"] = p["dmg"] / p["gold"] if p["gold"] else 0.0


def rel(ps, key):
    """P = 100 x / (x + E)，E = 其他九人的平均"""
    tot = sum(p[key] for p in ps)
    out = []
    for p in ps:
        e = (tot - p[key]) / (len(ps) - 1)
        x = p[key]
        out.append(0.0 if x == 0 else 100.0 if e == 0 else 100 * x / (x + e))
    return out


def rel_low(ps, key):
    """越少越好：P = 100 E / (x + E)"""
    tot = sum(p[key] for p in ps)
    out = []
    for p in ps:
        e = (tot - p[key]) / (len(ps) - 1)
        x = p[key]
        out.append(100.0 if x == 0 else 0.0 if e == 0 else 100 * e / (x + e))
    return out


def fixed(x, k):
    return 100 * x / (x + k)


for g, ps in games.items():
    for key in ("D", "O", "W", "T", "C", "C2", "K"):
        for p, v in zip(ps, rel(ps, "x_" + key)):
            p["P_" + key] = v
    for p, v in zip(ps, rel_low(ps, "x_deaths")):
        p["P_S"] = v
    for key, src in (("kp", "kp"), ("spl", "soak_per_life"), ("dpg", "dmg_per_gold")):
        for p, v in zip(ps, rel(ps, src)):
            p["P_" + key] = v
    if all(p["casts"] is not None for p in ps):
        for p, v in zip(ps, rel(ps, "casts")):
            p["P_casts"] = v

# H、A 同場常只有一兩個人有量，相對分會變成「量多量少同分」，用固定換算（K 取有量的人的中位數）
h_eog = sorted(p["x_H"] for p in P if p["eog"] and p["x_H"] > 0)
h_flag = sorted(p["x_H"] for p in P if not p["eog"] and p["x_H"] > 0)
a_pos = sorted(p["x_A"] for p in P if p["x_A"] > 0)
K_H_EOG = 1250.0
K_H_FLAG = 1100.0
K_A = round(a_pos[len(a_pos) // 2], -1)
for p in P:
    p["P_H"] = fixed(p["x_H"], K_H_EOG if p["eog"] else K_H_FLAG)
    p["P_A"] = fixed(p["x_A"], K_A)

N = len(P)
out = {"rows": N, "games": len(games), "eog_games": sum(1 for ps in games.values() if ps[0]["eog"]),
       "K_A": K_A, "h_eog_median": h_eog[len(h_eog) // 2], "h_flag_median": h_flag[len(h_flag) // 2]}
print(f"{N} 人次、{len(games)} 場（十人都有賽後統計 {out['eog_games']} 場）；A 的換算常數 K_A = {K_A}（有量的人 {len(a_pos)} 人次的中位數）")

GENES = ["D", "W", "O", "T", "C", "H", "A", "K", "S"]
NAMES = {"D": "對英雄輸出", "W": "對小兵傷害", "O": "對建築傷害", "T": "承傷（承受＋減免）", "C": "控場", "H": "治療護盾隊友",
         "A": "功能裝（重創／破盾）", "K": "擊殺參與（K＋A）", "S": "存活（死亡少）",
         "C2": "控場（cc_duration）", "kp": "參團率", "spl": "每次死亡的承傷", "dpg": "每金錢輸出", "casts": "技能施放次數"}
ROLES = ["射手", "法師", "刺客", "鬥士", "坦克", "輔助"]


# ── 1. 隊伍層級：兩隊差距 → 勝負（標準化的邏輯斯迴歸，牛頓法） ──
def logit(X, y, l2=1e-3):
    X = np.column_stack([np.ones(len(X)), X])
    b = np.zeros(X.shape[1])
    for _ in range(50):
        z = X @ b
        pr = 1 / (1 + np.exp(-z))
        W = pr * (1 - pr)
        H = X.T @ (X * W[:, None]) + l2 * np.eye(X.shape[1])
        gr = X.T @ (y - pr) - l2 * b
        step = np.linalg.solve(H, gr)
        b += step
        if np.abs(step).max() < 1e-10:
            break
    pr = 1 / (1 + np.exp(-(X @ b)))
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * (pr * (1 - pr))[:, None]) + l2 * np.eye(X.shape[1]))))
    return b[1:], se[1:]


def team_table(keys, eog_only=False, agg="sum"):
    X, y = [], []
    for g, ps in games.items():
        if eog_only and not ps[0]["eog"]:
            continue
        a = [p for p in ps if p["team"] == 100]
        bb = [p for p in ps if p["team"] == 200]
        row = []
        for k in keys:
            sa = sum(p[k] for p in a)
            sb = sum(p[k] for p in bb)
            row.append(math.log((sa + 1) / (sb + 1)))
        X.append(row)
        y.append(a[0]["win"])
    X = np.array(X)
    X = (X - X.mean(0)) / X.std(0)
    return X, np.array(y, dtype=float)


print("\n1. 隊伍層級（兩隊總量的對數比，標準化後同時放進邏輯斯迴歸；z = 係數 ÷ 標準誤）")
team = {}
for label, keys, eog_only in (
    ("工作量六項", ["x_D", "x_W", "x_O", "x_T", "x_C", "x_H"], False),
    ("＋擊殺參與與死亡", ["x_D", "x_W", "x_O", "x_T", "x_C", "x_H", "x_K", "x_deaths"], False),
    ("工作量六項（只看有賽後統計的場次）", ["x_D", "x_W", "x_O", "x_T", "x_C", "x_H"], True),
):
    X, y = team_table(keys, eog_only)
    b, se = logit(X, y)
    team[label] = {k: {"coef": round(float(bi), 3), "z": round(float(bi / si), 1)} for k, bi, si in zip(keys, b, se)}
    print(f"  {label}（{len(y)} 場）：" + "、".join(f"{k[2:]} {bi:+.2f}（z {bi / si:+.1f}）" for k, bi, si in zip(keys, b, se)))
out["team_level"] = team

# 只看「工作量」（不含擊殺、死亡），每一項單獨放進去的 z（不控制其他項）
solo = {}
for k in ["x_D", "x_W", "x_O", "x_T", "x_C", "x_H", "x_K", "x_deaths", "x_A"]:
    X, y = team_table([k])
    b, se = logit(X, y)
    solo[k] = round(float(b[0] / se[0]), 1)
print("  單獨一項的 z：" + "、".join(f"{k[2:]} {v:+.1f}" for k, v in solo.items()))
out["team_level_solo_z"] = solo

# 功能裝：敵方治療多的時候，我方有沒有重創差多少
print("\n   重創：依敵方每分鐘治療量分三等份，我方有／沒有重創裝的勝率")
ah_rows = []
for g, ps in games.items():
    for team_id in (100, 200):
        mine = [p for p in ps if p["team"] == team_id]
        ah_rows.append((mine[0]["foe_heal"], any(p["ah"] for p in mine), mine[0]["win"]))
ah_rows.sort()
third = len(ah_rows) // 3
ah_out = []
for i, name in enumerate(("敵方治療少", "中", "敵方治療多")):
    part = ah_rows[i * third:(i + 1) * third] if i < 2 else ah_rows[2 * third:]
    w1 = [r[2] for r in part if r[1]]
    w0 = [r[2] for r in part if not r[1]]
    ah_out.append({"band": name, "with": [len(w1), round(100 * sum(w1) / len(w1), 1)], "without": [len(w0), round(100 * sum(w0) / max(1, len(w0)), 1)]})
    print(f"    {name}（每分鐘 {part[0][0]:.0f}～{part[-1][0]:.0f}）：有重創 {len(w1)} 隊勝率 {100 * sum(w1) / len(w1):.1f}%、沒有 {len(w0)} 隊 {100 * sum(w0) / max(1, len(w0)):.1f}%")
out["anti_heal_by_foe_heal"] = ah_out


# ── 2～4. 個人層級 ──
def split_half(vals_by_player, min_n=30):
    """每個人奇數場與偶數場平均的相關（依時間順序），以及組間變異占比 η²"""
    a, b, allv, groups = [], [], [], []
    for pu, vs in vals_by_player.items():
        if len(vs) < min_n:
            continue
        a.append(np.mean(vs[0::2]))
        b.append(np.mean(vs[1::2]))
        groups.append(vs)
        allv.extend(vs)
    if len(a) < 5:
        return None, None, len(a)
    r = float(np.corrcoef(a, b)[0, 1])
    grand = np.mean(allv)
    ssb = sum(len(v) * (np.mean(v) - grand) ** 2 for v in groups)
    sst = sum((x - grand) ** 2 for x in allv)
    return round(r, 3), round(float(ssb / sst), 4), len(a)


order = sorted(P, key=lambda p: p["rid"])
tracked = {r[0] for r in c.execute("SELECT puuid FROM accounts")}


def by_player(key):
    d = defaultdict(list)
    for p in order:
        if p["puuid"] in tracked and p.get(key) is not None:
            d[p["puuid"]].append(p[key])
    return d


def corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.corrcoef(a, b)[0, 1])


print("\n2～4. 個人層級：和勝負的相關、奇偶場穩定度（追蹤玩家 30 場以上）、各出裝平均")
indiv = {}
for k in GENES + ["C2", "kp", "spl", "dpg", "casts"]:
    key = "P_" + k
    have = [p for p in P if p.get(key) is not None]
    rw = corr([p[key] for p in have], [p["win"] for p in have])
    sh, eta, npl = split_half(by_player(key))
    means = {r: round(float(np.mean([p[key] for p in have if p["build"] == r])), 1) for r in ROLES}
    indiv[k] = {"name": NAMES[k], "n": len(have), "win_r": round(rw, 3), "split_half": sh, "eta2": eta, "players": npl, "by_build": means,
                "mean": round(float(np.mean([p[key] for p in have])), 1), "sd": round(float(np.std([p[key] for p in have])), 1)}
    print(f"  {k:5s}{NAMES[k]:<14s} n={len(have):5d} 平均 {indiv[k]['mean']:5.1f} SD {indiv[k]['sd']:5.1f}｜勝負 r {rw:+.3f}｜穩定 {sh}（η² {eta}，{npl} 人）｜"
          + " ".join(f"{r}{v:.0f}" for r, v in means.items()))
out["individual"] = indiv

print("\n   基因之間的相關（全部人次）")
M = np.array([[p["P_" + k] for k in GENES] for p in P])
R = np.corrcoef(M.T)
print("        " + " ".join(f"{k:>6s}" for k in GENES))
for i, k in enumerate(GENES):
    print(f"  {k:5s} " + " ".join(f"{R[i, j]:+6.2f}" for j in range(len(GENES))))
out["gene_corr"] = {k: {k2: round(float(R[i, j]), 2) for j, k2 in enumerate(GENES)} for i, k in enumerate(GENES)}


# ── 5. 組合 ──
F = np.array([[p["f_ad"], p["f_ap"], p["r_t"], p["r_h"], p["f_ad"] * p["r_t"], p["f_ap"] * p["r_t"]] for p in P])
WIN = np.array([p["win"] for p in P], float)
BUILD = np.array([p["build"] for p in P])
ISMK = np.array([p["is_mk"] for p in P], float)


def calibrate(raw):
    beta, *_ = np.linalg.lstsq(F, raw, rcond=None)
    res = raw - F @ beta
    return res, beta


def score_of(weights, standardize=True):
    """S = Σ w × (P − 同出裝的期望) ÷ 該基因的殘差 SD；顯示 50 + 20 × S ÷ SD(S)"""
    total = np.zeros(N)
    parts = {}
    for k, w in weights.items():
        if w == 0:
            continue
        v = np.array([p["P_" + k] for p in P])
        res, _ = calibrate(v)
        z = res / res.std() if standardize else res / 20
        parts[k] = z
        total += w * z
    return np.clip(50 + 20 * total / total.std(), 0, 100), parts


def evaluate(name, s):
    by = {r: round(float(s[BUILD == r].mean()), 1) for r in ROLES}
    mk = round(float(s[(BUILD == "射手") & (ISMK == 1)].mean()), 1)
    # 每隊最高分的出裝占比 ÷ 該出裝的人次占比
    top = defaultdict(int)
    idx = defaultdict(list)
    for i, p in enumerate(P):
        idx[(p["g"], p["team"])].append(i)
    for ii in idx.values():
        best = max(ii, key=lambda i: s[i])
        top[BUILD[best]] += 1
    nteams = len(idx)
    ratio = {r: round((top[r] / nteams) / ((BUILD == r).mean()), 2) for r in ROLES}
    for i, p in enumerate(P):
        p["_s"] = s[i]
    sh, eta, npl = split_half(by_player("_s"))
    # 坦克裝裡輸出前 10% 的人
    tank = [i for i, p in enumerate(P) if p["build"] == "坦克"]
    cut = np.percentile([P[i]["P_D"] for i in tank], 90)
    loud = [s[i] for i in tank if P[i]["P_D"] >= cut]
    res = {"by_build": by, "marksman_heroes": mk, "spread": round(max(by.values()) - min(by.values()), 1), "team_top_ratio": ratio,
           "win_r": round(corr(s, WIN), 3), "split_half": sh, "eta2": eta, "tank_top10_dmg": round(float(np.mean(loud)), 1),
           "kda_r": round(corr(s, [(p["k"] + p["a"]) / max(1, p["d"]) for p in P]), 3),
           "deaths_r": round(corr(s, [p["d"] for p in P]), 3), "v3_r": round(corr(s, [p["v3"] for p in P]), 3)}
    print(f"  {name:<22s} 出裝差 {res['spread']:4.1f}（" + " ".join(f"{r}{v:.1f}" for r, v in by.items()) + f"）｜勝負 {res['win_r']:+.3f}｜KDA {res['kda_r']:+.2f}｜"
          f"死亡 {res['deaths_r']:+.2f}｜穩定 {sh}（η² {eta}）｜高輸出坦克 {res['tank_top10_dmg']}｜每隊最高 " + " ".join(f"{r}{v}" for r, v in ratio.items()))
    return res


print("\n5. 組合（下面的比較組：每個基因先扣掉同裝備比例的期望、除以殘差 SD，再加權；顯示分 50 ± 20）")
print("   v2.3 與舊 perf 的對照數字見 docs/contribution-scoring.md（2026-10-24 這支腳本第一次跑時，那兩張表還在）")
combos = {"採用的 v3（mat_contribution）": evaluate("採用的 v3（mat_contribution）", np.array([p["v3"] for p in P]))}
CANDIDATES = {
    "工作量六項等權": {"D": 1, "W": 1, "O": 1, "T": 1, "C": 1, "H": 1},
    "八項等權（含功能裝、K）": {"D": 1, "W": 1, "O": 1, "T": 1, "C": 1, "H": 1, "A": 1, "K": 1},
    "九項等權（含存活）": {g: 1 for g in GENES},
    "設計權重": {"D": .25, "T": .20, "H": .15, "C": .10, "K": .10, "O": .08, "W": .07, "A": .05},
    "設計＋存活": {"D": .24, "T": .18, "H": .14, "C": .10, "K": .10, "S": .06, "O": .08, "W": .06, "A": .04},
    "輸出加重": {"D": .35, "T": .18, "H": .13, "C": .08, "K": .10, "O": .07, "W": .05, "A": .04},
}
for name, w in CANDIDATES.items():
    s, _ = score_of(w)
    combos[name] = evaluate(name, s)
    combos[name]["weights"] = w

# 隊伍層級迴歸推出來的權重（工作量六項＋擊殺參與、死亡；負的歸零）
X, y = team_table(["x_D", "x_W", "x_O", "x_T", "x_C", "x_H", "x_K", "x_deaths"])
b, _ = logit(X, y)
wd = dict(zip(["D", "W", "O", "T", "C", "H", "K", "S"], [max(0.0, float(v)) if k != "S" else max(0.0, float(-v)) for k, v in zip("DWOTCHKS", b)]))
tot = sum(wd.values())
wd = {k: round(v / tot, 3) for k, v in wd.items()}
s, _ = score_of(wd)
combos["勝負推出的權重"] = evaluate("勝負推出的權重", s)
combos["勝負推出的權重"]["weights"] = wd
print("    勝負推出的權重：", wd)
out["combos"] = combos

Path(__file__).with_suffix(".json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
