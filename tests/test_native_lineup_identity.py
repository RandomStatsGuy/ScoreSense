"""Identity and alias regressions for native locks and published points."""
from datetime import datetime, timezone

import pytest

from src.draft_hub import hub_scoring as scoring, storage
from src.draft_hub.native_lineup_identity import trusted_lineup_row
from src.draft_hub.presets import load_preset


@pytest.fixture
def known_players(trusted_native_catalog, monkeypatch):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id="00-0033873")
    trusted_native_catalog("receiver", name="Real Receiver", team="DET", position="WR")
    monkeypatch.setattr(scoring, "_utcnow", lambda: datetime(2026, 9, 1, tzinfo=timezone.utc))
    monkeypatch.setattr(scoring, "_week_lineups_closed", lambda *_args, **_kwargs: False)
    monkeypatch.setattr("src.draft_hub.native_stats.cached_week_snapshot", lambda *_: None)
    return trusted_native_catalog


def league_pair(hub_db):
    league = storage.create_league("identity-owner", "Identity integrity", 2026, load_preset("snake_draft_v1"), team_count=2)
    home = storage.get_team_by_user(league["id"], "identity-owner")
    away = storage.join_league("identity-away", league["room_code"], "Away")
    return league, home, away


def saved(pid="4046", *, position="QB", team="KC", slot="QB", role="starter", locked=True):
    return {"player_id": pid, "player_name": "Patrick Mahomes", "nfl_team": team,
            "position": position, "slot": slot, "lineup_role": role, "locked": locked}


def test_spoofed_team_and_position_cannot_bypass_kickoff(known_players, monkeypatch):
    monkeypatch.setattr(scoring, "nfl_game_started", lambda club, *_args, **_kwargs: club == "KC")
    row = saved(position="WR", team="DET", slot="BN", role="bench", locked=False)
    assert scoring._lineup_row_locked(row, 2026, 1)
    actual = trusted_lineup_row(row, 2026, 1)
    assert actual["position"] == "QB" and actual["nfl_team"] == "KC"
    assert scoring.lineup_edit_metadata(row, 2026, 1)["lock_reason"] == "game_started"


def test_historical_event_team_wins_over_current_nfl_trade(known_players, monkeypatch):
    known_players("6783", name="Tyreek Hill", team="MIA", position="WR", gsis_id="00-0033040")
    event = {"sleeper_player_id": "6783", "name": "Tyreek Hill", "team": "KC", "position": "WR"}
    snapshot = {"identities": {"6783": event}, "records": [event]}
    monkeypatch.setattr("src.draft_hub.native_stats.cached_week_snapshot", lambda *_: snapshot)
    clubs = []
    monkeypatch.setattr(scoring, "nfl_game_started", lambda club, *_args, **_kwargs: clubs.append(club) or club == "KC")
    row = saved("00-0033040", position="WR", team="MIA", slot="WR1", locked=False)
    assert scoring._lineup_row_locked(row, 2022, 1)
    assert clubs == ["KC"]


def test_unknown_identity_fails_closed_without_changing_saved_row(known_players, monkeypatch):
    monkeypatch.setattr(scoring, "nfl_game_started", lambda *_args, **_kwargs: False)
    row = saved("unrecognized", locked=False)
    before = dict(row)
    assert scoring._lineup_row_locked(row, 2026, 1)
    assert scoring.lineup_edit_metadata(row, 2026, 1)["lock_reason"] == "identity_unavailable"
    assert row == before
    # Explicit per-player callbacks remain a trusted test/integration hook.
    assert not scoring._lineup_row_locked(row, 2026, 1, game_started=lambda team: False)


def test_legacy_spoofed_qb_cannot_be_selected_at_wr(hub_db, known_players, monkeypatch):
    league, home, _away = league_pair(hub_db)
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(ws, {"player_id": "4046", "player_name": "Patrick Mahomes", "team": "DET",
                               "position": "WR", "salary": 0, "contract_years": 1}, team_id=home["id"])
    monkeypatch.setattr(scoring, "nfl_game_started", lambda *_args, **_kwargs: False)
    with pytest.raises(scoring.LineupError, match="QB cannot start at WR1"):
        scoring.set_team_starters(league["id"], home["id"], 2026, 1, [{"player_id": "4046", "slot": "WR1"}])


def test_invalid_historical_slot_holds_finalization_without_rewriting_snapshot(hub_db, known_players):
    league, home, away = league_pair(hub_db)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, [saved(position="WR", team="DET", slot="WR1")])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1, [])
    before = storage.list_week_lineups(league["id"], 2026, 1)
    with pytest.raises(scoring.LineupError, match="QB cannot score at WR1"):
        scoring.apply_week_scores(league["id"], 2026, 1, stat_index={"4046": {"passing_yards": 300}}, slate_complete=True)
    assert storage.get_week_scoring_run(league["id"], 2026, 1) is None
    assert storage.list_week_lineups(league["id"], 2026, 1) == before


def test_aliases_cannot_score_as_starters_on_two_teams(hub_db, known_players):
    league, home, away = league_pair(hub_db)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, [saved()])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1, [saved("00-0033873")])
    with pytest.raises(scoring.LineupError, match="multiple starting slots"):
        scoring.apply_week_scores(league["id"], 2026, 1,
            stat_index={"4046": {"passing_yards": 300}, "00-0033873": {"passing_yards": 300}}, slate_complete=True)
    assert storage.list_team_week_scores(league["id"], 2026, 1) == []


def test_duplicate_configured_slot_cannot_double_score(hub_db, known_players):
    known_players("qb-two", name="Second QB", team="BUF", position="QB")
    league, home, away = league_pair(hub_db)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1,
                               [saved(), saved("qb-two", team="BUF", slot="QB1")])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1, [])
    with pytest.raises(scoring.LineupError, match="starter slot can only score once"):
        scoring.apply_week_scores(league["id"], 2026, 1,
            stat_index={"4046": {"passing_yards": 300}, "qb-two": {"passing_yards": 200}}, slate_complete=True)
    assert storage.get_week_scoring_run(league["id"], 2026, 1) is None


def test_acquired_alias_bench_does_not_inherit_original_starter_points(hub_db, known_players):
    league, home, away = league_pair(hub_db)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, [saved()])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1,
                               [saved("00-0033873", slot="BN", role="bench")])
    result = scoring.apply_week_scores(league["id"], 2026, 1,
            stat_index={"4046": {"passing_yards": 300}, "00-0033873": {"passing_yards": 300}}, slate_complete=True)
    assert result["scored"]
    assert {r["team_id"]: r["points"] for r in storage.list_team_week_scores(league["id"], 2026, 1)} == {home["id"]: 12, away["id"]: 0}
    rows = storage.list_player_week_scores(league["id"], 2026, 1)
    assert [(row["player_id"], row["team_id"]) for row in rows] == [("4046", home["id"])]


def test_worker_alias_bench_is_unknown_and_original_starter_is_only_scoring_owner(hub_db, known_players):
    from src.draft_hub import native_score_refresh as refresh
    league, home, away = league_pair(hub_db)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, [saved()])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1, [saved("00-0033873", slot="BN", role="bench")])
    event = {"sleeper_player_id": "4046", "name": "Patrick Mahomes", "team": "KC", "position": "QB"}
    now = datetime(2026, 9, 1, tzinfo=timezone.utc)
    snapshot = {"identities": {"4046": event, "00-0033873": event},
                "stats": {"4046": {"passing_yards": 300}}, "game_states": {"KC": {"game_state": "live"}},
                "complete": False, "fetched_at": now.isoformat(), "fingerprint": "same-real-player"}
    result = refresh.refresh_league_week(league, 2026, 1, snapshot, current_week=False, now=now)
    assert {row["team_id"]: row["points"] for row in result["teams"]} == {home["id"]: 12, away["id"]: 0}
    assert next(row for row in result["players"] if row["team_id"] == away["id"])["points"] is None


def test_correction_rejects_spoofed_position_and_alias_starters(hub_db, known_players, monkeypatch):
    from src.draft_hub import week_corrections as correction
    league, home, away = league_pair(hub_db)
    monkeypatch.setattr(scoring, "nfl_week_slate_complete", lambda *_args, **_kwargs: True)
    context = correction.correction_context(league["id"], 2026, 1, "identity-owner")
    with pytest.raises(correction.CorrectionError, match="position-eligible"):
        correction.preview_correction(league["id"], 2026, 1, "identity-owner",
            [{"team_id": home["id"], "players": [saved(position="WR", team="DET", slot="WR1")]}],
            "Correct historical ownership", context["revision"], True, stat_index={"4046": {"passing_yards": 300}})
    with pytest.raises(correction.CorrectionError, match="one team"):
        correction.preview_correction(league["id"], 2026, 1, "identity-owner",
            [{"team_id": home["id"], "players": [saved()]}, {"team_id": away["id"], "players": [saved("00-0033873")]}],
            "Correct historical ownership", context["revision"], True, stat_index={"4046": {"passing_yards": 300}})


def test_no_change_trade_correction_preserves_owner_across_aliases(hub_db, known_players, monkeypatch):
    from src.draft_hub import week_corrections as correction
    league, home, away = league_pair(hub_db)
    monkeypatch.setattr(scoring, "nfl_week_slate_complete", lambda *_args, **_kwargs: True)
    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, [saved()])
    storage.replace_team_lineup(league["id"], away["id"], 2026, 1, [saved("00-0033873", slot="BN", role="bench")])
    scoring.ensure_season_schedule(league["id"], season=2026)
    context = correction.correction_context(league["id"], 2026, 1, "identity-owner")
    index = {"4046": {"passing_yards": 300}, "00-0033873": {"passing_yards": 300}}
    result = correction.preview_correction(league["id"], 2026, 1, "identity-owner",
        [{"team_id": home["id"], "players": storage.list_team_lineup(league["id"], home["id"], 2026, 1)}],
        "Preserve original scoring owner", context["revision"], True, stat_index=index)
    assert result["can_publish"]
    correction.publish_correction(league["id"], 2026, 1, "identity-owner", result["id"], result["revision"],
                                  result["reason"], "alias-trade-correction", stat_index=index)
    assert [(row["player_id"], row["team_id"]) for row in storage.list_player_week_scores(league["id"], 2026, 1)] == [("4046", home["id"])]
