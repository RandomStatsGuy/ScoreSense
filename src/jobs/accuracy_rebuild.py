"""Orchestrated accuracy + upside rebuild with pollable status."""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path

from src.products.accuracy_report import ACCURACY_REPORT_PATH, build_all_positions_report
from src.analytics.season_long_eval import SEASON_LONG_ACCURACY_PATH, build_all_season_long_reports
from src.analytics.upside_eval import BASELINE_UPSIDE_PATH, build_all_upside_reports
from src.config import CACHE_DIR

STATUS_PATH = CACHE_DIR / "accuracy_rebuild_status.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime if path.exists() else None
    except OSError:
        return None


def _load_status() -> dict:
    if not STATUS_PATH.exists():
        return {}
    try:
        return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_status(status: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(status, indent=2), encoding="utf-8")


def get_accuracy_rebuild_status() -> dict:
    """Lightweight status for polling — file mtimes + in-flight job state."""
    status = _load_status()
    yearly_mtime = _file_mtime(ACCURACY_REPORT_PATH)
    upside_mtime = _file_mtime(BASELINE_UPSIDE_PATH)
    is_building = bool(status.get("is_building"))
    started_at = status.get("started_at")
    finished_at = status.get("finished_at")
    error = status.get("error")
    yearly_at_start = status.get("yearly_mtime_at_start")
    upside_at_start = status.get("upside_mtime_at_start")

    reports_touched = False
    if yearly_at_start is not None and yearly_mtime is not None:
        reports_touched = reports_touched or yearly_mtime > yearly_at_start
    if upside_at_start is not None and upside_mtime is not None:
        reports_touched = reports_touched or upside_mtime > upside_at_start

    ready_to_load = (
        not is_building
        and bool(started_at)
        and bool(finished_at)
        and not error
        and reports_touched
    )

    return {
        "is_building": is_building,
        "started_at": started_at,
        "finished_at": finished_at,
        "error": error,
        "yearly_accuracy_mtime": yearly_mtime,
        "upside_report_mtime": upside_mtime,
        "yearly_accuracy_path": str(ACCURACY_REPORT_PATH),
        "upside_report_path": str(BASELINE_UPSIDE_PATH),
        "ready_to_load": ready_to_load,
        "backtest_checkpoints": _backtest_checkpoint_stats(),
    }


def _backtest_checkpoint_stats() -> dict:
    from src.config import BACKTEST_CACHE_DIR

    if not BACKTEST_CACHE_DIR.exists():
        return {"count": 0, "bytes": 0}
    files = list(BACKTEST_CACHE_DIR.glob("*.joblib"))
    total_bytes = sum(f.stat().st_size for f in files)
    return {"count": len(files), "bytes": total_bytes, "dir": str(BACKTEST_CACHE_DIR)}


def start_full_accuracy_rebuild(include_espn: bool = True) -> dict:
    """Queue guard for API — locks status before the worker process starts."""
    if _load_status().get("is_building"):
        out = get_accuracy_rebuild_status()
        out["status"] = "already_running"
        return out

    started_at = _utc_now()
    _save_status(
        {
            "is_building": True,
            "started_at": started_at,
            "finished_at": None,
            "error": None,
            "yearly_mtime_at_start": _file_mtime(ACCURACY_REPORT_PATH),
            "upside_mtime_at_start": _file_mtime(BASELINE_UPSIDE_PATH),
            "include_espn": include_espn,
        }
    )
    return {"status": "started", "started_at": started_at}


def run_full_accuracy_rebuild(include_espn: bool | None = None) -> None:
    """
    Master rebuild: yearly MAE backtest + upside reports for all positions.

    Runs in a separate OS process when invoked via the API. Sequential phases
    limit peak memory on local dev.
    """
    from src.core.memory_utils import release_memory

    status = _load_status()
    started_at = status.get("started_at") or _utc_now()
    yearly_at_start = status.get("yearly_mtime_at_start")
    upside_at_start = status.get("upside_mtime_at_start")
    if include_espn is None:
        include_espn = bool(status.get("include_espn", True))

    try:
        from src.config import DEFAULT_FP_ARCHIVE_SEASONS
        from src.integrations.fantasypros import fantasypros_api_key_configured, prefetch_fantasypros_archive

        if fantasypros_api_key_configured():
            prefetch_fantasypros_archive(DEFAULT_FP_ARCHIVE_SEASONS)
        build_all_positions_report(None, include_espn=include_espn)
        release_memory()
        build_all_upside_reports()
        release_memory()
        from src.analytics.season_long_eval import prefetch_fp_preseason_weeks
        from src.config import DEFAULT_ACCURACY_SEASONS

        if fantasypros_api_key_configured():
            prefetch_fp_preseason_weeks(DEFAULT_ACCURACY_SEASONS)
        build_all_season_long_reports(tune_alpha=True)
        release_memory()
        _save_status(
            {
                "is_building": False,
                "started_at": started_at,
                "finished_at": _utc_now(),
                "error": None,
                "yearly_mtime_at_start": yearly_at_start,
                "upside_mtime_at_start": upside_at_start,
            }
        )
    except Exception as exc:
        _save_status(
            {
                "is_building": False,
                "started_at": started_at,
                "finished_at": _utc_now(),
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "yearly_mtime_at_start": yearly_at_start,
                "upside_mtime_at_start": upside_at_start,
            }
        )
        raise
    finally:
        release_memory()


def acknowledge_accuracy_rebuild() -> dict:
    """Clear completed rebuild state after the client loads fresh reports."""
    _save_status(
        {
            "is_building": False,
            "started_at": None,
            "finished_at": None,
            "error": None,
            "yearly_mtime_at_start": None,
            "upside_mtime_at_start": None,
        }
    )
    return get_accuracy_rebuild_status()
