"""從單場事件辨認交戰與推進，供戰報顯示。"""

FIGHT_GAP_SECONDS = 12
PUSH_WINDOW_SECONDS = 30
TOWER_KINDS = {"OUTER_TURRET", "INNER_TURRET", "BASE_TURRET", "NEXUS_TURRET"}


def summarize_fights(kills, buildings):
    """回傳事件索引。輸入是已依時間排序的擊殺與拆建築紀錄。"""
    groups = []
    for i, kill in enumerate(kills):
        if kill["killerId"] is None:
            continue
        if not groups or kill["t"] - kills[groups[-1][-1]]["t"] > FIGHT_GAP_SECONDS:
            groups.append([])
        groups[-1].append(i)

    fights = []
    for j, indices in enumerate(groups):
        if len(indices) < 2:
            continue
        start, end = kills[indices[0]]["t"], kills[indices[-1]]["t"]
        kills100 = sum(kills[i]["team"] == 100 for i in indices)
        kills200 = len(indices) - kills100
        winner = None if kills100 == kills200 else (100 if kills100 > kills200 else 200)
        next_start = kills[groups[j + 1][0]]["t"] if j + 1 < len(groups) else float("inf")
        objectives = []
        key_kill = None
        reversal = False
        if winner is not None:
            objectives = [
                i for i, event in enumerate(buildings)
                if end < event["t"] <= end + PUSH_WINDOW_SECONDS and event["t"] < next_start
                and event["owner"] == 300 - winner
                and (event["kind"] in TOWER_KINDS or event["kind"] == "INHIBITOR_BUILDING")
            ]
            lead = 0
            for position, i in enumerate(indices):
                if lead <= 0:
                    pivot = i
                lead += 1 if kills[i]["team"] == winner else -1
                if position + 1 == len(indices) or kills[i]["t"] != kills[indices[position + 1]]["t"]:
                    reversal = reversal or lead < 0
            # 同一時間戳的多筆擊殺無法可靠排序，保留交戰但略過單顆標記。
            same_time = sum(kills[i]["t"] == kills[pivot]["t"] for i in indices) > 1
            if not same_time and any(buildings[i]["kind"] in TOWER_KINDS for i in objectives):
                key_kill = pivot
        fights.append({
            "start": start, "end": end, "killIndices": indices,
            "kills100": kills100, "kills200": kills200, "winner": winner,
            "objectiveIndices": objectives, "keyKillIndex": key_kill, "reversal": reversal,
        })
    return fights
