"""Tests for hub data freshness aggregator."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.hub_freshness import league_data_freshness
from src.draft_hub.schemas import LeagueRules


def test_league_data_freshness_missing_league():
    assert league_data_freshness("nonexistent-league-id") == {"available": False}


def test_league_data_freshness_shape():
    league = storage.create_league(
        commissioner_sub="test-sub",
        name="Freshness Test",
        season=2026,
        rules=LeagueRules(),
    )
    league_id = str(league["id"])
    out = league_data_freshness(league_id)
    assert out["available"] is True
    assert out["league_id"] == league_id
    assert "sleeper" in out
    assert "scoring" in out
    assert "cap_sheets" in out
    assert "projections" in out
    assert out.get("stale_as_of")


def test_league_data_freshness_never_parses_workbooks(hub_db, monkeypatch):
    league = storage.create_league(
        commissioner_sub="test-sub",
        name="Freshness Fast",
        season=2026,
        rules=LeagueRules(),
    )

    def _boom(*_a, **_k):
        raise AssertionError("process_league_history must not run on freshness GET")

    monkeypatch.setattr("src.draft_hub.contract_sync.process_league_history", _boom)
    monkeypatch.setattr("src.draft_hub.legacy_contract_import.process_league_history", _boom)
    out = league_data_freshness(str(league["id"]))
    assert out["available"] is True
    assert out["cap_sheets"]["stale"] in {True, False}
