"""A deployment must never make stale outputs look current by relabeling them."""
import json

import pandas as pd
import pytest

from scripts.ops import artifact_fingerprint_audit as audit
from src.projections import artifact_store


@pytest.fixture
def artifacts(tmp_path, monkeypatch):
    for name in ("WEEKLY_PREDICTIONS_DIR", "ROS_PREDICTIONS_DIR", "DRAFT_POOL_DIR"):
        monkeypatch.setattr(audit, name, tmp_path)
    monkeypatch.setattr(audit, "weekly_fingerprint", lambda: "current-inputs")
    monkeypatch.setattr(audit, "ros_fingerprint", lambda: "current-inputs")
    monkeypatch.setattr(audit, "pool_fingerprint", lambda: "current-inputs")
    def forbidden(*args, **kwargs):
        pytest.fail("fingerprint audit invoked inference")
    monkeypatch.setattr("src.projections.weekly_cache.predict_upcoming_week", forbidden)
    monkeypatch.setattr("src.projections.ros_cache.predict_rest_of_season", forbidden)
    return tmp_path


def legacy_artifact(directory, *, fingerprint="old-inputs"):
    data_path = directory / "2026_w7_wr.parquet"
    meta_path = directory / "2026_w7_wr.meta.json"
    pd.DataFrame({"player_id": ["00-0037247"], "Projected Points": [8.472]}).to_parquet(data_path, index=False)
    meta_path.write_text(json.dumps({"fingerprint": fingerprint, "season": 2026, "week": 7,
                                     "built_at": "2026-10-22T00:00:00Z"}), encoding="utf-8")
    return data_path, meta_path


def test_stale_legacy_fingerprint_is_reported_without_touching_either_file(artifacts):
    data_path, meta_path = legacy_artifact(artifacts)
    before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in (data_path, meta_path)}
    result = audit.audit_artifact_fingerprints(kinds=("weekly",), include_integrity=False)
    assert result["status"] == "warning" and result["read_only"] is True
    assert result["artifacts"][0]["status"] == "stale"
    assert result["artifacts"][0]["artifact_fingerprint"] == "old-inputs"
    assert before == {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in before}


def test_embedded_version_wins_over_forged_current_sidecar(artifacts):
    data_path, meta_path = legacy_artifact(artifacts)
    frame = pd.read_parquet(data_path)
    frame.attrs[artifact_store.METADATA_ATTR] = {"fingerprint": "real-old-inputs", "season": 2026, "week": 7}
    frame.to_parquet(data_path, index=False)
    meta_path.write_text(json.dumps({"fingerprint": "current-inputs"}), encoding="utf-8")
    result = audit.audit_artifact_fingerprints(kinds=("weekly",), include_integrity=False)
    artifact = result["artifacts"][0]
    assert artifact["metadata_source"] == "embedded"
    assert artifact["status"] == "stale" and artifact["sidecar_status"] == "out_of_date"


def test_missing_sidecar_embedded_artifact_remains_visible_to_audit(artifacts):
    data_path, meta_path = legacy_artifact(artifacts)
    frame = pd.read_parquet(data_path)
    frame.attrs[artifact_store.METADATA_ATTR] = {"fingerprint": "current-inputs"}
    frame.to_parquet(data_path, index=False)
    meta_path.unlink()
    result = audit.audit_artifact_fingerprints(kinds=("weekly",), include_integrity=False)
    assert result["status"] == "warning"
    assert result["artifacts"][0]["sidecar_status"] == "missing"


def test_recent_artifact_and_matching_fingerprint_cannot_hide_old_source(artifacts, monkeypatch, capsys):
    legacy_artifact(artifacts, fingerprint="current-inputs")
    calls = []
    def coverage(**context):
        calls.append(context)
        return {"status": "warning", "findings": [{"code": "source_cutoff_behind_completed_games", "source_through_week": 4, "latest_completed_game_week": 6}]}
    monkeypatch.setattr("src.projections.data_integrity.audit_projection_integrity", coverage)
    assert audit.main(["--season", "2026", "--week", "7"], kinds=("weekly",)) == 1
    result = json.loads(capsys.readouterr().out)
    assert result["artifacts"][0]["status"] == "matching"
    assert result["integrity"]["findings"][0]["source_through_week"] == 4
    assert calls == [{"season": 2026, "week": 7}]


def test_old_artifact_period_cannot_hide_current_source_gap(artifacts, monkeypatch):
    from src.core.projection_read_scope import anonymous_projection_read
    _, meta_path = legacy_artifact(artifacts, fingerprint="current-inputs")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["week"] = 4
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    def calendar(position):
        assert anonymous_projection_read() is True
        return {"default_season": 2026, "default_week": 7}
    monkeypatch.setattr("src.projections.projection_meta.get_projection_meta", calendar)
    contexts = []
    def coverage(**context):
        contexts.append(context)
        return {"status": "warning", "reason": "source_cutoff_behind_completed_games"}
    monkeypatch.setattr("src.projections.data_integrity.audit_projection_integrity", coverage)
    result = audit.audit_artifact_fingerprints(kinds=("weekly",))
    assert result["status"] == "warning"
    assert contexts == [{"season": 2026, "week": 7}]


def test_missing_data_or_bad_metadata_is_structured_failure(artifacts):
    (artifacts / "missing.meta.json").write_text("{}", encoding="utf-8")
    result = audit.audit_artifact_fingerprints(kinds=("weekly",), include_integrity=False)
    assert result["status"] == "failed"
    assert result["artifacts"][0]["reason"] == "artifact_data_missing"


def test_deprecated_entrypoints_only_delegate_to_read_only_audit():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    for name in ("fix_artifact_fingerprints.py", "fix_weekly_cache_fingerprint.py"):
        text = (root / "scripts" / "ops" / name).read_text(encoding="utf-8")
        assert "artifact_fingerprint_audit import main" in text
        assert "write_text" not in text and "load_weekly_prediction" not in text
    deploy = (root / "deploy" / "server" / "deploy-on-server.sh").read_text(encoding="utf-8")
    assert "scripts/ops/artifact_fingerprint_audit.py" in deploy
    assert "deployment did not refresh or relabel the data" in deploy
