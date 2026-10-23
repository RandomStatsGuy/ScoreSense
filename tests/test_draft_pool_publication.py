"""Pool publication keeps forecasts and their season metadata in one version."""
import json
from pathlib import Path

import pandas as pd
import pytest

from src.draft_hub import draft_pool_cache as cache
from src.projections import artifact_store


@pytest.fixture(autouse=True)
def isolated_pool(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DRAFT_POOL_DIR", tmp_path / "pool")
    monkeypatch.setattr(cache, "PROCESSED_DATA_DIR", tmp_path / "features")
    monkeypatch.setattr(cache, "pool_fingerprint", lambda: "source-v1")
    def forbidden(*args, **kwargs):
        pytest.fail("saved pool read ran inference or a roster refresh")
    monkeypatch.setattr(cache, "_compute_pool", forbidden)
    monkeypatch.setattr(cache, "_with_roster_identity", forbidden)
    cache.invalidate_pool_cache()
    yield
    cache.invalidate_pool_cache()


def pool_frame(points=300.0):
    return pd.DataFrame({"player_id": ["00-0000001", "00-0000002"],
                         "Player": ["Test QB", "Test TE"], "Position": ["QB", "TE"],
                         "Season": [2026, 2026], "Season Proj": [points, 0.0]})


def read_pool():
    return cache.load_draft_pool(2026, allow_compute=False, apply_identity=False)


@pytest.mark.parametrize("sidecar_problem", ["invalid", "missing", "out_of_date"])
def test_embedded_pool_metadata_survives_broken_mirror(sidecar_problem):
    cache.save_pool_artifact(2026, pool_frame(), {"games_per_season": 17, "feature_season": 2025})
    data_path, meta_path = cache._artifact_paths(2026)
    authoritative = pd.read_parquet(data_path).attrs[artifact_store.METADATA_ATTR]
    if sidecar_problem == "invalid":
        meta_path.write_text("{broken", encoding="utf-8")
    elif sidecar_problem == "missing":
        meta_path.unlink()
    else:
        mirror = {**authoritative, "built_at": "2000-01-01T00:00:00Z"}
        meta_path.write_text(json.dumps(mirror), encoding="utf-8")
    cache.invalidate_pool_cache()
    loaded = read_pool()
    meta = cache.load_pool_meta(2026)
    status = cache.pool_artifact_status(2026)
    assert loaded["Season Proj"].tolist() == [300.0, 0.0]
    assert meta["artifact_kind"] == "draft_pool" and meta["artifact_version"] == 1
    assert "week" not in meta and "position" not in meta
    assert meta["built_at"] == authoritative["built_at"] == status["built_at"]
    assert meta["games_per_season"] == 17 and meta["feature_season"] == 2025
    assert status["cached"] is True and status["stale"] is False
    assert status["position_counts"]["TE"] == 1
    assert loaded.attrs["artifact_status"]["sidecar_status"] == sidecar_problem


def test_failed_atomic_commit_preserves_last_good_after_restart(monkeypatch):
    cache.save_pool_artifact(2026, pool_frame())
    data_path, meta_path = cache._artifact_paths(2026)
    before = {path: path.read_bytes() for path in (data_path, meta_path)}
    replace = artifact_store.os.replace
    def fail_commit(source, destination):
        if Path(destination) == data_path:
            raise OSError("fixture commit failed")
        return replace(source, destination)
    monkeypatch.setattr(artifact_store.os, "replace", fail_commit)
    with pytest.raises(OSError, match="commit failed"):
        cache.save_pool_artifact(2026, pool_frame(999.0))
    assert before == {path: path.read_bytes() for path in before}
    cache.invalidate_pool_cache()
    assert read_pool().iloc[0]["Season Proj"] == 300.0


@pytest.mark.parametrize("problem", ["empty", "duplicate", "wrong_season", "null", "no_id", "no_headline"])
def test_invalid_pool_replacement_is_rejected_before_commit(problem):
    cache.save_pool_artifact(2026, pool_frame())
    bad = pool_frame(999.0)
    if problem == "empty":
        bad = bad.iloc[:0]
    elif problem == "duplicate":
        bad.loc[1, "player_id"] = bad.loc[0, "player_id"]
    elif problem == "wrong_season":
        bad["Season"] = 2025
    elif problem == "null":
        bad["Season Proj"] = None
    elif problem == "no_id":
        bad = bad.drop(columns=["player_id"])
    else:
        bad = bad.drop(columns=["Season Proj"])
    with pytest.raises(ValueError, match="artifact_"):
        cache.save_pool_artifact(2026, bad)
    cache.invalidate_pool_cache()
    assert read_pool().iloc[0]["Season Proj"] == 300.0


def test_pool_empty_reads_have_truthful_diagnostics(monkeypatch):
    missing = read_pool()
    assert missing.empty and missing.attrs["artifact_status"]["status"] == "missing"
    cache.save_pool_artifact(2026, pool_frame())
    monkeypatch.setattr(cache, "pool_fingerprint", lambda: "source-v2")
    stale = read_pool()
    assert stale.empty and stale.attrs["artifact_status"]["status"] == "stale"
    data_path, _ = cache._artifact_paths(2026)
    data_path.write_bytes(b"broken parquet")
    invalid = read_pool()
    assert invalid.empty and invalid.attrs["artifact_status"]["status"] == "invalid"
    assert cache.pool_artifact_status(2026)["stale"] is True


def test_pool_metadata_returns_independent_nested_values():
    cache.save_pool_artifact(2026, pool_frame(), {"season_coverage_meta": {"n_sims": 1000}})
    metadata = cache.load_pool_meta(2026)
    metadata["season_coverage_meta"]["n_sims"] = -1
    assert cache.load_pool_meta(2026)["season_coverage_meta"]["n_sims"] == 1000


def test_legacy_pool_stays_readable_with_its_original_sidecar():
    data_path, meta_path = cache._artifact_paths(2026)
    frame = pool_frame()
    frame.to_parquet(data_path, index=False)
    meta_path.write_text(json.dumps({"season": 2026, "fingerprint": "source-v1", "rows": len(frame),
        "pos_logic": cache.POSITION_LOGIC_VERSION, "position_counts": cache.position_counts(frame),
        "built_at": "2026-07-01T00:00:00Z"}), encoding="utf-8")
    loaded = read_pool()
    assert loaded["Season Proj"].tolist() == [300.0, 0.0]
    assert loaded.attrs["artifact_status"]["artifact_version"] == 0
    assert cache.load_pool_meta(2026)["built_at"] == "2026-07-01T00:00:00Z"


def test_position_slice_keeps_metadata_from_its_own_pool_snapshot(monkeypatch):
    cache.save_pool_artifact(2026, pool_frame(), {"feature_season": 2025, "games_per_season": 17})
    older = read_pool()
    cache.save_pool_artifact(2026, pool_frame(999.0), {"feature_season": 2026, "games_per_season": 17})
    assert cache.load_pool_meta(2026)["feature_season"] == 2026
    monkeypatch.setattr(cache, "load_draft_pool", lambda season, **kwargs: older)
    part = cache.draft_pool_for_position("qb", 2026)
    assert part.iloc[0]["Season Proj"] == 300.0
    assert part.attrs["feature_season"] == 2025
