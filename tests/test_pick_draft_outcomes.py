"""Starter-aware pick-draft recap outcomes."""

from __future__ import annotations

from src.draft_hub.pick_draft_outcomes import (
    fill_starters,
    inverse_quantile_sample,
    pick_draft_awards,
    players_for_team,
    rotating_opponent,
    simulate_pick_draft_outcomes,
    starter_points,
)
from src.draft_hub.presets import load_preset


def _player(pid, pos, p10, p50, p90, overall=None):
    return {
        "player_id": pid,
        "player_name": pid,
        "position": pos,
        "p10": p10,
        "p50": p50,
        "p90": p90,
        "overall": overall,
    }


def test_fill_starters_uses_flex_and_ignores_bench():
    rules = load_preset("snake_draft_v1")
    players = [
        _player("qb1", "QB", 10, 20, 30),
        _player("rb1", "RB", 12, 22, 32),
        _player("rb2", "RB", 11, 18, 28),
        _player("rb3", "RB", 10, 16, 24),
        _player("wr1", "WR", 14, 24, 34),
        _player("wr2", "WR", 9, 15, 25),
        _player("te1", "TE", 6, 10, 16),
        _player("k1", "K", 4, 8, 12),
        _player("def1", "DEF", 4, 7, 11),
        _player("wr3", "WR", 3, 5, 9),
    ]
    for p in players:
        p["score"] = p["p50"]
    starters, bench = fill_starters(players, rules, score_key="score")
    starter_ids = {s["player_id"] for s in starters}
    assert "wr3" in {b["player_id"] for b in bench}
    assert "rb3" in starter_ids  # FLEX
    assert starter_points(starters, "p50") == 20 + 22 + 18 + 24 + 15 + 10 + 8 + 7 + 16
    assert "wr3" not in starter_ids


def test_inverse_quantile_ordering():
    lo = inverse_quantile_sample(10, 20, 40, 0.1)
    mid = inverse_quantile_sample(10, 20, 40, 0.5)
    hi = inverse_quantile_sample(10, 20, 40, 0.9)
    assert lo == 10
    assert mid == 20
    assert hi == 40
    assert inverse_quantile_sample(10, 20, 40, 0.0) <= lo
    assert inverse_quantile_sample(10, 20, 40, 1.0) >= hi


def test_rotating_opponent_never_self_for_even_league():
    seen = set()
    for week in range(14):
        opp = rotating_opponent(0, week, 12)
        assert opp is not None and opp != 0
        seen.add(opp)
    assert len(seen) >= 6


def test_simulate_p10_le_p50_le_p90_and_wins_not_rank_buckets():
    rules = load_preset("snake_draft_v1")
    strong = [_player(f"s{i}", pos, 80, 120, 160) for i, pos in enumerate(["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"])]
    weak = [_player(f"w{i}", pos, 4, 8, 12) for i, pos in enumerate(["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"])]
    mid = [_player(f"m{i}", pos, 20, 40, 60) for i, pos in enumerate(["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"])]
    teams = [
        {"team_id": "a", "team_name": "Alpha", "players": strong},
        {"team_id": "b", "team_name": "Beta", "players": mid},
        {"team_id": "c", "team_name": "Gamma", "players": weak},
        {"team_id": "d", "team_name": "Delta", "players": mid},
    ]
    out = simulate_pick_draft_outcomes(teams, rules, n_sims=80, record_games=14, nfl_games=17)
    rows = out["projected_standings"]
    assert out["record_games"] == 14
    assert rows[0]["team_id"] == "a"
    assert "not the sum of each player's p10" in out["outcome_note"].lower()
    for row in rows:
        assert row["points_p10"] <= row["points_p50"] <= row["points_p90"]
        assert 0 <= row["expected_wins"] <= 14
        assert abs(row["expected_wins"] + row["expected_losses"] - 14) < 0.11
    # Not the old 70%/30% rank buckets (first 9.8, last 4.2 on 14 games).
    assert rows[0]["expected_wins"] > 9.9
    assert rows[-1]["expected_wins"] < 4.1
    # Close rosters stay close rather than being forced into 70 vs 30.
    beta = next(r for r in rows if r["team_id"] == "b")
    delta = next(r for r in rows if r["team_id"] == "d")
    assert abs(beta["expected_wins"] - delta["expected_wins"]) < 2.5


def test_standings_sort_order_is_expected_wins():
    rules = load_preset("linear_draft_v1")
    def team(tid, pts):
        return {
            "team_id": tid,
            "team_name": tid,
            "players": [_player(f"{tid}-{pos}", pos, pts * 0.8, pts, pts * 1.2) for pos in ("QB", "RB", "RB", "WR", "WR", "TE")],
        }
    out = simulate_pick_draft_outcomes(
        [team("hi", 40), team("lo", 8), team("mid", 20)],
        rules,
        n_sims=64,
        record_games=10,
    )
    ranks = [r["team_id"] for r in out["projected_standings"]]
    assert ranks[0] == "hi"
    assert ranks[-1] == "lo"


def test_pick_awards_have_no_auction_language():
    rules = load_preset("snake_draft_v1")
    teams = [
        {
            "team_id": "a",
            "team_name": "A",
            "players": [
                _player("qb", "QB", 20, 30, 40, 1),
                _player("rb", "RB", 20, 28, 36, 12),
                _player("wr", "WR", 18, 26, 40, 24),
                _player("te", "TE", 8, 12, 18, 36),
                _player("late", "WR", 16, 22, 30, 96),
            ],
        },
        {
            "team_id": "b",
            "team_name": "B",
            "players": [_player("qb2", "QB", 8, 12, 16, 2)],
        },
    ]
    awards = pick_draft_awards(teams, rules, [], draft_type="snake")
    blob = " ".join(f"{a['title']} {a['detail']} {a['blurb']}" for a in awards).lower()
    for banned in ("cap hoarder", "empty wallet", "amount spent", "fair salary", "auction wins", "notable sales", "$"):
        assert banned not in blob
    assert any(a["id"] == "best_lineup" for a in awards)


def _full_skill(prefix: str, p50: float):
    return [_player(f"{prefix}-{pos}{i}", pos, p50 * 0.8, p50, p50 * 1.2) for i, pos in enumerate(("QB", "RB", "RB", "WR", "WR", "TE"))]


def test_biggest_need_follows_standings_not_empty_kicker():
    """A stacked team that skipped K/DEF is not the neediest when standings say otherwise."""
    rules = load_preset("snake_draft_v1")
    strong = _full_skill("alpha", 120)
    weak = _full_skill("gamma", 12) + [
        _player("gk", "K", 6, 8, 10),
        _player("gdef", "DEF", 5, 7, 9),
    ]
    teams = [
        {"team_id": "a", "team_name": "Alpha", "players": strong},
        {"team_id": "c", "team_name": "Gamma", "players": weak},
    ]
    standings = [
        {"team_id": "a", "team_name": "Alpha", "expected_wins": 10.4, "points_p50": 1610.0, "rank": 1},
        {"team_id": "c", "team_name": "Gamma", "expected_wins": 3.1, "points_p50": 820.0, "rank": 2},
    ]
    awards = pick_draft_awards(teams, rules, standings, draft_type="snake")
    need = next(a for a in awards if a["id"] == "biggest_need")
    assert need["team_id"] == "c"
    assert "3.1 expected wins" in need["detail"]
    assert "820 median pts" in need["detail"]
    assert "standings" in need["blurb"]


def test_players_for_team_overlays_zero_k_def_projections():
    picks = [
        {
            "team_id": "t1",
            "player_id": "k1",
            "player_name": "Justin Tucker",
            "position": "K",
            "season_proj": 0.0,
            "overall": 150,
        },
        {
            "team_id": "t1",
            "player_id": "d1",
            "player_name": "Ravens",
            "position": "DEF",
            "season_proj": 0,
            "overall": 151,
        },
    ]
    index = {
        "k1": {"p10": 120.0, "p50": 140.0, "p90": 158.0, "season_proj": 140.0, "position": "K", "player_name": "Justin Tucker", "team": "BAL"},
        "d1": {"p10": 90.0, "p50": 128.0, "p90": 160.0, "season_proj": 128.0, "position": "DEF", "player_name": "Ravens", "team": "BAL"},
    }
    players = players_for_team("t1", "Alpha", picks, [], index)
    by_id = {p["player_id"]: p for p in players}
    assert by_id["k1"]["p50"] == 140.0
    assert by_id["k1"]["p10"] == 120.0
    assert by_id["d1"]["p50"] == 128.0
