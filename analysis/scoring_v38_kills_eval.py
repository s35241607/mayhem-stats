"""評估：把「擊殺占比」（自己擊殺 ÷ 我方擊殺）加進本場貢獻。唯讀。

起因（使用者 2026-11-01）：一場 24 殺的烏迪爾只拿 46，同場推塔、清兵、承傷都多的伊瑞莉雅 81；
使用者同意伊瑞莉雅較高，但烏迪爾至少要 50 以上。現行 K/DA 的參團率把擊殺和助攻算成一樣，擊殺數本身不加分。

做法：從 mat_contribution 讀同場比分數 p_*，加一個新基因 KS（擊殺占比，和其他基因一樣先同場比、再和同出裝定位比），
每種改法都重新算 sd_work 與整體校正（平均拉回 50）。權重從其他基因等比例讓出。
用法：uv run --with numpy python -X utf8 analysis/scoring_v38_kills_eval.py
"""
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent
text = (ROOT / "cube/model/cubes/contribution.yml").read_text(encoding="utf-8")
blk = re.search(r"-- 校正常數開始[^\n]*\n(.*?)-- 校正常數結束", text, re.S).group(1)
MU = {m.group(1): dict(zip(["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda"], map(float, m.group(2).split(","))))
      for m in re.finditer(r"\('([^']+)', ([^)]*)\)", blk)}
sdv = [float(x) for x in re.search(r"VALUES \(([\d., ]+)\)\s*$", blk.strip()).group(1).split(",")]
SD = dict(zip(["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda", "work", "mu_work"], sdv))

c = sqlite3.connect(f"file:{ROOT / 'mayhem.db'}?mode=ro", uri=True)
tracked = {r[0] for r in c.execute("SELECT puuid FROM accounts WHERE tracked = 1 OR is_me = 1")}
rows = c.execute("""
  SELECT mc.build_role, mc.heal_src, mc.p_d, mc.p_w, mc.p_o, mc.p_t, mc.p_c, mc.p_h, mc.p_a, mc.p_k, mc.p_s,
         mp.win, mp.puuid, mc.work_score, mp.kills, mp.platform_id, mp.game_id, mp.team_id, mp.champion_id
  FROM mat_contribution mc JOIN match_participants mp ON mp.rowid = mc.participant_rowid
  WHERE mc.work_score IS NOT NULL""").fetchall()
n = len(rows)
role = np.array([r[0] for r in rows])
eog = np.array([r[1] == "eog" for r in rows])
P = {k: np.array([r[i] for r in rows], float) for i, k in enumerate(["d", "w", "o", "t", "c", "h", "a", "k", "s"], start=2)}
win = np.array([r[11] for r in rows], float)
who = np.array([r[12] for r in rows])
cur = np.array([r[13] for r in rows], float)
kills = np.array([r[14] for r in rows], float)
game = [(r[15], r[16]) for r in rows]
team = [(r[15], r[16], r[17]) for r in rows]
champ = np.array([r[18] for r in rows])

# 擊殺占比：自己擊殺 ÷ 我方擊殺，再和同場另外九人比（同其他基因：P = 100x ÷ (x + 其他九人平均)）
team_kills = defaultdict(float)
for k, t in zip(kills, team):
    team_kills[t] += k
ks = np.array([k / team_kills[t] if team_kills[t] else 0.0 for k, t in zip(kills, team)])
by_game = defaultdict(list)
for i, g in enumerate(game):
    by_game[g].append(i)
p_ks = np.zeros(n)
for idx in by_game.values():
    tot = ks[idx].sum()
    for i in idx:
        e = (tot - ks[i]) / (len(idx) - 1)
        p_ks[i] = 0.0 if ks[i] == 0 else 100.0 if e == 0 else 100.0 * ks[i] / (ks[i] + e)
mu_ks = {r: p_ks[role == r].mean() for r in set(role)}
z_ks = p_ks - np.array([mu_ks[r] for r in role])
z_ks /= z_ks.std()

mu = lambda g: np.array([MU[r][g] for r in role])
Z = {g: (P[g] - mu(g)) / SD[g] for g in ["d", "w", "o", "t", "c", "a"]}
Z["h"] = np.where(eog, (P["h"] - mu("h_eog")) / SD["h_eog"], 0.0)
Z["kda"] = ((P["k"] + P["s"]) / 2 - mu("kda")) / SD["kda"]
Z["ks"] = z_ks
ADD = {"t", "c", "h", "a"}
W0 = {"d": 0.28, "t": 0.23, "h": 0.13, "c": 0.12, "kda": 0.06, "o": 0.08, "w": 0.06, "a": 0.04}


def with_ks(w_ks):
    """擊殺占比拿 w_ks，其他基因等比例讓出"""
    return {**{g: v * (1 - w_ks) for g, v in W0.items()}, "ks": w_ks}


def score(weights, add):
    z = {g: (np.maximum(Z[g], 0) if g in add else Z[g]) for g in weights}
    raw = sum(weights[g] * z[g] for g in weights)
    return np.clip(50 + 20 * (raw - raw.mean()) / raw.std(), 0, 100)


def eta2(s):
    sel = np.isin(who, list(tracked))
    groups = defaultdict(list)
    for v, p in zip(s[sel], who[sel]):
        groups[p].append(v)
    groups = [v for v in groups.values() if len(v) >= 30]
    allv = np.concatenate(groups)
    gm = allv.mean()
    return sum(len(v) * (np.mean(v) - gm) ** 2 for v in groups) / ((allv - gm) ** 2).sum()


# 例子：使用者問的那一場（以場次與英雄編號找，不寫名字）
ex = {name: next(i for i, r in enumerate(rows) if r[16] == 459680178 and r[18] == cid) for name, cid in (("烏迪爾", 77), ("伊瑞莉雅", 39))}
print(f"{n} 人次；例子那場擊殺占比：" + "、".join(f"{k} {ks[i]:.0%}" for k, i in ex.items()))

# 「搶頭」的疑慮（使用者）：擊殺占比高、但輸出比同定位低的人，加了擊殺會不會變高分？
# 解法候選：擊殺占比和輸出取小的（min(z_ks, z_d)）——殺得多又打得多才加分，只有尾刀的人拿不到
Z["ks_dmg"] = np.minimum(Z["ks"], Z["d"])
VARIANTS = {
    "v3.7 現狀": None,
    "擊殺占比 8%（兩邊都算）": (with_ks(0.08), ADD),
    "擊殺占比 8%（只加不扣）": (with_ks(0.08), ADD | {"ks"}),
    "擊殺占比 12%（兩邊都算）": (with_ks(0.12), ADD),
    "擊殺占比 12%（只加不扣）": (with_ks(0.12), ADD | {"ks"}),
    "擊殺占比 16%（兩邊都算）": (with_ks(0.16), ADD),
    "擊殺×輸出取小 12%（兩邊都算）": ({**{g: v * 0.88 for g, v in W0.items()}, "ks_dmg": 0.12}, ADD),
    "擊殺×輸出取小 12%（只加不扣）": ({**{g: v * 0.88 for g, v in W0.items()}, "ks_dmg": 0.12}, ADD | {"ks_dmg"}),
    "擊殺×輸出取小 16%（只加不扣）": ({**{g: v * 0.84 for g, v in W0.items()}, "ks_dmg": 0.16}, ADD | {"ks_dmg"}),
    # 使用者追問：清兵、推塔也只加不扣
    "清兵推塔只加不扣": (W0, ADD | {"w", "o"}),
    "清兵推塔只加不扣＋取小 12%": ({**{g: v * 0.88 for g, v in W0.items()}, "ks_dmg": 0.12}, ADD | {"w", "o", "ks_dmg"}),
    "清兵推塔只加不扣＋取小 16%": ({**{g: v * 0.84 for g, v in W0.items()}, "ks_dmg": 0.16}, ADD | {"w", "o", "ks_dmg"}),
}
roles = ["坦克", "鬥士", "刺客", "射手", "法師", "輔助"]
print(f"\n{'改法':<22}{'烏迪爾':>7}{'伊瑞':>6}{'勝負相關':>8}{'η²':>7}  " + " ".join(f"{r:>4}" for r in roles))
for name, v in VARIANTS.items():
    s = cur if v is None else score(*v)
    print(f"{name:<22}{s[ex['烏迪爾']]:>7.1f}{s[ex['伊瑞莉雅']]:>6.1f}{np.corrcoef(s, win)[0, 1]:>8.3f}{eta2(s):>7.3f}  "
          + " ".join(f"{s[role == r].mean():>5.1f}" for r in roles))

# 擊殺占比高的人（同定位前 10%）現在被評多少
top = np.zeros(n, bool)
for r in roles:
    m = role == r
    top[m] = ks[m] >= np.quantile(ks[m], 0.9)
print(f"\n擊殺占比同定位前 10% 的 {top.sum()} 人次：v3.7 平均 {cur[top].mean():.1f}；"
      + "；".join(f"{k} {score(*v)[top].mean():.1f}" for k, v in VARIANTS.items() if v))

# 搶頭：擊殺占比在同定位前 20%、但輸出低於同定位平均；對照：輸出在同定位前 20%、擊殺占比低於同定位平均（打很多傷害沒拿到頭）
ks_hi = np.zeros(n, bool)
d_hi = np.zeros(n, bool)
ks_lo = np.zeros(n, bool)
for r in roles:
    m = role == r
    ks_hi[m] = ks[m] >= np.quantile(ks[m], 0.8)
    ks_lo[m] = ks[m] < np.median(ks[m])
    d_hi[m] = P["d"][m] >= np.quantile(P["d"][m], 0.8)
steal = ks_hi & (Z["d"] < 0)
carry_no_kill = d_hi & ks_lo
print(f"\n搶頭（擊殺占比前 20%、輸出低於同定位）{steal.sum()} 人次；打很多卻沒拿頭（輸出前 20%、擊殺占比低於中位數）{carry_no_kill.sum()} 人次")
print(f"{'改法':<26}{'搶頭':>7}{'沒拿頭的輸出手':>10}")
for name, v in VARIANTS.items():
    s2 = cur if v is None else score(*v)
    print(f"{name:<26}{s2[steal].mean():>7.1f}{s2[carry_no_kill].mean():>10.1f}")

# 什麼都少做的人（輸出、承傷、清兵、推塔四項都低於同定位平均）：只加不扣的項目越多，他們越不會被拉開
idle = (Z["d"] < 0) & (Z["t"] < 0) & (Z["w"] < 0) & (Z["o"] < 0)
print(f"\n四項都低於同定位的 {idle.sum()} 人次（什麼都少做）、整體校正（每個人扣幾分）：")
for name, v in VARIANTS.items():
    if v is None:
        print(f"  {name:<24}{cur[idle].mean():>6.1f}")
        continue
    w, add = v
    z = {g: (np.maximum(Z[g], 0) if g in add else Z[g]) for g in w}
    raw = sum(w[g] * z[g] for g in w)
    print(f"  {name:<24}{score(*v)[idle].mean():>6.1f}   校正 {20 * raw.mean() / raw.std():.1f} 分")
