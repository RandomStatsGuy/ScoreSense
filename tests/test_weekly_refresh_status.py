"""Refresh status file — running marker, errors, and UI-facing completed flag."""

from __future__ import annotations

import json
from unittest.mock import patch

from src.jobs import weekly_refresh as wr


def test_mark_refresh_started_writes_running(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    started = wr.mark_refresh_started(retrain=False, draft_only=False)
    assert started["status"] == "running"
    assert started["started_at"]
    on_disk = json.loads(status_path.read_text())
    assert on_disk["status"] == "running"
    assert wr.get_refresh_status()["status"] == "running"


def test_get_refresh_status_legacy_completed(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    status_path.write_text(
        json.dumps({"started_at": "2026-06-01T00:00:00+00:00", "completed_at": "2026-06-01T01:00:00+00:00"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    status = wr.get_refresh_status()
    assert status["status"] == "completed"


def test_run_weekly_refresh_records_error(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    with patch.object(wr, "build_all_datasets", side_effect=RuntimeError("nflverse down")):
        try:
            wr.run_weekly_refresh(retrain=False, seasons=[2026], draft_only=False)
        except RuntimeError:
            pass
        else:
            raise AssertionError("expected RuntimeError")
    status = wr.get_refresh_status()
    assert status["status"] == "error"
    assert "nflverse down" in status["error"]
    assert status.get("completed_at")
