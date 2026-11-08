"""產生本場貢獻 v3 的校正常數（contribution.yml 第 4、6 步）：各出裝定位每個基因的平均、各基因的標準差、總分的 SD。唯讀，除非加 --write。

做法：把 yml 裡「校正常數開始」到「校正常數結束」之間換成中性值（平均 0、標準差 1），跑一次 SQL 取出每個人的同場比分數 p_*，
1. 各出裝定位（射手、法師、刺客、鬥士、坦克、輔助）的平均；未成形用全體平均；治療護盾依資料來源（eog／flag）各算一組；
2. 扣掉平均後的標準差（治療護盾例外：用有治療到隊友的人之間的標準差，見下面的註解）；
3. 依權重加總後的標準差（總分的 SD）與平均（整體校正 mu_work；v3.5 控場只加不扣，raw 的平均不再是 0）。
印出要寫回 yml 的常數區塊；加 --write 直接寫回。定版之後不要再自動跑：常數一變，所有舊分都會變，要升 score_version。

用法：uv run python analysis/scoring_v3_fit.py [mayhem.db] [--write]
"""
import re
import sqlite3
import sys
from pathlib import Path
from statistics import mean, pstdev

import yaml

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DB = ARGS[0] if ARGS else "mayhem.db"
YML = Path(__file__).parent.parent / "cube" / "model" / "cubes" / "contribution.yml"
# 只加不扣的基因（ks 是擊殺和輸出取小之後再夾，見下面的 kd）
ADD_ONLY = {"t", "c", "h", "a", "w", "o"}
ROLES = ["射手", "法師", "刺客", "鬥士", "坦克", "輔助"]
GENES = ["d", "w", "o", "t", "c", "h", "a", "kda", "ks"]
# 和 yml 第 5 步相同（改權重要兩邊一起改）
# kd＝擊殺（擊殺占比和輸出的 z 取小，只加不扣，v3.8）
# v3.9：K/DA 不計分（gene_kda 仍要它的平均與標準差，所以 GENES 裡留著）
WEIGHTS = {"d": 0.23, "t": 0.19, "kd": 0.14, "h": 0.18, "c": 0.11, "o": 0.07, "w": 0.05, "a": 0.03}
FRONTLINE_WEIGHTS = {**WEIGHTS, "d": 0.13, "t": 0.25, "c": 0.15}
BLOCK = re.compile(r"(-- 校正常數開始[^\n]*\n)(.*?)(\n\s*-- 校正常數結束)", re.S)


def block(mu: dict, sd: dict, sd_work: float, mu_work: float) -> str:
    """常數區塊（開始與結束兩行註解之間的內容）"""
    rows = []
    for role in ROLES + ["未成形"]:
        m = mu[role]
        vals = [m["d"], m["w"], m["o"], m["t"], m["c"], m["h_eog"], m["h_flag"], m["a"], m["kda"], m["ks"]]
        rows.append(f"              ('{role}', " + ", ".join(f"{v:.3f}" for v in vals) + ")")
    s = [sd["d"], sd["w"], sd["o"], sd["t"], sd["c"], sd["h_eog"], sd["h_flag"], sd["a"], sd["kda"], sd["ks"]]
    return ("            VALUES\n" + ",\n".join(rows) + "\n          ),\n"
            "          sd(sd_d, sd_w, sd_o, sd_t, sd_c, sd_h_eog, sd_h_flag, sd_a, sd_kda, sd_ks, sd_work, mu_work) AS (\n"
            "            VALUES (" + ", ".join(f"{v:.3f}" for v in s) + f", {sd_work:.4f}, {mu_work:.4f})")


text = YML.read_text(encoding="utf-8")
sql = yaml.safe_load(text)["cubes"][0]["meta"]["materialize"]["sql"]
zero = {r: {k: 0.0 for k in ["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda", "ks"]} for r in ROLES + ["未成形"]}
one = {k: 1.0 for k in ["d", "w", "o", "t", "c", "h_eog", "h_flag", "a", "kda", "ks"]}
neutral = BLOCK.sub(lambda m: m.group(1) + block(zero, one, 1.0, 0.0) + m.group(3), sql)
assert neutral != sql or "VALUES (1.000" in sql, "找不到常數區塊"

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
# 用本次的出裝規則校正，不依賴資料庫中上一版的衍生表。
builds = yaml.safe_load(YML.with_name("builds.yml").read_text(encoding="utf-8"))
build_sql = builds["cubes"][0]["meta"]["materialize"]["sql"]
c.execute("BEGIN")
c.execute(f"CREATE TEMP TABLE mat_builds AS {build_sql}")
rows = c.execute(f"""SELECT build_role, heal_src, p_d, p_w, p_o, p_t, p_c, p_h, p_a, p_kda, p_ks FROM ({neutral}) WHERE work_score IS NOT NULL""").fetchall()
c.close()
roles = [r[0] for r in rows]
eog = [i for i, r in enumerate(rows) if r[1] == "eog"]
all_rows = range(len(rows))
P = {g: [r[2 + i] for r in rows] for i, g in enumerate(GENES)}
print(f"{len(rows)} 人次（eog {len(eog)}、flag {len(rows) - len(eog)}）")

mu = {r: {} for r in ROLES + ["未成形"]}
sd = {}
resid = {}
for g in GENES:
    # v3.4：治療護盾只算賽後統計（eog）的場次；flag 場次不計這一項（z＝0），見下面的 h_flag
    name, selected = ("h_eog", eog) if g == "h" else (g, all_rows)
    values = P[g]
    overall = mean(values[i] for i in selected)
    for r in ROLES + ["未成形"]:
        group = [values[i] for i in selected if roles[i] == r]
        mu[r][name] = round(mean(group) if r != "未成形" and group else overall, 3)
    centered = [values[i] - mu[roles[i]][name] for i in selected]
    # 治療護盾用實際有保人量的分布，其餘用扣除定位基準後的分布。
    spread = [values[i] for i in selected if values[i] > 0] if g == "h" else centered
    sd[name] = round(pstdev(spread), 3)
    resid[g] = [0.0] * len(rows)
    for i, value in zip(selected, centered):
        z = value / sd[name]
        resid[g][i] = max(z, 0.0) if g in ADD_ONLY else z
        if g == "h":
            resid[g][i] = (values[i] / sd[name] + resid[g][i]) / 2
# flag 場次的治療護盾不計分：常數寫 0／1，yml 的 sd 與 calib 欄位仍在但不會被用到
for r in ROLES + ["未成形"]:
    mu[r]["h_flag"] = 0.0
sd["h_flag"] = 1.0
# 擊殺和沒夾的輸出取小，再依定位處理輸出權重與扣分。
resid["kd"] = [max(0.0, min(k, d)) for k, d in zip(resid["ks"], resid["d"])]
raw = []
for i, role in enumerate(roles):
    weights = WEIGHTS
    if role in ("坦克", "輔助"):
        weights = FRONTLINE_WEIGHTS
        resid["d"][i] = max(0.0, resid["d"][i])
    if role == "輔助":
        if resid["t"][i] > 0.5:
            resid["t"][i] = 0.5 + 0.4 * (resid["t"][i] - 0.5)
        resid["h"][i] *= 5 / 6
    raw.append(sum(weight * resid[g][i] for g, weight in weights.items()))
sd_work = round(pstdev(raw), 4)
mu_work = round(mean(raw), 4)
new_block = block(mu, sd, sd_work, mu_work)
print(new_block)
score = [min(100, max(0, 50 + 20 * (value - mu_work) / sd_work)) for value in raw]
print("各出裝平均：", {r: round(mean(s for s, role in zip(score, roles) if role == r), 1) for r in ROLES if r in roles})
print("總分平均", round(mean(score), 2), "標準差", round(pstdev(score), 2), "0 分", score.count(0), "100 分", score.count(100))

if "--write" in sys.argv:
    out = BLOCK.sub(lambda m: m.group(1) + new_block + m.group(3), text)
    assert out != text or new_block in text
    YML.write_text(out, encoding="utf-8")
    print("已寫回", YML)
