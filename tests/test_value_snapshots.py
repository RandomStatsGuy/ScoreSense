"""Snapshot correctness, input freshness, and equivalent prepared matching."""
import json
import random
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event, Lock

import pandas as pd
import pytest

from src.draft_hub import value_sheet as values, value_snapshot as snapshots
from src.draft_hub.roster_identity_match import RosterIdentityIndex, find_matching_roster_slot
from src.draft_hub.schemas import LeagueRules


def observe_waiters(monkeypatch, expected):
    """Signal actual joins, so concurrency tests need no scheduling sleeps."""
    from src.core import shared_computation
    joined, lock, count = Event(), Lock(), [0]
    class ObservedFuture(Future):
        def result(self, *args, **kwargs):
            with lock:
                count[0] += 1
                if count[0] == expected:
                    joined.set()
            return super().result(*args, **kwargs)
    monkeypatch.setattr(shared_computation, "Future", ObservedFuture)
    return joined


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


def test_explicit_warmup_prepares_each_configured_season_once(hub_db, pool, monkeypatch):
    from src.draft_hub import storage, draft_pool_cache
    from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
    storage.get_or_create_workspace("older", season=2025)
    storage.get_or_create_workspace("current", season=2026)
    storage.create_league("current", name="Current league", season=2026, rules=LeagueRules(), team_count=10)
    prepared = []
    monkeypatch.setattr(draft_pool_cache, "load_draft_pool",
                        lambda season, **kwargs: prepared.append(season) or pool.copy())
    assert warm_fantasy_value_snapshots()["unavailable"] == 0
    assert prepared == []  # startup never runs projection inference
    assert warm_fantasy_value_snapshots(prepare_pools=True)["unavailable"] == 0
    assert sorted(prepared) == [2025, 2026]


def test_eight_concurrent_misses_share_one_preparation_and_isolate_responses(pool, monkeypatch):
    started, release = Event(), Event()
    joined = observe_waiters(monkeypatch, 7)
    original, calls = values._valuation_maps, []
    def prepare(*args, **kwargs):
        calls.append(1)
        started.set()
        assert release.wait(5)
        return original(*args, **kwargs)
    monkeypatch.setattr(values, "_valuation_maps", prepare)
    with ThreadPoolExecutor(max_workers=8) as executor:
        leader = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [])
        try:
            assert started.wait(5)
            others = [executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), []) for _ in range(7)]
            assert joined.wait(5)
        finally:
            release.set()
        results = [f.result(timeout=5) for f in [leader, *others]]
    assert len(calls) == 1
    assert all(r == results[0] for r in results)
    results[0]["rows"][0]["player"] = "Viewer mutation"
    results[0]["hub_context"] = {"viewer": "private"}
    assert all(r["rows"][0]["player"] == "Player One" and "hub_context" not in r for r in results[1:])


def test_shared_failure_reaches_waiters_and_next_request_retries(pool, monkeypatch):
    started, release = Event(), Event()
    joined = observe_waiters(monkeypatch, 3)
    original, calls = values._valuation_maps, []
    def fail_once(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            started.set()
            assert release.wait(5)
            raise RuntimeError("Preparation failed")
        return original(*args, **kwargs)
    monkeypatch.setattr(values, "_valuation_maps", fail_once)
    with ThreadPoolExecutor(max_workers=4) as executor:
        leader = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [])
        try:
            assert started.wait(5)
            others = [executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), []) for _ in range(3)]
            assert joined.wait(5)
        finally:
            release.set()
        for future in [leader, *others]:
            with pytest.raises(RuntimeError, match="Preparation failed"):
                future.result(timeout=5)
    assert len(calls) == 1
    assert values.read_draft_pool_payload(2026, LeagueRules(), [])["count"] == 1
    assert len(calls) == 2


def test_unrelated_configurations_do_not_wait_for_one_global_builder(pool, monkeypatch):
    started, release = Event(), Event()
    original = values._valuation_maps
    def prepare(*args, **kwargs):
        if kwargs["team_count"] == 12:
            started.set()
            assert release.wait(5)
        return original(*args, **kwargs)
    monkeypatch.setattr(values, "_valuation_maps", prepare)
    with ThreadPoolExecutor(max_workers=2) as executor:
        slow = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [], team_count=12)
        try:
            assert started.wait(5)
            independent = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [], team_count=10)
            assert independent.result(timeout=3)["team_count"] == 10
            assert not slow.done()
        finally:
            release.set()
        assert slow.result(timeout=5)["team_count"] == 12


def test_http_reader_does_not_join_inference_allowed_producer(pool, monkeypatch):
    started, release = Event(), Event()
    def load(_season, **options):
        if not options:
            started.set()
            assert release.wait(5)
        else:
            assert options == {"allow_compute": False, "apply_identity": False}
        return pool.copy()
    monkeypatch.setattr(values, "load_draft_pool", load)
    with ThreadPoolExecutor(max_workers=2) as executor:
        offline = executor.submit(values.build_draft_pool_payload, 2026, LeagueRules(), [])
        try:
            assert started.wait(5)
            reader = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [])
            assert reader.result(timeout=3)["count"] == 1
            assert not offline.done()
        finally:
            release.set()
        assert offline.result(timeout=5)["count"] == 1


def test_source_replacement_starts_new_flight_and_rejects_old_publication(pool, monkeypatch):
    started, release = Event(), Event()
    revision = ["old"]
    original = values._valuation_maps
    monkeypatch.setattr(values, "source_revision", lambda _: revision[0])
    monkeypatch.setattr(values, "load_draft_pool", lambda *_a, **_k: pool.copy())
    def prepare(frame, *args, **kwargs):
        if frame.loc[0, "Season Proj"] == 200:
            started.set()
            assert release.wait(5)
        return original(frame, *args, **kwargs)
    monkeypatch.setattr(values, "_valuation_maps", prepare)
    with ThreadPoolExecutor(max_workers=2) as executor:
        old = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [])
        try:
            assert started.wait(5)
            revision[0] = "new"
            pool.loc[0, "Season Proj"] = 250
            new = executor.submit(values.read_draft_pool_payload, 2026, LeagueRules(), [])
            assert new.result(timeout=3)["rows"][0]["season_proj"] == 250
        finally:
            release.set()
        assert old.result(timeout=5)["rows"][0]["season_proj"] == 200
    values.invalidate_pool_payload_cache()
    assert values.peek_pool_payload_cache(2026, LeagueRules(), [])["rows"][0]["season_proj"] == 250


@pytest.mark.parametrize("read_name", ["read_draft_pool_payload", "peek_pool_payload_cache"])
def test_concurrent_restart_reads_share_one_snapshot_parse(pool, monkeypatch, read_name):
    rules = LeagueRules()
    values.read_draft_pool_payload(2026, rules, [])
    values.invalidate_pool_payload_cache()
    started, release = Event(), Event()
    joined = observe_waiters(monkeypatch, 3)
    original, calls = values.load_snapshot, []
    def load(*args):
        calls.append(1)
        started.set()
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(values, "load_snapshot", load)
    read = getattr(values, read_name)
    with ThreadPoolExecutor(max_workers=4) as executor:
        leader = executor.submit(read, 2026, rules, [])
        try:
            assert started.wait(5)
            others = [executor.submit(read, 2026, rules, []) for _ in range(3)]
            assert joined.wait(5)
        finally:
            release.set()
        assert all(f.result(timeout=5)["count"] == 1 for f in [leader, *others])
    assert len(calls) == 1
