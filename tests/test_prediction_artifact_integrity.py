"""Prediction version/context invariants, with real isolated parquet files."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from src.projections import artifact_store, ros_cache, weekly_cache


@pytest.fixture(params=["weekly", "ros"])
def prediction_cache(request, monkeypatch, tmp_path):
    kind = request.param
    module = weekly_cache if kind == "weekly" else ros_cache
    monkeypatch.setattr(module, "WEEKLY_PREDICTIONS_DIR" if kind == "weekly" else "ROS_PREDICTIONS_DIR", tmp_path)
    monkeypatch.setattr(module, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(module, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(module, "_with_roster_identity", lambda frame, *args, **kwargs: frame)
    monkeypatch.setattr("src.projections.projection_movement.WEEKLY_PROJECTION_CHANGES_DIR", tmp_path / "movement")
    invalidate = getattr(module, f"invalidate_{kind}_cache")
    invalidate()
    yield module, getattr(module, f"save_{kind}_artifact"), getattr(module, f"load_{kind}_prediction"), invalidate
    invalidate()


def sample_frame(points=0.0):
    frame = pd.DataFrame({"player_id": ["00-0037247"], "Player": ["George Pickens"], "Season": [2026], "Week": [7], "Projected Points": [points], "ROS P50": [100.0], "Season P50": [200.0]})
    frame.attrs["inference_meta"] = {"feature_season": 2026, "source_note": "fixture"}
    return frame


def test_embedded_metadata_is_authoritative_after_restart(prediction_cache):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame())
    path, meta_path = module._artifact_paths("wr", 2026, 7, True)
    published = pd.read_parquet(path).attrs[artifact_store.METADATA_ATTR]
    # Simulates interruption between atomic parquet publication and sidecar copy.
    meta_path.write_text("{broken-json", encoding="utf-8")
    invalidate()
    loaded = load("wr", 2026, 7, allow_compute=False)
    assert loaded.iloc[0]["Projected Points"] == 0.0
    assert loaded.attrs["built_at"] == published["built_at"]
    assert loaded.attrs["inference_meta"]["feature_season"] == 2026
    assert loaded.attrs["artifact_status"]["status"] == "ready"
    assert loaded.attrs["artifact_status"]["sidecar_status"] == "invalid"


def test_failed_replacement_preserves_last_good_on_disk(prediction_cache, monkeypatch):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame(8.472))
    path, _ = module._artifact_paths("wr", 2026, 7, True)
    old_bytes = path.read_bytes()
    real_replace = artifact_store.os.replace

    def fail_commit(source, destination):
        if Path(destination) == path:
            raise OSError("disk commit failed")
        return real_replace(source, destination)

    monkeypatch.setattr(artifact_store.os, "replace", fail_commit)
    with pytest.raises(OSError, match="commit failed"):
        save("wr", 2026, 7, True, sample_frame(99.0))
    assert path.read_bytes() == old_bytes
    invalidate()
    assert load("wr", 2026, 7, allow_compute=False).iloc[0]["Projected Points"] == 8.472
    assert not list(path.parent.glob("*.tmp"))


@pytest.mark.parametrize("problem", ["wrong_week", "wrong_season", "duplicate", "empty", "missing_forecast", "infinite_forecast", "missing_id_column", "missing_headline_column"])
def test_invalid_replacement_never_overwrites_valid_artifact(prediction_cache, problem):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame(8.472))
    bad = sample_frame(99.0)
    if problem == "wrong_week":
        bad["Week"] = 6
    elif problem == "wrong_season":
        bad["Season"] = 2025
    elif problem == "duplicate":
        bad = pd.concat([bad, bad], ignore_index=True)
    elif problem == "missing_forecast":
        bad["Projected Points"] = None
    elif problem == "infinite_forecast":
        bad["Projected Points"] = float("inf")
    elif problem == "missing_id_column":
        bad = bad.drop(columns=["player_id"])
    elif problem == "missing_headline_column":
        bad = bad.drop(columns=["Projected Points"] if module is weekly_cache else ["ROS P50"])
    else:
        bad = bad.iloc[:0]
    with pytest.raises(ValueError, match="artifact_"):
        save("wr", 2026, 7, True, bad)
    invalidate()
    assert load("wr", 2026, 7, allow_compute=False).iloc[0]["Projected Points"] == 8.472


def test_stale_is_explicit_and_only_same_context(prediction_cache, monkeypatch):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame(8.472))
    kind = "weekly" if module is weekly_cache else "ros"
    monkeypatch.setattr(module, f"{kind}_fingerprint", lambda: "new-inputs")
    strict = load("wr", 2026, 7, allow_compute=False)
    assert strict.empty and strict.attrs["artifact_status"]["status"] == "stale"
    fallback = load("wr", 2026, 7, allow_compute=False, allow_stale=True)
    assert fallback.iloc[0]["Week"] == 7
    assert fallback.attrs["artifact_status"]["status"] == "stale"
    strict_after_fallback = load("wr", 2026, 7, allow_compute=False)
    assert strict_after_fallback.empty
    assert strict_after_fallback.attrs["artifact_status"]["status"] == "stale"
    other_week = load("wr", 2026, 8, allow_compute=False, allow_stale=True)
    assert other_week.empty and other_week.attrs["artifact_status"]["status"] == "missing"
    other_variant = load("wr", 2026, 7, apply_injury_adjustments=False, allow_compute=False, allow_stale=True)
    assert other_variant.empty


def test_legacy_bad_context_and_corrupt_parquet_are_diagnosed(prediction_cache):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame())
    path, meta_path = module._artifact_paths("wr", 2026, 7, True)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta.pop("artifact_version")
    meta.pop("publication_id")
    meta["week"] = 6
    sample_frame().to_parquet(path, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    invalidate()
    invalid = load("wr", 2026, 7, allow_compute=False)
    assert invalid.empty
    assert invalid.attrs["artifact_status"]["reason"] == "artifact_context_mismatch:week"
    path.write_bytes(b"truncated parquet")
    broken = load("wr", 2026, 7, allow_compute=False)
    assert broken.empty and broken.attrs["artifact_status"]["reason"] == "artifact_unreadable"


def test_incomplete_context_never_computes_when_compute_disabled(prediction_cache, monkeypatch):
    module, _, load, _ = prediction_cache
    predictor = "predict_upcoming_week" if module is weekly_cache else "predict_rest_of_season"
    def forbidden(*args, **kwargs):
        pytest.fail("read-only request invoked model inference")
    monkeypatch.setattr(module, predictor, forbidden)
    result = load("wr", 2026, None, allow_compute=False)
    assert result.empty
    assert result.attrs["artifact_status"]["reason"] == "incomplete_projection_context"


def test_generation_time_does_not_replace_feature_source_cutoff(prediction_cache):
    module, save, load, invalidate = prediction_cache
    pd.DataFrame({"season": [2025, 2026, 2026], "week": [18, 3, 4]}).to_parquet(module.PROCESSED_DATA_DIR / "wr_mlready.parquet", index=False)
    save("wr", 2026, 7, True, sample_frame())
    invalidate()
    loaded = load("wr", 2026, 7, allow_compute=False)
    status = loaded.attrs["artifact_status"]
    assert status["built_at"]
    assert status["feature_source_cutoff"]["season"] == 2026
    assert status["feature_source_cutoff"]["through_week"] == 4
    assert status["feature_source_cutoff"]["ingested_at"] is None
    assert status["feature_source_cutoff"]["source"] == "training_features"


def test_identity_source_change_invalidates_ready_memory(prediction_cache, monkeypatch):
    module, save, load, _ = prediction_cache
    revision = {"value": "identity-v1"}
    monkeypatch.setattr(artifact_store, "prediction_identity_revision", lambda season: revision["value"])
    monkeypatch.setattr(module, "prediction_identity_revision", lambda season: revision["value"])
    save("wr", 2026, 7, True, sample_frame())
    assert not load("wr", 2026, 7, allow_compute=False).empty
    revision["value"] = "identity-v2"
    changed = load("wr", 2026, 7, allow_compute=False)
    assert changed.empty
    assert changed.attrs["artifact_status"]["reason"] == "identity_source_changed"
    fallback = load("wr", 2026, 7, allow_compute=False, allow_stale=True)
    assert not fallback.empty and fallback.attrs["artifact_status"]["status"] == "stale"


def test_corrupt_external_replacement_uses_labeled_memory_only_when_requested(prediction_cache):
    module, save, load, _ = prediction_cache
    save("wr", 2026, 7, True, sample_frame(8.472))
    original_built_at = load("wr", 2026, 7, allow_compute=False).attrs["built_at"]
    path, _ = module._artifact_paths("wr", 2026, 7, True)
    path.write_bytes(b"broken external replacement")
    assert load("wr", 2026, 7, allow_compute=False).empty
    fallback = load("wr", 2026, 7, allow_compute=False, allow_stale=True)
    assert fallback.iloc[0]["Projected Points"] == 8.472
    assert fallback.attrs["projection_stale"] is True
    assert fallback.attrs["built_at"] == original_built_at
    assert fallback.attrs["artifact_status"]["status"] == "invalid"
    assert fallback.attrs["artifact_status"]["reason"] == "artifact_unreadable"
    assert fallback.attrs["artifact_status"]["last_known_good"] is True
    assert load("wr", 2026, 7, allow_compute=False).empty


def test_unknown_artifact_schema_is_invalid(prediction_cache):
    module, save, load, invalidate = prediction_cache
    save("wr", 2026, 7, True, sample_frame())
    path, _ = module._artifact_paths("wr", 2026, 7, True)
    frame = pd.read_parquet(path)
    frame.attrs[artifact_store.METADATA_ATTR]["artifact_version"] = 99
    frame.to_parquet(path, index=False)
    invalidate()
    invalid = load("wr", 2026, 7, allow_compute=False)
    assert invalid.empty
    assert invalid.attrs["artifact_status"]["reason"] == "artifact_version_unsupported"
