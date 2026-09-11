"""Tests for lineup optimizer."""

import pandas as pd

from src.products.lineup_optimizer import (
    LineupPlayer,
    _locked_stack_error,
    collect_keep_teams,
    optimize_lineup,
    optimize_multiple_lineups,
    reserve_pool_for_keep_teams,
)


def _sample_pool() -> list[LineupPlayer]:
    return [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 22, 15, 28),
        LineupPlayer("qb2", "QB Two", "BBB", "QB", 18, 12, 24),
        LineupPlayer("rb1", "RB One", "AAA", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "BBB", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "CCC", "RB", 12, 8, 18),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 15, 9, 21),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 11, 7, 17),
        LineupPlayer("te1", "TE One", "AAA", "TE", 10, 6, 15),
        LineupPlayer("te2", "TE Two", "BBB", "TE", 8, 5, 12),
        LineupPlayer("rb4", "RB Four", "DDD", "RB", 9, 6, 14),
    ]


def test_optimize_lineup_fills_all_slots():
    result = optimize_lineup(_sample_pool(), objective="median")
    assert result["ok"] is True
    assert len(result["lineup"]) == 7
    slots = {row["slot"] for row in result["lineup"]}
    assert "QB" in slots
    assert "FLEX" in slots
    assert result["total_points"] > 0


def test_optimize_lineup_respects_lock():
    result = optimize_lineup(_sample_pool(), objective="median", locked_player_ids={"qb2"})
    assert result["ok"] is True
    qbs = [row for row in result["lineup"] if row["slot"] == "QB"]
    assert len(qbs) == 1
    assert qbs[0]["player_id"] == "qb2"


def test_optimize_lineup_insufficient_pool():
    tiny = _sample_pool()[:3]
    result = optimize_lineup(tiny, objective="median")
    assert result["ok"] is False


def test_optimize_multiple_lineups_diverse():
    pool = _sample_pool()
    result = optimize_multiple_lineups(pool, count=2, max_overlap=3, objective="median")
    assert result["ok"] is True
    assert len(result["lineups"]) == 2
    ids1 = {r["player_id"] for r in result["lineups"][0]["lineup"]}
    ids2 = {r["player_id"] for r in result["lineups"][1]["lineup"]}
    assert len(ids1 & ids2) <= 3


def test_optimize_qb_stack_requires_pass_catcher():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 22, 15, 28),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 15, 9, 21),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 11, 7, 17),
        LineupPlayer("te1", "TE One", "EEE", "TE", 10, 6, 15),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    result = optimize_lineup(players, roster=roster, require_qb_stack=True)
    assert result["ok"] is True
    qb = next(r for r in result["lineup"] if r["slot"] == "QB")
    same_team = [r for r in result["lineup"] if r["team"] == qb["team"] and r["position"] in ("WR", "TE")]
    assert len(same_team) >= 1


def test_optimize_qb_stack_count_two_pass_catchers():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 22, 15, 28),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 9, 5, 13),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 15, 9, 21),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 13, 8, 19),
        LineupPlayer("te1", "TE One", "AAA", "TE", 6, 3, 10),
        LineupPlayer("te2", "TE Two", "EEE", "TE", 10, 6, 15),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    result = optimize_lineup(players, roster=roster, qb_stack_count=2)
    assert result["ok"] is True
    qb = next(r for r in result["lineup"] if r["slot"] == "QB")
    mates = [
        r
        for r in result["lineup"]
        if r["team"] == qb["team"] and r["position"] in ("WR", "TE")
    ]
    assert len(mates) >= 2


def test_collect_keep_teams_adds_locked_qb_side_and_opponent():
    pool = pd.DataFrame(
        [
            {"player_id": "willis", "Team": "MIA", "Opponent": "LV"},
            {"player_id": "cousins", "Team": "LVR", "Opponent": "MIA"},
            {"player_id": "allen", "Team": "BUF", "Opponent": "NYJ"},
        ]
    )
    keys = collect_keep_teams(["MIA"], ["willis"], pool)
    assert keys == {"MIA", "LV"}
    from_pin = collect_keep_teams(None, ["cousins"], pool)
    assert from_pin == {"LV", "MIA"}
    sparse = pd.DataFrame(
        [
            {"player_id": "willis", "Team": None, "Opponent": float("nan")},
            {"player_id": "cousins", "Team": "LV", "Opponent": "MIA"},
        ]
    )
    assert collect_keep_teams(None, ["willis"], sparse) == set()
    assert collect_keep_teams(None, ["cousins"], sparse) == {"LV", "MIA"}
    reserved = reserve_pool_for_keep_teams(sparse, {"LV", "MIA"})
    assert set(reserved["player_id"]) == {"cousins"}
    nan_team = pd.DataFrame(
        [
            {"player_id": "bye", "Team": float("nan")},
            {"player_id": "waddle", "Team": "MIA"},
        ]
    )
    assert set(reserve_pool_for_keep_teams(nan_team, {"MIA"})["player_id"]) == {"waddle"}


def test_locked_stack_error_tolerates_missing_locks():
    assert _locked_stack_error(_sample_pool(), None, 2) is None
    assert _locked_stack_error(_sample_pool(), set(), 2) is None


def test_optimize_locked_willis_with_mates_builds():
    players = [
        LineupPlayer("willis", "Malik Willis", "MIA", "QB", 9, 1, 25, opponent="LV"),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("waddle", "Jaylen Waddle", "MIA", "WR", 15, 9, 22),
        LineupPlayer("wease", "Theo Wease Jr.", "MIA", "WR", 8, 4, 14),
        LineupPlayer("bowers", "Brock Bowers", "LV", "TE", 12, 7, 20),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 11, 7, 17),
        LineupPlayer("te2", "TE Two", "EEE", "TE", 7, 4, 11),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    result = optimize_lineup(
        players,
        roster=roster,
        qb_stack_count=2,
        stack_bring_back=True,
        locked_player_ids={"willis"},
    )
    assert result["ok"] is True
    qb = next(row for row in result["lineup"] if row["slot"] == "QB")
    assert qb["player_id"] == "willis"
    mates = [
        row
        for row in result["lineup"]
        if row["team"] == "MIA" and row["position"] in ("WR", "TE")
    ]
    assert len(mates) >= 2


def test_optimize_locked_qb_without_mates_explains_the_miss():
    players = [
        LineupPlayer("willis", "Malik Willis", "MIA", "QB", 9, 1, 25),
        LineupPlayer("cousins", "Kirk Cousins", "LV", "QB", 11, 6, 18),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("dulcich", "Greg Dulcich", "MIA", "TE", 6, 3, 12),
        LineupPlayer("bowers", "Brock Bowers", "LV", "TE", 12, 7, 20),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 11, 7, 17),
        LineupPlayer("wr4", "WR Four", "EEE", "WR", 10, 6, 15),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    result = optimize_lineup(
        players,
        roster=roster,
        qb_stack_count=2,
        locked_player_ids={"willis"},
    )
    assert result["ok"] is False
    assert "Malik Willis" in result["error"]
    assert "pass catchers" in result["error"]


def test_optimize_stack_teams_uses_a_qb_from_the_marked_game():
    players = [
        LineupPlayer("willis", "Malik Willis", "MIA", "QB", 9, 1, 25, opponent="LV"),
        LineupPlayer("allen", "Josh Allen", "BUF", "QB", 24, 16, 34, opponent="NYJ"),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("waddle", "Jaylen Waddle", "MIA", "WR", 15, 9, 22),
        LineupPlayer("wease", "Theo Wease Jr.", "MIA", "WR", 8, 4, 14),
        LineupPlayer("bowers", "Brock Bowers", "LV", "TE", 12, 7, 20),
        LineupPlayer("shakir", "Khalil Shakir", "BUF", "WR", 14, 8, 20),
        LineupPlayer("kincaid", "Dalton Kincaid", "BUF", "TE", 11, 6, 16),
        LineupPlayer("te2", "TE Two", "EEE", "TE", 7, 4, 11),
        LineupPlayer("wr4", "WR Four", "EEE", "WR", 6, 3, 10),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    result = optimize_lineup(
        players,
        roster=roster,
        qb_stack_count=2,
        stack_bring_back=True,
        stack_teams=["MIA", "LV"],
    )
    assert result["ok"] is True
    qb = next(row for row in result["lineup"] if row["slot"] == "QB")
    assert qb["player_id"] == "willis"


def test_optimize_bring_back_uses_opponent_player():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 22, 15, 28, opponent="ZZZ"),
        LineupPlayer("rb1", "RB One", "BBB", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "CCC", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 12, 8, 18),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 15, 9, 21),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 12, 7, 18),
        LineupPlayer("wrz", "WR Rival", "ZZZ", "WR", 2, 1, 4),
        LineupPlayer("te1", "TE One", "AAA", "TE", 10, 6, 15),
        LineupPlayer("te2", "TE Two", "EEE", "TE", 8, 5, 12),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    without = optimize_lineup(players, roster=roster)
    assert all(r["team"] != "ZZZ" for r in without["lineup"])

    result = optimize_lineup(players, roster=roster, stack_bring_back=True)
    assert result["ok"] is True
    assert any(r["team"] == "ZZZ" for r in result["lineup"])


def test_optimize_max_per_team_limits_stacking():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 22, 15, 28),
        LineupPlayer("rb1", "RB One", "AAA", "RB", 16, 10, 22),
        LineupPlayer("rb2", "RB Two", "AAA", "RB", 14, 9, 20),
        LineupPlayer("rb3", "RB Three", "DDD", "RB", 8, 5, 12),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 15, 9, 21),
        LineupPlayer("wr2", "WR Two", "AAA", "WR", 13, 8, 19),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 7, 4, 11),
        LineupPlayer("wr4", "WR Four", "FFF", "WR", 5, 3, 8),
        LineupPlayer("te1", "TE One", "AAA", "TE", 10, 6, 15),
        LineupPlayer("te2", "TE Two", "EEE", "TE", 6, 3, 9),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    unlimited = optimize_lineup(players, roster=roster)
    aaa = [r for r in unlimited["lineup"] if r["team"] == "AAA"]
    assert len(aaa) > 3

    capped = optimize_lineup(players, roster=roster, max_per_team=3)
    assert capped["ok"] is True
    aaa = [r for r in capped["lineup"] if r["team"] == "AAA"]
    assert len(aaa) <= 3


def test_optimize_min_salary_forces_spend():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 25, 18, 32, salary=8000),
        LineupPlayer("qb2", "QB Two", "BBB", "QB", 26, 12, 24, salary=5000),
        LineupPlayer("rb1", "RB One", "AAA", "RB", 20, 14, 26, salary=9000),
        LineupPlayer("rb2", "RB Two", "BBB", "RB", 19, 9, 20, salary=4500),
        LineupPlayer("rb3", "RB Three", "CCC", "RB", 18, 8, 18, salary=4000),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 18, 12, 24, salary=8500),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 17, 8, 19, salary=4200),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 16, 7, 17, salary=3800),
        LineupPlayer("te1", "TE One", "AAA", "TE", 10, 6, 15, salary=3500),
        LineupPlayer("te2", "TE Two", "BBB", "TE", 9, 5, 12, salary=3000),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    cheap = optimize_lineup(players, roster=roster, salary_cap=50000)
    assert cheap["ok"] is True
    assert cheap["total_salary"] < 41000  # the cheap QB is also the best QB

    forced = optimize_lineup(
        players, roster=roster, salary_cap=50000, min_salary=41000
    )
    assert forced["ok"] is True
    assert forced["total_salary"] >= 41000


def test_optimize_multiple_lineups_exposure_cap():
    pool = []
    for i in range(3):
        pool.append(LineupPlayer(f"qb{i}", f"QB {i}", f"T{i}", "QB", 22 - i, 15, 28))
    for i in range(6):
        pool.append(LineupPlayer(f"rb{i}", f"RB {i}", f"T{i % 4}", "RB", 18 - i, 10, 24))
    for i in range(6):
        pool.append(LineupPlayer(f"wr{i}", f"WR {i}", f"T{i % 4}", "WR", 17 - i, 9, 23))
    for i in range(3):
        pool.append(LineupPlayer(f"te{i}", f"TE {i}", f"T{i}", "TE", 11 - i, 6, 16))

    result = optimize_multiple_lineups(
        pool, count=4, max_overlap=6, max_exposure=0.5, objective="median"
    )
    assert result["ok"] is True
    assert len(result["lineups"]) == 4
    counts: dict[str, int] = {}
    for entry in result["lineups"]:
        for row in entry["lineup"]:
            counts[row["player_id"]] = counts.get(row["player_id"], 0) + 1
    assert max(counts.values()) <= 2  # ceil(0.5 * 4)
    assert result["exposure"][0]["count"] <= 2
    assert result["exposure"][0]["pct"] <= 50.0


def test_optimize_multiple_lineups_randomness_is_seeded():
    pool = _sample_pool()
    a = optimize_multiple_lineups(pool, count=3, max_overlap=5, randomness=0.3, seed=11)
    b = optimize_multiple_lineups(pool, count=3, max_overlap=5, randomness=0.3, seed=11)
    assert a["ok"] and b["ok"]
    ids_a = [sorted(r["player_id"] for r in e["lineup"]) for e in a["lineups"]]
    ids_b = [sorted(r["player_id"] for r in e["lineup"]) for e in b["lineups"]]
    assert ids_a == ids_b


def test_optimize_multiple_lineups_never_duplicates():
    pool = _sample_pool()
    # max_overlap above roster size is clamped so lineups still differ.
    result = optimize_multiple_lineups(pool, count=3, max_overlap=99, objective="median")
    assert result["ok"] is True
    seen = {tuple(sorted(r["player_id"] for r in e["lineup"])) for e in result["lineups"]}
    assert len(seen) == len(result["lineups"])


def _showdown_pool() -> list[LineupPlayer]:
    return [
        LineupPlayer("qb1", "QB Home", "AAA", "QB", 22, 15, 28, salary=10000, cpt_salary=15000, dfs_id="f1", cpt_dfs_id="c1"),
        LineupPlayer("qb2", "QB Away", "BBB", "QB", 18, 12, 24, salary=9400, cpt_salary=14100, dfs_id="f2", cpt_dfs_id="c2"),
        LineupPlayer("rb1", "RB Home", "AAA", "RB", 16, 10, 22, salary=8400, cpt_salary=12600, dfs_id="f3", cpt_dfs_id="c3"),
        LineupPlayer("rb2", "RB Away", "BBB", "RB", 14, 9, 20, salary=8200, cpt_salary=12300, dfs_id="f4", cpt_dfs_id="c4"),
        LineupPlayer("wr1", "WR Home", "AAA", "WR", 15, 9, 21, salary=10600, cpt_salary=15900, dfs_id="f5", cpt_dfs_id="c5"),
        LineupPlayer("wr2", "WR Away", "BBB", "WR", 13, 8, 19, salary=7000, cpt_salary=10500, dfs_id="f6", cpt_dfs_id="c6"),
        LineupPlayer("te1", "TE Home", "AAA", "TE", 10, 6, 15, salary=5200, cpt_salary=7800, dfs_id="f7", cpt_dfs_id="c7"),
        LineupPlayer("dst1", "Away DST", "BBB", "DST", 7, 4, 11, salary=4000, cpt_salary=6000, dfs_id="f8", cpt_dfs_id="c8"),
    ]


def test_optimize_captain_lineup_slots_and_multiplier():
    result = optimize_lineup(
        _showdown_pool(),
        roster={"cpt": 1, "flex": 5},
        salary_cap=50000,
        captain_label="CPT",
    )
    assert result["ok"] is True
    assert len(result["lineup"]) == 6
    cpt = result["lineup"][0]
    assert cpt["slot"] == "CPT"
    assert cpt["multiplier"] == 1.5
    # Captain projection and salary are boosted 1.5×.
    assert cpt["dfs_id"].startswith("c")
    assert result["total_salary"] <= 50000
    # Both teams represented per site rules.
    teams = {r["team"] for r in result["lineup"]}
    assert teams == {"AAA", "BBB"}


def test_optimize_captain_lineup_picks_best_captain():
    players = _showdown_pool()
    result = optimize_lineup(
        players,
        roster={"cpt": 1, "flex": 5},
        salary_cap=100000,  # cap loose enough that points decide the captain
    )
    assert result["ok"] is True
    cpt = result["lineup"][0]
    assert cpt["player_id"] == "qb1"  # highest projection takes the 1.5× slot
    assert cpt["proj"] == 33.0  # 22 * 1.5


def test_draftkings_captain_never_exports_a_flex_id():
    players = _showdown_pool()
    for player in players:
        player.cpt_dfs_id = ""
    result = optimize_lineup(players, roster={"cpt": 1, "flex": 5}, salary_cap=50000)
    assert result["ok"] is True
    assert result["lineup"][0]["dfs_id"] is None
    assert all(row["dfs_id"] for row in result["lineup"][1:])


def test_captain_lock_and_exclusion_only_apply_to_captain_slot():
    result = optimize_lineup(_showdown_pool(), roster={"cpt":1,"flex":5}, salary_cap=60000, locked_captain_id="te1", excluded_captain_ids={"qb1"})
    assert result["ok"]
    assert result["lineup"][0]["player_id"] == "te1"
    assert any(r["player_id"] == "qb1" and r["slot"].startswith("FLEX") for r in result["lineup"])


def test_captain_exposure_caps_count_separately_from_flex():
    result=optimize_multiple_lineups(_showdown_pool(),count=4,max_overlap=5,roster={"cpt":1,"flex":5},salary_cap=60000,captain_exposure_limits={"qb1":.25,"qb2":0})
    assert result["ok"]
    captains=[e["lineup"][0]["player_id"] for e in result["lineups"]]
    assert captains.count("qb1") <= 1
    assert "qb2" not in captains


def test_single_game_rejects_multigame_pool():
    players=_showdown_pool()
    players[-1].team="CCC"
    assert not optimize_lineup(players,roster={"cpt":1,"flex":5},salary_cap=50000)["ok"]


def test_optimize_captain_lineup_respects_locks():
    result = optimize_lineup(
        _showdown_pool(),
        roster={"cpt": 1, "flex": 5},
        salary_cap=50000,
        locked_player_ids={"dst1"},
    )
    assert result["ok"] is True
    assert any(r["player_id"] == "dst1" for r in result["lineup"])


def test_optimize_captain_multiple_lineups():
    result = optimize_multiple_lineups(
        _showdown_pool(),
        count=2,
        max_overlap=4,
        roster={"cpt": 1, "flex": 5},
        salary_cap=50000,
    )
    assert result["ok"] is True
    assert len(result["lineups"]) == 2
    ids1 = {r["player_id"] for r in result["lineups"][0]["lineup"]}
    ids2 = {r["player_id"] for r in result["lineups"][1]["lineup"]}
    assert len(ids1 & ids2) <= 4


def test_optimize_lineup_respects_salary_cap():
    players = [
        LineupPlayer("qb1", "QB One", "AAA", "QB", 25, 18, 32, salary=8000),
        LineupPlayer("qb2", "QB Two", "BBB", "QB", 18, 12, 24, salary=5000),
        LineupPlayer("rb1", "RB One", "AAA", "RB", 20, 14, 26, salary=9000),
        LineupPlayer("rb2", "RB Two", "BBB", "RB", 14, 9, 20, salary=4500),
        LineupPlayer("rb3", "RB Three", "CCC", "RB", 12, 8, 18, salary=4000),
        LineupPlayer("wr1", "WR One", "AAA", "WR", 18, 12, 24, salary=8500),
        LineupPlayer("wr2", "WR Two", "BBB", "WR", 13, 8, 19, salary=4200),
        LineupPlayer("wr3", "WR Three", "CCC", "WR", 11, 7, 17, salary=3800),
        LineupPlayer("te1", "TE One", "AAA", "TE", 10, 6, 15, salary=3500),
        LineupPlayer("te2", "TE Two", "BBB", "TE", 8, 5, 12, salary=3000),
    ]
    roster = {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0}
    expensive = optimize_lineup(
        players,
        objective="median",
        roster=roster,
        salary_cap=50000,
    )
    assert expensive["ok"] is True
    assert expensive["total_salary"] <= 50000

    too_tight = optimize_lineup(
        players,
        objective="median",
        roster=roster,
        salary_cap=20000,
        locked_player_ids={"qb1", "rb1", "wr1"},
    )
    assert too_tight["ok"] is False


def test_locked_captain_is_exempt_from_total_exposure_cap():
    # Enough alternates to fill three distinct six-player lineups at 2/3 exposure.
    players = _showdown_pool() + [LineupPlayer(f"alt{i}", f"Alt {i}", "AAA" if i % 2 else "BBB", "WR", 8, 4, 12, salary=3000) for i in range(5)]
    result = optimize_multiple_lineups(players, count=3, max_overlap=5, max_exposure=.8, locked_captain_id="te1", roster={"cpt":1,"flex":5}, salary_cap=60000)
    assert len(result["lineups"]) == 3
    assert all(e["lineup"][0]["player_id"] == "te1" for e in result["lineups"])


def test_imported_kicker_is_eligible_without_mutating_source_pool():
    import pandas as pd
    from src.products.dfs_inputs import apply_projection_overrides
    from src.products.lineup_optimizer import _players_from_pool
    pool = pd.DataFrame([{"player_id":"k1", "Player":"Kicker", "Team":"AAA", "Position":"K", "salary":4000, "Projected Points":None, "Low (P10)":None, "High (P90)":None}])
    assert _players_from_pool(pool) == []
    patched = apply_projection_overrides(pool, {"k1":{"proj":8.,"floor":3.,"ceiling":15.}})
    assert _players_from_pool(patched)[0].position == "K"
    assert _players_from_pool(patched)[0].proj == 8.
    assert pd.isna(pool.iloc[0]["Projected Points"])
    import pytest
    with pytest.raises(ValueError):
        apply_projection_overrides(pool, {"k1":{"proj":8.,"floor":9.,"ceiling":15.}})


def test_single_lineup_respects_fractional_captain_limit():
    import pandas as pd
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    pool = pd.DataFrame([{"player_id":p.player_id, "Player":p.name, "Team":p.team, "Position":p.position, "Projected Points":p.proj, "Low (P10)":p.floor, "High (P90)":p.ceiling, "salary":p.salary} for p in _showdown_pool()])
    result = optimize_from_pool_dataframe(pool, site="draftkings_showdown", salary_cap=60000, captain_exposure_limits={"qb1":.25}, lineup_count=1)
    assert result["ok"]
    assert result["lineup"][0]["player_id"] != "qb1"
