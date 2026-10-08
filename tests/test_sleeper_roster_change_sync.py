"""Sleeper roster changes reconcile within a minute, and open pages can see the new revision."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import sleeper_sync_ticker as ticker
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.presets import load_preset


def _rosters(*rows):
    return [{"roster_id": rid, "owner_id": f"u{rid}", "players": players, "taxi": None, "reserve": None}
            for rid, players in rows]


def test_fingerprint_tracks_player_moves_not_order(monkeypatch):
    calls = iter([
        _rosters((1, ["a", "b"]), (2, ["c"])),
        _rosters((2, ["c"]), (1, ["b", "a"])),
        _rosters((1, ["a"]), (2, ["c", "b"])),
    ])
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_rosters", lambda _sid: next(calls))

    first = ticker.sleeper_roster_fingerprint("sl")
    assert ticker.sleeper_roster_fingerprint("sl") == first
    assert ticker.sleeper_roster_fingerprint("sl") != first


def test_reserve_and_taxi_count_toward_the_fingerprint(monkeypatch):
    rosters = [{"roster_id": 1, "owner_id": "u1", "players": ["a"], "reserve": ["b"], "taxi": None}]
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_rosters", lambda _sid: rosters)
    with_reserve = ticker.sleeper_roster_fingerprint("sl")
    rosters[0]["reserve"] = None
    assert ticker.sleeper_roster_fingerprint("sl") != with_reserve


def _patch_sync(monkeypatch, fingerprints, *, fail=()):
    synced: list[str] = []

    def fake_sync(league_id, _parsed, _manager_map):
        synced.append(league_id)
        if league_id in fail:
            raise RuntimeError("Sleeper unavailable")
        return {"sleeper": {"teams_synced": 2, "trade_count": 1, "merge": {}}, "waived": {}}

    monkeypatch.setattr(ticker, "_fingerprints", {})
    monkeypatch.setattr(ticker, "_retry_after", {})
    monkeypatch.setattr(storage, "list_live_sleeper_league_ids", lambda: list(fingerprints))
    monkeypatch.setattr(ticker, "_league_fingerprint", lambda lid: fingerprints[lid])
    monkeypatch.setattr("src.draft_hub.cap_sheet_import.sync_league_rosters_and_contracts", fake_sync)
    monkeypatch.setattr("app.hub_routes._clear_league_rosters_cache", lambda _lid: None)
    monkeypatch.setattr("app.hub_routes._clear_insights_response_cache", lambda _lid: None)
    return synced


def test_check_syncs_only_leagues_whose_rosters_changed(monkeypatch):
    fingerprints = {"a": "fa1", "b": "fb1"}
    synced = _patch_sync(monkeypatch, fingerprints)

    assert ticker.sync_all_live_sleeper_leagues()["synced"] == 2
    synced.clear()

    assert ticker.sync_changed_sleeper_leagues() == {"status": "unchanged", "checked": 2}
    assert synced == []

    fingerprints["b"] = "fb2"
    result = ticker.sync_changed_sleeper_leagues()
    assert synced == ["b"]
    assert result["changed"] == 1 and result["synced"] == 1 and result["leagues"][0]["trades_applied"] == 1
    assert ticker.sync_changed_sleeper_leagues()["status"] == "unchanged"


def test_new_league_without_a_fingerprint_syncs_on_first_check(monkeypatch):
    synced = _patch_sync(monkeypatch, {"new": "f1"})
    ticker.sync_changed_sleeper_leagues()
    assert synced == ["new"]


def test_unreachable_sleeper_skips_the_league(monkeypatch):
    synced = _patch_sync(monkeypatch, {"down": None})
    assert ticker.sync_changed_sleeper_leagues()["status"] == "unchanged"
    assert synced == []


def test_failed_sync_backs_off_instead_of_retrying_every_minute(monkeypatch):
    fingerprints = {"bad": "f1"}
    synced = _patch_sync(monkeypatch, fingerprints, fail={"bad"})

    assert ticker.sync_changed_sleeper_leagues()["failed"] == 1
    assert ticker.sync_changed_sleeper_leagues()["status"] == "unchanged"
    assert synced == ["bad"]

    ticker._retry_after["bad"] = 0
    ticker.sync_changed_sleeper_leagues()
    assert synced == ["bad", "bad"]


def test_unchanged_checks_are_counted_without_filling_run_history(diagnostics_enabled, monkeypatch):
    from src.ops.job_report import read_report

    _patch_sync(monkeypatch, {})
    for _ in range(3):
        assert ticker.sync_changed_sleeper_leagues()["status"] == "unchanged"
    job = next(j for j in read_report(diagnostics_enabled, limit=100)["jobs"] if j["job"] == "sleeper_rosters.check")
    assert job["skips"] == 3
    assert job["recent_reasons"] == {}


def _client(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def test_revision_route_reports_roster_changes_to_members_only(hub_db):
    league = storage.create_league("rev-comm", "Revision League", 2026, load_preset("salary_cap_auction_v1"))
    try:
        member = _client("rev-comm")
        before = member.get(f"/api/hub/league/{league['id']}/revision")
        assert before.status_code == 200
        storage.bump_live_roster_revision(league["id"])
        after = member.get(f"/api/hub/league/{league['id']}/revision").json()
        assert after["live_roster_revision"] == before.json()["live_roster_revision"] + 1

        outsider = _client("rev-outsider")
        assert outsider.get(f"/api/hub/league/{league['id']}/revision").status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
