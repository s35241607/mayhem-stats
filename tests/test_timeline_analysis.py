import unittest

from timeline_analysis import summarize_fights


def kill(t, team, killer=1):
    return {"t": t, "team": team, "killerId": killer}


def tower(t, owner=200):
    return {"t": t, "owner": owner, "kind": "INNER_TURRET"}


class TimelineAnalysisTests(unittest.TestCase):
    def test_comeback_uses_the_last_kill_that_establishes_a_durable_lead(self):
        kills = [kill(10, 200), kill(15, 100), kill(19, 100), kill(21, 100)]
        fight, = summarize_fights(kills, [tower(24, owner=100), tower(28)])
        self.assertEqual((fight["kills100"], fight["kills200"], fight["winner"]), (3, 1, 100))
        self.assertEqual(fight["keyKillIndex"], 2)
        self.assertEqual(fight["objectiveIndices"], [1])
        self.assertTrue(fight["reversal"])

    def test_a_later_fight_prevents_attribution_to_an_earlier_fight(self):
        kills = [kill(1, 100), kill(5, 100), kill(25, 100)]
        fight, = summarize_fights(kills, [tower(26)])
        self.assertEqual(fight["objectiveIndices"], [])
        self.assertIsNone(fight["keyKillIndex"])

    def test_environmental_deaths_do_not_bridge_fights(self):
        kills = [kill(1, 100), kill(10, 100, None), kill(17, 100)]
        self.assertEqual(summarize_fights(kills, [tower(20)]), [])

    def test_simultaneous_kills_do_not_get_an_arbitrary_key_kill(self):
        fight, = summarize_fights([kill(1, 100), kill(1, 100)], [tower(4)])
        self.assertEqual(fight["objectiveIndices"], [0])
        self.assertIsNone(fight["keyKillIndex"])
