"""Scoring-host parity and history integrity, with no provider or real DB access."""
import pytest

from src.draft_hub import league_history as history


@pytest.fixture
def sleeper(monkeypatch):
    history._SCORING_CACHE.clear()
    monkeypatch.setattr(history, "_sleeper_roster_labels", lambda *a, **k: {"1": "Alpha", "2": "Beta"})
    monkeypatch.setattr(history, "_sleeper_roster_meta", lambda *a, **k: {"1": {"owner_id": "a"}, "2": {"owner_id": "b"}})
    monkeypatch.setattr(history, "_playoff_from_sleeper", lambda *a: {})
    monkeypatch.setattr(history, "_sleeper_completed_week_limit", lambda *a: 1)
    def fetch(url, **kwargs):
        if url.endswith("/rosters"):
            return [{"roster_id": 1, "settings": {"wins": 2, "losses": 0, "fpts": 120, "fpts_decimal": 25, "fpts_against": 90}},
                    {"roster_id": 2, "settings": {"wins": 0, "losses": 2, "fpts": 90, "fpts_against": 120, "fpts_against_decimal": 25}}]
        if "/matchups/" in url:
            return [{"roster_id": 1, "matchup_id": 1, "points": 119, "custom_points": 120.25},
                    {"roster_id": 2, "matchup_id": 1, "points": 90}]
        return {"season": "2026", "status": "in_season", "settings": {"playoff_week_start": 15}}
    monkeypatch.setattr(history, "_fetch_json", fetch)
    yield fetch
    history._SCORING_CACHE.clear()


def test_sleeper_history_uses_official_records_and_pf_pa(sleeper):
    result = history.build_sleeper_scoring_history("league")
    first = result["standings"][0]
    # A median league records two wins; re-deriving a single H2H win would be wrong.
    assert (first["wins"], first["losses"], first["ties"]) == (2, 0, 0)
    assert first["points_for"] == 120.25 and first["points_against"] == 90
    assert first["weeks_scored"] == 1 and first["avg_points"] == 120.25
    assert [week["week"] for week in result["weeks"]] == [1]
    assert result["weeks"][0]["teams"][0]["points"] == 120.25


def test_sleeper_average_uses_regular_weeks_for_official_pf(sleeper, monkeypatch):
    monkeypatch.setattr(history, "_sleeper_completed_week_limit", lambda *a: 2)
    def fetch(url, **kwargs):
        data = sleeper(url, **kwargs)
        if isinstance(data, dict) and "settings" in data:
            data["settings"]["playoff_week_start"] = 2
        return data
    monkeypatch.setattr(history, "_fetch_json", fetch)
    result = history.build_sleeper_scoring_history("league")
    assert len(result["weeks"]) == 2 and result["weeks"][1]["is_playoff"]
    assert result["standings"][0]["avg_points"] == 120.25
    assert result["standings"][0]["weeks_scored"] == 1


def test_current_live_week_is_not_finalized(monkeypatch):
    monkeypatch.setattr(history, "_fetch_json", lambda *a, **k: {"season": "2026", "week": 2, "season_type": "regular"})
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a: False)
    assert history._sleeper_completed_week_limit({"season": "2026", "status": "in_season"}, 18) == 1
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a: True)
    assert history._sleeper_completed_week_limit({"season": "2026", "status": "in_season"}, 18) == 2


def test_failed_week_does_not_replace_saved_history(sleeper, monkeypatch):
    saved = history.build_sleeper_scoring_history("league")
    history._SCORING_CACHE.clear()
    def failing_fetch(url, **kwargs):
        if "/matchups/" in url:
            raise TimeoutError("provider unavailable")
        return sleeper(url, **kwargs)
    writes = []
    monkeypatch.setattr(history, "_fetch_json", failing_fetch)
    monkeypatch.setattr(history, "sleeper_league_season_chain", lambda *a, **k: [{"season": "2026", "league_id": "league"}])
    monkeypatch.setattr(history.storage, "get_sleeper_scoring_cache", lambda *a: {"payload": saved, "synced_at": "2026-10-01T00:00:00+00:00"})
    monkeypatch.setattr(history.storage, "upsert_sleeper_scoring_cache", lambda *args: writes.append(args))
    result = history.get_sleeper_scoring_history("league", refresh=True)
    assert result["cached"] and result["partial"] and result["refresh_failed"]
    assert result["standings"] == saved["standings"]
    assert result["coverage"]["missing_weeks"] == [1]
    assert writes == []


def test_explicit_nonfinal_week_never_adds_a_record():
    result = history.compute_regular_season_records([{"is_final": False, "teams": [
        {"roster_id": "a", "matchup_id": 1, "points": 100},
        {"roster_id": "b", "matchup_id": 1, "points": 0},
    ]}])
    assert result == {}


def test_unfinished_bracket_cannot_award_semifinal_winner_a_title():
    bracket = [{"r": 1, "w": 1, "l": 2}, {"r": 2, "w": None, "l": None}]
    assert history.champion_from_winners_bracket(bracket, {"1": "Alpha"}) is None


@pytest.fixture
def native(monkeypatch):
    monkeypatch.setattr(history.storage, "get_league", lambda *a: {"season": 2026})
    monkeypatch.setattr(history, "_native_scoring_seasons", lambda *a: [2026])
    monkeypatch.setattr(history.storage, "list_league_teams", lambda *a: [
        {"id": "a", "name": "Alpha", "owner_name": "Alice", "user_sub": "alice-user"}, {"id": "b", "name": "Beta", "owner_name": "Bob", "user_sub": "bob-user"}])
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [
        {"team_id": "a", "week": 1, "matchup_id": "game", "points": 120, "scored_at": "2026-09-15"},
        {"team_id": "b", "week": 1, "matchup_id": "game", "points": 90, "scored_at": "2026-09-15"}])
    monkeypatch.setattr(history.storage, "get_week_scoring_run", lambda *a: {"scored_at": "saved"})
    monkeypatch.setattr(history.storage, "list_week_matchups", lambda *a: [{"home_team_id": "a", "away_team_id": "b"}])
    monkeypatch.setattr(history.storage, "list_week_lineups", lambda *a: [
        {"team_id": "a", "player_id": "p", "player_name": "Player", "position": "WR"}])
    monkeypatch.setattr(history.storage, "list_player_week_scores", lambda *a: [
        {"team_id": "a", "player_id": "p", "lineup_role": "starter", "points": 30},
        {"team_id": "a", "player_id": "bench", "lineup_role": "bench", "points": 100}])


def test_native_overview_and_player_history_read_saved_results(native):
    result = history.get_native_scoring_history("league")
    first = result["standings"][0]
    assert first["owner_id"] == "alice-user"
    assert first["wins"] == 1 and first["points_for"] == 120 and first["points_against"] == 90
    assert result["player_seasons"] == [{"player_id": "p", "player_name": "Player", "position": "WR",
        "team_id": "a", "roster_id": "a", "team_name": "Alpha", "owner_name": "Alice", "season": "2026",
        "started_points": 30, "starts": 1}]
    landing = history.build_native_insights_landing("league")
    assert landing["available"] and landing["has_records"]
    assert landing["current_standings"][0]["points_against"] == 90
    assert landing["champions"] == []


@pytest.mark.parametrize("first_id", ["4046", "sheet-mahomes"])
def test_native_player_history_merges_aliases_per_fantasy_team(native, trusted_native_catalog, monkeypatch, first_id):
    import copy

    gsis = "00-0033873"
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id=gsis)
    saved_scores = [{"team_id": tid, "week": week, "matchup_id": "game", "points": points}
                    for week in (1, 2, 3) for tid, points in (("a", 120), ("b", 90))]
    saved_lineups = {
        1: [{"team_id": "a", "player_id": first_id, "sleeper_player_id": "4046", "player_name": "Saved Mahomes", "position": "QB"}],
        2: [{"team_id": "a", "player_id": gsis, "player_name": "Patrick Mahomes", "position": "QB"}],
        3: [{"team_id": "b", "player_id": "sleeper-4046", "player_name": "Mahomes after trade", "position": "QB"}],
    }
    saved_players = {week: [{"team_id": row["team_id"], "player_id": row["player_id"],
        "lineup_role": "starter", "points": points}] for week, points in ((1, 12.25), (2, 21.5), (3, 7.75))
        for row in saved_lineups[week]}
    original = copy.deepcopy((saved_scores, saved_lineups, saved_players))
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: saved_scores)
    monkeypatch.setattr(history.storage, "list_week_lineups", lambda league, season, week: saved_lineups[week])
    monkeypatch.setattr(history.storage, "list_player_week_scores", lambda league, season, week: saved_players[week])
    def no_remote(*a, **k):
        pytest.fail("Native player history must use only saved results and cached identity")
    monkeypatch.setattr(history, "_fetch_json", no_remote)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", no_remote)
    result = history.get_native_scoring_history("league")
    by_team = {row["team_id"]: row for row in result["player_seasons"]}
    assert len(by_team) == len(result["player_seasons"]) == 2
    assert by_team["a"]["player_id"] == by_team["b"]["player_id"] == gsis
    assert (by_team["a"]["starts"], by_team["a"]["started_points"]) == (2, 33.75)
    assert (by_team["b"]["starts"], by_team["b"]["started_points"]) == (1, 7.75)
    assert by_team["a"]["player_name"] == "Saved Mahomes" and by_team["a"]["position"] == "QB"
    assert by_team["a"]["team_name"] == "Alpha" and by_team["a"]["owner_name"] == "Alice"
    assert by_team["b"]["player_name"] == "Mahomes after trade" and by_team["b"]["team_name"] == "Beta"
    assert {row["team_id"]: row["points_for"] for row in result["standings"]} == {"a": 360, "b": 270}
    assert (saved_scores, saved_lineups, saved_players) == original


@pytest.mark.parametrize("reason", ["unavailable", "conflicting_sid"])
def test_native_player_history_preserves_unresolved_literal_ids(native, trusted_native_catalog, monkeypatch, reason):
    gsis = "00-0033873"
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id=gsis)
    trusted_native_catalog("11533", name="Brandon Aubrey", team="DAL", position="K")
    ids = ["legacy-one", "legacy-two"] if reason == "unavailable" else ["4046", gsis]
    lineups = {week: [{"team_id": "a", "player_id": pid, "player_name": "Saved name", "position": "QB",
                      **({"sleeper_player_id": "11533"} if reason == "conflicting_sid" and week == 1 else {})}]
               for week, pid in enumerate(ids, 1)}
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [
        {"team_id": tid, "week": week, "points": points} for week in (1, 2) for tid, points in (("a", 120), ("b", 90))])
    monkeypatch.setattr(history.storage, "list_week_lineups", lambda league, season, week: lineups[week])
    monkeypatch.setattr(history.storage, "list_player_week_scores", lambda league, season, week: [
        {"team_id": "a", "player_id": ids[week-1], "lineup_role": "starter", "points": 10}])
    rows = history.get_native_scoring_history("league")["player_seasons"]
    assert [row["player_id"] for row in rows] == ids
    assert all(row["player_name"] == "Saved name" and row["started_points"] == 10 and row["starts"] == 1 for row in rows)


def test_player_group_schema_invalidates_only_native_insights_response_keys(hub_db, monkeypatch):
    from app.hub_routes import _insights_cache_key
    from src.draft_hub import storage
    from src.draft_hub.schemas import LeagueRules

    league = storage.create_league("native-key", "Native", 2026, LeagueRules(), team_count=2)
    kwargs = {"sections": "scoring", "history_season": None, "scoring_season": None, "source_version": "saved"}
    version = history.NATIVE_PLAYER_GROUP_VERSION
    native = _insights_cache_key(league["id"], **kwargs)
    monkeypatch.setattr(history, "NATIVE_PLAYER_GROUP_VERSION", version + 1)
    assert _insights_cache_key(league["id"], **kwargs) != native
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET sleeper_league_id='official-linked' WHERE id=?", (league["id"],))
    linked = _insights_cache_key(league["id"], **kwargs)
    monkeypatch.setattr(history, "NATIVE_PLAYER_GROUP_VERSION", version + 2)
    assert _insights_cache_key(league["id"], **kwargs) == linked


def test_native_league_without_games_shows_unranked_zero_records(native, monkeypatch):
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [])
    result = history.get_native_scoring_history("league")
    assert result["available"] and result["preseason"]
    assert all(row["rank"] is None and row["wins"] == 0 for row in result["standings"])


def test_native_championship_requires_final_snapshot_and_ignores_third_place(native, monkeypatch):
    monkeypatch.setattr(history.storage, "get_week_scoring_run", lambda *a: {"scored_at": "saved"})
    monkeypatch.setattr(history.storage, "list_week_matchups", lambda *a: [
        {"matchup_id": "playoff-r3-1-game-s1-s2", "home_team_id": "a", "away_team_id": "b"},
        {"matchup_id": "playoff-third-place", "home_team_id": "c", "away_team_id": "d"}])
    champion = history._native_season_champion("league", 2026)
    assert champion["owner_name"] == "Alice" and champion["team_name"] == "Alpha"
    landing = history.build_native_insights_landing("league")
    assert landing["has_champions"] and landing["most_titles"]["titles"] == 1
    monkeypatch.setattr(history.storage, "get_week_scoring_run", lambda *a: None)
    assert history._native_season_champion("league", 2026) is None


def test_native_playoffs_do_not_change_regular_season_records(native, monkeypatch):
    monkeypatch.setattr(history.storage, "get_league", lambda *a: {"season": 2026, "rules": {"regular_season_games": 1}})
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [
        {"team_id": "a", "week": 1, "matchup_id": "game", "points": 120}, {"team_id": "b", "week": 1, "matchup_id": "game", "points": 90},
        {"team_id": "a", "week": 2, "matchup_id": "playoff-r1", "points": 50}, {"team_id": "b", "week": 2, "matchup_id": "playoff-r1", "points": 100}])
    first = history.get_native_scoring_history("league")["standings"][0]
    assert (first["wins"], first["losses"], first["points_for"], first["points_against"]) == (1, 0, 120, 90)


def test_native_standings_use_win_percentage_for_byes_and_ties(native, monkeypatch):
    monkeypatch.setattr(history.storage, "list_league_teams", lambda *a: [
        {"id": "a", "name": "Alpha"}, {"id": "b", "name": "Beta"}, {"id": "c", "name": "Gamma"}, {"id": "d", "name": "Delta"}])
    # Alpha wins twice in four games, Beta wins one and ties one in two games.
    scores = {1: {"a": 100, "c": 80}, 2: {"a": 100, "c": 80},
              3: {"a": 80, "b": 100}, 4: {"a": 100, "c": 120, "b": 120, "d": 120}}
    matchups = {1: [("a", "c")], 2: [("a", "c")], 3: [("a", "b")], 4: [("a", "c"), ("b", "d")]}
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [
        {"week": week, "team_id": tid, "points": points} for week, teams in scores.items() for tid, points in teams.items()])
    monkeypatch.setattr(history.storage, "list_week_matchups", lambda league, season, week: [
        {"home_team_id": home, "away_team_id": away} for home, away in matchups[week]])
    result = history.get_native_scoring_history("league")
    assert result["standings"][0]["roster_id"] == "b"
    assert result["standings"][0]["win_pct"] == .75


@pytest.mark.parametrize("current_regular_weeks", [8, 16])
@pytest.mark.parametrize("id_source", ["schedule", "score"])
def test_saved_matchup_types_preserve_historical_regular_results(native, monkeypatch, current_regular_weeks, id_source):
    from src.draft_hub.hub_scoring import build_hub_standings
    monkeypatch.setattr(history.storage, "get_league", lambda *a: {
        "season": 2027, "rules": {"regular_season_games": current_regular_weeks, "playoffs": {"enabled": False}}})
    # The prior season had fourteen regular weeks; neither expanding nor
    # shortening this season may relabel its published Week 14/15/16 results.
    matches = {14: "hub-14-1", 15: "playoff-r1-1-game-s1-s2", 16: "playoff-third-place"}
    monkeypatch.setattr(history.storage, "list_season_team_scores", lambda *a: [
        {"team_id": tid, "week": week, "points": points, "matchup_id": matches[week] if id_source == "score" else None}
        for week in matches for tid, points in (("a", 120 if week == 14 else 50), ("b", 90 if week == 14 else 100))])
    # Both saved score IDs and saved schedule IDs identify historical results.
    monkeypatch.setattr(history.storage, "list_week_matchups", lambda league, season, week: [
        {"matchup_id": matches[week] if id_source == "schedule" else None, "home_team_id": "a", "away_team_id": "b"}])
    result = history.get_native_scoring_history("league", scoring_season="2026")
    assert [week["is_playoff"] for week in result["weeks"]] == [False, True, True]
    for rows in (result["standings"], build_hub_standings("league", 2026)):
        first = rows[0]
        assert first["hub_team_id"] == "a"
        assert (first["wins"], first["losses"], first["points_for"], first["points_against"]) == (1, 0, 120, 90)


def test_orphan_scores_never_enter_official_records_or_player_history(native, monkeypatch):
    from src.draft_hub.hub_scoring import build_hub_standings
    monkeypatch.setattr(history.storage, "get_week_scoring_run", lambda *a: None)
    def unexpected_read(*args):
        pytest.fail("Unpublished weeks must not read player scores or saved lineups")
    monkeypatch.setattr(history.storage, "list_player_week_scores", unexpected_read)
    monkeypatch.setattr(history.storage, "list_week_lineups", unexpected_read)
    result = history.get_native_scoring_history("league")
    assert result["preseason"] and result["weeks"] == [] and result["player_seasons"] == []
    for rows in (result["standings"], build_hub_standings("league", 2026)):
        assert all(row["rank"] is None and row["wins"] == row["points_for"] == row["points_against"] == 0 for row in rows)
    landing = history.build_native_insights_landing("league")
    assert not landing["has_records"] and not landing["has_champions"]


def test_native_season_selector_excludes_orphan_score_seasons(monkeypatch):
    import sqlite3
    # An in-memory fixture exercises the publication join without a league DB.
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE league_team_week_score (league_id TEXT, season INTEGER, week INTEGER);
        CREATE TABLE league_week_scoring_run (league_id TEXT, season INTEGER, week INTEGER, final INTEGER NOT NULL DEFAULT 1);
        INSERT INTO league_team_week_score VALUES ('league', 2024, 1), ('league', 2025, 2), ('other', 2023, 1);
        INSERT INTO league_week_scoring_run (league_id, season, week) VALUES ('league', 2025, 1), ('league', 2024, 1), ('other', 2023, 1);
        INSERT INTO league_team_week_score VALUES ('league', 2023, 2);
        INSERT INTO league_week_scoring_run VALUES ('league', 2023, 2, 0);
    """)
    monkeypatch.setattr(history.storage, "get_conn", lambda: conn)
    try:
        assert history._native_scoring_seasons("league", 2026) == [2026, 2024]
    finally:
        conn.close()
