"""League fairness, playoff byes, immutable seeds and finalized advancement."""
from collections import Counter

import pytest

from src.draft_hub import native_schedule as schedule
from src.draft_hub.schemas import LeagueRules


@pytest.mark.parametrize("matchup_id,week,boundary,expected", [
    ("hub-14-1", 14, 8, True),
    ("playoff-r1-1-game-s1-s2", 15, 16, False),
    ("playoff-third-place", 16, 16, False),
    ("legacy-final", 14, 14, True),
    (None, 15, 14, False),
])
def test_saved_matchup_type_uses_boundary_only_for_legacy_ids(matchup_id, week, boundary, expected):
    assert schedule.saved_matchup_is_regular(matchup_id, week, boundary) is expected


def test_score_id_can_fall_back_to_saved_matchup_type():
    assert not schedule.saved_matchup_is_regular(None, 15, 16, saved_matchup_id="playoff-r1-1-game-s1-s2")
    assert schedule.saved_matchup_is_regular("legacy", 14, 8, saved_matchup_id="hub-14-1")


@pytest.mark.parametrize("count", range(2, 15))
def test_round_robin_visits_every_opponent_and_rotates_odd_byes(count):
    teams = [{"id": str(index)} for index in range(count)]
    rounds = count - 1 if count % 2 == 0 else count
    games, byes = Counter(), Counter()
    for week in range(1, rounds + 1):
        seen = set()
        for home, away in schedule.round_robin_pairs(teams, week):
            assert home["id"] not in seen
            seen.add(home["id"])
            if away:
                assert away["id"] not in seen
                seen.add(away["id"])
                games[tuple(sorted((home["id"], away["id"])))] += 1
            else:
                byes[home["id"]] += 1
        assert len(seen) == count
    assert len(games) == count * (count - 1) // 2
    assert set(games.values()) == {1}
    assert not byes if count % 2 == 0 else set(byes.values()) == {1}


@pytest.fixture()
def bracket_store(monkeypatch):
    matchups, totals, finalized = {}, {}, {1}
    monkeypatch.setattr(schedule.storage, "get_week_scoring_run", lambda _league, _season, week:
                        {"scored_at": "saved"} if week in finalized else None)
    monkeypatch.setattr(schedule.storage, "list_week_matchups", lambda _league, _season, week: matchups.get(week, []))
    monkeypatch.setattr(schedule.storage, "list_team_week_scores", lambda _league, _season, week:
                        [{"team_id": team_id, "points": points} for team_id, points in totals.get(week, {}).items()])
    monkeypatch.setattr(schedule.storage, "replace_week_matchups", lambda _league, _season, week, rows:
                        matchups.setdefault(week, [dict(row) for row in rows]))
    standings = [{"hub_team_id": str(seed), "roster_id": str(seed)} for seed in range(1, 7)]
    rules = LeagueRules(regular_season_games=1, playoffs={"enabled": True, "teams": 6})
    return rules, standings, matchups, totals, finalized


def test_playoffs_wait_for_final_regular_season(bracket_store):
    rules, standings, matchups, _totals, finalized = bracket_store
    finalized.clear()
    result = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    assert result["status"] == "pending_regular_season"
    assert not matchups


def test_six_team_bracket_byes_reseed_ties_champion_and_third_place(bracket_store):
    rules, standings, matchups, totals, finalized = bracket_store
    first = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    assert {row["home_team_id"] for row in matchups[2] if row["away_team_id"] is None} == {"1", "2"}
    assert len(first["rounds"]) == 1 and 3 not in matchups
    totals[2] = {"3": 100, "6": 100, "4": 90, "5": 110}
    # Provisional totals alone must not advance.
    assert len(schedule.ensure_playoff_matchups("league", 2026, rules, standings)["rounds"]) == 1
    finalized.add(2)
    second = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    assert {(row["home_team_id"], row["away_team_id"]) for row in matchups[3]} == {("1", "5"), ("2", "3")}
    assert second["rounds"][0]["complete"]
    totals[3] = {"1": 120, "5": 100, "2": 80, "3": 90}
    finalized.add(3)
    final = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    championship = next(row for row in matchups[4] if row["matchup_id"] != "playoff-third-place")
    assert (championship["home_team_id"], championship["away_team_id"]) == ("1", "3")
    assert {final["third_place"]["home_team_id"], final["third_place"]["away_team_id"]} == {"2", "5"}
    totals[4] = {"1": 100, "3": 125, "2": 90, "5": 75}
    finalized.add(4)
    result = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    assert result["champion_team_id"] == "3" and result["status"] == "complete"


def test_saved_first_round_seeds_survive_regular_result_correction(bracket_store):
    rules, standings, _matchups, _totals, _finalized = bracket_store
    first = schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    corrected = schedule.ensure_playoff_matchups("league", 2026, rules, list(reversed(standings)))
    assert corrected["seeds"] == first["seeds"]


def test_four_team_fixed_bracket_preserves_paths(bracket_store):
    rules, standings, matchups, totals, finalized = bracket_store
    rules = LeagueRules(regular_season_games=1, playoffs={"enabled": True, "teams": 4, "reseed": False})
    schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    totals[2] = {"1": 80, "4": 100, "2": 110, "3": 75}
    finalized.add(2)
    schedule.ensure_playoff_matchups("league", 2026, rules, standings)
    championship = next(row for row in matchups[3] if row["matchup_id"] != "playoff-third-place")
    assert (championship["home_team_id"], championship["away_team_id"]) == ("4", "2")
