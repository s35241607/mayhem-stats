"""Read-only scoring design audit; outputs aggregate, identity-free evidence.

Run from repository root with Python + numpy + pandas.
No changes to the live scoring formula or database. A consistent read transaction
is used. Match-grouped evaluation and a chronological holdout avoid splitting
the ten participants from one match across train and validation sets.
"""
from __future__ import annotations

import json
import sqlite3
import zlib
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "analysis" / "scoring_options_20261017.json"
PERF_WEIGHTS = {
    "坦克": [0, 40, 10, 15, 35, 0],
    "鬥士": [30, 20, 10, 20, 10, 10],
    "刺客": [50, 5, 10, 20, 10, 5],
    "射手": [45, 0, 10, 25, 15, 5],
    "法師": [45, 0, 15, 20, 15, 5],
    "輔助": [0, 0, 10, 20, 40, 30],
    "未成形": [1, 1, 1, 1, 1, 5],
}


def records(frame):
    return json.loads(frame.to_json(orient="records", force_ascii=False))


def corr(x, y):
    return float(np.corrcoef(np.asarray(x, float), np.asarray(y, float))[0, 1])


def ridge_predict(x, y, train, test, penalty=20):
    # Binary category columns retain their scale; coefficient shrinkage ~= n/(n+20).
    reg = np.eye(x.shape[1]) * penalty
    reg[0, 0] = 1e-7
    beta = np.linalg.solve(x[train].T @ x[train] + reg, x[train].T @ y[train])
    return x[test] @ beta


def logistic_fit(x, y, penalty=5):
    mu, sd = x.mean(axis=0), x.std(axis=0)
    sd[sd < 1e-8] = 1
    a = np.column_stack([np.ones(len(x)), (x - mu) / sd])
    beta = np.zeros(a.shape[1])
    reg = np.eye(a.shape[1]) * penalty
    reg[0, 0] = 1e-7
    for _ in range(60):
        p = 1 / (1 + np.exp(-np.clip(a @ beta, -30, 30)))
        grad = a.T @ (p - y) + reg @ beta
        hess = a.T @ ((p * (1 - p))[:, None] * a) + reg
        step = np.linalg.solve(hess, grad)
        beta -= step
        if abs(step).max() < 1e-8:
            break
    return beta, mu, sd


def logistic_predict(model, x):
    beta, mu, sd = model
    return 1 / (1 + np.exp(-np.clip(np.column_stack([np.ones(len(x)), (x - mu) / sd]) @ beta, -30, 30)))


def auc(y, p):
    ranks = pd.Series(p).rank(method="average").to_numpy()
    n1, n0 = int(sum(y)), int(sum(1-y))
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def main():
    c = sqlite3.connect(f"file:{(ROOT/'mayhem.db').as_posix()}?mode=ro", uri=True)
    c.execute("BEGIN")
    d = pd.read_sql_query("""
      SELECT p.rowid AS rid, p.platform_id, p.game_id, p.participant_id,
        p.team_id, p.champion_id, p.win, p.kills, p.assists, p.deaths,
        p.dmg_to_champions, p.dmg_taken, p.dmg_mitigated,
        p.total_damage, p.dmg_to_objectives, p.cs, p.time_ccing_others, p.cc_duration,
        p.total_heal, p.units_healed, m.game_duration, m.game_creation, m.local_date,
        m.game_version, ch.name AS champion,
        (SELECT role FROM dim_champion_roles r WHERE r.champion_id=p.champion_id ORDER BY r.rowid LIMIT 1) AS cls,
        b.build_role, b.ad_gold, b.ap_gold, b.tank_gold, b.sup_gold, b.core_gold,
        s.cell,s.perf,s.score,s.pa_dmg,s.pa_soak,s.pa_minion,s.pa_obj,s.pa_cc,s.pa_heal,
        s.melee_bonus,s.role_bonus,s.heal_src,
        e.game_id IS NOT NULL AS has_eog,e.heal_on_teammates,e.shield_on_teammates,e.time_spent_dead
      FROM match_participants p JOIN matches m USING(platform_id,game_id)
      JOIN dim_champions ch ON ch.id=p.champion_id
      JOIN mat_builds b ON b.participant_rowid=p.rowid
      JOIN mat_contribution s ON s.participant_rowid=p.rowid
      LEFT JOIN eog_player_stats e ON e.game_id=p.game_id AND e.puuid=p.puuid
      WHERE m.queue_id=2400 AND m.is_remake=0 AND m.game_duration>=360
      ORDER BY m.game_creation,p.platform_id,p.game_id,p.participant_id
    """, c)
    game_keys = list(dict.fromkeys(zip(d.platform_id, d.game_id)))
    game_index = {key: i for i, key in enumerate(game_keys)}
    d["match"] = [game_index[k] for k in zip(d.platform_id, d.game_id)]
    assert not d.rid.duplicated().any()
    assert (d.groupby("match").size() == 10).all()
    assert (d.groupby(["match", "team_id"]).size() == 5).all()
    assert (d.groupby("match").win.sum() == 5).all()
    assert not d[["deaths", "dmg_to_champions", "dmg_taken", "dmg_mitigated", "total_damage", "dmg_to_objectives", "time_ccing_others"]].isna().any().any()
    d["minutes"] = d.game_duration / 60
    d["patch"] = d.game_version.str.split(".").str[:2].str.join(".")
    d["band"] = np.select([d.minutes < 14, d.minutes < 18, d.minutes < 22], [0, 1, 2], default=3)
    for n in ["ad", "ap", "tank", "sup"]:
        d[n+"_fraction"] = (d[n+"_gold"] / d.core_gold.replace(0, np.nan)).fillna(0)
    d["damage"] = d.dmg_to_champions / d.minutes
    d["soak"] = (d.dmg_taken + d.dmg_mitigated) / d.minutes
    d["minion"] = (d.total_damage - d.dmg_to_champions - d.dmg_to_objectives) / d.minutes
    d["objective"] = d.dmg_to_objectives / d.minutes
    d["cc"] = d.time_ccing_others / d.minutes
    d["deaths_rate"] = d.deaths / d.minutes
    d["ally"] = (d.heal_on_teammates + d.shield_on_teammates) / d.minutes

    counts = d.groupby("champion_id").size()
    report = {"scope": {
        "valid_matches": len(game_keys), "participants": len(d),
        "first_date": d.local_date.min(), "last_date": d.local_date.max(),
        "all_mayhem_matches": c.execute("SELECT COUNT(*) FROM matches WHERE queue_id=2400").fetchone()[0],
        "patch_matches": d.groupby("patch").match.nunique().to_dict(),
        "heroes": len(counts), "heroes_under_30": int((counts < 30).sum()),
        "rows_heroes_under_30": int(counts[counts < 30].sum()),
        "hero_n_median": float(counts.median()),
        "eog_matches": int(d[d.has_eog == 1].match.nunique()),
        "eog_rows": int(d.has_eog.sum()),
        "eog_positive_ally_rows": int((d.ally > 0).sum()),
        "eog_hero_count": int(d[d.has_eog == 1].champion_id.nunique()),
        "identity_fields_exported": False,
    }}

    # Independent reconstruction of the live performance aggregation and scaling.
    def ng(keys):
        return d.groupby(keys, dropna=False).rid.transform("size")
    cellb_n, rb_n = ng(["build_role", "cls", "band"]), ng(["build_role", "band"])
    d["acell"] = np.where(cellb_n >= 30, d.build_role + "|" + d.cls.fillna("") + "|" + d.band.astype(str),
        np.where(rb_n >= 30, d.build_role + "|*|" + d.band.astype(str), d.build_role + "|*"))
    d["heal_k"] = np.where(d.heal_src == "eog", ((d.heal_on_teammates + d.shield_on_teammates) * 5 / d.dmg_to_champions.replace(0, np.nan)).clip(upper=1).fillna(1), 1)
    percentiles = d[["pa_dmg", "pa_soak", "pa_minion", "pa_obj", "pa_cc", "pa_heal"]].to_numpy(float)
    weights = np.array([PERF_WEIGHTS[r] for r in d.build_role], float)
    weights[:, 5] *= d.heal_k.to_numpy()
    weights[np.isnan(percentiles)] = 0
    d["raw"] = (np.nansum(percentiles * weights, axis=1) / weights.sum(axis=1)).round(9)
    pos = lambda field: (d[field].fillna(50) - 50).clip(lower=0)
    d["extra"] = np.where(d.build_role == "坦克", .5 * pos("pa_dmg") + .3 * d.heal_k * pos("pa_heal"),
                          np.where(d.build_role == "輔助", .5 * pos("pa_dmg") + .3 * pos("pa_soak"), 0))
    g = d.groupby("acell").raw
    mu, sd = g.transform("mean"), g.transform(lambda x: x.std(ddof=0))
    calculated = (50 + 20 * (d.raw - mu) / sd + d.extra + d.melee_bonus + d.role_bonus).clip(0, 100)
    calculated = calculated.where(sd > 1e-4, 50)
    report["qa"] = {"reconstructed_perf_max_error": float(abs(calculated-d.perf).max()), "complete_match_grain": True}
    assert report["qa"]["reconstructed_perf_max_error"] < 1e-6
    role_stats = d.groupby("build_role").agg(n=("rid", "size"), mean_perf=("perf", "mean"),
        mean_melee_bonus=("melee_bonus", "mean"), mean_role_bonus=("role_bonus", "mean"),
        mean_extra=("extra", "mean"), zero_objective_pct=("dmg_to_objectives", lambda x: 100*(x == 0).mean()),
        at_100_pct=("perf", lambda x: 100*(x >= 99.999).mean()))
    report["current_by_role"] = records(role_stats.reset_index().round(3))
    damage_roles = d[d.build_role.isin(["射手", "法師"])]
    high_soak = damage_roles[(damage_roles.tank_fraction > 0) & (damage_roles.pa_soak >= 75)]
    report["ignored_soak"] = {"damage_role_rows": len(damage_roles), "with_tank_investment": int((damage_roles.tank_fraction > 0).sum()),
        "tank_investment_and_soak_p75": len(high_soak), "their_soak_percentile_mean": float(high_soak.pa_soak.mean()),
        "tank_fraction_median": float(high_soak.tank_fraction.median())}
    d["tank_band"] = pd.cut(d.tank_fraction, [-.001, .001, .1, .2, .3, 1.001], right=False).astype(str)
    report["damage_role_tank_mix"] = records(d[d.build_role.isin(["射手", "法師"])].groupby(["build_role", "tank_band"]).agg(
        n=("rid", "size"), soak_percentile=("pa_soak", "mean"), perf=("perf", "mean")).reset_index().round(3))

    # Hero contrasts within existing role buckets are descriptive, not causal estimates.
    hs = d.groupby(["build_role", "champion_id", "champion"]).agg(n=("rid", "size"),
        wave_p=("pa_minion", "mean"), tower_p=("pa_obj", "mean"), cc_p=("pa_cc", "mean"),
        soak_p=("pa_soak", "mean"), perf=("perf", "mean"), winrate=("win", "mean")).reset_index()
    hs = hs[hs.n >= 20]
    examples = []
    for role in ["射手", "法師", "刺客", "坦克", "鬥士", "輔助"]:
        subset = hs[hs.build_role == role]
        for axis in ["wave_p", "tower_p"]:
            chosen = pd.concat([subset.nsmallest(2, axis), subset.nlargest(2, axis)]).drop_duplicates("champion_id")
            examples.append({"role": role, "axis": axis, "heroes": records(chosen.round(3))})
    report["hero_contrasts"] = examples
    report["win_associations"] = {a: corr(d[a], d.win) for a in ["damage", "soak", "minion", "objective", "cc", "deaths_rate", "perf"]}
    report["win_associations_by_role"] = {r: {a: corr(sub[a], sub.win) for a in ["damage", "soak", "minion", "objective", "cc", "perf"]}
        for r, sub in d.groupby("build_role") if len(sub) >= 20}

    # Match-grouped, out-of-fold context baseline comparison. No win, kills, gold
    # earned, player identity, or the observed metric used as explanatory features.
    # Equipment expenditure shares describe the build, not a reward for wealth.
    cat = pd.get_dummies(d[["acell", "patch"]], dtype=float).to_numpy()
    duration = np.column_stack([(d.minutes - 18)/5] + [np.maximum(d.minutes-k, 0)/5 for k in [14, 18, 22]])
    x0 = np.column_stack([np.ones(len(d)), cat, duration])
    hero = pd.get_dummies(d.champion_id.astype(str), dtype=float).to_numpy()
    mix = d[["ad_fraction", "ap_fraction", "tank_fraction", "sup_fraction"]].to_numpy()
    x1 = np.column_stack([x0, hero, mix])
    response_names = ["damage", "soak", "minion", "objective", "cc", "deaths_rate"]
    y = np.log1p(d[response_names].to_numpy())
    rng = np.random.default_rng(20261017)
    fold_for_game = np.empty(len(game_keys), int)
    fold_for_game[rng.permutation(len(game_keys))] = np.arange(len(game_keys)) % 5
    folds = fold_for_game[d.match.to_numpy()]
    predicted = []
    for x in [x0, x1]:
        pred = np.zeros_like(y)
        for fold in range(5):
            train, test = folds != fold, folds == fold
            pred[test] = ridge_predict(x, y, train, test)
        predicted.append(pred)
    def improvements(a, b, rows):
        err0, err1 = (y[rows]-a[rows])**2, (y[rows]-b[rows])**2
        var = ((y[rows] - y[rows].mean(axis=0))**2).sum(axis=0)
        return {n: {"coarse_r2": float(1-err0[:,i].sum()/var[i]),
            "hero_mix_r2": float(1-err1[:,i].sum()/var[i]),
            "mse_reduction_pct": float(100*(1-err1[:,i].sum()/err0[:,i].sum()))} for i,n in enumerate(response_names)}
    report["context_prediction_oof"] = improvements(predicted[0], predicted[1], np.ones(len(d), bool))
    cutoff = len(game_keys)*7//10
    train, test = d.match.to_numpy() < cutoff, d.match.to_numpy() >= cutoff
    chronological = []
    for x in [x0, x1]:
        pred = np.zeros_like(y)
        pred[test] = ridge_predict(x, y, train, test)
        chronological.append(pred)
    report["context_prediction_future"] = improvements(chronological[0], chronological[1], test)
    report["evaluation"] = {"grouped_folds": 5, "seed": 20261017, "ridge_penalty": 20,
        "chronological_train_matches": cutoff, "chronological_test_matches": len(game_keys)-cutoff,
        "first_holdout_date": d.loc[test, "local_date"].min(),
        "context_caveat": "Predicting metric opportunity is not validation of a final player score; final builds and some peer category counts are retrospectively known."}
    # Paired match bootstrap for out-of-fold mean squared error improvements.
    err0 = (y-predicted[0])**2
    err1 = (y-predicted[1])**2
    e0 = np.array([err0[d.match.to_numpy()==g].sum(axis=0) for g in range(len(game_keys))])
    e1 = np.array([err1[d.match.to_numpy()==g].sum(axis=0) for g in range(len(game_keys))])
    boot = rng.integers(0, len(game_keys), size=(1000,len(game_keys)))
    diffs = 100*(1-e1[boot].sum(axis=1)/e0[boot].sum(axis=1))
    report["context_mse_reduction_ci95"] = {n: [float(v) for v in np.quantile(diffs[:,i],[.025,.975])] for i,n in enumerate(response_names)}

    # A diagnostic outcome model, not a deployable player score or causal model.
    # Each match supplies exactly one row: log workload of team 100 minus team 200.
    grouped = d.groupby(["match", "team_id"])[response_names].sum()
    a, b = grouped.xs(100, level="team_id"), grouped.xs(200, level="team_id")
    tx = np.log1p(a.to_numpy())-np.log1p(b.to_numpy())
    ty = d[d.team_id==100].groupby("match").win.first().to_numpy(float)
    score = d.groupby(["match", "team_id"]).perf.mean()
    current = (score.xs(100, level="team_id")-score.xs(200, level="team_id")).to_numpy()
    report["outcome_models"] = {}
    for name,cols in [("without_objective",[0,1,2,4,5]),("with_objective",list(range(6)))]:
        model = logistic_fit(tx[:cutoff,cols],ty[:cutoff])
        p = logistic_predict(model, tx[cutoff:,cols])
        report["outcome_models"][name] = {"holdout_auc":auc(ty[cutoff:],p),
            "holdout_brier":float(np.mean((p-ty[cutoff:])**2)),
            "holdout_accuracy":float(np.mean((p>=.5)==ty[cutoff:])),
            "standardized_coefficients":{response_names[col]:float(co) for col,co in zip(cols,model[0][1:])}}
    report["outcome_models"]["current_perf_difference"] = {"holdout_auc":auc(ty[cutoff:],current[cutoff:])}
    report["outcome_models"]["warning"] = "End-of-game outcome association only: tower damage and survival reflect winning. These values cannot demonstrate individual causal impact or rank fairness. No ally protection is available for 575 matches."

    # Timeline inventory and feasibility of a combat/structure conversion model.
    event_counts = Counter()
    kills = towers = tower_direct = tower_assist = tower_no_direct = tower_after_team_kill_30 = 0
    kills_damage_payload = frames_damage_payload = late_end = mismatch = 0
    timeline_matches = 0
    valid = set(game_keys)
    bygame = {k:v for k,v in d.groupby(["platform_id","game_id"])}
    for plat,gid,blob in c.execute("SELECT platform_id,game_id,raw_gz FROM match_timelines"):
        if (plat,gid) not in valid:
            continue
        timeline_matches += 1
        j = json.loads(zlib.decompress(blob))
        sub = bygame[(plat,gid)]
        teams = dict(zip(sub.participant_id,sub.team_id))
        frames = j.get("frames",[])
        if frames and abs(frames[-1]["timestamp"]/1000-sub.game_duration.iloc[0]) > 90:
            late_end += 1
        events = sorted([e for f in frames for e in f.get("events",[])], key=lambda e:e["timestamp"])
        local_kills = []
        for f in frames:
            for pf in f.get("participantFrames",{}).values():
                frames_damage_payload += int(any("damage" in k.lower() for k in pf))
        for e in events:
            event_counts[e.get("type", "")] += 1
            if e.get("type") == "CHAMPION_KILL":
                kills += 1
                local_kills.append(e)
                kills_damage_payload += int(any("damage" in k.lower() for k in e))
            if e.get("type") == "BUILDING_KILL" and e.get("buildingType") == "TOWER_BUILDING":
                towers += 1
                direct = set(e.get("assistingParticipantIds",[])) | {e.get("killerId",0)}
                direct.discard(0)
                tower_direct += int(bool(direct))
                tower_assist += int(bool(e.get("assistingParticipantIds",[])))
                tower_no_direct += int(not direct)
                attackers = 300-e.get("teamId",0)
                tower_after_team_kill_30 += int(any(e["timestamp"]-k["timestamp"] <= 30000 and teams.get(k.get("killerId"))==attackers for k in local_kills))
        mismatch += int(len(local_kills) != int(sub.deaths.sum()))
    report["timeline"] = {"matches":timeline_matches,"event_counts":dict(event_counts),
        "kill_events":kills,"tower_events":towers,"towers_direct_participants":tower_direct,
        "towers_with_assists":tower_assist,"towers_no_direct_participant":tower_no_direct,
        "towers_with_attacker_kill_in_prior_30s":tower_after_team_kill_30,
        "kill_events_with_damage_payload":kills_damage_payload,
        "player_frames_with_damage_fields":frames_damage_payload,
        "matches_final_frame_gap_gt_90s":late_end,"matches_kill_count_differs_from_total_deaths":mismatch}
    report["raw_live_coverage"] = c.execute("SELECT COUNT(DISTINCT game_id) FROM raw_payloads WHERE source='live-client'").fetchone()[0]

    # Independent SQL checks of headline totals and ignored-soak counts.
    sql_check = c.execute("""
      SELECT COUNT(*),COUNT(DISTINCT m.platform_id||':'||m.game_id),COUNT(e.game_id),
        SUM(CASE WHEN b.build_role IN ('射手','法師') AND b.tank_gold>0 AND s.pa_soak>=75 THEN 1 ELSE 0 END)
      FROM matches m JOIN match_participants p USING(platform_id,game_id)
      JOIN mat_builds b ON b.participant_rowid=p.rowid
      JOIN mat_contribution s ON s.participant_rowid=p.rowid
      LEFT JOIN eog_player_stats e ON e.game_id=p.game_id AND e.puuid=p.puuid
      WHERE m.queue_id=2400 AND m.is_remake=0 AND m.game_duration>=360
    """).fetchone()
    assert sql_check == (len(d),len(game_keys),int(d.has_eog.sum()),len(high_soak))
    report["qa"]["independent_sql_totals"] = list(sql_check)
    c.rollback()
    c.close()
    OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
    print(json.dumps({k:report[k] for k in ["scope","qa","ignored_soak","context_prediction_oof","context_prediction_future","context_mse_reduction_ci95","outcome_models","timeline"]},ensure_ascii=False,indent=2))
    print(f"Saved aggregate evidence: {OUT}")


if __name__ == "__main__":
    main()
