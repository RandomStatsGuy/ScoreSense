"""Tests for lineup optimizer."""

from src.products.lineup_optimizer import LineupPlayer, optimize_lineup, optimize_multiple_lineups


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
