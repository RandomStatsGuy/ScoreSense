"""Saved Fantasy valuations survive later source updates until fresh replacements."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

from src.draft_hub import draft_pool_cache as pools, value_sheet as values, storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_snapshot import PoolSnapshotUnavailable
from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots


@pytest.fixture
def forecasts(tmp_path, monkeypatch):
    import src.config as config
    from src.projections import input_policy
    from app import projection_recovery as recovery
    from src.jobs import projection_recovery as worker
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(input_policy, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(pools, "DRAFT_POOL_DIR", tmp_path / "pools")
    monkeypatch.setattr(pools, "PROCESSED_DATA_DIR", tmp_path / "features")
    monkeypatch.setattr(pools, "MODEL_DIR", tmp_path / "models")
    monkeypatch.setattr(worker, "CACHE_DIR", tmp_path)
    monkeypatch.setattr("src.integrations.roster_identity.apply_roster_identity_with_attrs", lambda f, *a, **k: f.copy())
    monkeypatch.setattr("src.integrations.roster_identity.identity_stamp", lambda year: "local")
    monkeypatch.setattr(values, "load_k_def_rows", lambda *a, **k: [])
    feature = pools.PROCESSED_DATA_DIR / "qb_mlready.parquet"
    feature.parent.mkdir()
    feature.write_bytes(b"old features")
    frame = pd.DataFrame({"player_id": ["00-0000001"], "Player": ["Test TE"],
                          "Position": ["TE"], "Team": ["BUF"],
                          "Season Proj": [204.], "Per-Game Proj": [12.]})
    pools.save_pool_artifact(2026, frame)
    before = pools.load_pool_meta(2026)
    compute = Mock(side_effect=AssertionError("Inference on the request path"))
    monkeypatch.setattr(pools, "_compute_pool", compute)
    recovery._ACTIVE.clear()
    recovery._RESULTS.clear()
    yield feature, frame, before, compute
    recovery._ACTIVE.clear()
    recovery._RESULTS.clear()


def make_stale(feature):
    feature.write_bytes(b"new projection input")


def test_saved_valuations_survive_input_change_and_restart_with_original_provenance(forecasts):
    feature, frame, before, compute = forecasts
    values.read_draft_pool_payload(2026, LeagueRules(), [])
    artifact_bytes = [p.read_bytes() for p in pools._artifact_paths(2026)]
    make_stale(feature)
    assert pools.load_draft_pool(2026, allow_compute=False, apply_identity=False).empty
    result = values.read_draft_pool_payload(2026, LeagueRules(), [])
    assert result["rows"][0]["season_proj"] == 204
    assert result["rows"][0]["per_game_proj"] == 12
    assert result["projection_stale"] is True
    assert result["projection_built_at"] == before["built_at"]
    assert result["projection_fingerprint"] == before["fingerprint"] != pools.pool_fingerprint()
    assert values.peek_pool_payload_cache(2026, LeagueRules(), []) is None
    pools.invalidate_pool_cache()
    values.invalidate_pool_payload_cache()
    cached = values.peek_pool_payload_cache(2026, LeagueRules(), [], allow_stale=True)
    assert cached == result
    assert values.build_value_overlay(cached, LeagueRules(), [])["projection_stale"]
    assert [p.read_bytes() for p in pools._artifact_paths(2026)] == artifact_bytes
    compute.assert_not_called()


def test_refresh_warmup_rejects_stale_valuations_even_after_http_publication(hub_db, forecasts):
    feature, _, _, _ = forecasts
    workspace = storage.get_or_create_workspace("manager", season=2026)
    rules = LeagueRules.model_validate(workspace["rules"])
    make_stale(feature)
    assert values.read_draft_pool_payload(2026, rules, [])["projection_stale"]
    with pytest.raises(PoolSnapshotUnavailable):
        values.read_draft_pool_payload(2026, rules, [], allow_stale=False)
    assert warm_fantasy_value_snapshots(season=2026) == {
        "prepared": 0, "unavailable": 1, "failed_seasons": [2026]}


@pytest.mark.parametrize("damage", ["wrong_season", "parquet", "metadata", "columns"])
def test_wrong_context_or_damaged_snapshot_never_becomes_a_fallback(forecasts, damage):
    feature, frame, _, _ = forecasts
    make_stale(feature)
    parquet, metadata = pools._artifact_paths(2026)
    if damage == "wrong_season":
        meta = json.loads(metadata.read_text())
        meta.update(season=2025, fingerprint=pools.pool_fingerprint())
        metadata.write_text(json.dumps(meta))
    elif damage == "parquet":
        parquet.write_bytes(b"corrupt")
    elif damage == "metadata":
        metadata.write_text("[]")
    else:
        frame.drop(columns="Per-Game Proj").to_parquet(parquet, index=False)
    pools.invalidate_pool_cache()
    with pytest.raises(PoolSnapshotUnavailable):
        values.read_draft_pool_payload(2026, LeagueRules(), [])
    with pytest.raises(PoolSnapshotUnavailable):
        values.read_draft_pool_payload(2025, LeagueRules(), [])


@pytest.mark.parametrize("path", ["/draft-pool", "/value-sheet", "/value-sheet?overlay_only=true", "/value-overlay"])
@pytest.mark.parametrize("age_minutes", [14, 1500])
def test_fantasy_http_keeps_rows_available_and_respects_daily_cadence(hub_db, forecasts, monkeypatch, path, age_minutes):
    from app.api import app
    from app import projection_recovery as recovery
    feature, _, before, compute = forecasts
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    submitted = []
    async def submit(*args):
        submitted.append(args)
        return {"status": "error", "failed": ["draft"]}
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    make_stale(feature)
    metadata = pools._artifact_paths(2026)[1]
    before["built_at"] = (datetime.now(timezone.utc)-timedelta(minutes=age_minutes)).isoformat()
    metadata.write_text(json.dumps(before))
    pools.invalidate_pool_cache()
    response = TestClient(app).get("/api/hub" + path)
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1 and payload["rows"][0]["per_game_proj"] == 12
    assert payload["projection_stale"] and payload["projection_built_at"] == before["built_at"]
    compute.assert_not_called()
    if age_minutes == 14:
        assert payload["projection_recovery"]["status"] == "scheduled"
        assert not submitted
        again = TestClient(app).get("/api/hub" + path)
        assert again.status_code == 200
        assert again.json()["projection_recovery"]["status"] == "scheduled"
        assert not submitted
        return
    assert payload["projection_recovery"]["status"] == "queued"
    assert len(submitted) == 1 and submitted[0][1:] == (2026, 1, ("draft",))
    # Recovery failure retains the same forecast and uses the bounded retry.
    again = TestClient(app).get("/api/hub" + path)
    assert again.status_code == 200
    assert again.json()["projection_recovery"]["status"] == "error"
    assert len(submitted) == 1


def test_genuinely_missing_pool_queues_recovery_on_the_503_response(hub_db, forecasts, monkeypatch):
    from app.api import app
    from app import projection_recovery as recovery
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    pools._artifact_paths(2026)[0].unlink()
    pools.invalidate_pool_cache()
    submitted = []
    async def submit(*args):
        submitted.append(args)
        return {"status": "error", "failed": ["draft"]}
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    response = TestClient(app).get("/api/hub/draft-pool")
    assert response.status_code == 503 and response.headers["retry-after"] == "60"
    assert response.json()["projection_recovery"]["status"] == "queued"
    assert len(submitted) == 1


def test_background_recovery_rebuilds_current_season_and_its_durable_valuations(hub_db, forecasts):
    from src.jobs.projection_recovery import rebuild_projection_context
    feature, frame, before, compute = forecasts
    workspace = storage.get_or_create_workspace("manager", season=2026)
    # An unrelated historical workspace must not make current-season recovery fail.
    storage.get_or_create_workspace("older", season=2025)
    rules = LeagueRules.model_validate(workspace["rules"])
    make_stale(feature)
    assert values.read_draft_pool_payload(2026, rules, [])["projection_stale"]
    updated = frame.copy()
    updated["Season Proj"] = 238.
    updated["Per-Game Proj"] = 14.
    compute.side_effect = None
    compute.return_value = updated, {}
    assert rebuild_projection_context(2026, 1, ("draft",)) == {"status": "ok", "failed": []}
    compute.assert_called_once_with(2026)
    pools.invalidate_pool_cache()
    values.invalidate_pool_payload_cache()
    payload = values.peek_pool_payload_cache(2026, rules, [])
    assert payload and payload["projection_stale"] is False
    assert payload["projection_fingerprint"] == pools.pool_fingerprint()
    assert payload["projection_built_at"] != before["built_at"]
    assert payload["rows"][0]["per_game_proj"] == 14.
    assert values.peek_pool_payload_cache(2025, rules, []) is None


def test_publication_source_change_does_not_relabel_memory_as_a_new_forecast(forecasts, monkeypatch):
    feature, frame, _, _ = forecasts
    original = pools.pool_fingerprint
    captured = original()
    # Simulate a source replacement after metadata construction, before the
    # in-memory result would formerly be stamped with the next fingerprint.
    calls = []
    def fingerprint():
        calls.append(1)
        if len(calls) == 2:
            make_stale(feature)
        return original()
    monkeypatch.setattr(pools, "pool_fingerprint", fingerprint)
    pools.save_pool_artifact(2026, frame)
    assert pools.load_pool_meta(2026)["fingerprint"] == captured
    assert pools.load_draft_pool(2026, allow_compute=False, apply_identity=False).empty


def test_failed_background_replacement_preserves_saved_forecasts(hub_db, forecasts):
    from src.jobs.projection_recovery import rebuild_projection_context
    feature, _, before, compute = forecasts
    make_stale(feature)
    saved = [p.read_bytes() for p in pools._artifact_paths(2026)]
    compute.side_effect = RuntimeError("Roster source unavailable")
    assert rebuild_projection_context(2026, 1, ("draft",)) == {"status": "error", "failed": ["draft"]}
    assert [p.read_bytes() for p in pools._artifact_paths(2026)] == saved
    payload = values.read_draft_pool_payload(2026, LeagueRules(), [])
    assert payload["rows"][0]["per_game_proj"] == 12
    assert payload["projection_stale"] and payload["projection_built_at"] == before["built_at"]
