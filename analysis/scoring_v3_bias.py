"""本場貢獻 v3 會不會偏向資料庫主人（is_me）？唯讀。

資料庫裡每一場都有主人或追蹤的好友，基準線（各出裝定位的平均）也是從這些場次算出來的，所以檢查：
1. 基準線拿掉主人自己的人次（或拿掉所有追蹤的人）重新算，主人的平均分數變多少；
2. 換幾種權重，主人在追蹤玩家之間的名次會不會變（權重是不是剛好挑了主人擅長的項目）；
3. 主人各基因的平均（強項在哪）；
4. 分數高低和勝率是否一致（主人分數高、勝率卻沒有比較高，就要懷疑分數）；
5. 有賽後統計（complete）與暫估（estimate）的場次分數差多少——賽後統計只有主人自己的客戶端抓得到；
6. 追蹤玩家與同場陌生人的平均。
輸出不含玩家名稱或 puuid（主人寫「你」，其他追蹤玩家依場次排成好友 A、B…）。

用法：uv run --with numpy python analysis/scoring_v3_bias.py [mayhem.db]
"""
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

DB = sys.argv[1] if len(sys.argv) > 1 else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
SD_WORK = float(re.search(r"VALUES \([\d., ]+, ([\d.]+)\)\s*-- 校正常數結束", YML.read_text(encoding="utf-8")).group(1))
W = {"d": 0.25, "t": 0.20, "h": 0.13, "c": 0.12, "kda": 0.12, "o": 0.08, "w": 0.06, "a": 0.04}
ROLES = ["射手", "法師", "刺客", "鬥士", "坦克", "輔助", "未成形"]
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
me = c.execute("SELECT puuid FROM accounts WHERE is_me = 1").fetchone()[0]
tracked = {r[0] for r in c.execute("SELECT puuid FROM accounts")}
rows = c.execute("""SELECT mp.puuid, mp.win, mp.platform_id || ':' || mp.game_id, mp.team_id, n.work_score, n.build_role, n.heal_src, n.score_status,
  n.p_d, n.p_w, n.p_o, n.p_t, n.p_c, n.p_h, n.p_a, n.p_kda, n.pts_d, n.pts_w, n.pts_o, n.pts_t, n.pts_c, n.pts_h, n.pts_a, n.pts_kda,
  n.gene_d, n.gene_w, n.gene_o, n.gene_t, n.gene_c, n.gene_h, n.gene_a, n.gene_kda, mp.kills, mp.deaths, mp.assists
  FROM mat_contribution n JOIN match_participants mp ON mp.rowid = n.participant_rowid WHERE n.work_score IS NOT NULL""").fetchall()
G = ["d", "w", "o", "t", "c", "h", "a", "kda"]
pu = np.array([r[0] for r in rows])
win = np.array([r[1] for r in rows], float)
game = np.array([r[2] for r in rows])
team = np.array([r[3] for r in rows])
score = np.array([r[4] for r in rows])
role = np.array([r[5] for r in rows])
src = np.array([r[6] for r in rows])
status = np.array([r[7] for r in rows])
P = {g: np.array([r[8 + i] for r in rows]) for i, g in enumerate(G)}
Z = {g: np.array([r[16 + i] for r in rows]) * SD_WORK / (20 * W[g]) for i, g in enumerate(G)}
gene = {g: np.array([r[24 + i] for r in rows]) for i, g in enumerate(G)}
kda = np.array([(r[32] + r[34]) / max(1, r[33]) for r in rows])
is_me = pu == me
is_tr = np.isin(pu, list(tracked))
out = {"rows": len(rows), "me_rows": int(is_me.sum()), "tracked_rows": int(is_tr.sum())}

# 追蹤玩家的代號：你，其他依場次多到少 A、B…（只列 20 場以上）
counts = {p: int((pu == p).sum()) for p in tracked}
others = sorted([p for p in tracked if p != me and counts[p] >= 20], key=lambda p: -counts[p])
name = {me: "你", **{p: f"好友 {chr(65 + i)}" for i, p in enumerate(others)}}
players = [me] + others


def refit(train):
    """用 train 這些人次重算基準線，回傳每一列的新分數"""
    z_all = {}
    for g in G:
        z = np.zeros(len(rows))
        groups = [src == "eog", src == "flag"] if g == "h" else [np.ones(len(rows), bool)]
        for sel in groups:
            base = P[g][sel & train].mean()
            mu = {r: (P[g][sel & train & (role == r)].mean() if r != "未成形" and (sel & train & (role == r)).any() else base) for r in ROLES}
            ex = np.array([mu[r] for r in role])
            res = P[g] - ex
            if g == "h":
                sd = P[g][sel & train & (P[g] > 0)].std()
            else:
                sd = res[sel & train].std()
            z[sel] = res[sel] / sd
        z_all[g] = z
    raw = sum(W[g] * z_all[g] for g in G)
    return np.clip(50 + 20 * raw / raw[train].std(), 0, 100)


print(f"{len(rows)} 人次；你 {is_me.sum()}、追蹤玩家合計 {is_tr.sum()}（占 {100 * is_tr.mean():.1f}%）")
print("\n1. 基準線拿掉誰重算，你的平均分數")
base_all = refit(np.ones(len(rows), bool))
r1 = {"現行（全部人次）": round(float(score[is_me].mean()), 2),
      "全部人次重算（應與現行相同）": round(float(base_all[is_me].mean()), 2),
      "拿掉你自己的人次": round(float(refit(~is_me)[is_me].mean()), 2),
      "拿掉所有追蹤玩家（只用陌生人）": round(float(refit(~is_tr)[is_me].mean()), 2)}
for k, v in r1.items():
    print(f"   {k}：{v}")
out["refit"] = r1

print("\n2. 換權重，追蹤玩家（20 場以上）的平均與你的名次")
ALT = {
    "現行 v3": W,
    "八項等權": {g: 1 / 8 for g in G},
    "只看工作（輸出、承傷、治療、控場各 1/4）": {"d": .25, "t": .25, "h": .25, "c": .25},
    "拿掉清兵與推塔": {"d": .29, "t": .23, "h": .15, "c": .14, "kda": .14, "a": .05},
    "拿掉 K/DA": {"d": .28, "t": .23, "h": .15, "c": .14, "o": .09, "w": .07, "a": .04},
    "輸出加重（輸出 40%）": {"d": .40, "t": .17, "h": .11, "c": .10, "kda": .10, "o": .06, "w": .04, "a": .02},
    "承傷加重（承傷 35%）": {"d": .20, "t": .35, "h": .11, "c": .10, "kda": .10, "o": .07, "w": .05, "a": .02},
}
r2 = {}
for label, w in ALT.items():
    raw = sum(w.get(g, 0) * Z[g] for g in G)
    s = np.clip(50 + 20 * raw / raw.std(), 0, 100)
    means = {name[p]: round(float(s[pu == p].mean()), 1) for p in players}
    rank = sorted(means, key=lambda k: -means[k]).index("你") + 1
    r2[label] = {"means": means, "my_rank": rank}
    print(f"   {label:<28s} 你 {means['你']:5.1f}（第 {rank}/{len(players)}）｜" + " ".join(f"{k[-1] if k != '你' else '你'}{v:.0f}" for k, v in means.items()))
out["weights"] = r2

print("\n3. 你各基因的平均（50＝同出裝定位的平均）與加減分")
r3 = {g: {"gene": round(float(gene[g][is_me].mean()), 1), "pts": round(float((20 * W[g] * Z[g] / SD_WORK)[is_me].mean()), 2)} for g in G}
print("   " + "、".join(f"{g} {v['gene']}（{v['pts']:+.2f}）" for g, v in r3.items()))
out["my_genes"] = r3
roles_me = {r: int((is_me & (role == r)).sum()) for r in ROLES}
out["my_roles"] = roles_me
print("   你的出裝定位場次：", roles_me)

print("\n4. 分數和勝率是否一致（追蹤玩家 20 場以上）")
r4 = []
for p in players:
    m = pu == p
    r4.append({"who": name[p], "games": int(m.sum()), "score": round(float(score[m].mean()), 1), "winrate": round(float(100 * win[m].mean()), 1),
               "kda": round(float(kda[m].mean()), 2), "win_games_score": round(float(score[m & (win == 1)].mean()), 1),
               "loss_games_score": round(float(score[m & (win == 0)].mean()), 1)})
for r in r4:
    print(f"   {r['who']:<5s} {r['games']:4d} 場 分數 {r['score']:5.1f} 勝率 {r['winrate']:5.1f}% KDA {r['kda']:.2f}｜贏 {r['win_games_score']} 輸 {r['loss_games_score']}")
xs, ys = [r["score"] for r in r4], [r["winrate"] for r in r4]
out["players"] = r4
out["score_winrate_corr"] = round(float(np.corrcoef(xs, ys)[0, 1]), 3)
print(f"   玩家之間：平均分數和勝率的相關 {out['score_winrate_corr']}")

print("\n5. 有賽後統計（complete）與暫估（estimate）")
r5 = {}
for label, sel in (("你", is_me), ("其他追蹤玩家", is_tr & ~is_me), ("陌生人", ~is_tr)):
    r5[label] = {k: [int((sel & (status == k)).sum()), round(float(score[sel & (status == k)].mean()), 1) if (sel & (status == k)).any() else None]
                 for k in ("complete", "estimate")}
    print(f"   {label}：complete {r5[label]['complete']}、estimate {r5[label]['estimate']}（場數、平均）")
out["status"] = r5

print("\n6. 追蹤玩家與同場的陌生人")
r6 = {"你": round(float(score[is_me].mean()), 1), "其他追蹤玩家": round(float(score[is_tr & ~is_me].mean()), 1),
      "陌生人": round(float(score[~is_tr].mean()), 1)}
# 你的隊友（陌生人）與對手（陌生人）
mine_games = {(g, t) for g, t in zip(game[is_me], team[is_me])}
mate = np.array([(g, t) in mine_games for g, t in zip(game, team)]) & ~is_tr
my_g = set(game[is_me])
foe = np.array([g in my_g for g in game]) & ~np.array([(g, t) in mine_games for g, t in zip(game, team)]) & ~is_tr
r6["你場上的陌生隊友"] = round(float(score[mate].mean()), 1)
r6["你場上的陌生對手"] = round(float(score[foe].mean()), 1)
r6["陌生人勝率"] = round(float(100 * win[~is_tr].mean()), 1)
for k, v in r6.items():
    print(f"   {k}：{v}")
out["groups"] = r6

Path(__file__).with_suffix(".json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
