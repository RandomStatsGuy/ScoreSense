"""Reproducible synthetic identity workload; no DB, network, or artifact writes."""
import argparse
import json
from time import perf_counter

from src.draft_hub import value_sheet
from src.draft_hub.roster_identity_match import find_matching_roster_slot
from src.draft_hub.schemas import LeagueRules


class ScanIndex:
    """Previous scan matcher used as the comparison oracle."""
    def __init__(self, rows, *, occupying_only=True):
        self.rows, self.occupying_only = rows, occupying_only

    def find(self, player, *, team_id=None):
        return find_matching_roster_slot(self.rows, player, team_id=team_id, occupying_only=self.occupying_only)


def benchmark(compare=False):
    pool = {"rows": [{"player_id": f"00-{i:07d}", "player": f"Player {i}", "position": "WR", "fair_value": 5}
                     for i in range(1200)]}
    roster = [{"player_id": f"00-{i:07d}", "player_name": f"Player {i}", "position": "WR", "team_id": str(i % 12),
               "salary": 5, "contract_years": 2, "roster_status": "active", "source": "import"} for i in range(240)]
    index = value_sheet.RosterIdentityIndex
    results, previous = {}, None
    try:
        for label, implementation in [("prepared", index)] + ([("scan", ScanIndex)] if compare else []):
            value_sheet.RosterIdentityIndex = implementation
            start = perf_counter()
            result = value_sheet.build_value_overlay(pool, LeagueRules(), roster[:20], league_roster=roster,
                                                    my_team_id="0", draft_completed=True)
            results[label + "_ms"] = round((perf_counter() - start) * 1000, 1)
            if previous is not None:
                assert previous == result, "Changed availability or valuation results"
            previous = result
    finally:
        value_sheet.RosterIdentityIndex = index
    return {"board_players": 1200, "roster_players": 240, **results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", action="store_true")
    print(json.dumps(benchmark(parser.parse_args().compare)))
