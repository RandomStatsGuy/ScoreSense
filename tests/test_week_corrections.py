import pytest

from src.draft_hub import storage, hub_scoring, week_corrections as corrections
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def recovery(hub_db, monkeypatch):
    rules = LeagueRules(draft_type="snake", roster={"qb": {"starter": 1, "max": 3}}, roster_size_max=3)
    league = storage.create_league("commissioner", "Recovery", 2026, rules)
    home = storage.get_team_by_user(league["id"], "commissioner")
    away = storage.join_league("manager", league["room_code"], "Away")
    hub_scoring.ensure_season_schedule(league["id"])
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *args, **kwargs: True)
    monkeypatch.setattr(hub_scoring, "load_week_stat_index", lambda *args: {
        "past-qb": {"passing_yards": 300}, "other-qb": {"passing_yards": 200}})
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
    monkeypatch.setattr(hub_scoring, "load_week_stat_index", lambda *args: {})
    result = preview(recovery)
    assert not result["can_publish"]
    with pytest.raises(corrections.CorrectionError, match="blocked"):
        publish(recovery[0], result)


def test_correction_resolves_saved_player_name_when_provider_id_differs(recovery, monkeypatch):
    recovery[3][0]["players"][0]["player_name"] = "Drake Maye"
    name_key = hub_scoring.name_pos_key({"player_name": "Drake Maye", "position": "QB"})
    monkeypatch.setattr(hub_scoring, "load_week_stat_index", lambda *args: {
        name_key: {"passing_yards": 300}, "other-qb": {"passing_yards": 200}})
    result = preview(recovery)
    assert result["can_publish"]
    assert next(row for row in result["player_scores"] if row["player_id"] == "past-qb")["points"] == 12


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
    monkeypatch.setattr(hub_scoring, "load_week_stat_index", lambda *args: {"past-qb": {"passing_yards": 400}})
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
    assert meta["week_scored"]


def test_context_exposes_required_slots_and_position_eligibility(recovery):
    result = corrections.correction_context(recovery[0], 2026, 1, "commissioner")
    assert result["slots"]["QB"] == 1
    assert result["slot_positions"]["QB"] == ["QB"]
    assert result["lineups"] == []


def test_manager_display_enrichment_does_not_change_revision(recovery, monkeypatch):
    def enrich(_league_id, teams, **kwargs):
        for team in teams:
            team["owner_name"] = "Display manager"
        return teams
    monkeypatch.setattr("src.draft_hub.owner_display.attach_owner_names_to_teams", enrich)
    assert preview(recovery)["can_publish"]


@pytest.mark.parametrize("slot", ["QB", " qb ", "QB1"])
def test_native_singleton_slots_can_be_previewed(recovery, slot):
    recovery[3][0]["players"][0]["slot"] = slot
    result = preview(recovery)
    assert result["can_publish"]
    assert all(row["slot"] == "QB1" for row in result["player_scores"])


def test_mixed_slot_aliases_still_reject_duplicate_starters(recovery):
    recovery[3][0]["players"].append({"player_id":"duplicate", "position":"QB", "slot":"QB"})
    with pytest.raises(corrections.CorrectionError, match="distinct"):
        preview(recovery)


def test_current_players_are_suggestions_not_historical_lineups(recovery, monkeypatch):
    league_id, home, away, _ = recovery
    monkeypatch.setattr(storage, "list_league_rosters_by_team", lambda _: {
        home:[{"player_id":"current", "player_name":"Current QB", "position":"QB", "team":"NE"},
              {"player_id":"cut", "position":"QB", "roster_status":"cut"}], away:[]})
    context = corrections.correction_context(league_id,2026,1,"commissioner")
    assert [row["player_id"] for row in context["current_roster_candidates"][home]] == ["current"]
    assert context["lineups"] == []
    assert storage.list_week_lineups(league_id,2026,1) == []
    assert preview(recovery)["can_publish"]  # suggestions never change revision
