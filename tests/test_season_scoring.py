from src.draft_hub import season_scoring as scores
from src.draft_hub.schemas import ScoringRules


def test_totals_ppg_ties_unrostered_rank_and_saved_projections():
    weeks = {
        1: [{"aliases": ["one", "gsis-one"], "position": "QB", "points": 10},
            {"aliases": ["unrostered"], "position": "QB", "points": 15},
            {"aliases": ["tie"], "position": "QB", "points": 10}],
        2: [{"aliases": ["one", "gsis-one"], "position": "QB", "points": 0}],
    }
    roster = [{"player_id": "gsis-one"}, {"player_id": "missing"}]
    result = scores.summarize(weeks, roster, {("gsis-one", 1): 12})
    one = result["gsis-one"]
    assert (one["points"], one["ppg"], one["games"], one["rank"]) == (10, 5, 2, 2)
    assert [game["week"] for game in one["game_log"]] == [2, 1]
    assert one["game_log"][0]["projection"] is None
    assert one["game_log"][1]["projection"] == 12
    assert result["missing"]["points"] is None
    assert result["missing"]["rank"] is None
    assert set(result) == {"gsis-one", "missing"}


def test_native_aliases_count_once_and_league_weights_apply(monkeypatch):
    saved = []
    monkeypatch.setattr(scores, "save_week", lambda *args: saved.append(args))
    stats = {"position": "WR", "receptions": 3, "receiving_yards": 20}
    scores.native_week("league", 2026, 1, {"gsis": stats, "sleeper": stats}, ScoringRules(receptions=0.5))
    rows = saved[0][-1]
    assert len(rows) == 1
    assert rows[0]["aliases"] == ["gsis", "sleeper"]
    assert rows[0]["points"] == 3.5


def test_sleeper_authoritative_points_zero_and_inactive(monkeypatch):
    from src.draft_hub import hub_scoring
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *a: True)
    saved = []
    monkeypatch.setattr(scores, "save_week", lambda *args: saved.append(args))
    league = {"league_id": "sleeper", "season": 2026, "scoring_settings": {"rec": 0.5, "rec_yd": 0.1}}
    raw = {"1": {"gp": 1, "rec": 3, "rec_yd": 20}, "2": {"gp": 1}, "3": {"gp": 0}}
    metadata = {pid: {"position": "WR"} for pid in raw}
    scores.sleeper_week(league, 1, [{"players_points": {"1": -2}}], lambda url: raw, metadata)
    rows = saved[0][-1]
    assert [row["points"] for row in rows] == [-2, 0]
    assert [row["aliases"][0] for row in rows] == ["1", "2"]


def test_unfinished_sleeper_week_never_fetches_or_publishes(monkeypatch):
    from src.draft_hub import hub_scoring
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *a: False)
    scores.sleeper_week({"season": 2026}, 1, [], lambda url: (_ for _ in ()).throw(AssertionError()), {})


def test_scores_endpoint_uses_membership_and_team_gate(monkeypatch):
    import app.hub_routes as routes
    calls = []
    monkeypatch.setattr(routes, "_room_team", lambda league, team, sub: calls.append((league, team, sub)) or {"id": team})
    monkeypatch.setattr(scores, "team_scores", lambda team: {"team": team["id"]})
    assert routes.hub_team_season_scores("league", "team", {"sub": "owner"}) == {"team": "team"}
    assert calls == [("league", "team", "owner")]


def test_database_read_scopes_season_league_and_hides_missing_feed_week(hub_db, monkeypatch):
    from src.draft_hub import storage
    monkeypatch.setattr(storage, "get_league", lambda _: {"id":"mine", "season":2026, "workspace_id":"ws"})
    monkeypatch.setattr(storage, "list_roster", lambda *a: [{"player_id":"p"}])
    monkeypatch.setattr(scores, "warm_native", lambda _: False)
    game = {"aliases":["p"],"position":"QB","points":20}
    scores.save_week("other",2026,1,[{**game,"points":99}])
    scores.save_week("mine",2025,1,[{**game,"points":88}])
    scores.save_week("mine",2026,1,[game])
    result = scores.team_scores({"league_id":"mine","id":"team"})
    assert result["players"]["p"]["points"] == 20
    scores.save_week("mine",2026,3,[game])
    result = scores.team_scores({"league_id":"mine","id":"team"})
    assert result["incomplete"] and not result["available"]
    assert result["players"]["p"]["points"] is None

def test_native_missing_bench_stats_do_not_create_a_zero_point_played_game(hub_db):
    import json
    from src.draft_hub import storage

    played_zero = {"position": "QB", "passing_yards": 0, "_native_played": True,
                   "_native_player_key": "sleeper:played"}
    scores.native_week("native-log", 2026, 1, {
        "missing-bench": {"position": "QB", "_native_stats_unavailable": 1},
        "verified-bye": {"position": "DEF", "_native_no_game": 1},
        "did-not-play": {"position": "WR", "receptions": 0, "_native_played": False},
        "played-zero": played_zero,
        "sleeper-played-zero": played_zero,
    }, ScoringRules())
    with storage.get_conn() as conn:
        saved = conn.execute("SELECT payload_json FROM player_season_week WHERE source=? AND season=? AND week=?",
                             ("native-log", 2026, 1)).fetchone()
    rows = json.loads(saved["payload_json"])
    assert rows == [{"aliases": ["played-zero", "sleeper-played-zero"], "position": "QB",
                     "opponent": None, "points": 0}]
    players = scores.summarize({1: rows}, [{"player_id": "played-zero"}, {"player_id": "missing-bench"}], {})
    assert players["played-zero"]["games"] == 1 and players["played-zero"]["points"] == 0
    assert players["missing-bench"]["games"] == 0 and players["missing-bench"]["points"] is None
