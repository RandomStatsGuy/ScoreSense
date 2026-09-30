"""Snapshot correctness, input freshness, and equivalent prepared matching."""
import json
import random

import pandas as pd
import pytest

from src.draft_hub import value_sheet as values, value_snapshot as snapshots
from src.draft_hub.roster_identity_match import RosterIdentityIndex, find_matching_roster_slot
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def pool(monkeypatch):
    frame = pd.DataFrame([{"player_id": "00-0000001", "Player": "Player One", "Position": "WR",
                           "Team": "KC", "Season Proj": 200, "Per-Game Proj": 12}])
    monkeypatch.setattr(values, "load_draft_pool", lambda *_a, **_k: frame)
    monkeypatch.setattr(values, "load_k_def_rows", lambda *_a, **_k: [])
    monkeypatch.setattr("src.integrations.roster_identity.apply_roster_identity_with_attrs", lambda f, *_a, **_k: f)
    monkeypatch.setattr(values, "source_revision", lambda _season: "revision-1")
    return frame


def test_restart_reads_durable_snapshot_without_calculation(pool, monkeypatch):
    rules = LeagueRules()
    original = values.read_draft_pool_payload(2026, rules, [])
    # Returned responses must not contaminate a shared or persisted snapshot.
    original["hub_context"] = {"private": "viewer-a"}
    original["rows"][0]["player"] = "Changed in response"
    values.invalidate_pool_payload_cache()
    def forbidden(*_a, **_k):
        raise AssertionError("A restart must not recompute unchanged valuations")
    monkeypatch.setattr(values, "_valuation_maps", forbidden)
    restored = values.read_draft_pool_payload(2026, rules, [])
    assert restored["rows"][0]["player"] == "Player One"
    assert "hub_context" not in restored


def test_inputs_invalidate_memory_and_disk_snapshot(pool, monkeypatch):
    rules = LeagueRules()
    values.read_draft_pool_payload(2026, rules, [])
    monkeypatch.setattr(values, "source_revision", lambda _season: "revision-2")
    pool.loc[0, "Season Proj"] = 250
    assert values.read_draft_pool_payload(2026, rules, [])["rows"][0]["season_proj"] == 250
    values.invalidate_pool_payload_cache()
    assert values.peek_pool_payload_cache(2026, rules, [], team_count=10) is None
    assert values.peek_pool_payload_cache(2025, rules, []) is None
    assert values.peek_pool_payload_cache(2026, rules.model_copy(update={"salary_cap": 500}), []) is None


def test_source_revision_tracks_model_artifacts_and_identity(tmp_path, monkeypatch):
    from src.draft_hub import draft_pool_cache
    revision = {"model": "a", "identity": "a"}
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "pool_fingerprint", lambda: revision["model"])
    monkeypatch.setattr("src.integrations.roster_identity.identity_stamp", lambda _: revision["identity"])
    before = snapshots.source_revision(2026)
    (tmp_path / "pool_2026.parquet").write_bytes(b"replacement")
    artifact = snapshots.source_revision(2026)
    assert artifact != before
    revision["model"] = "b"
    model = snapshots.source_revision(2026)
    assert model != artifact
    revision["identity"] = "b"
    assert snapshots.source_revision(2026) != model


def test_import_source_and_tier_are_snapshot_inputs(pool):
    rules = LeagueRules()
    ranges = [{"player_id": "00-0000001", "min_sal": 20, "max_sal": 30, "source": "model", "tier": "Depth"}]
    modeled = values.read_draft_pool_payload(2026, rules, ranges)
    ranges[0].update(source="import", tier="Elite")
    imported = values.read_draft_pool_payload(2026, rules, ranges)
    assert imported["rows"][0]["fair_value"] == 25
    assert imported["rows"][0]["tier"] == "Elite"
    assert modeled["rows"][0]["tier"] == "Depth"


def test_http_preparation_uses_artifacts_without_network_or_model_work(pool, monkeypatch):
    calls = []
    def load(_season, **options):
        calls.append(options)
        assert options == {"allow_compute": False, "apply_identity": False}
        return pool
    def identity(frame, _position, **options):
        assert options["allow_refresh"] is False
        return frame
    def specialists(*_a, **options):
        assert options["allow_fetch"] is False
        return []
    monkeypatch.setattr(values, "load_draft_pool", load)
    monkeypatch.setattr("src.integrations.roster_identity.apply_roster_identity_with_attrs", identity)
    monkeypatch.setattr(values, "load_k_def_rows", specialists)
    values.read_draft_pool_payload(2026, LeagueRules(), [])
    assert len(calls) == 1


def test_missing_projection_artifact_does_not_publish_empty_success(monkeypatch):
    monkeypatch.setattr(values, "load_draft_pool", lambda *_a, **_k: pd.DataFrame())
    with pytest.raises(snapshots.PoolSnapshotUnavailable):
        values.read_draft_pool_payload(2026, LeagueRules(), [])
    assert not list(snapshots.SNAPSHOT_DIR.glob("*.json"))


def test_changed_inputs_during_preparation_are_not_published(pool, monkeypatch):
    revision = ["one"]
    monkeypatch.setattr(values, "source_revision", lambda _: revision[0])
    original = values._valuation_maps
    def changing(*args, **kwargs):
        revision[0] = "two"
        return original(*args, **kwargs)
    monkeypatch.setattr(values, "_valuation_maps", changing)
    values.read_draft_pool_payload(2026, LeagueRules(), [])
    assert values.peek_pool_payload_cache(2026, LeagueRules(), []) is None


def test_partial_publication_keeps_previous_snapshot(pool, monkeypatch):
    values.read_draft_pool_payload(2026, LeagueRules(), [])
    path = next(snapshots.SNAPSHOT_DIR.glob("*.json"))
    before = path.read_bytes()
    monkeypatch.setattr(snapshots.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("interrupted")))
    snapshots.save_snapshot(values._pool_payload_cache_key(2026, LeagueRules(), [], team_count=12), "two", {"rows": []})
    assert path.read_bytes() == before
    assert len(list(path.parent.iterdir())) == 1


def test_ownership_is_fresh_on_each_read(pool):
    rules = LeagueRules()
    payload = values.read_draft_pool_payload(2026, rules, [])
    assert values.build_value_overlay(payload, rules, [], draft_completed=True)["rows"][0]["is_available"]
    roster = [{"player_id": "00-0000001", "team_id": "other", "salary": 7, "contract_years": 2}]
    assert not values.build_value_overlay(payload, rules, [], league_roster=roster, draft_completed=True)["rows"][0]["is_available"]
    assert values.build_value_overlay(payload, rules, [], league_roster=[], draft_completed=True)["rows"][0]["is_available"]


def test_prepared_index_matches_existing_identity_rules():
    rng = random.Random(117)
    names = ["Kenneth Walker III", "Kenneth Walker", "Walker", "Kyren Williams", "Javonte Williams", "Williams", "Puka Nacua"]
    rows = [{"id": i, "player_id": rng.choice(["00-0000001", "sleeper-12", "12", "", str(i)]),
             "sleeper_player_id": rng.choice(["12", "99", ""]), "player_name": rng.choice(names),
             "position": rng.choice(["RB", "WR", "TE"]), "team_id": rng.choice(["a", "b"]),
             "salary": rng.randrange(1, 30), "contract_years": rng.randrange(0, 4),
             "source": rng.choice(["import", "sleeper"]), "roster_status": rng.choice(["active", "cut_before_draft"])}
            for i in range(60)]
    probes = rows + [{"player_id": "missing", "player_name": n, "position": p} for n in names for p in ["RB", "WR", "TE"]]
    for occupying in [True, False]:
        index = RosterIdentityIndex(rows, occupying_only=occupying)
        for player in probes:
            for team in [None, "a", "b", "missing"]:
                assert index.find(player, team_id=team) is find_matching_roster_slot(rows, player, team_id=team, occupying_only=occupying)


def test_board_does_not_normalize_every_roster_for_every_player(monkeypatch):
    from src.draft_hub import roster_identity_match
    from scripts.dev.benchmark_value_overlay import benchmark
    calls = 0
    original = roster_identity_match.roster_name_key
    def counted(name):
        nonlocal calls
        calls += 1
        return original(name)
    monkeypatch.setattr(roster_identity_match, "roster_name_key", counted)
    benchmark()
    assert calls < 10000  # Old nested scans normalize hundreds of thousands of names.


def test_unavailable_projection_http_returns_503_without_live_fallback(hub_db, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr(values, "load_draft_pool", lambda *_a, **_k: pd.DataFrame())
    client = TestClient(app)
    for path in ["/api/hub/draft-pool", "/api/hub/value-sheet", "/api/hub/value-sheet?overlay_only=true"]:
        response = client.get(path)
        assert response.status_code == 503
        assert "projection refresh" in response.json()["detail"]


def test_warmup_prepares_manager_ranges_with_league_rules(hub_db, pool, monkeypatch):
    from src.draft_hub import storage
    from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
    rules = LeagueRules()
    ws = storage.get_or_create_workspace("manager", season=2026)
    league = storage.create_league("manager", name="Snapshot league", season=2026, rules=rules, team_count=10)
    assert warm_fantasy_value_snapshots()["unavailable"] == 0
    assert values.peek_pool_payload_cache(2026, rules, [], team_count=10)
    assert storage.get_league(league["id"])["team_count"] == 10
    assert storage.list_roster(ws["id"]) == []
