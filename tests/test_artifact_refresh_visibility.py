"""An API process must see artifacts rewritten by a refresh process."""
import os
import pandas as pd
import pytest
from src.projections import weekly_cache, ros_cache
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
    frame = pd.DataFrame({"Player": ["Test TE"], "Position": ["TE"], "Projected Points": [12.0], "Season Proj": [180.0]})
    if kind == "pool":
        mod.invalidate_pool_cache()
        mod.save_pool_artifact(2026, frame)
        load = lambda: mod.load_draft_pool(2026, allow_compute=False, apply_identity=False)
        artifact = mod._artifact_paths(2026)[0]
    else:
        getattr(mod, f"invalidate_{kind}_cache")()
        getattr(mod, f"save_{kind}_artifact")("wr", 2026, 1, True, frame)
        load = lambda: getattr(mod, f"load_{kind}_prediction")("wr", 2026, 1, allow_compute=False)
        artifact = mod._artifact_paths("wr", 2026, 1, True)[0]
    assert load().iloc[0]["Projected Points"] == 12.0
    stamp = artifact.stat().st_mtime_ns
    frame["Projected Points"] = 24.0
    frame.to_parquet(artifact, index=False)  # another process cannot clear this process's dictionary
    os.utime(artifact, ns=(stamp + 1_000_000, stamp + 1_000_000))
    assert load().iloc[0]["Projected Points"] == 24.0
