"""Retained player aliases and last-moment pick validation."""
import json

import pytest

from src.draft_hub import draft_pool, draft_state, storage
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def retained_alias(hub_db, trusted_native_catalog, monkeypatch):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id="00-0033873")
    rules = load_preset("snake_draft_v1")
    league = storage.create_league("alias-comm", "Alias draft", 2026, rules, team_count=2)
    home = storage.get_team_by_user(league["id"], "alias-comm")
    away = storage.join_league("alias-member", league["room_code"], "Member")
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(ws, {"player_id": "4046", "player_name": "Patrick Mahomes", "team": "KC",
                               "position": "QB", "salary": 0, "contract_years": 2}, team_id=home["id"])
    rows = [{"player_id": "00-0033873", "player": "Patrick Mahomes", "team": "KC", "position": "QB"},
            {"player_id": "available", "player": "Available WR", "team": "BUF", "position": "WR"}]
    monkeypatch.setattr("src.draft_hub.value_sheet.build_value_sheet", lambda *_args, **_kwargs: {"rows": rows})
    monkeypatch.setattr(draft_state, "_emit_state", lambda *_args: {})
    return league, home, away, rows


def test_nomination_pool_excludes_aliases_without_inflating_drafted_count(retained_alias):
    league, home, away, _rows = retained_alias
    assert draft_pool.list_drafted_player_ids(league["id"]) == {"4046"}
    aliases = draft_pool.list_drafted_player_ids(league["id"], include_aliases=True)
    assert {"4046", "sleeper-4046", "00-0033873"} <= aliases
    pool = draft_pool.build_nomination_pool(league_id=league["id"], pool_mode="full", season=2026,
        rules=LeagueRules.model_validate(league["rules"]), workspace_id=storage.roster_workspace_for_league(league))
    assert [row["player_id"] for row in pool["rows"]] == ["available"]
    assert pool["drafted_count"] == 1
    with pytest.raises(ValueError, match="already drafted"):
        draft_pool.resolve_nomination_player(league_id=league["id"], pool_mode="full", player_id="00-0033873",
            season=2026, rules=LeagueRules.model_validate(league["rules"]),
            workspace_id=storage.roster_workspace_for_league(league))


def test_retained_raw_sid_blocks_gsis_pick_before_roster_or_clock_changes(retained_alias):
    league, home, away, rows = retained_alias
    storage.update_draft_session(league["id"], status="picking", nomination_order_json=json.dumps([away["id"], home["id"]]))
    before_session = storage.get_draft_session(league["id"])
    before_events = storage.list_draft_events(league["id"])
    with pytest.raises(ValueError, match="already drafted"):
        draft_state.make_pick(league["id"], "alias-member", rows[0], from_pool=True)
    assert storage.list_team_roster(league["id"], away["id"]) == []
    assert storage.get_draft_session(league["id"]) == before_session
    assert storage.list_draft_events(league["id"]) == before_events


def test_retained_alias_blocks_auction_nomination(retained_alias):
    league, home, away, rows = retained_alias
    storage.update_league_rules(league["id"], load_preset("salary_cap_auction_v1"))
    storage.update_draft_session(league["id"], status="nominating", nomination_order_json=json.dumps([away["id"], home["id"]]))
    before = storage.get_draft_session(league["id"])
    with pytest.raises(ValueError, match="already drafted"):
        draft_state.nominate(league["id"], "alias-member", rows[0], from_pool=True)
    assert storage.get_draft_session(league["id"]) == before


@pytest.mark.parametrize("entry", ["live", "offline"])
def test_late_capacity_change_rejects_pick_without_advancing_draft(hub_db, trusted_native_catalog, monkeypatch, entry):
    rules = LeagueRules(draft_type="snake", roster={"wr": {"starter": 1, "max": 1}}, roster_size_max=1)
    league = storage.create_league("race-owner", "Capacity race", 2026, rules, team_count=1)
    home = storage.get_team_by_user(league["id"], "race-owner")
    ws = storage.roster_workspace_for_league(league)
    trusted_native_catalog("candidate", team="KC", position="WR")
    trusted_native_catalog("concurrent", team="BUF", position="WR")
    storage.update_draft_session(league["id"], status="picking", conduct=entry,
                                 nomination_order_json=json.dumps([home["id"]]))
    before_session = storage.get_draft_session(league["id"])
    before_events = storage.list_draft_events(league["id"])
    original_add = storage.add_roster_slot
    def race_add(workspace_id, row, *args, **kwargs):
        original_add(ws, {"player_id": "concurrent", "player_name": "Concurrent WR", "team": "BUF",
                         "position": "WR", "salary": 0, "contract_years": 2}, team_id=home["id"])
        return original_add(workspace_id, row, *args, **kwargs)
    monkeypatch.setattr(storage, "add_roster_slot", race_add)
    monkeypatch.setattr(draft_state, "_emit_state", lambda *_args: {})
    candidate = {"player_id": "candidate", "player": "Candidate WR", "team": "KC", "position": "WR"}
    with pytest.raises(ValueError, match="maximum|roster limit|roster maximum"):
        if entry == "live":
            draft_state.make_pick(league["id"], "race-owner", candidate, from_pool=True)
        else:
            from src.draft_hub import offline_draft
            monkeypatch.setattr(offline_draft, "resolve_nomination_player", lambda **_kwargs: candidate)
            offline_draft.record_draft_result(league["id"], "race-owner", player_id="candidate", team_id=home["id"])
    assert [row["player_id"] for row in storage.list_team_roster(league["id"], home["id"])] == ["concurrent"]
    assert storage.get_draft_session(league["id"]) == before_session
    assert storage.list_draft_events(league["id"]) == before_events
