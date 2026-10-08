import pytest

from src.draft_hub import storage, hub_scoring, week_corrections as corrections
from src.draft_hub.schemas import LeagueRules
from src.draft_hub import native_stats


@pytest.fixture
def recovery(hub_db, monkeypatch, trusted_native_roster_rows):
    trusted_native_roster_rows("past-qb", name="Drake Maye", team="NE", position="QB")
    trusted_native_roster_rows("other-qb", team="DAL", position="QB")
    trusted_native_roster_rows("duplicate", team="NE", position="QB")
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *args: {
        "complete": hub_scoring.nfl_week_slate_complete(*args),
        "stats": hub_scoring.load_week_stat_index(*args)})
    monkeypatch.setattr(native_stats, "cached_week_snapshot", lambda *_: None)
    monkeypatch.setattr(native_stats, "resolve_lineup_stats", lambda row, snapshot:
                        hub_scoring.stats_for_lineup_row(snapshot["stats"], row))
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
    assert all(row["slot"] == "QB" for row in result["player_scores"])


def test_mixed_slot_aliases_still_reject_duplicate_starters(recovery):
    recovery[3][0]["players"].append({"player_id":"duplicate", "position":"QB", "slot":"QB"})
    with pytest.raises(corrections.CorrectionError, match="two starters at QB"):
        preview(recovery)


@pytest.fixture
def two_back_league(recovery, trusted_native_roster_rows):
    league_id, home, away, _ = recovery
    for player_id, position in [("rb-a", "RB"), ("rb-b", "RB"), ("wr-a", "WR"), ("rb-c", "RB"), ("rb-d", "RB"), ("wr-b", "WR")]:
        trusted_native_roster_rows(player_id, name=player_id.upper(), team="NE", position=position)
    league = storage.get_league(league_id)
    rules = {**league["rules"], "roster": {"qb": {"starter": 1, "max": 3}, "rb": {"starter": 2, "max": 4},
                                           "flex": {"starter": 1, "eligible": ["RB", "WR", "TE"]}},
             "roster_size_max": 8}
    storage.update_league_rules(league_id, LeagueRules.model_validate(rules))

    def lineup(qb, rb1, rb2, flex):
        return [{"player_id": qb, "position": "QB", "slot": "QB1"},
                {"player_id": rb1, "position": "RB", "slot": "RB1"},
                {"player_id": rb2, "position": "RB", "slot": "RB2"},
                {"player_id": flex, "position": "WR", "slot": "FLEX1"}]
    return league_id, home, away, [{"team_id": home, "players": lineup("past-qb", "rb-a", "rb-b", "wr-a")},
                                   {"team_id": away, "players": lineup("other-qb", "rb-c", "rb-d", "wr-b")}]


def test_repeated_position_slots_can_be_corrected(two_back_league):
    result = preview(two_back_league)
    assert {row["slot"] for row in result["after"]["lineups"] if row["team_id"] == two_back_league[1]} == {"QB", "RB1", "RB2", "FLEX"}


def test_ineligible_starter_error_names_player_and_slot(two_back_league):
    two_back_league[3][0]["players"][3]["slot"] = "RB2"
    two_back_league[3][0]["players"][2]["slot"] = "BN"
    two_back_league[3][0]["players"][3]["position"] = "WR"
    with pytest.raises(corrections.CorrectionError, match=r"WR-A \(WR\) cannot start at RB 2"):
        preview(two_back_league)


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


def lineup_preview(recovery):
    context = corrections.correction_context(recovery[0], 2026, 1, "commissioner")
    return corrections.preview_correction(recovery[0], 2026, 1, "commissioner", recovery[3],
                                          "Repair starters during games", context["revision"], mode="lineup")


def test_lineup_repair_before_slate_ends_without_statistics(recovery, monkeypatch):
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *args, **kwargs: False)
    monkeypatch.setattr(hub_scoring, "load_week_stat_index", lambda *args: pytest.fail("Lineup repair must not load stats"))
    monkeypatch.setattr(hub_scoring, "nfl_game_started", lambda team, *args, **kwargs: team == "NE")
    recovery[3][0]["players"][0]["nfl_team"] = "NE"
    recovery[3][1]["players"][0]["nfl_team"] = "DAL"
    storage.replace_team_lineup(recovery[0], recovery[1], 2026, 2,
                                [{"player_id": "later", "position": "QB", "slot": "QB1"}])
    later = storage.list_week_lineups(recovery[0], 2026, 2)
    result = lineup_preview(recovery)
    assert result["can_publish"] and result["mode"] == "lineup"
    assert result["before"]["scores"] == result["after"]["scores"]
    assert result["before"]["standings"] == result["after"]["standings"]
    assert storage.list_week_lineups(recovery[0], 2026, 1) == []
    publish(recovery[0], result)
    saved = storage.list_week_lineups(recovery[0], 2026, 1)
    assert {row["player_id"]: row["locked"] for row in saved} == {"past-qb": 1, "other-qb": 0}
    assert storage.list_week_lineups(recovery[0], 2026, 2) == later
    assert storage.list_team_week_scores(recovery[0], 2026, 1) == []
    assert storage.get_week_scoring_run(recovery[0], 2026, 1) is None
    assert corrections.correction_history(recovery[0], 2026, 1)[0]["mode"] == "lineup"
    assert publish(recovery[0], result)["already_published"]


def test_lineup_only_audit_allows_subsequent_scoring_and_final_correction(recovery, monkeypatch):
    monkeypatch.setattr(hub_scoring, "nfl_game_started", lambda *args, **kwargs: False)
    result = lineup_preview(recovery)
    publish(recovery[0], result)
    scoring = storage.get_league(recovery[0])["rules"]["scoring"]
    storage.save_native_week_scores(recovery[0], 2026, 1, [], [], scoring, final=False)
    storage.save_native_week_scores(recovery[0], 2026, 1, [], [], scoring, final=True)
    with pytest.raises(corrections.CorrectionError, match="finalized"):
        lineup_preview(recovery)
    completed = preview(recovery)
    publish(recovery[0], completed, key="final-results")
    assert storage.get_week_scoring_run(recovery[0], 2026, 1)["final"]
    with pytest.raises(ValueError, match="commissioner correction"):
        storage.save_native_week_scores(recovery[0], 2026, 1, [], [], scoring)


def test_lineup_only_repair_rejects_stale_preview_and_unauthorized_actor(recovery, monkeypatch):
    monkeypatch.setattr(hub_scoring, "nfl_game_started", lambda *args, **kwargs: False)
    result = lineup_preview(recovery)
    with pytest.raises(PermissionError):
        corrections.publish_correction(recovery[0], 2026, 1, "manager", result["id"],
                                       result["revision"], result["reason"], "unauthorized")
    storage.replace_team_lineup(recovery[0], recovery[1], 2026, 1, [{"player_id":"changed", "slot":"BN", "position":"QB"}])
    with pytest.raises(corrections.CorrectionError, match="changed"):
        publish(recovery[0], result)
    assert corrections.correction_history(recovery[0], 2026, 1) == []


def test_final_results_still_require_completed_slate(recovery, monkeypatch):
    monkeypatch.setattr(hub_scoring, "nfl_week_slate_complete", lambda *args, **kwargs: False)
    result = preview(recovery)
    assert not result["can_publish"]
    with pytest.raises(corrections.CorrectionError, match="not complete"):
        publish(recovery[0], result)
