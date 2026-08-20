"""Live projection artifacts must survive a production git reset."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _load_preserve():
    path = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "preserve_runtime_artifacts.py"
    spec = importlib.util.spec_from_file_location("preserve_runtime_artifacts", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


preserve = _load_preserve()
backup = preserve.backup
restore = preserve.restore


def test_deploy_workflow_lists_the_same_runtime_paths():
    workflow = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "deploy.yml"
    text = workflow.read_text(encoding="utf-8")
    missing = [
        path
        for path in [*preserve.RUNTIME_DIRS, *preserve.RUNTIME_FILES]
        if path not in text
    ]
    assert missing == []


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_restore_keeps_refreshed_built_at_over_git_copy(tmp_path):
    root = tmp_path / "repo"
    meta = root / "artifacts" / "draft_pool" / "pool_2026.meta.json"
    parquet = root / "artifacts" / "draft_pool" / "pool_2026.parquet"
    weekly = root / "artifacts" / "weekly_predictions" / "2026_w1_qb.meta.json"
    mlready = root / "data" / "processed" / "qb_mlready.parquet"
    _write(meta, json.dumps({"built_at": "2026-08-18T16:00:00+00:00", "rows": 548}))
    parquet.write_bytes(b"fresh-pool")
    _write(weekly, json.dumps({"built_at": "2026-08-18T16:05:00+00:00"}))
    mlready.parent.mkdir(parents=True, exist_ok=True)
    mlready.write_bytes(b"fresh-features")

    dest = tmp_path / "backup"
    copied = backup(root, dest)
    assert "artifacts/draft_pool/pool_2026.meta.json" in copied
    assert "artifacts/weekly_predictions/2026_w1_qb.meta.json" in copied
    assert "data/processed/qb_mlready.parquet" in copied

    # Simulate `git reset --hard origin/master` restoring June 25 copies.
    _write(meta, json.dumps({"built_at": "2026-06-25T16:08:33.139849+00:00", "rows": 548}))
    parquet.write_bytes(b"old-pool")
    _write(weekly, json.dumps({"built_at": "2026-06-25T02:27:48.454626+00:00"}))
    mlready.write_bytes(b"old-features")

    restored = restore(root, dest)
    assert "artifacts/draft_pool/pool_2026.meta.json" in restored

    live_meta = json.loads(meta.read_text(encoding="utf-8"))
    live_weekly = json.loads(weekly.read_text(encoding="utf-8"))
    assert live_meta["built_at"].startswith("2026-08-18")
    assert live_weekly["built_at"].startswith("2026-08-18")
    assert parquet.read_bytes() == b"fresh-pool"
    assert mlready.read_bytes() == b"fresh-features"


def test_backup_skips_missing_runtime_dirs(tmp_path):
    root = tmp_path / "empty-repo"
    root.mkdir()
    dest = tmp_path / "backup"
    assert backup(root, dest) == []
    assert restore(root, dest) == []
