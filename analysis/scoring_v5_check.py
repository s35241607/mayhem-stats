"""獨立用 Python 重算一次本場貢獻 v5.4（v5-B 修訂版），拿去跟 mayhem.db 的 mat_contribution 逐筆核對（不重跑 SQL）。
讀入 yml 裡定死的校正常數（calib_role / calib_champ_shield / calib_global），確認 SQLite materialized 結果與獨立實作完全一致、且各項加減分加總無誤差。

用法：uv run python analysis/scoring_v5_check.py [mayhem.db]
"""
import json
import math
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import variance

DB = sys.argv[1] if len(sys.argv) > 1 else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"

ANTI_HEAL = {3033, 3075, 3076, 3123, 3165, 3916, 6609, 223033, 223075, 223165, 226609, 323075, 773075, 773123, 773165}
ANTI_SHIELD = {6695, 226695}
SUP_ITEMS = {6617, 4005, 2530, 3504, 6621, 3107, 6616, 3222, 6620, 2065, 2526, 124011, 123430, 3190}
ALPHA = {"d": 0.60, "mit": 0.75, "tak": 0.60, "w": 1.00, "o": 0.25, "ka": -0.20, "late_ka": -0.25}
ROLE_COLS = [
    "med_d", "iqr_d", "med_t", "iqr_t", "med_c", "iqr_c", "med_ccdur", "iqr_ccdur",
    "med_w", "iqr_w", "med_o", "iqr_o", "med_k", "iqr_k", "med_ka", "iqr_ka",
    "med_multi", "med_isod", "med_p_kda",
]
GLOB_COLS = [
    "h_scale", "h_sup_med", "h_sup_iqr",
    "med_d", "iqr_d", "med_t", "iqr_t", "med_w", "iqr_w", "med_o", "iqr_o",
    "med_c", "iqr_c", "med_ccdur", "iqr_ccdur", "med_k", "iqr_k", "med_ka", "iqr_ka",
    "med_lka", "iqr_lka", "med_dpg", "iqr_dpg", "med_ipg", "iqr_ipg",
    "core_sd", "g_mean_eog", "g_mean_est", "sd_p_kda",
]


def clip(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def spow(x: float, med: float, scale: float, p: float = 0.84, lo: float = -3.2, hi: float = 4.0) -> float:
    d = (x - med) / scale
    sgn = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
    return clip(sgn * (abs(d) ** p), lo, hi)


def parse_constants() -> tuple[dict[str, dict[str, float]], dict[int, tuple[int, float]], dict[str, float]]:
    text = YML.read_text(encoding="utf-8")
    role_rows = re.findall(r"\('([^']+)',\s*([-\d., ]+)\)", text)
    assert role_rows, "找不到 calib_role 常數"
    calib_role = {}
    for name, nums in role_rows:
        vals = [float(x) for x in nums.split(",")]
        assert len(vals) == len(ROLE_COLS), f"{name} 常數數量不符: {len(vals)}"
        calib_role[name] = dict(zip(ROLE_COLS, vals))

    m_sh = re.search(
        r"calib_champ_shield\([^)]+\)\s*AS\s*\(\s*VALUES\s*(.*?)\s*\),\s*calib_global",
        text,
        re.S,
    )
    assert m_sh, "找不到 calib_champ_shield 常數"
    champ_sh: dict[int, tuple[int, float]] = {}
    for cid_s, n_s, sh_s in re.findall(r"\(\s*(\d+)\s*,\s*(\d+)\s*,\s*([-\d.eE+]+)\s*\)", m_sh.group(1)):
        champ_sh[int(cid_s)] = (int(n_s), float(sh_s))

    m_glob = re.search(
        r"calib_global\([^)]+\)\s*AS\s*\(\s*VALUES\s*\(([-\d., eE+]+)\)\s*-- 校正常數結束",
        text,
        re.S,
    )
    assert m_glob, "找不到 calib_global 常數"
    g_vals = [float(x) for x in m_glob.group(1).split(",")]
    assert len(g_vals) == len(GLOB_COLS), f"calib_global 常數數量不符: {len(g_vals)}"
    calib_global = dict(zip(GLOB_COLS, g_vals))
    return calib_role, champ_sh, calib_global


def main() -> None:
    calib_role, champ_sh, cg = parse_constants()
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row

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

    mp_rows = [
        dict(r)
        for r in c.execute(
            """
            SELECT mp.rowid AS rid, mp.platform_id, mp.game_id, mp.participant_id, mp.puuid,
                   mp.team_id, mp.champion_id, m.queue_id, m.is_remake, m.game_duration,
                   COALESCE(b.build_role, '未成形') AS build_role,
                   COALESCE(cc.enemy_front, 2) AS enemy_front,
                   mp.dmg_to_champions, mp.total_damage,
                   COALESCE(mp.turret_dmg, mp.dmg_to_objectives) AS turret_dmg,
                   mp.dmg_to_objectives,
                   mp.dmg_taken, mp.dmg_mitigated, mp.time_ccing_others,
                   COALESCE(mp.cc_duration, mp.time_ccing_others, 0) AS cc_duration,
                   mp.kills, mp.deaths, mp.assists, mp.total_heal, mp.units_healed,
                   mp.gold_earned,
                   COALESCE(mp.double_kills, 0) AS double_kills,
                   COALESCE(mp.triple_kills, 0) AS triple_kills,
                   COALESCE(mp.quadra_kills, 0) AS quadra_kills,
                   COALESCE(mp.penta_kills, 0) AS penta_kills
            FROM match_participants mp
            JOIN matches m ON m.platform_id = mp.platform_id AND m.game_id = mp.game_id
            LEFT JOIN mat_builds b ON b.participant_rowid = mp.rowid
            LEFT JOIN mat_comp_context cc ON cc.participant_rowid = mp.rowid
            """
        )
    ]

    db_mat = {r["participant_rowid"]: dict(r) for r in c.execute("SELECT * FROM mat_contribution")}
    crew = [dict(r) for r in c.execute("SELECT puuid, riot_id FROM accounts WHERE is_me = 1 OR tracked = 1 ORDER BY is_me DESC, added_at")]
    c.close()

    by_game: dict[tuple[str, int], dict[int, dict]] = defaultdict(dict)
    for r in mp_rows:
        by_game[(r["platform_id"], r["game_id"])][r["participant_id"]] = r

    expected: dict[int, dict] = {}
    for (pl, gid), pmap in by_game.items():
        ps = list(pmap.values())
        g0 = ps[0]
        unscored_reason = None
        if g0["queue_id"] != 2400:
            unscored_reason = "other_queue"
        elif g0["is_remake"] == 1 or g0["game_duration"] < 360:
            unscored_reason = "remake_or_short_game"
        elif len(ps) != 10 or sum(1 for p in ps if p["team_id"] == 100) != 5:
            unscored_reason = "incomplete_5v5"
        elif any(
            p[col] is None
            for p in ps
            for col in ("dmg_to_champions", "dmg_taken", "dmg_mitigated", "time_ccing_others", "total_damage", "turret_dmg", "kills", "assists", "deaths", "total_heal")
        ):
            unscored_reason = "missing_main_axis"

        has_eog = len(ps) == 10 and all((gid, p["puuid"]) in eog for p in ps)
        has_flag = len(ps) == 10 and all(p["units_healed"] is not None for p in ps)
        heal_src = "eog" if has_eog else ("flag" if has_flag else None)
        if unscored_reason is None and heal_src is None:
            unscored_reason = "missing_heal_data"

        if unscored_reason is not None:
            for p in ps:
                expected[p["rid"]] = {
                    "score_version": "v5.4",
                    "score_status": "unscored",
                    "unscored_reason": unscored_reason,
                    "work_score": None,
                    "work_raw": None,
                }
            continue

        mins = g0["game_duration"] / 60.0
        fac = mins / 16.5
        late_cut = 0.65 * g0["game_duration"] * 1000.0
        evs = ke_by_game.get((pl, gid), [])

        for p in ps:
            p["ke_solo"] = 0
            p["ke_late_ka"] = 0
            p["ke_iso_death"] = 0
            p["ke_late_iso_death"] = 0
            p["ke_trade_death"] = 0
            p["ke_solo_tur"] = be_solo_by_game.get((pl, gid, p["participant_id"]), 0)
            p["n_sup_items"] = sup_counts.get((pl, gid, p["participant_id"]), 0)
            p["x_d"] = p["dmg_to_champions"] / mins
            p["x_w"] = max(0.0, p["total_damage"] - p["dmg_to_champions"] - p["dmg_to_objectives"]) / mins
            p["x_o"] = p["turret_dmg"] / mins
            p["x_mit"] = p["dmg_mitigated"] / mins
            p["x_tak"] = p["dmg_taken"] / mins
            p["x_c"] = p["time_ccing_others"] / mins
            p["x_cc_dur"] = p["cc_duration"] / mins
            p["x_k"] = p["kills"] / mins
            p["x_ka"] = (p["kills"] + p["assists"]) / mins
            p["x_death"] = p["deaths"] / mins
            if heal_src == "eog":
                h, s = eog[(gid, p["puuid"])]
                p["x_h"] = (h + s) / mins
                p["_shield"] = s / mins
            else:
                p["x_h"] = (p["total_heal"] / mins) if (p["units_healed"] or 0) >= 2 else 0.0
                p["_shield"] = 0.0
            own = items.get((pl, gid, p["participant_id"]), set())
            p["_ah"] = bool(own & ANTI_HEAL)
            p["_ash"] = bool(own & ANTI_SHIELD)

        for tms, kid, vid, aids in evs:
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
                ally_near = sum(
                    1
                    for t2, k2, _, _ in evs
                    if abs(t2 - tms) <= 10000 and (kp2 := pmap.get(k2)) is not None and kp2["team_id"] == vteam
                )
                vteam_deaths_near = sum(
                    1
                    for t2, _, v2, _ in evs
                    if abs(t2 - tms) <= 10000 and (vp2 := pmap.get(v2)) is not None and vp2["team_id"] == vteam
                )
                if ally_near == 0 and vteam_deaths_near == 1:
                    victim["ke_iso_death"] += 1
                    if tms >= late_cut:
                        victim["ke_late_iso_death"] += 1
                elif ally_near >= 2:
                    victim["ke_trade_death"] += 1

        team_kills = {tid: sum(p["kills"] for p in ps if p["team_id"] == tid) for tid in (100, 200)}
        for p in ps:
            tk = team_kills[p["team_id"]]
            p["x_kp"] = (p["kills"] + p["assists"]) / tk if tk > 0 else 0.0
        sum_kp = sum(p["x_kp"] for p in ps)
        sum_death = sum(p["x_death"] for p in ps)
        sum_xk = sum(p["x_k"] for p in ps)

        for p in ps:
            ro = p["build_role"]
            cr = calib_role[ro]
            team = [q for q in ps if q["team_id"] == p["team_id"]]
            foe = [q for q in ps if q["team_id"] != p["team_id"]]
            foe_heal = sum(q["total_heal"] for q in foe) / mins
            foe_shield = sum(q["_shield"] for q in foe)
            n_ah = sum(q["_ah"] for q in team)
            n_ash = sum(q["_ash"] for q in team)
            x_a = (0.4 * foe_heal / n_ah if p["_ah"] else 0.0) + (0.4 * foe_shield / n_ash if p["_ash"] else 0.0)

            e_kp = (sum_kp - p["x_kp"]) / 9.0
            e_death = (sum_death - p["x_death"]) / 9.0
            p_k = 0.0 if p["x_kp"] == 0 else (100.0 if e_kp == 0 else 100.0 * p["x_kp"] / (p["x_kp"] + e_kp))
            p_s = 100.0 if p["x_death"] == 0 else (0.0 if e_death == 0 else 100.0 * e_death / (p["x_death"] + e_death))
            p_kda = (p_k + p_s) / 2.0

            e_k_pm = (sum_xk - p["x_k"]) / 9.0
            pace_k = clip((e_k_pm / (fac ** ALPHA["ka"])) / 0.625, 0.75, 1.30)
            ef_c = clip(p["enemy_front"] - 2, -2, 2)
            adj_d = (p["x_d"] / (fac ** ALPHA["d"])) / ((1.0 + 0.115 * ef_c) * (pace_k ** 0.28))
            eff_t = 0.62 * (p["x_mit"] / (fac ** ALPHA["mit"])) + 0.38 * (p["x_tak"] / (fac ** ALPHA["tak"]))
            adj_w = p["x_w"] / (fac ** ALPHA["w"])
            adj_o = p["x_o"] / (fac ** ALPHA["o"])
            adj_c = p["x_c"]
            adj_cc_dur = p["x_cc_dur"]
            adj_k = p["x_k"]
            adj_ka = (p["x_ka"] / (fac ** ALPHA["ka"])) / ((1.0 + 0.052 * ef_c) * (pace_k ** 0.60))
            adj_late_ka = ((p["ke_late_ka"] / mins) / (fac ** ALPHA["late_ka"])) / ((1.0 + 0.052 * ef_c) * (pace_k ** 0.60))
            adj_iso_d = p["ke_iso_death"] / mins
            iso_ratio = p["ke_iso_death"] / max(p["deaths"], 1)
            if heal_src == "eog":
                h_aligned = p["x_h"]
            elif ro == "輔助":
                base_h = cg["h_scale"] * p["x_h"]
                item_def = max(0.0, 240.0 * min(3, p["n_sup_items"]) - 0.25 * base_h)
                n_sup, sum_sh = champ_sh.get(int(p["champion_id"]), (0, 0.0))
                sh_prior = (sum_sh + 1.5 * item_def) / (n_sup + 1.5)
                ka_act = clip(0.20 + 0.80 * (adj_ka / cr["med_ka"]), 0.45, 1.25)
                h_aligned = base_h + sh_prior * ka_act
            else:
                h_aligned = cg["h_scale"] * p["x_h"]

            zr_d = spow(adj_d, cr["med_d"], cr["iqr_d"])
            zr_t = spow(eff_t, cr["med_t"], cr["iqr_t"])
            zr_c = spow(adj_c, cr["med_c"], cr["iqr_c"])
            zr_ccdur = spow(adj_cc_dur, cr["med_ccdur"], cr["iqr_ccdur"])
            zr_cc = 0.65 * zr_c + 0.35 * max(zr_c, zr_ccdur)
            zr_w = spow(adj_w, cr["med_w"], cr["iqr_w"], lo=-2.0, hi=2.5)
            zr_o = spow(adj_o, cr["med_o"], cr["iqr_o"], lo=-1.4, hi=2.8)
            zr_k = spow(adj_k, cr["med_k"], cr["iqr_k"])
            zr_ka = spow(adj_ka, cr["med_ka"], cr["iqr_ka"])

            zg_d = spow(adj_d, cg["med_d"], cg["iqr_d"])
            zg_t = spow(eff_t, cg["med_t"], cg["iqr_t"])
            zg_ka = spow(adj_ka, cg["med_ka"], cg["iqr_ka"])
            zg_lka = spow(adj_late_ka, cg["med_lka"], cg["iqr_lka"])
            zg_o = spow(adj_o, cg["med_o"], cg["iqr_o"], lo=-1.4, hi=2.8)
            zh_sup = spow(h_aligned, cg["h_sup_med"], cg["h_sup_iqr"], lo=-1.8, hi=3.6)

            tank_w = clip((eff_t - 1350.0) / 2100.0, 0.0, 0.65)
            k_eff = min(zr_k, zr_d + 0.40)
            d_mix = 0.70 * zr_d + 0.30 * zg_d
            o_mix = 0.40 * zr_o + 0.60 * zg_o
            t_mix = 0.85 * zr_t + 0.15 * zg_t
            ka_mix = (0.70 * zr_ka + 0.30 * zg_ka) if ro == "輔助" else zg_ka

            if ro == "射手":
                cc_pos = 0.05 * (zr_cc - 0.35) if zr_cc > 0.35 else 0.0
                cd = 0.40 * d_mix + 0.04 * max(0.0, d_mix - 0.45)
                ct, cks, cka, ch, cc, co, cw = 0.0, 0.15 * k_eff, 0.17 * ka_mix + 0.12 * zg_lka, 0.0, cc_pos, 0.10 * o_mix, 0.06 * zr_w
            elif ro == "刺客":
                cc_pos = 0.05 * (zr_cc - 0.35) if zr_cc > 0.35 else 0.0
                cd = 0.41 * d_mix + 0.04 * max(0.0, d_mix - 0.45)
                ct, cks, cka, ch, cc, co, cw = 0.0, 0.17 * k_eff, 0.17 * ka_mix + 0.12 * zg_lka, 0.0, cc_pos, 0.10 * o_mix, 0.03 * zr_w
            elif ro == "法師":
                cd = 0.38 * d_mix + 0.05 * max(0.0, d_mix - 0.40)
                c_eff = max(zr_cc, min(0.0, -0.90 + 0.90 * (d_mix - 0.20))) if d_mix > 0.20 else zr_cc
                ct, cks, cka, ch, cc, co, cw = 0.0, 0.13 * k_eff, 0.16 * ka_mix + 0.12 * zg_lka, 0.0, 0.08 * c_eff, 0.08 * o_mix, 0.05 * zr_w
            elif ro == "鬥士":
                cd = 0.28 * d_mix + 0.12 * max(0.0, d_mix - 0.30)
                t_eff = max(t_mix, min(0.0, -0.85 + 0.90 * (d_mix - 0.20))) if d_mix > 0.20 else t_mix
                ct = 0.20 * t_eff
                cks = 0.11 * k_eff + 0.04 * max(0.0, k_eff - 0.30)
                c_eff = (
                    max(zr_cc, min(0.0, -0.90 + 0.85 * max(0.0, d_mix - 0.20) + 0.35 * max(0.0, t_mix - 0.25)))
                    if (d_mix > 0.20 or t_mix > 0.25)
                    else zr_cc
                )
                cka, ch, cc, co, cw = 0.16 * ka_mix + 0.11 * zg_lka, 0.0, 0.07 * c_eff, 0.07 * o_mix, 0.0
            elif ro == "坦克":
                cd = 0.10 * zr_d + 0.18 * max(0.0, zr_d - 0.45) + 0.10 * max(0.0, zg_d - 0.20)
                t_eff = max(t_mix, min(0.0, -0.85 + 0.85 * (zr_d - 0.35))) if zr_d > 0.35 else t_mix
                ct = 0.30 * t_eff
                cks = 0.10 * max(0.0, k_eff - 0.30)
                c_eff = (
                    max(zr_cc, min(0.0, -1.05 + 0.90 * max(0.0, zr_d - 0.30) + 0.30 * max(0.0, zr_t - 0.35)))
                    if (zr_d > 0.30 or zr_t > 0.35)
                    else zr_cc
                )
                cka, ch, cc, co, cw = 0.19 * ka_mix + 0.13 * zg_lka, 0.0, 0.20 * c_eff, 0.08 * o_mix, 0.0
            elif ro == "輔助":
                cd = 0.12 * max(-0.35, zr_d) + 0.16 * max(0.0, zr_d - 0.55) + 0.12 * max(0.0, zg_d + 0.35)
                ct = 0.42 * tank_w * zr_t
                cks = 0.09 * max(0.0, k_eff - 0.35)
                util_alt = max(0.0, zr_cc - 0.20) + 0.80 * max(0.0, zr_d - 0.20) + 0.55 * max(0.0, zr_d - 0.65)
                zh_floor = -1.15 + 0.65 * tank_w + 0.45 * min(2.0, util_alt)
                zh_eff = (max(zh_sup, zh_floor) if (tank_w > 0.0 or util_alt > 0.0) else zh_sup) + 0.10 * max(0.0, zh_sup - 0.35)
                c_sup_eff = max(-0.45, zr_cc, min(0.0, -0.45 + 0.45 * max(0.0, zr_d - 0.45)))
                if heal_src == "eog":
                    cka = 0.22 * ka_mix + 0.10 * zg_lka
                    ch = 0.40 * (1.0 - tank_w) * zh_eff
                    cc = 0.10 * c_sup_eff
                else:
                    cka = (0.22 + 0.04 * (1.0 - tank_w)) * ka_mix + 0.10 * zg_lka
                    ch = 0.34 * (1.0 - tank_w) * zh_eff
                    cc = (0.10 + 0.02 * (1.0 - tank_w)) * c_sup_eff
                co = 0.06 * o_mix
                cw = 0.0
            else:
                cd = 0.28 * d_mix + 0.10 * max(0.0, d_mix - 0.35)
                ct, cks, cka, ch, cc, co, cw = 0.18 * t_mix, 0.11 * k_eff, 0.16 * ka_mix + 0.11 * zg_lka, 0.0, 0.08 * zr_cc, 0.08 * o_mix, 0.0

            core = cd + ct + cks + cka + ch + cc + co + cw
            c_pts0 = 20.0 * core / cg["core_sd"]
            stretch = (15.0 + 1.18 * (c_pts0 - 15.0)) / c_pts0 if c_pts0 > 15.0 else 1.0
            k_core = (20.0 / cg["core_sd"]) * stretch

            gold = p["gold_earned"]
            if gold is None or gold <= 0:
                eff_z = 0.0
            elif ro in ("射手", "法師", "刺客"):
                adj_d_per_g = (p["dmg_to_champions"] / gold) / (fac ** 0.50)
                eff_z = (adj_d_per_g - cg["med_dpg"]) / cg["iqr_dpg"]
            else:
                h_imp = h_aligned if (ro == "輔助" or heal_src == "eog") else 0.0
                adj_imp_per_g = (1000.0 * (p["dmg_to_champions"] + 0.25 * (p["dmg_taken"] + p["dmg_mitigated"]) + 1.80 * h_imp * mins + 110.0 * adj_c * mins) / gold) / (fac ** 0.55)
                eff_z = (adj_imp_per_g - cg["med_ipg"]) / cg["iqr_ipg"]

            mk = p["double_kills"] + 2.5 * p["triple_kills"] + 4.5 * p["quadra_kills"] + 7.5 * p["penta_kills"]
            sup_streak = (
                1.8 * max(0.0, ka_mix - 0.50) + 1.5 * max(0.0, max(zh_sup, zr_cc, zr_t) - 0.55)
                if ro == "輔助"
                else 0.0
            )
            b_multi = min(4.5, 1.5 * math.sqrt(max(0.0, mk - (cr["med_multi"] + 1.5))) + sup_streak)
            b_tur = min(3.5, 1.8 * max(0.0, zr_o - 0.50) + (3.0 if p["ke_solo_tur"] >= 2 else (2.0 if p["ke_solo_tur"] == 1 else 0.0)))
            sup_fight = (
                1.2 * max(0.0, zg_lka - 0.35) + 0.9 * max(0.0, min(ka_mix, max(zh_sup, zr_cc, zr_t)) - 0.25)
                if ro == "輔助"
                else 0.0
            )
            b_fight = min(3.5, 1.2 * math.sqrt(max(0, p["ke_trade_death"] - p["ke_iso_death"] - 1)) + 0.9 * min(2, p["ke_solo"]) + sup_fight)
            b_eff = min(3.5, 3.0 * max(0.0, eff_z - 0.50))
            b_anti = min(2.5, 2.2 * min(1.2, x_a / 630.0)) if x_a > 200.0 else 0.0
            if ro == "坦克" and zr_d > 0.45:
                b_util_dmg = min(4.0, 2.6 * (zr_d - 0.45))
            elif ro == "輔助" and zr_d > 0.45:
                b_util_dmg = min(3.5, 2.4 * (zr_d - 0.45))
            elif ro == "鬥士" and zr_d > 0.60:
                b_util_dmg = min(2.5, 2.0 * (zr_d - 0.60))
            else:
                b_util_dmg = 0.0
            b_util_heal = min(2.0, (h_aligned - 500.0) / 500.0) if (ro not in ("坦克", "輔助") and heal_src == "eog" and h_aligned > 500.0) else 0.0
            b_util_cc = min(2.5, 2.0 * (zr_cc - 0.65)) if (ro in ("射手", "刺客", "法師", "鬥士", "輔助") and zr_cc > 0.65) else 0.0

            bonus_raw = b_multi + b_tur + b_fight + b_eff + b_anti + b_util_dmg + b_util_heal + b_util_cc
            bonus_pts = min(15.0, bonus_raw)
            b_scale = bonus_pts / bonus_raw if bonus_raw > 0 else 1.0

            iso_thresh = max(0.09, cr["med_isod"] + 0.03)
            p_iso = min(7.0, 28.0 * (adj_iso_d - iso_thresh) * min(1.5, iso_ratio / 0.35)) if (adj_iso_d > iso_thresh and iso_ratio > 0.25) else 0.0
            p_late = min(5.0, 2.2 * max(0, p["ke_late_iso_death"] - 1))
            act = max(zr_d, zr_t, zh_sup if ro == "輔助" else -1.0)
            p_ghost = min(8.0, 6.5 * max(0.0, -0.75 - act) + 4.5 * max(0.0, -0.80 - ka_mix))
            pen_pts = min(18.0, p_iso + p_late + p_ghost)

            work_raw = core * k_core + bonus_pts - pen_pts
            g_mean_off = cg["g_mean_eog"] if heal_src == "eog" else cg["g_mean_est"]
            work_score = clip(50.0 + work_raw - g_mean_off, 0.0, 100.0)

            expected[p["rid"]] = {
                "score_version": "v5.4",
                "score_status": "complete" if heal_src == "eog" else "estimate",
                "unscored_reason": None,
                "work_score": work_score,
                "work_raw": work_raw,
                "gene_d": clip(50.0 + 20.0 * zr_d, 0.0, 100.0),
                "gene_w": clip(50.0 + 20.0 * zr_w, 0.0, 100.0),
                "gene_o": clip(50.0 + 20.0 * zr_o, 0.0, 100.0),
                "gene_t": clip(50.0 + 20.0 * zr_t, 0.0, 100.0),
                "gene_c": clip(50.0 + 20.0 * zr_cc, 0.0, 100.0),
                "gene_h": clip(50.0 + 20.0 * zh_sup, 0.0, 100.0),
                "gene_a": clip(50.0 + 20.0 * ((x_a - 200.0) / 430.0), 0.0, 100.0),
                "gene_kda": clip(50.0 + 20.0 * ((p_kda - cr["med_p_kda"]) / cg["sd_p_kda"]), 0.0, 100.0),
                "gene_ks": clip(50.0 + 20.0 * zr_k, 0.0, 100.0),
                "gene_ka": clip(50.0 + 20.0 * zr_ka, 0.0, 100.0),
                "pts_d": cd * k_core + b_util_dmg * b_scale,
                "pts_w": cw * k_core,
                "pts_o": co * k_core,
                "pts_t": ct * k_core,
                "pts_c": cc * k_core + b_util_cc * b_scale,
                "pts_h": ch * k_core + b_util_heal * b_scale,
                "pts_a": b_anti * b_scale,
                "pts_ks": cks * k_core,
                "pts_ka": cka * k_core,
                "pts_bonus": (b_multi + b_tur + b_fight + b_eff) * b_scale,
                "pts_penalty": -pen_pts,
                "pts_base": -g_mean_off,
            }

    assert set(expected) == set(db_mat), f"列數不符: python={len(expected)} db={len(db_mat)}"
    max_diffs: dict[str, float] = defaultdict(float)
    mismatches = 0
    num_cols = [
        "work_score", "work_raw",
        "gene_d", "gene_w", "gene_o", "gene_t", "gene_c", "gene_h", "gene_a", "gene_kda", "gene_ks", "gene_ka",
        "pts_d", "pts_w", "pts_o", "pts_t", "pts_c", "pts_h", "pts_a", "pts_ks", "pts_ka", "pts_bonus", "pts_penalty", "pts_base",
    ]
    pts_cols = ["pts_d", "pts_w", "pts_o", "pts_t", "pts_c", "pts_h", "pts_a", "pts_ks", "pts_ka", "pts_bonus", "pts_penalty", "pts_base"]
    max_sum_err = 0.0

    for rid, exp in expected.items():
        got = db_mat[rid]
        if (got["score_version"], got["score_status"], got["unscored_reason"]) != (
            exp["score_version"], exp["score_status"], exp["unscored_reason"]
        ):
            mismatches += 1
            print("meta mismatch", rid, got, exp)
            continue
        if exp["work_score"] is None:
            if got["work_score"] is not None:
                mismatches += 1
            continue
        for k in num_cols:
            diff = abs(got[k] - exp[k])
            if diff > max_diffs[k]:
                max_diffs[k] = diff
            if diff > 1e-6:
                mismatches += 1
                if mismatches <= 5:
                    print(f"diff {k} rid={rid}: db={got[k]} py={exp[k]} diff={diff}")
        re_score = clip(50.0 + sum(got[k] for k in pts_cols), 0.0, 100.0)
        max_sum_err = max(max_sum_err, abs(got["work_score"] - re_score))

    scored_n = sum(1 for v in expected.values() if v["work_score"] is not None)
    print(f"總列數 {len(expected)}（計分 {scored_n}），不一致 {mismatches} 筆")
    print(f"各數值欄位最大誤差：{max(max_diffs.values()):.2e}（work_score={max_diffs['work_score']:.2e}，加成之和誤差={max_sum_err:.2e}）")
    assert mismatches == 0 and max(max_diffs.values()) < 1e-6 and max_sum_err < 1e-6

    # Crew sanity summary & pooled within-player SD (≥30 場)
    by_pu = defaultdict(list)
    for r in mp_rows:
        m = db_mat[r["rid"]]
        if m["work_score"] is not None:
            by_pu[r["puuid"]].append(m["work_score"])
    crew_pu = {a["puuid"] for a in crew}

    def pooled_sd(pu_filter):
        ss = 0.0
        df = 0
        n_pl = 0
        for pu, vals in by_pu.items():
            if pu in pu_filter and len(vals) >= 30:
                n_pl += 1
                df += len(vals) - 1
                ss += variance(vals) * (len(vals) - 1)
        return n_pl, math.sqrt(ss / df) if df > 0 else 0.0

    n_crew30, sd_crew30 = pooled_sd(crew_pu)
    n_all30, sd_all30 = pooled_sd(set(by_pu))
    print(f"同玩家組內 SD：好友≥30場({n_crew30}位)={sd_crew30:.2f}、全部≥30場({n_all30}位)={sd_all30:.2f}")
    print("好友平均貢獻（核對表）：", [(a["riot_id"], len(by_pu[a["puuid"]]), round(sum(by_pu[a["puuid"]]) / len(by_pu[a["puuid"]]), 2)) for a in crew if by_pu[a["puuid"]]])


if __name__ == "__main__":
    main()
