import pytest

from src.draft_hub import storage, hub_scoring, week_corrections as corrections
from src.draft_hub import native_stats
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def recovery(hub_db, monkeypatch, trusted_native_roster_rows):
    trusted_native_roster_rows("past-qb", team="KC", position="QB")
    trusted_native_roster_rows("other-qb", team="KC", position="QB")
    rules = LeagueRules(draft_type="snake", roster={"qb": {"starter": 1, "max": 3}}, roster_size_max=3)
    league = storage.create_league("commissioner", "Recovery", 2026, rules)
    home = storage.get_team_by_user(league["id"], "commissioner")
    away = storage.join_league("manager", league["room_code"], "Away")
    hub_scoring.ensure_season_schedule(league["id"])
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *args, **kwargs: True)
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *args: {"complete": True, "stats": {
        "past-qb": {"passing_yards": 300}, "other-qb": {"passing_yards": 200}}})
    monkeypatch.setattr(native_stats, "resolve_lineup_stats", lambda row, snapshot: snapshot["stats"].get(row["player_id"], {}))
    changes = [{"team_id": team["id"], "players": [{"player_id": player_id, "position": "QB", "slot": "QB1"}]}
               for team, player_id in [(home, "past-qb"), (away, "other-qb")]]
    return league["id"], home["id"], away["id"], changes


def preview(recovery):
    league_id, home, away, changes = recovery
    context = corrections.correction_context(league_id, 2026, 1, "commissioner")
    return corrections.preview_correction(league_id, 2026, 1, "commissioner", changes,
                                          "Missing Week 1 records", context["revision"])


def publish(league_id, result, key="publish-once"):
    return corrections.publish_correction(league_id, 2026, 1, "commissioner", result["id"],
                                          result["revision"], result["reason"], key)


def test_repair_publishes_without_touching_week_two(recovery):
    league_id, home, away, changes = recovery
    storage.replace_team_lineup(league_id, home, 2026, 2, [{"player_id": "week-two", "position": "QB", "slot": "QB1", "lineup_role": "starter"}])
    week_two = storage.list_week_lineups(league_id, 2026, 2)
    result = preview(recovery)
    assert result["can_publish"]
    assert storage.list_week_lineups(league_id, 2026, 1) == []
    publish(league_id, result)
    assert storage.list_week_lineups(league_id, 2026, 2) == week_two
    assert all(row["locked"] for row in storage.list_week_lineups(league_id, 2026, 1))
    assert publish(league_id, result)["already_published"]
    assert len(corrections.correction_history(league_id, 2026, 1)) == 1


def test_stale_preview_changes_nothing(recovery):
    league_id, home, away, changes = recovery
    result = preview(recovery)
    storage.replace_team_lineup(league_id, home, 2026, 1, [{"player_id": "changed", "slot": "BN", "position": "QB"}])
    before = storage.list_week_lineups(league_id, 2026, 1)
    with pytest.raises(corrections.CorrectionError, match="changed"):
        publish(league_id, result)
    assert storage.list_week_lineups(league_id, 2026, 1) == before


def test_missing_stats_block_publication(recovery, monkeypatch):
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *args: {"complete": True, "stats": {}})
    result = preview(recovery)
    assert not result["can_publish"]
    with pytest.raises(corrections.CorrectionError, match="blocked"):
        publish(recovery[0], result)


def test_only_commissioner_can_repair(recovery):
    with pytest.raises(PermissionError):
        corrections.correction_context(recovery[0], 2026, 1, "manager")


def test_past_week_read_does_not_fill_from_current_roster(recovery):
    league_id, home, away, changes = recovery
    assert hub_scoring.ensure_team_lineup(league_id, home, 2026, 1) == []


def test_duplicate_historical_ownership_rejected(recovery):
    recovery[3][1]["players"][0]["player_id"] = "past-qb"
    with pytest.raises(corrections.CorrectionError, match="one team"):
        preview(recovery)


def test_scoring_refresh_does_not_invent_missing_lineups(recovery):
    result = hub_scoring.apply_week_scores(recovery[0], 2026, 1, slate_complete=True)
    assert result["reason"] == "incomplete_historical_lineups"
    assert storage.list_week_lineups(recovery[0], 2026, 1) == []


def test_scoring_refresh_cannot_overwrite_published_correction(recovery):
    result = preview(recovery)
    publish(recovery[0], result)
    before = storage.list_team_week_scores(recovery[0], 2026, 1)
    with pytest.raises(ValueError, match="commissioner correction"):
        storage.save_native_week_scores(recovery[0], 2026, 1, [], [], result["scoring"])
    assert storage.list_team_week_scores(recovery[0], 2026, 1) == before


def test_changed_stats_require_new_preview(recovery, monkeypatch):
    result = preview(recovery)
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *args: {"complete": True, "stats": {"past-qb": {"passing_yards": 400}}})
    with pytest.raises(corrections.CorrectionError, match="statistics changed"):
        publish(recovery[0], result)
    assert storage.list_week_lineups(recovery[0], 2026, 1) == []


def test_normal_lineup_api_remains_locked_for_historical_week(recovery):
    with pytest.raises(hub_scoring.LineupError, match="commissioner correction"):
        hub_scoring.set_team_starters(recovery[0], recovery[1], 2026, 1, [])


def test_historical_view_preserves_departed_players(recovery):
    result = preview(recovery)
    publish(recovery[0], result)
    league = storage.get_league(recovery[0])
    starters, bench, meta = hub_scoring.resolve_week_lineup(
        {"mode": "league", "league_id": recovery[0], "team_id": recovery[1]},
        [{"player_id": "today", "position": "QB"}], LeagueRules.model_validate(league["rules"]), season=2026, week=1)
    assert [row["player_id"] for row in starters] == ["past-qb"]
    assert not bench
    assert meta["lineup_locked"]


def test_correction_persists_explicit_empty_team_header(recovery):
    league_id, home, away, changes = recovery
    changes[1]["players"] = []
    context = corrections.correction_context(league_id, 2026, 1, "commissioner")
    result = corrections.preview_correction(league_id, 2026, 1, "commissioner", changes,
                                          "Confirmed empty roster", context["revision"], acknowledge_empty=True)
    assert result["can_publish"]
    publish(league_id, result)
    assert storage.has_team_lineup_snapshot(league_id, away, 2026, 1)
    assert storage.list_team_lineup(league_id, away, 2026, 1) == []
    assert corrections.correction_context(league_id, 2026, 1, "commissioner")["incomplete_team_ids"] == []
    assert next(row for row in storage.list_team_week_scores(league_id, 2026, 1) if row["team_id"] == away)["points"] == 0


def test_verified_bye_stats_can_publish_as_zero(recovery, monkeypatch):
    monkeypatch.setattr(native_stats, "resolve_lineup_stats", lambda *_: {"_native_no_game": 1})
    result = preview(recovery)
    assert result["can_publish"]
    assert all(row["points"] == 0 for row in result["player_scores"])
    publish(recovery[0], result)


def test_correction_uses_resolved_historical_identity(recovery, monkeypatch):
    seen = []
    def resolve(row, snapshot):
        seen.append((row["player_id"], row["nfl_team"], row["position"]))
        return {"passing_yards": 100}
    monkeypatch.setattr(native_stats, "resolve_lineup_stats", resolve)
    result = preview(recovery)
    assert result["can_publish"] and len(seen) == 2
    assert {row[0] for row in seen} == {"past-qb", "other-qb"}
    publish(recovery[0], result)
    assert len(seen) == 4


def test_correction_requires_verified_game_completion(recovery, monkeypatch):
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *args: {"complete": False, "stats": {
        "past-qb": {"passing_yards": 300}, "other-qb": {"passing_yards": 200}}})
    result = preview(recovery)
    assert not result["can_publish"]
    assert "not complete" in result["blockers"][0]


def test_correction_stat_index_hook_remains_available(recovery):
    league_id, _home, _away, changes = recovery
    context = corrections.correction_context(league_id, 2026, 1, "commissioner")
    index = {"past-qb": {"passing_yards": 100}, "other-qb": {"passing_yards": 100}}
    result = corrections.preview_correction(league_id, 2026, 1, "commissioner", changes,
                                          "Verified manual import", context["revision"], stat_index=index)
    assert result["can_publish"]
    corrections.publish_correction(league_id, 2026, 1, "commissioner", result["id"],
                                   result["revision"], result["reason"], "injected-index", stat_index=index)


def test_unchanged_correction_after_started_trade_keeps_original_score_owner(recovery):
    league_id, home, away, changes = recovery
    storage.replace_team_lineup(league_id, home, 2026, 1, [{"player_id": "past-qb", "position": "QB", "slot": "QB",
                                                        "lineup_role": "starter", "locked": True}])
    storage.replace_team_lineup(league_id, away, 2026, 1, [
        {"player_id": "other-qb", "position": "QB", "slot": "QB", "lineup_role": "starter", "locked": True},
        {"player_id": "past-qb", "position": "QB", "slot": "BN", "lineup_role": "bench", "locked": True}])
    context = corrections.correction_context(league_id, 2026, 1, "commissioner")
    reviewed = [{"team_id": tid, "players": [row for row in context["lineups"] if row["team_id"] == tid]}
                for tid in (home, away)]
    result = corrections.preview_correction(league_id, 2026, 1, "commissioner", reviewed,
                                          "Reviewed saved trade ownership", context["revision"])
    assert result["can_publish"]
    publish(league_id, result)
    scores = storage.list_player_week_scores(league_id, 2026, 1)
    owned = [row for row in scores if row["player_id"] == "past-qb"]
    assert len(owned) == 1 and owned[0]["team_id"] == home
    assert owned[0]["points"] == 12
    acquired = next(row for row in storage.list_team_lineup(league_id, away, 2026, 1) if row["player_id"] == "past-qb")
    assert acquired["lineup_role"] == "bench" and acquired["locked"]
    assert next(row for row in storage.list_team_week_scores(league_id, 2026, 1) if row["team_id"] == away)["points"] == 8


def test_correction_cannot_invent_an_acquired_locked_bench(recovery):
    league_id, home, away, changes = recovery
    changes[1]["players"].append({"player_id": "past-qb", "position": "QB", "slot": "BN", "locked": True})
    with pytest.raises(corrections.CorrectionError, match="one team"):
        preview(recovery)
