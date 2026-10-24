"""擬合本場貢獻 v2 的固定係數：第 7 步「裝備組成校正」的 β 與 SD，以及第 8 步「射手加分」的係數。唯讀。

做法：把 contribution_v2.yml 的 SQL 裡的係數暫時換成 0（SD 換成 1、射手加分換成 0），取出每個人的原始分 work_raw 與裝備比例，
1. 對 [AD, AP, 承傷, 保人, AD×承傷, AP×承傷] 做沒有截距的最小平方（四個比例加起來是 1，等於已含截距），得到 β 與殘差標準差 SD；
2. 找讓「射手出裝」平均顯示分數剛好是 50 的射手加分係數 MK（只加給官方定位有射手的英雄：MK × 這場 AD 裝比例）。
印出要寫回 yml 的常數，以及校正前後各出裝的平均。定版之後不要再自動跑：係數一變，所有舊分都會變，要升 score_version。

用法：uv run --with numpy python analysis/scoring_v2_fit.py [mayhem.db]
"""
import re
import sqlite3
import sys
from pathlib import Path

import numpy as np
import yaml

DB = sys.argv[1] if len(sys.argv) > 1 else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution_v2.yml"
sql = yaml.safe_load(YML.read_text(encoding="utf-8"))["cubes"][0]["meta"]["materialize"]["sql"]
# 係數那一行換成 0，SD 換成 1，射手加分關掉（不管現在寫的是佔位符還是數字）
sql = re.sub(r"(?m)^(\s*)\S+ \* f_ad \+ \S+ \* f_ap \+ \S+ \* r_t \+ \S+ \* r_h \+ \S+ \* f_ad \* r_t \+ \S+ \* f_ap \* r_t AS mix_expected",
             r"\g<1>0 AS mix_expected", sql)
sql = re.sub(r"\(f\.work_raw \+ f\.marksman_bonus - f\.mix_expected\) / [^)]+\)", "(f.work_raw + f.marksman_bonus - f.mix_expected) / 1.0)", sql)
sql = re.sub(r"CASE WHEN is_marksman THEN \S+ \* f_ad ELSE 0\.0 END AS marksman_bonus", "0.0 AS marksman_bonus", sql)

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = c.execute(f"""SELECT t.work_raw, t.f_ad, t.f_ap, t.r_t, t.r_h, b.build_role, t.is_marksman FROM ({sql}) t
                      JOIN mat_builds b USING (participant_rowid) WHERE t.work_raw IS NOT NULL""").fetchall()
raw = np.array([r[0] for r in rows])
f = np.array([r[1:5] for r in rows])
role = np.array([r[5] for r in rows])
ismk = np.array([r[6] for r in rows], dtype=float)
X = np.column_stack([f, f[:, 0] * f[:, 2], f[:, 1] * f[:, 2]])
beta, *_ = np.linalg.lstsq(X, raw, rcond=None)
beta = np.round(beta, 3)
resid = raw - X @ beta
sd = round(float(resid.std()), 3)
print(f"{len(raw)} 人次；原始分平均 {raw.mean():.3f}、標準差 {raw.std():.3f}；殘差平均 {resid.mean():.4f}")
print("β（AD, AP, 承傷, 保人, AD×承傷, AP×承傷）=", beta.tolist(), " SD =", sd)


def shown(mk):
    return np.clip(50 + 20 * (resid + mk * ismk * f[:, 0]) / sd, 0, 100)


lo, hi = 0.0, 4.0
for _ in range(60):
    mid = (lo + hi) / 2
    if shown(mid)[role == "射手"].mean() < 50:
        lo = mid
    else:
        hi = mid
mk = round((lo + hi) / 2, 2)
print("射手加分係數 MK =", mk)
for name, val in (("校正前", 50 + 20 * (raw - raw.mean()) / raw.std()), ("校正後（含射手加分）", shown(mk))):
    print(name, {k: round(float(val[role == k].mean()), 1) for k in ("射手", "法師", "刺客", "鬥士", "坦克", "輔助")})
