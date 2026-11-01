"""v3.7 的依據：承傷（T）對後排（射手、法師）走位好、吃得少的人是不是不公平；模擬幾種改法。唯讀。

2026-11-01 在 v3.6 的常數上跑的結果寫在 docs/contribution-scoring.md 的 v3.7。之後的版本承傷已經只加不扣，
「v3.6 現狀」那一列會變成目前版本的分數，要重現當時的表請 checkout v3.6 的 contribution.yml。
用法：uv run --with numpy python -X utf8 analysis/scoring_v37_soak_eval.py

用 mat_contribution 已經算好的同場比分數 p_*（和 v3.6 同一套），校正常數從 yml 讀；
每種改法都重新算 sd_work 與整體校正（平均拉回 50），才公平比較。
"""
import re
import sqlite3
import statistics as st
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(r"C:\Users\User\vsdbg\Downloads\mayhem-stats")
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
         mp.win, mp.puuid, mc.work_score, mp.deaths, mp.game_id, mp.dmg_taken
  FROM mat_contribution mc JOIN match_participants mp ON mp.rowid = mc.participant_rowid
  WHERE mc.work_score IS NOT NULL""").fetchall()
n = len(rows)
role = np.array([r[0] for r in rows])
eog = np.array([r[1] == "eog" for r in rows])
P = {k: np.array([r[i] for r in rows], float) for i, k in enumerate(["d", "w", "o", "t", "c", "h", "a", "k", "s"], start=2)}
win = np.array([r[11] for r in rows], float)
who = np.array([r[12] for r in rows])
cur = np.array([r[13] for r in rows], float)
mu = lambda g: np.array([MU[r][g] for r in role])
Z = {g: (P[g] - mu(g)) / SD[g] for g in ["d", "w", "o", "t", "c", "a"]}
Z["h"] = np.where(eog, (P["h"] - mu("h_eog")) / SD["h_eog"], 0.0)
Z["kda"] = ((P["k"] + P["s"]) / 2 - mu("kda")) / SD["kda"]
# 存活單獨看（走位好＝死得少）：同出裝定位裡的標準化
zs = np.zeros(n)
for r in set(role):
    m = role == r
    zs[m] = (P["s"][m] - P["s"][m].mean()) / P["s"][m].std()

W = {"d": 0.28, "t": 0.23, "h": 0.13, "c": 0.12, "kda": 0.06, "o": 0.08, "w": 0.06, "a": 0.04}
ADD = {"c", "h", "a"}  # v3.6 的只加不扣；承傷在下面各改法裡另外處理
back = np.isin(role, ["射手", "法師"])


def score(weights, zmod):
    z = {g: (np.maximum(Z[g], 0) if g in ADD else Z[g]) for g in Z}
    z.update(zmod(z))
    raw = sum(weights[g] * z[g] for g in weights)
    return np.clip(50 + 20 * (raw - raw.mean()) / raw.std(), 0, 100), z


def eta2(s):
    """追蹤的人（30 場以上）：分數裡有多少是「人」的差別（越高越分得出誰比較會打）"""
    sel = np.isin(who, list(tracked))
    groups = defaultdict(list)
    for v, p in zip(s[sel], who[sel]):
        groups[p].append(v)
    groups = {p: v for p, v in groups.items() if len(v) >= 30}
    allv = np.concatenate(list(groups.values()))
    gm = allv.mean()
    between = sum(len(v) * (np.mean(v) - gm) ** 2 for v in groups.values())
    return between / ((allv - gm) ** 2).sum()


# 「走位好的後排」：射手／法師、承傷低於同定位平均（z_t < -0.5）且死得比同定位少（存活 z > 0.5）
dodge = back & (Z["t"] < -0.5) & (zs > 0.5)
# 「吃很多傷害卻一直死的後排」：承傷高、死得多（站位差）
fed = back & (Z["t"] > 0.5) & (zs < -0.5)
print(f"{n} 人次；後排 {back.sum()}；走位好（承傷低、死得少）{dodge.sum()}；站位差（承傷高、死得多）{fed.sum()}")
print(f"後排的承傷加減分：平均 {np.mean(20*W['t']*Z['t'][back]/SD['work']):+.2f}；走位好的那群平均 {np.mean(20*W['t']*Z['t'][dodge]/SD['work']):+.2f}")

VARIANTS = {
    "v3.6 現狀": (W, lambda z: {}),
    "A 承傷只加不扣（全部人）": (W, lambda z: {"t": np.maximum(Z["t"], 0)}),
    "B 承傷只加不扣（只有射手、法師）": (W, lambda z: {"t": np.where(back, np.maximum(Z["t"], 0), Z["t"])}),
    "C 承傷最多扣 1 個標準差": (W, lambda z: {"t": np.maximum(Z["t"], -1)}),
    "D 承傷只加不扣＋存活獨立 6%": ({**W, "kda": 0.03, "s": 0.03}, lambda z: {"t": np.maximum(Z["t"], 0), "s": zs}),
}
print(f"\n{'改法':<26}{'勝負相關':>8}{'η²':>7}{'走位好後排':>9}{'站位差後排':>9}{'坦克平均':>8}{'射手平均':>8}{'法師平均':>8}{'坦克SD':>7}")
for name, (w, mod) in VARIANTS.items():
    s, _ = score(w, mod) if name != "v3.6 現狀" else (cur, None)
    r = lambda m: np.mean(s[m])
    print(f"{name:<26}{np.corrcoef(s, win)[0,1]:>8.3f}{eta2(s):>7.3f}{r(dodge):>9.1f}{r(fed):>9.1f}"
          f"{r(role=='坦克'):>8.1f}{r(role=='射手'):>8.1f}{r(role=='法師'):>8.1f}{np.std(s[role=='坦克']):>7.1f}")
