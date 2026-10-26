"""產生本場貢獻 v3 的校正常數（contribution.yml 第 4、6 步）：各出裝定位每個基因的平均、各基因的標準差、總分的 SD。唯讀，除非加 --write。

做法：把 yml 裡「校正常數開始」到「校正常數結束」之間換成中性值（平均 0、標準差 1），跑一次 SQL 取出每個人的同場比分數 p_*，
1. 各出裝定位（射手、法師、刺客、鬥士、坦克、輔助）的平均；未成形用全體平均；治療護盾依資料來源（eog／flag）各算一組；
2. 扣掉平均後的標準差（治療護盾例外：用有治療到隊友的人之間的標準差，見下面的註解）；
3. 依權重加總後的標準差（總分的 SD）。
印出要寫回 yml 的常數區塊；加 --write 直接寫回。定版之後不要再自動跑：常數一變，所有舊分都會變，要升 score_version。

用法：uv run --with numpy python analysis/scoring_v3_fit.py [mayhem.db] [--write]
"""
import re
import sqlite3
import sys
from pathlib import Path

import numpy as np
import yaml

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DB = ARGS[0] if ARGS else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
ROLES = ["射手", "法師", "刺客", "鬥士", "坦克", "輔助"]
GENES = ["d", "w", "o", "t", "c", "h", "a", "kda"]
# 和 yml 第 5 步相同（改權重要兩邊一起改）
WEIGHTS = {"d": 0.25, "t": 0.20, "h": 0.13, "c": 0.12, "kda": 0.12, "o": 0.08, "w": 0.06, "a": 0.04}
BLOCK = re.compile(r"(-- 校正常數開始[^\n]*\n)(.*?)(\n\s*-- 校正常數結束)", re.S)


def block(mu: dict, sd: dict, sd_work: float) -> str:
    """常數區塊（開始與結束兩行註解之間的內容）"""
    rows = []
    for role in ROLES + ["未成形"]:
        m = mu[role]
        vals = [m["d"], m["w"], m["o"], m["t"], m["c"], m["h_eog"], m["h_flag"], m["a"], m["kda"]]
        rows.append(f"              ('{role}', " + ", ".join(f"{v:.3f}" for v in vals) + ")")
    s = [sd["d"], sd["w"], sd["o"], sd["t"], sd["c"], sd["h_eog"], sd["h_flag"], sd["a"], sd["kda"]]
    return ("            VALUES\n" + ",\n".join(rows) + "\n          ),\n"
            "          sd(sd_d, sd_w, sd_o, sd_t, sd_c, sd_h_eog, sd_h_flag, sd_a, sd_kda, sd_work) AS (\n"
            "            VALUES (" + ", ".join(f"{v:.3f}" for v in s) + f", {sd_work:.4f})")


text = YML.read_text(encoding="utf-8")
sql = yaml.safe_load(text)["cubes"][0]["meta"]["materialize"]["sql"]
zero = {r: {k: 0.0 for k in ["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda"]} for r in ROLES + ["未成形"]}
one = {k: 1.0 for k in ["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda"]}
neutral = BLOCK.sub(lambda m: m.group(1) + block(zero, one, 1.0) + m.group(3), sql)
assert neutral != sql or "VALUES (1.000" in sql, "找不到常數區塊"

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = c.execute(f"""SELECT build_role, heal_src, p_d, p_w, p_o, p_t, p_c, p_h, p_a, p_kda FROM ({neutral}) WHERE work_score IS NOT NULL""").fetchall()
role = np.array([r[0] for r in rows])
src = np.array([r[1] for r in rows])
P = {g: np.array([r[2 + i] for r in rows], float) for i, g in enumerate(GENES)}
print(f"{len(rows)} 人次（eog {int((src == 'eog').sum())}、flag {int((src == 'flag').sum())}）")

mu = {r: {} for r in ROLES + ["未成形"]}
sd = {}
resid = {}
for g in GENES:
    # v3.4：治療護盾只算賽後統計（eog）的場次；flag 場次不計這一項（z＝0），見下面的 h_flag
    groups = [("h_eog", src == "eog")] if g == "h" else [(g, np.ones(len(rows), bool))]
    r_all = np.zeros(len(rows))
    for name, sel in groups:
        overall = float(P[g][sel].mean())
        for r in ROLES + ["未成形"]:
            m = sel & (role == r)
            mu[r][name] = round(float(P[g][m].mean()), 3) if r != "未成形" and m.sum() else round(overall, 3)
        expect = np.array([mu[r][name] for r in role])
        r_all[sel] = (P[g] - expect)[sel]
        # 治療護盾大部分人是 0，扣掉平均後的標準差很小（eog 只有 7），會讓會補血的人一項就加三四十分；
        # 改用「有治療到隊友的人」之間的標準差，代表治療量本身的分布寬度
        sd[name] = round(float(P[g][sel & (P[g] > 0)].std() if g == "h" else r_all[sel].std()), 3)
        r_all[sel] = r_all[sel] / sd[name]
    resid[g] = r_all
# flag 場次的治療護盾不計分：常數寫 0／1，yml 的 sd 與 calib 欄位仍在但不會被用到
for r in ROLES + ["未成形"]:
    mu[r]["h_flag"] = 0.0
sd["h_flag"] = 1.0
raw = sum(WEIGHTS[g] * resid[g] for g in GENES)
sd_work = round(float(raw.std()), 4)
new_block = block(mu, sd, sd_work)
print(new_block)
score = np.clip(50 + 20 * raw / sd_work, 0, 100)
print("各出裝平均：", {r: round(float(score[role == r].mean()), 1) for r in ROLES})
print("總分平均", round(float(score.mean()), 2), "標準差", round(float(score.std()), 2), "0 分", int((score <= 0).sum()), "100 分", int((score >= 100).sum()))

if "--write" in sys.argv:
    out = BLOCK.sub(lambda m: m.group(1) + new_block + m.group(3), text)
    assert out != text or new_block in text
    YML.write_text(out, encoding="utf-8")
    print("已寫回", YML)
