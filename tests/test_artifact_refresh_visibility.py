"""An API process must see coherently published artifacts from a refresh process."""
import json

import pandas as pd
import pytest

from src.projections import weekly_cache, ros_cache
from src.projections.artifact_store import METADATA_ATTR, publish_prediction_artifact
from src.draft_hub import draft_pool_cache


@pytest.mark.parametrize("kind", ["weekly", "ros", "pool"])
def test_external_rewrite_invalidates_memory_without_feature_changes(kind, monkeypatch, tmp_path):
    monkeypatch.setattr("src.projections.projection_movement.WEEKLY_PROJECTION_CHANGES_DIR", tmp_path / "movement")
    mod = {"weekly": weekly_cache, "ros": ros_cache, "pool": draft_pool_cache}[kind]
    directory = {"weekly": "WEEKLY_PREDICTIONS_DIR", "ros": "ROS_PREDICTIONS_DIR", "pool": "DRAFT_POOL_DIR"}[kind]
    monkeypatch.setattr(mod, directory, tmp_path)
    monkeypatch.setattr(mod, "_with_roster_identity", lambda frame, *args, **kwargs: frame)
    fingerprint = {"weekly": "weekly_fingerprint", "ros": "ros_fingerprint", "pool": "pool_fingerprint"}[kind]
    monkeypatch.setattr(mod, fingerprint, lambda: "unchanged")
    metric = {"weekly": "Projected Points", "ros": "ROS P50", "pool": "Season Proj"}[kind]
    values = {"player_id": ["00-0000001"], "Player": ["Test TE"], "Position": ["TE"], metric: [12.0]}
    if kind == "ros":
        values["Season P50"] = [180.0]
    frame = pd.DataFrame(values)
    if kind == "pool":
        mod.invalidate_pool_cache()
        mod.save_pool_artifact(2026, frame)
        load = lambda: mod.load_draft_pool(2026, allow_compute=False, apply_identity=False)
        artifact, sidecar = mod._artifact_paths(2026)
    else:
        getattr(mod, f"invalidate_{kind}_cache")()
        getattr(mod, f"save_{kind}_artifact")("wr", 2026, 1, True, frame)
        load = lambda: getattr(mod, f"load_{kind}_prediction")("wr", 2026, 1, allow_compute=False)
        artifact, sidecar = mod._artifact_paths("wr", 2026, 1, True)
    assert load().iloc[0][metric] == 12.0
    embedded = pd.read_parquet(artifact).attrs[METADATA_ATTR]

    # A compatibility sidecar cannot replace the parquet's authoritative generation.
    sidecar.write_text(json.dumps({**embedded, "publication_id": "sidecar-only-edit"}), encoding="utf-8")
    unchanged = load()
    assert unchanged.iloc[0][metric] == 12.0
    assert unchanged.attrs["artifact_status"]["publication_id"] == embedded["publication_id"]
    assert unchanged.attrs["artifact_status"]["sidecar_status"] == "out_of_date"

    # Simulate another producer without touching this module's in-memory cache.
    replacement = frame.copy()
    replacement[metric] = 24.0
    published = publish_prediction_artifact(artifact, sidecar, replacement, embedded)
    assert published["publication_id"] != embedded["publication_id"]
    refreshed = load()
    assert refreshed.iloc[0][metric] == 24.0
    assert refreshed.attrs["artifact_status"]["publication_id"] == published["publication_id"]
    assert refreshed.attrs["artifact_status"]["sidecar_status"] == "matching"
