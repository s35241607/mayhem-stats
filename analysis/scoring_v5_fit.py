"""產生本場貢獻 v5.4（v5-B 修訂版）的校正常數（中位數、IQR 尺度、治療／護盾先驗、CORE_SD、EOG 全局補償），
唯讀除非加 --write。定版後不要再自動跑：常數一變，所有舊分都會重算，需同步升 score_version。

用法：uv run python analysis/scoring_v5_fit.py [mayhem.db] [--write]
"""
import json
import math
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, pstdev

import yaml

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DB = ARGS[0] if ARGS else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
BLOCK = re.compile(r"(-- 校正常數開始[^\n]*\n)(.*?)(\n\s*-- 校正常數結束)", re.S)

ROLES = ["射手", "法師", "刺客", "鬥士", "坦克", "輔助"]
ANTI_HEAL = {3033, 3075, 3076, 3123, 3165, 3916, 6609, 223033, 223075, 223165, 226609, 323075, 773075, 773123, 773165}
ANTI_SHIELD = {6695, 226695}
SUP_ITEMS = {6617, 4005, 2530, 3504, 6621, 3107, 6616, 3222, 6620, 2065, 2526, 124011, 123430, 3190}
ALPHA = {"d": 0.60, "mit": 0.75, "tak": 0.60, "w": 1.00, "o": 0.25, "c": 0.0, "cc_dur": 0.0, "k": 0.0, "ka": -0.20, "late_ka": -0.25}


def percentile(vals: list[float], q: float) -> float:
    """線性內插百分位數（與 numpy.percentile method='linear' 一致）。"""
    s = sorted(vals)
    n = len(s)
    if n == 1:
        return float(s[0])
    pos = (q / 100.0) * (n - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(s[lo])
    frac = pos - lo
    return float(s[lo] + frac * (s[hi] - s[lo]))


def med_iqr(vals: list[float]) -> tuple[float, float]:
    return percentile(vals, 50.0), percentile(vals, 75.0) - percentile(vals, 25.0)


def spow(x: float, med: float, scale: float, p: float = 0.84, lo: float = -3.2, hi: float = 4.0) -> float:
    d = (x - med) / scale
    sgn = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
    v = sgn * (abs(d) ** p)
    return min(hi, max(lo, v))


def clip(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def load_rows(db_path: str) -> list[dict]:
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    builds = yaml.safe_load(YML.with_name("builds.yml").read_text(encoding="utf-8"))
    comp_ctx = yaml.safe_load(YML.with_name("comp_context.yml").read_text(encoding="utf-8"))
    c.execute("BEGIN")
    c.execute(f"CREATE TEMP TABLE mat_builds AS {builds['cubes'][0]['meta']['materialize']['sql']}")
    c.execute(f"CREATE TEMP TABLE mat_comp_context AS {comp_ctx['cubes'][0]['meta']['materialize']['sql']}")

    items: dict[tuple[str, int, int], set[int]] = defaultdict(set)
    sup_counts: dict[tuple[str, int, int], int] = defaultdict(int)
    for pl, gid, pid, iid in c.execute(
        "SELECT platform_id, game_id, participant_id, item_id FROM participant_items WHERE slot < 6 AND item_id > 0"
    ):
        items[(pl, gid, pid)].add(iid)
        if iid in SUP_ITEMS:
            sup_counts[(pl, gid, pid)] += 1

    eog = {
        (gid, pu): (float(h), float(s))
        for gid, pu, h, s in c.execute(
            "SELECT game_id, puuid, heal_on_teammates, shield_on_teammates FROM eog_player_stats "
            "WHERE heal_on_teammates IS NOT NULL AND shield_on_teammates IS NOT NULL"
        )
    }

    raw_rows = [
        dict(r)
        for r in c.execute(
            """
            WITH scored AS (
              SELECT mp.rowid AS rid, mp.platform_id, mp.game_id, mp.participant_id, mp.puuid,
                     mp.team_id, mp.champion_id, mp.win, m.queue_id, m.is_remake, m.game_duration,
                     COALESCE(b.build_role, '未成形') AS build_role,
                     COALESCE(cc.enemy_front, 2) AS enemy_front,
                     mp.dmg_to_champions, mp.total_damage,
                     COALESCE(mp.turret_dmg, mp.dmg_to_objectives) AS turret_dmg,
                     mp.dmg_to_objectives,
                     mp.dmg_taken, mp.dmg_mitigated, mp.time_ccing_others,
                     COALESCE(mp.cc_duration, mp.time_ccing_others, 0) AS cc_duration,
                     mp.kills, mp.deaths, mp.assists, mp.total_heal, mp.units_healed,
                     COALESCE(mp.gold_earned, 0) AS gold_earned,
                     COALESCE(mp.double_kills, 0) AS double_kills,
                     COALESCE(mp.triple_kills, 0) AS triple_kills,
                     COALESCE(mp.quadra_kills, 0) AS quadra_kills,
                     COALESCE(mp.penta_kills, 0) AS penta_kills,
                     e.heal_on_teammates AS eog_h, e.shield_on_teammates AS eog_s,
                     COUNT(*) OVER (PARTITION BY mp.platform_id, mp.game_id) AS n_p,
                     SUM(CASE WHEN mp.team_id = 100 THEN 1 ELSE 0 END) OVER (PARTITION BY mp.platform_id, mp.game_id) AS n_t100,
                     COUNT(mp.dmg_to_champions) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_d,
                     COUNT(mp.dmg_taken) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_t,
                     COUNT(mp.time_ccing_others) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_c,
                     COUNT(mp.total_damage) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_tot,
                     COUNT(COALESCE(mp.turret_dmg, mp.dmg_to_objectives)) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_o,
                     COUNT(mp.kills) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_k,
                     COUNT(mp.assists) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_a,
                     COUNT(mp.deaths) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_death,
                     COUNT(mp.total_heal) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_h,
                     COUNT(mp.units_healed) OVER (PARTITION BY mp.platform_id, mp.game_id) AS c_uh
              FROM match_participants mp
              JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
              LEFT JOIN mat_builds b ON b.participant_rowid = mp.rowid
              LEFT JOIN mat_comp_context cc ON cc.participant_rowid = mp.rowid
              LEFT JOIN eog_player_stats e ON e.game_id = mp.game_id AND e.puuid = mp.puuid
            )
            SELECT * FROM scored
            WHERE queue_id = 2400 AND is_remake = 0 AND game_duration >= 360
              AND n_p = 10 AND n_t100 = 5
              AND c_d = 10 AND c_t = 10 AND c_c = 10 AND c_tot = 10 AND c_o = 10
              AND c_k = 10 AND c_a = 10 AND c_death = 10 AND c_h = 10
              AND (c_h = 10 AND (SELECT 1) IS NOT NULL)
            """
        )
    ]
    ke_by_game: dict[tuple[str, int], list[tuple[int, int, int, list[int]]]] = defaultdict(list)
    for pl, gid, tms, kid, vid, aids in c.execute(
        "SELECT platform_id, game_id, time_ms, killer_id, victim_id, assist_ids "
        "FROM match_kill_events ORDER BY platform_id, game_id, time_ms, event_index"
    ):
        ke_by_game[(pl, gid)].append((tms, kid, vid, json.loads(aids) if aids else []))
    be_solo_by_game: dict[tuple[str, int, int], int] = defaultdict(int)
    for pl, gid, kid, aids in c.execute(
        "SELECT platform_id, game_id, killer_id, assist_ids FROM match_building_events "
        "WHERE killer_id IS NOT NULL AND killer_id > 0"
    ):
        if not (json.loads(aids) if aids else []):
            be_solo_by_game[(pl, gid, kid)] += 1
    c.close()

    games: dict[tuple[str, int], dict[int, dict]] = defaultdict(dict)
    for r in raw_rows:
        games[(r["platform_id"], r["game_id"])][r["participant_id"]] = r

    out: list[dict] = []
    for (pl, gid), pmap in games.items():
        if len(pmap) != 10:
            continue
        ps = list(pmap.values())
        has_eog = all((gid, p["puuid"]) in eog for p in ps)
        has_flag = all(p["units_healed"] is not None for p in ps)
        if not has_eog and not has_flag:
            continue
        mins = ps[0]["game_duration"] / 60.0
        fac = mins / 16.5
        late_cut = 0.65 * ps[0]["game_duration"] * 1000.0
        evs = ke_by_game.get((pl, gid), [])
        for p in ps:
            p["has_eog"] = has_eog
            p["mins"] = mins
            p["fac"] = fac
            p["ke_solo"] = 0
            p["ke_late_ka"] = 0
            p["ke_iso_death"] = 0
            p["ke_late_iso_death"] = 0
            p["ke_trade_death"] = 0
            p["ke_solo_tur"] = be_solo_by_game.get((pl, gid, p["participant_id"]), 0)
            p["n_sup_items"] = sup_counts.get((pl, gid, p["participant_id"]), 0)
            p["x_d"] = p["dmg_to_champions"] / mins
            p["x_w"] = max(0, p["total_damage"] - p["dmg_to_champions"] - p["dmg_to_objectives"]) / mins
            p["x_o"] = p["turret_dmg"] / mins
            p["x_c"] = p["time_ccing_others"] / mins
            p["x_cc_dur"] = p["cc_duration"] / mins
            p["x_k"] = p["kills"] / mins
            p["x_ka"] = (p["kills"] + p["assists"]) / mins
            p["x_death"] = p["deaths"] / mins
            p["h_flag"] = (p["total_heal"] / mins) if (p["units_healed"] or 0) >= 2 else 0.0
            if has_eog:
                h, s = eog[(gid, p["puuid"])]
                p["x_h"] = (h + s) / mins
                p["_shield"] = s / mins
            else:
                p["x_h"] = p["h_flag"]
                p["_shield"] = 0.0
            own = items.get((pl, gid, p["participant_id"]), set())
            p["_ah"] = bool(own & ANTI_HEAL)
            p["_ash"] = bool(own & ANTI_SHIELD)

        for idx, (tms, kid, vid, aids) in enumerate(evs):
            killer = pmap.get(kid)
            victim = pmap.get(vid)
            if killer and victim:
                if not aids:
                    killer["ke_solo"] += 1
                if tms >= late_cut:
                    killer["ke_late_ka"] += 1
                    for aid in aids:
                        if aid in pmap:
                            pmap[aid]["ke_late_ka"] += 1
            if victim:
                vteam = victim["team_id"]
                ally_kills_near = 0
                vteam_deaths_near = 0
                for t2, k2, v2, _ in evs:
                    if abs(t2 - tms) <= 10000:
                        kp2 = pmap.get(k2)
                        if kp2 and kp2["team_id"] == vteam:
                            ally_kills_near += 1
                        vp2 = pmap.get(v2)
                        if vp2 and vp2["team_id"] == vteam:
                            vteam_deaths_near += 1
                if ally_kills_near == 0 and vteam_deaths_near == 1:
                    victim["ke_iso_death"] += 1
                    if tms >= late_cut:
                        victim["ke_late_iso_death"] += 1
                elif ally_kills_near >= 2:
                    victim["ke_trade_death"] += 1

        team_kills = {tid: sum(p["kills"] for p in ps if p["team_id"] == tid) for tid in (100, 200)}
        sum_xk = sum(p["x_k"] for p in ps)
        for p in ps:
            tk = team_kills[p["team_id"]]
            p["x_kp"] = (p["kills"] + p["assists"]) / tk if tk > 0 else 0.0
            team = [q for q in ps if q["team_id"] == p["team_id"]]
            foe = [q for q in ps if q["team_id"] != p["team_id"]]
            foe_heal = sum(q["total_heal"] for q in foe) / mins
            foe_shield = sum(q["_shield"] for q in foe)
            n_ah = sum(q["_ah"] for q in team)
            n_ash = sum(q["_ash"] for q in team)
            p["adj_anti"] = (0.4 * foe_heal / n_ah if p["_ah"] else 0.0) + (0.4 * foe_shield / n_ash if p["_ash"] else 0.0)

            e_k_pm = (sum_xk - p["x_k"]) / 9.0
            pace_k = clip((e_k_pm / (fac ** ALPHA["ka"])) / 0.625, 0.75, 1.30)
            ef_c = clip(p["enemy_front"] - 2, -2, 2)
            p["adj_d"] = (p["x_d"] / (fac ** ALPHA["d"])) / ((1.0 + 0.115 * ef_c) * (pace_k ** 0.28))
            p["adj_mit"] = (p["dmg_mitigated"] / mins) / (fac ** ALPHA["mit"])
            p["adj_tak"] = (p["dmg_taken"] / mins) / (fac ** ALPHA["tak"])
            p["eff_t"] = 0.62 * p["adj_mit"] + 0.38 * p["adj_tak"]
            p["adj_w"] = p["x_w"] / (fac ** ALPHA["w"])
            p["adj_o"] = p["x_o"] / (fac ** ALPHA["o"])
            p["adj_c"] = p["x_c"]
            p["adj_cc_dur"] = p["x_cc_dur"]
            p["adj_k"] = p["x_k"]
            p["adj_ka"] = (p["x_ka"] / (fac ** ALPHA["ka"])) / ((1.0 + 0.052 * ef_c) * (pace_k ** 0.60))
            p["adj_late_ka"] = ((p["ke_late_ka"] / mins) / (fac ** ALPHA["late_ka"])) / ((1.0 + 0.052 * ef_c) * (pace_k ** 0.60))
            p["adj_iso_d"] = p["ke_iso_death"] / mins
            p["iso_ratio"] = p["ke_iso_death"] / max(p["deaths"], 1)
            gold = max(p["gold_earned"], 1)
            p["adj_d_per_g"] = (p["dmg_to_champions"] / gold) / (fac ** 0.50)
            p["multi_raw"] = p["double_kills"] + 2.5 * p["triple_kills"] + 4.5 * p["quadra_kills"] + 7.5 * p["penta_kills"]

        sum_kp = sum(p["x_kp"] for p in ps)
        sum_death = sum(p["x_death"] for p in ps)
        for p in ps:
            e_kp = (sum_kp - p["x_kp"]) / 9.0
            e_death = (sum_death - p["x_death"]) / 9.0
            p_k = 0.0 if p["x_kp"] == 0 else (100.0 if e_kp == 0 else 100.0 * p["x_kp"] / (p["x_kp"] + e_kp))
            p_s = 100.0 if p["x_death"] == 0 else (0.0 if e_death == 0 else 100.0 * e_death / (p["x_death"] + e_death))
            p["p_kda"] = (p_k + p_s) / 2.0
        out.extend(ps)
    return out


def format_block(
    r_med: dict,
    r_iqr: dict,
    g_med: dict,
    g_iqr: dict,
    champ_sh: dict[int, tuple[int, float]],
    c_glob: dict,
) -> str:
    role_rows = []
    for ro in ROLES + ["未成形"]:
        m, iq = r_med[ro], r_iqr[ro]
        vals = [
            m["d"], iq["d"],
            m["eff_t"], iq["eff_t"],
            m["c"], iq["c"],
            m["cc_dur"], iq["cc_dur"],
            m["w"], iq["w"],
            m["o"], iq["o"],
            m["k"], iq["k"],
            m["ka"], iq["ka"],
            m["multi"],
            m["iso_d"],
            m["p_kda"],
        ]
        role_rows.append(f"              ('{ro}', " + ", ".join(f"{v:.6f}" for v in vals) + ")")
    sh_rows = ["              (0, 0, 0.000000)"] + [
        f"              ({cid}, {n_sup}, {sum_sh:.6f})"
        for cid, (n_sup, sum_sh) in sorted(champ_sh.items())
    ]
    g_vals = [
        c_glob["h_scale"], c_glob["h_sup_med"], c_glob["h_sup_iqr"],
        g_med["d"], g_iqr["d"],
        g_med["eff_t"], g_iqr["eff_t"],
        g_med["w"], g_iqr["w"],
        g_med["o"], g_iqr["o"],
        g_med["c"], g_iqr["c"],
        g_med["cc_dur"], g_iqr["cc_dur"],
        g_med["k"], g_iqr["k"],
        g_med["ka"], g_iqr["ka"],
        g_med["late_ka"], g_iqr["late_ka"],
        g_med["d_per_g"], g_iqr["d_per_g"],
        g_med["imp_per_g"], g_iqr["imp_per_g"],
        c_glob["core_sd"], c_glob["g_mean_eog"], c_glob["g_mean_est"], c_glob["sd_p_kda"],
    ]
    return (
        "          calib_role(\n"
        "            build_role, med_d, iqr_d, med_t, iqr_t, med_c, iqr_c, med_ccdur, iqr_ccdur,\n"
        "            med_w, iqr_w, med_o, iqr_o, med_k, iqr_k, med_ka, iqr_ka, med_multi, med_isod, med_p_kda\n"
        "          ) AS (\n"
        "            VALUES\n"
        + ",\n".join(role_rows)
        + "\n          ),\n"
        "          calib_champ_shield(champion_id, n_sup, sum_sh_pm) AS (\n"
        "            VALUES\n"
        + ",\n".join(sh_rows)
        + "\n          ),\n"
        "          calib_global(\n"
        "            h_scale, h_sup_med, h_sup_iqr,\n"
        "            med_d, iqr_d, med_t, iqr_t, med_w, iqr_w, med_o, iqr_o, med_c, iqr_c, med_ccdur, iqr_ccdur,\n"
        "            med_k, iqr_k, med_ka, iqr_ka, med_lka, iqr_lka, med_dpg, iqr_dpg, med_ipg, iqr_ipg,\n"
        "            core_sd, g_mean_eog, g_mean_est, sd_p_kda\n"
        "          ) AS (\n"
        "            VALUES (" + ", ".join(f"{v:.6f}" for v in g_vals) + ")"
    )


def main() -> None:
    rows = load_rows(DB)
    n_eog = sum(1 for r in rows if r["has_eog"])
    print(f"{len(rows)} 人次（eog {n_eog}、flag {len(rows) - n_eog}）")

    heal_ratios = [
        r["eog_h"] / r["total_heal"]
        for r in rows
        if r["has_eog"] and r["build_role"] == "輔助" and (r["units_healed"] or 0) >= 2 and r["total_heal"] > 0
    ]
    h_scale = percentile(heal_ratios, 50.0)

    sh_acc: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        if r["has_eog"] and r["build_role"] == "輔助":
            sh_acc[int(r["champion_id"])].append(max(0.0, r["x_h"] - h_scale * r["h_flag"]))
    champ_sh = {cid: (len(vals), sum(vals)) for cid, vals in sh_acc.items()}

    g_extract = {
        "d": lambda r: r["adj_d"],
        "eff_t": lambda r: r["eff_t"],
        "w": lambda r: r["adj_w"],
        "o": lambda r: r["adj_o"] if r["adj_o"] > 0 else None,
        "c": lambda r: r["adj_c"],
        "cc_dur": lambda r: r["adj_cc_dur"],
        "k": lambda r: r["adj_k"],
        "ka": lambda r: r["adj_ka"],
        "late_ka": lambda r: r["adj_late_ka"],
        "d_per_g": lambda r: r["adj_d_per_g"],
    }
    g_med, g_iqr = {}, {}
    for k, fn in g_extract.items():
        vals = [v for r in rows if (v := fn(r)) is not None]
        m, iq = med_iqr(vals)
        g_med[k] = m
        g_iqr[k] = max(iq, 1e-6)

    g_multi_med = percentile([r["multi_raw"] for r in rows], 50.0)
    g_isod_med = percentile([r["adj_iso_d"] for r in rows], 50.0)
    g_pkda_mean = mean(r["p_kda"] for r in rows)

    r_extract = {
        **{k: g_extract[k] for k in ("d", "eff_t", "w", "o", "c", "cc_dur", "k", "ka")},
        "multi": lambda r: r["multi_raw"],
        "iso_d": lambda r: r["adj_iso_d"],
    }
    r_med: dict[str, dict[str, float]] = {}
    r_iqr: dict[str, dict[str, float]] = {}
    for ro in ROLES:
        grp = [r for r in rows if r["build_role"] == ro]
        r_med[ro], r_iqr[ro] = {}, {}
        for k, fn in r_extract.items():
            vals = [v for r in grp if (v := fn(r)) is not None]
            g_base_m = g_med.get(k, 0.0)
            g_base_iq = g_iqr.get(k, 1.0)
            if vals:
                m, iq = med_iqr(vals)
            else:
                m, iq = g_base_m, g_base_iq
            r_med[ro][k] = m
            r_iqr[ro][k] = max(iq if len(vals) > 20 else g_base_iq, 0.65 * g_base_iq)
        r_med[ro]["p_kda"] = mean(r["p_kda"] for r in grp) if grp else g_pkda_mean

    r_med["未成形"] = {
        **{k: g_med[k] for k in ("d", "eff_t", "w", "o", "c", "cc_dur", "k", "ka")},
        "multi": g_multi_med,
        "iso_d": g_isod_med,
        "p_kda": g_pkda_mean,
    }
    r_iqr["未成形"] = {k: g_iqr[k] for k in ("d", "eff_t", "w", "o", "c", "cc_dur", "k", "ka")}

    sup_ka_med = r_med["輔助"]["ka"]
    for r in rows:
        if r["has_eog"]:
            r["h_aligned"] = r["x_h"]
        elif r["build_role"] == "輔助":
            base_h = h_scale * r["x_h"]
            item_def = max(0.0, 240.0 * min(3, r["n_sup_items"]) - 0.25 * base_h)
            n_sup, sum_sh = champ_sh.get(int(r["champion_id"]), (0, 0.0))
            sh_prior = (sum_sh + 1.5 * item_def) / (n_sup + 1.5)
            ka_act = clip(0.20 + 0.80 * (r["adj_ka"] / sup_ka_med), 0.45, 1.25)
            r["h_aligned"] = base_h + sh_prior * ka_act
        else:
            r["h_aligned"] = h_scale * r["x_h"]

        gold = max(r["gold_earned"], 1)
        h_imp = r["h_aligned"] if (r["has_eog"] or r["build_role"] == "輔助") else 0.0
        r["adj_imp_per_g"] = (
            1000.0 * (r["dmg_to_champions"] + 0.25 * (r["dmg_taken"] + r["dmg_mitigated"]) + 1.80 * h_imp * r["mins"] + 110.0 * r["adj_c"] * r["mins"]) / gold
        ) / (r["fac"] ** 0.55)

    m_ipg, iq_ipg = med_iqr([r["adj_imp_per_g"] for r in rows])
    g_med["imp_per_g"] = m_ipg
    g_iqr["imp_per_g"] = max(iq_ipg, 1e-6)

    sup_h = [r["h_aligned"] for r in rows if r["build_role"] == "輔助"]
    h_sup_med, h_sup_iqr = med_iqr(sup_h)
    h_sup_iqr = max(h_sup_iqr, 100.0)

    sd_p_kda = pstdev(r["p_kda"] - r_med[r["build_role"]]["p_kda"] for r in rows)

    core_list, bonus_list, pen_list = [], [], []
    for r in rows:
        ro = r["build_role"]
        zr_d = spow(r["adj_d"], r_med[ro]["d"], r_iqr[ro]["d"])
        zr_t = spow(r["eff_t"], r_med[ro]["eff_t"], r_iqr[ro]["eff_t"])
        zr_c = spow(r["adj_c"], r_med[ro]["c"], r_iqr[ro]["c"])
        zr_ccdur = spow(r["adj_cc_dur"], r_med[ro]["cc_dur"], r_iqr[ro]["cc_dur"])
        zr_cc = 0.65 * zr_c + 0.35 * max(zr_c, zr_ccdur)
        zr_w = spow(r["adj_w"], r_med[ro]["w"], r_iqr[ro]["w"], lo=-2.0, hi=2.5)
        zr_o = spow(r["adj_o"], r_med[ro]["o"], r_iqr[ro]["o"], lo=-1.4, hi=2.8)
        zr_k = spow(r["adj_k"], r_med[ro]["k"], r_iqr[ro]["k"])
        zr_ka = spow(r["adj_ka"], r_med[ro]["ka"], r_iqr[ro]["ka"])

        zg_d = spow(r["adj_d"], g_med["d"], g_iqr["d"])
        zg_t = spow(r["eff_t"], g_med["eff_t"], g_iqr["eff_t"])
        zg_ka = spow(r["adj_ka"], g_med["ka"], g_iqr["ka"])
        zg_lka = spow(r["adj_late_ka"], g_med["late_ka"], g_iqr["late_ka"])
        zg_o = spow(r["adj_o"], g_med["o"], g_iqr["o"], lo=-1.4, hi=2.8)

        zh_sup = spow(r["h_aligned"], h_sup_med, h_sup_iqr, lo=-1.8, hi=3.6)
        k_eff = min(zr_k, zr_d + 0.40)
        d_mix = 0.70 * zr_d + 0.30 * zg_d
        o_mix = 0.40 * zr_o + 0.60 * zg_o
        t_mix = 0.85 * zr_t + 0.15 * zg_t
        ka_mix = (0.70 * zr_ka + 0.30 * zg_ka) if ro == "輔助" else zg_ka

        if ro == "射手":
            cc_pos = 0.05 * (zr_cc - 0.35) if zr_cc > 0.35 else 0.0
            core_d = 0.40 * d_mix + 0.04 * max(0.0, d_mix - 0.45)
            core = core_d + 0.15 * k_eff + 0.17 * ka_mix + 0.12 * zg_lka + 0.10 * o_mix + 0.06 * zr_w + cc_pos
        elif ro == "刺客":
            cc_pos = 0.05 * (zr_cc - 0.35) if zr_cc > 0.35 else 0.0
            core_d = 0.41 * d_mix + 0.04 * max(0.0, d_mix - 0.45)
            core = core_d + 0.17 * k_eff + 0.17 * ka_mix + 0.12 * zg_lka + 0.10 * o_mix + 0.03 * zr_w + cc_pos
        elif ro == "法師":
            core_d = 0.38 * d_mix + 0.05 * max(0.0, d_mix - 0.40)
            c_eff_mage = max(zr_cc, min(0.0, -0.90 + 0.90 * (d_mix - 0.20))) if d_mix > 0.20 else zr_cc
            core = core_d + 0.13 * k_eff + 0.16 * ka_mix + 0.12 * zg_lka + 0.08 * o_mix + 0.05 * zr_w + 0.08 * c_eff_mage
        elif ro == "鬥士":
            core_d = 0.28 * d_mix + 0.12 * max(0.0, d_mix - 0.30)
            t_eff_bruiser = max(t_mix, min(0.0, -0.85 + 0.90 * (d_mix - 0.20))) if d_mix > 0.20 else t_mix
            core_ks = 0.11 * k_eff + 0.04 * max(0.0, k_eff - 0.30)
            c_eff_bruiser = max(zr_cc, min(0.0, -0.90 + 0.85 * max(0.0, d_mix - 0.20) + 0.35 * max(0.0, t_mix - 0.25))) if (d_mix > 0.20 or t_mix > 0.25) else zr_cc
            core = core_d + 0.20 * t_eff_bruiser + core_ks + 0.16 * ka_mix + 0.11 * zg_lka + 0.07 * o_mix + 0.07 * c_eff_bruiser
        elif ro == "坦克":
            core_d = 0.10 * zr_d + 0.18 * max(0.0, zr_d - 0.45) + 0.10 * max(0.0, zg_d - 0.20)
            t_eff_tank = max(t_mix, min(0.0, -0.85 + 0.85 * (zr_d - 0.35))) if zr_d > 0.35 else t_mix
            core_ks = 0.10 * max(0.0, k_eff - 0.30)
            c_eff_tank = max(zr_cc, min(0.0, -1.05 + 0.90 * max(0.0, zr_d - 0.30) + 0.30 * max(0.0, zr_t - 0.35))) if (zr_d > 0.30 or zr_t > 0.35) else zr_cc
            core = 0.30 * t_eff_tank + 0.20 * c_eff_tank + 0.19 * ka_mix + 0.13 * zg_lka + core_d + core_ks + 0.08 * o_mix
        elif ro == "輔助":
            tank_w = clip((r["eff_t"] - 1350.0) / 2100.0, 0.0, 0.65)
            c_eff_sup = max(-0.45, zr_cc, min(0.0, -0.45 + 0.45 * max(0.0, zr_d - 0.45)))
            core_d = 0.12 * max(-0.35, zr_d) + 0.16 * max(0.0, zr_d - 0.55) + 0.12 * max(0.0, zg_d + 0.35)
            core_ks = 0.09 * max(0.0, k_eff - 0.35)
            util_alt = max(0.0, zr_cc - 0.20) + 0.80 * max(0.0, zr_d - 0.20) + 0.55 * max(0.0, zr_d - 0.65)
            zh_floor = -1.15 + 0.65 * tank_w + 0.45 * min(2.0, util_alt)
            zh_eff = (max(zh_sup, zh_floor) if (tank_w > 0.0 or util_alt > 0.0) else zh_sup) + 0.10 * max(0.0, zh_sup - 0.35)
            if r["has_eog"]:
                core = 0.40 * (1.0 - tank_w) * zh_eff + 0.42 * tank_w * zr_t + 0.22 * ka_mix + 0.10 * zg_lka + core_d + core_ks + 0.10 * c_eff_sup + 0.06 * o_mix
            else:
                core = (
                    0.34 * (1.0 - tank_w) * zh_eff
                    + 0.42 * tank_w * zr_t
                    + (0.22 + 0.04 * (1.0 - tank_w)) * ka_mix
                    + 0.10 * zg_lka
                    + core_d
                    + core_ks
                    + (0.10 + 0.02 * (1.0 - tank_w)) * c_eff_sup
                    + 0.06 * o_mix
                )
        else:
            core_d = 0.28 * d_mix + 0.10 * max(0.0, d_mix - 0.35)
            core = core_d + 0.18 * t_mix + 0.11 * k_eff + 0.16 * ka_mix + 0.11 * zg_lka + 0.08 * o_mix + 0.08 * zr_cc
        core_list.append(core)

        mk = r["double_kills"] + 2.5 * r["triple_kills"] + 4.5 * r["quadra_kills"] + 7.5 * r["penta_kills"]
        mk_ex = max(0.0, mk - (r_med[ro]["multi"] + 1.5))
        sup_streak = (
            1.8 * max(0.0, ka_mix - 0.50) + 1.5 * max(0.0, max(zh_sup, zr_cc, zr_t) - 0.55)
            if ro == "輔助"
            else 0.0
        )
        b_multi = min(4.5, 1.5 * math.sqrt(mk_ex) + sup_streak)

        b_tur = min(3.5, 1.8 * max(0.0, zr_o - 0.50) + (3.0 if r["ke_solo_tur"] >= 2 else (2.0 if r["ke_solo_tur"] == 1 else 0.0)))

        trade_edge = max(0, r["ke_trade_death"] - r["ke_iso_death"] - 1)
        sup_fight = (
            1.2 * max(0.0, zg_lka - 0.35) + 0.9 * max(0.0, min(ka_mix, max(zh_sup, zr_cc, zr_t)) - 0.25)
            if ro == "輔助"
            else 0.0
        )
        b_fight = min(3.5, 1.2 * math.sqrt(trade_edge) + 0.9 * min(2, r["ke_solo"]) + sup_fight)

        eff_z = (
            ((r["adj_d_per_g"] - g_med["d_per_g"]) / g_iqr["d_per_g"])
            if ro in ("射手", "法師", "刺客")
            else ((r["adj_imp_per_g"] - g_med["imp_per_g"]) / g_iqr["imp_per_g"])
        )
        b_eff = min(3.5, 3.0 * max(0.0, eff_z - 0.50))

        b_util = min(2.5, 2.2 * min(1.2, r["adj_anti"] / 630.0) if r["adj_anti"] > 200 else 0.0)
        if ro == "坦克" and zr_d > 0.45:
            b_util += min(4.0, 2.6 * (zr_d - 0.45))
        elif ro == "輔助" and zr_d > 0.45:
            b_util += min(3.5, 2.4 * (zr_d - 0.45))
        elif ro == "鬥士" and zr_d > 0.60:
            b_util += min(2.5, 2.0 * (zr_d - 0.60))
        if ro not in ("坦克", "輔助") and r["has_eog"] and r["h_aligned"] > 500:
            b_util += min(2.0, (r["h_aligned"] - 500.0) / 500.0)
        if ro in ("射手", "刺客", "法師", "鬥士", "輔助") and zr_cc > 0.65:
            b_util += min(2.5, 2.0 * (zr_cc - 0.65))
        bonus_list.append(min(15.0, b_multi + b_tur + b_fight + b_eff + b_util))

        iso_thresh = max(0.09, r_med[ro]["iso_d"] + 0.03)
        p_iso = 0.0
        if r["adj_iso_d"] > iso_thresh and r["iso_ratio"] > 0.25:
            p_iso = min(7.0, 28.0 * (r["adj_iso_d"] - iso_thresh) * min(1.5, r["iso_ratio"] / 0.35))
        p_late = min(5.0, 2.2 * max(0, r["ke_late_iso_death"] - 1))
        act = max(zr_d, zr_t, zh_sup if ro == "輔助" else -1.0)
        p_ghost = min(8.0, 6.5 * max(0.0, -0.75 - act) + 4.5 * max(0.0, -0.80 - ka_mix))
        pen_list.append(min(18.0, p_iso + p_late + p_ghost))

    core_sd = pstdev(core_list)
    raw_final = []
    for c_val, bo, pe in zip(core_list, bonus_list, pen_list):
        c_pts = 20.0 * c_val / core_sd
        if c_pts > 15.0:
            c_pts = 15.0 + 1.18 * (c_pts - 15.0)
        raw_final.append(c_pts + bo - pe)

    g_mean_eog = mean(rf for r, rf in zip(rows, raw_final) if r["has_eog"])
    g_mean_est = mean(rf for r, rf in zip(rows, raw_final) if not r["has_eog"])

    c_glob = {
        "h_scale": h_scale,
        "h_sup_med": h_sup_med,
        "h_sup_iqr": h_sup_iqr,
        "core_sd": core_sd,
        "g_mean_eog": g_mean_eog,
        "g_mean_est": g_mean_est,
        "sd_p_kda": sd_p_kda,
    }
    new_block = format_block(r_med, r_iqr, g_med, g_iqr, champ_sh, c_glob)
    print(f"H_SCALE={h_scale:.6f}, CORE_SD={core_sd:.6f}, G_MEAN_EOG={g_mean_eog:.6f}, G_MEAN_EST={g_mean_est:.6f}")

    scores = [
        clip(50.0 + rf - (g_mean_eog if r["has_eog"] else g_mean_est), 0.0, 100.0)
        for r, rf in zip(rows, raw_final)
    ]
    print(
        "各出裝平均：",
        {ro: round(mean(s for s, r in zip(scores, rows) if r["build_role"] == ro), 2) for ro in ROLES},
    )
    print(
        f"總分平均 {mean(scores):.2f} 標準差 {pstdev(scores):.2f} "
        f"0 分 {scores.count(0.0)} 100 分 {scores.count(100.0)}"
    )

    if "--write" in sys.argv:
        text = YML.read_text(encoding="utf-8")
        out = BLOCK.sub(lambda m: m.group(1) + new_block + m.group(3), text)
        assert out != text or new_block in text, "找不到校正常數區塊"
        YML.write_text(out, encoding="utf-8")
        print("已寫回", YML)
    else:
        print(new_block)


if __name__ == "__main__":
    main()
