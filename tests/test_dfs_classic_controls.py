from collections import Counter

import pandas as pd
import pytest

from src.products.lineup_optimizer import LineupPlayer, optimize_multiple_lineups, optimize_from_pool_dataframe, weighted_stack_schedule
from src.products.dfs_classic_controls import validate_classic_result


def players():
    rows = []
    for team in ("AAA", "BBB", "CCC", "DDD"):
        for pos, amount in (("QB", 1), ("RB", 2), ("WR", 4), ("TE", 1), ("DST", 1)):
            for i in range(amount):
                score = 30 - len(rows) / 3
                rows.append(LineupPlayer(f"{team}-{pos}{i}", f"{team} {pos}{i}", team, pos, score, score - 3, score + 5, salary=4000, dfs_id=str(len(rows) + 1)))
    return rows


GAMES = [{"game_id": "a-b", "teams": ["AAA", "BBB"], "weight": 3},
         {"game_id": "c-d", "teams": ["CCC", "DDD"], "weight": 1}]
ROSTER = {"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1}


def build(**kwargs):
    return optimize_multiple_lineups(players(), count=4, roster=ROSTER, max_overlap=8, salary_cap=50000, **kwargs)


def usage(result):
    return Counter(row["player_id"] for entry in result["lineups"] for row in entry["lineup"])


def test_individual_counts_include_zero_and_respect_shared_cap():
    result = build(player_maximum_counts={"AAA-QB0": 1, "AAA-WR0": 0}, max_exposure=.75)
    assert result["ok"] and result["complete"]
    counts = usage(result)
    assert counts["AAA-QB0"] <= 1 and counts["AAA-WR0"] == 0
    assert max(counts.values()) <= 3


def test_explicit_cap_does_not_exempt_locks_or_change_existing_lock_behavior():
    with pytest.raises(ValueError, match="locked.*only 3"):
        build(locked_player_ids={"AAA-QB0"}, player_maximum_counts={"AAA-QB0": 3})
    result = build(locked_player_ids={"AAA-QB0"}, max_exposure=.75)
    assert result["ok"] and usage(result)["AAA-QB0"] == 4


def test_weighted_game_preflight_and_named_stack_capacity():
    with pytest.raises(ValueError, match="needs 3.*at most 2"):
        build(stack_game_weights=GAMES, player_maximum_counts={"AAA-QB0": 1, "BBB-QB0": 1})
    choices = [{"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["AAA-WR3", "BBB-RB1"]}]
    with pytest.raises(ValueError, match="at most 1"):
        build(stack_game_weights=GAMES, stack_choices=choices, player_maximum_counts={"AAA-WR3": 1})
    with pytest.raises(ValueError, match="needs 3.*at most 2"):
        build(stack_game_weights=GAMES, max_exposure=.25, player_maximum_counts={"AAA-WR0": 4})
    with pytest.raises(ValueError, match="at most 0"):
        build(stack_game_weights=GAMES, locked_player_ids={"CCC-QB0"}, player_maximum_counts={"CCC-QB0": 4})


def test_weights_and_qb_specific_inclusions_work_together_without_global_locks():
    games = [{**GAMES[0], "weight": 1}]
    choices = [{"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["AAA-WR3", "BBB-RB1"]},
               {"game_id": "a-b", "qb_id": "BBB-QB0", "player_ids": ["BBB-WR3"]}]
    result = build(stack_game_weights=games, stack_choices=choices,
                   player_maximum_counts={"AAA-QB0": 1, "AAA-WR3": 1, "BBB-QB0": 3})
    assert result["ok"] and result["complete"]
    assert usage(result)["AAA-QB0"] == 1 and usage(result)["BBB-QB0"] == 3
    for entry in result["lineups"]:
        ids = {row["player_id"] for row in entry["lineup"]}
        if "AAA-QB0" in ids:
            assert {"AAA-WR3", "BBB-RB1"} <= ids
        else:
            assert "AAA-WR3" not in ids and "BBB-WR3" in ids


def test_game_allocation_remains_requested_and_partial_builds_are_reported():
    result = build(stack_game_weights=GAMES, player_maximum_counts={"AAA-QB0": 2, "BBB-QB0": 1})
    assert result["ok"] and result["complete"]
    qbs = [next(row for row in entry["lineup"] if row["slot"] == "QB")["team"] for entry in result["lineups"]]
    assert sum(team in ("AAA", "BBB") for team in qbs) == 3
    # Shared receiver budget can prevent completion even when QB capacity passes.
    choices = [{"game_id": "a-b", "qb_id": qb, "player_ids": ["AAA-WR3"]} for qb in ("AAA-QB0", "BBB-QB0")]
    partial = build(stack_game_weights=[GAMES[0]], stack_choices=choices, player_maximum_counts={"AAA-WR3": 2})
    assert partial["ok"] and not partial["complete"] and partial["count"] == 2
    assert "Built 2 of 4" in partial["note"]


@pytest.mark.parametrize("choice", [
    {"game_id": "missing", "qb_id": "AAA-QB0", "player_ids": []},
    {"game_id": "a-b", "qb_id": "CCC-QB0", "player_ids": []},
    {"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["CCC-WR0"]},
    {"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["AAA-RB0"]},
    {"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["AAA-WR0", "AAA-WR0"]},
])
def test_invalid_stack_inputs_rejected(choice):
    with pytest.raises(ValueError):
        build(stack_game_weights=GAMES, stack_choices=[choice])


def test_independent_result_checks_and_single_lineup_caps():
    result = build()
    assert not validate_classic_result(result, {"AAA-QB0": 0}, [])["ok"]
    assert not validate_classic_result(result, {}, [{"qb_id": "AAA-QB0", "player_ids": ["absent"]}])["ok"]
    assert not validate_classic_result(result, {}, [{"game_id": "a-b", "qb_id": "BBB-QB0", "player_ids": []}],
                                      [GAMES[0]], weighted_stack_schedule([GAMES[0]], 4))["ok"]
    frame = pd.DataFrame([{ "player_id": p.player_id, "Player": p.name, "Team": p.team, "Position": p.position,
                          "Projected Points": p.proj, "Low (P10)": p.floor, "High (P90)": p.ceiling,
                          "salary": p.salary, "dfs_id": p.dfs_id} for p in players()])
    single = optimize_from_pool_dataframe(frame, site="draftkings", player_maximum_counts={"AAA-QB0": 0})
    assert single["ok"] and single["validation"]["ok"]
    assert usage(single)["AAA-QB0"] == 0
    assert single["build_snapshot"]["content"]["parameters"]["player_maximum_counts"] == {"AAA-QB0": 0}
    with pytest.raises(ValueError, match="Classic only"):
        optimize_from_pool_dataframe(frame, site="draftkings_showdown", player_maximum_counts={"AAA-QB0": 0})


def test_api_strict_counts_and_forwarding(monkeypatch):
    import app.api as api
    from pydantic import ValidationError
    for invalid in (1.5, True, "2"):
        with pytest.raises(ValidationError):
            api.LineupOptimizeRequest(player_maximum_counts={"qb": invalid})
    seen = {}
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kw: (pd.DataFrame([{"player_id": "qb", "Player": "QB", "Position": "QB", "Team": "AAA", "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15}]), {}))
    monkeypatch.setattr(api, "optimize_from_pool_dataframe", lambda pool, **kw: seen.update(kw) or {"ok": True})
    api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings", player_maximum_counts={"qb": 2},
        stack_choices=[{"game_id": "game", "qb_id": "qb", "player_ids": ["wr"]}]), {})
    assert seen["player_maximum_counts"] == {"qb": 2}
    assert seen["stack_choices"][0]["player_ids"] == ["wr"]


def test_150_lineups_keep_game_allocation_and_stack_budgets():
    result = optimize_multiple_lineups(players(), count=150, roster=ROSTER, max_overlap=8, salary_cap=50000,
        stack_game_weights=GAMES, player_maximum_counts={"AAA-QB0": 75, "BBB-QB0": 75, "AAA-WR3": 75},
        stack_choices=[{"game_id": "a-b", "qb_id": "AAA-QB0", "player_ids": ["AAA-WR3"]},
                       {"game_id": "a-b", "qb_id": "BBB-QB0", "player_ids": []}])
    assert result["ok"] and result["complete"] and result["count"] == 150
    identities = {tuple(sorted(row["player_id"] for row in entry["lineup"])) for entry in result["lineups"]}
    assert len(identities) == 150
    counts = usage(result)
    assert counts["AAA-QB0"] <= 75 and counts["BBB-QB0"] <= 75 and counts["AAA-WR3"] <= 75
    assert counts["AAA-QB0"] + counts["BBB-QB0"] == 113
    assert validate_classic_result(result, {"AAA-WR3": 75}, [{"qb_id": "AAA-QB0", "player_ids": ["AAA-WR3"]}])["ok"]
    assert Counter(tuple(teams) for teams in weighted_stack_schedule([{"teams": ["A", "B"], "weight": 1}, {"teams": ["C", "D"], "weight": 1}, {"teams": ["E", "F"], "weight": 4}], 2)) == {("A", "B"): 1, ("E", "F"): 1}
