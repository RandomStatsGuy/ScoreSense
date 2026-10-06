"""Maintain the canonical weekly board hourly and season/ROS daily; no ETL or training."""
from __future__ import annotations
import json
import logging
import time
import pyarrow.parquet as pq
from datetime import datetime, timezone
from src.config import CACHE_DIR, SEASON_AUTO_REFRESH_SECONDS, WEEKLY_AUTO_REFRESH_SECONDS, PROJECTION_REFRESH_RETRY_SECONDS
from src.jobs.refresh_lock import refresh_lock, RefreshBusy
from src.ops.job_diagnostics import observe_job, annotate_job, call_phase
from src.projections.artifact_snapshot import read_cached_metadata
from src.projections.refresh_policy import timestamp

STATUS_PATH = CACHE_DIR / "season_refresh.json"


def read_status():
    result = read_cached_metadata(STATUS_PATH)
    targets = result.get("targets", {})
    return {key: value for key, value in targets.items() if isinstance(value, dict)} if isinstance(targets, dict) else {}


def target_key(kind, season, week=1):
    return f"{kind}:{int(season)}" + (f":{int(week)}" if kind in {"ros", "weekly"} else "")


def target_metadata(kind, season, week=1):
    if kind == "draft":
        from src.draft_hub.draft_pool_cache import _artifact_paths
        paths = [_artifact_paths(season)]
    else:
        if kind == "weekly":
            from src.projections.weekly_cache import _artifact_paths
        else:
            from src.projections.ros_cache import _artifact_paths
        paths = [_artifact_paths(pos, season, week, injury) for pos in ("qb", "rb", "wr") for injury in (True, False)]
    required = {
        "draft": {"Player", "Position", "Season Proj", "Per-Game Proj"},
        "weekly": {"Projected Points"},
        "ros": {"ROS P10", "ROS P50", "ROS P90"},
    }[kind]
    result = []
    for parquet, meta in paths:
        try:
            # Read only the footer: a recent damaged/empty cache must recover
            # immediately rather than wait for its normal daily deadline.
            footer = pq.read_metadata(parquet)
            valid = footer.num_rows > 0 and required.issubset(footer.schema.names)
            result.append(read_cached_metadata(meta) if valid else {})
        except (OSError, ValueError):
            result.append({})
    return result


def target_due(kind, season, week=1, *, now=None):
    clock = now or datetime.now(timezone.utc)
    for meta in target_metadata(kind, season, week):
        built = timestamp(meta.get("built_at"))
        if not built or (built - clock).total_seconds() > 300 or meta.get("rows") == 0 or meta.get("season") != season or (kind in {"ros", "weekly"} and meta.get("week") != week):
            return True
        if (clock - built).total_seconds() >= (WEEKLY_AUTO_REFRESH_SECONDS if kind == "weekly" else SEASON_AUTO_REFRESH_SECONDS):
            return True
    return False


def _save(targets):
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp = STATUS_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps({"targets": targets}), encoding="utf-8")
    temp.replace(STATUS_PATH)


def _prepare(kind, season, week):
    from src.jobs.dfs_inputs import invalidate_forecast_memory
    invalidate_forecast_memory(season)
    if kind == "draft":
        from src.draft_hub import draft_pool_cache as pool
        from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
        # Daily recomputation is explicit; normal GETs remain artifact-only.
        for _ in range(3):
            revision = pool.pool_fingerprint()
            frame, sidecar = pool._compute_pool(season)
            if frame.empty:
                raise ValueError("Empty season forecast; previous artifact retained")
            if revision != pool.pool_fingerprint():
                continue
            pool.save_pool_artifact(season, frame, sidecar)
            values = warm_fantasy_value_snapshots(season=season)
            if revision != pool.pool_fingerprint():
                continue
            if values["unavailable"]:
                raise ValueError("Season valuations could not refresh")
            return
        raise ValueError("Season inputs changed during refresh")
    receipt = None
    if kind == "weekly":
        from src.jobs import dfs_inputs
        from src.projections.weekly_cache import load_weekly_prediction as loader
        dfs_inputs.prepare_sources(season)
        revision = dfs_inputs.input_revision(season, week)
        computed_epoch = time.time()
    else:
        from src.projections.ros_cache import load_ros_prediction as loader
    for pos in ("qb", "rb", "wr"):
        for injury in (True, False):
            frame = loader(pos, season, week, apply_injury_adjustments=injury, force=True,
                           **({"apply_identity": False} if kind == "weekly" else {}))
            if frame.empty or frame.attrs.get("projection_stale"):
                raise ValueError("Forecast could not refresh")
    if kind == "weekly":
        if dfs_inputs.input_revision(season, week) != revision:
            raise RuntimeError("Weekly inputs changed during refresh")
        outputs = dfs_inputs.output_revisions(season, week)
        if outputs is not None:
            receipt = {"version": dfs_inputs.VERSION, "revision": revision,
                       "outputs": outputs, "computed_epoch": computed_epoch}
        from src.jobs.dfs_refresh import _warm_supporting_data
        _warm_supporting_data(season, week)
    # DFS can assemble its specialist scores around these exact saved frames,
    # rather than repeat six model passes after the hourly worker publishes.
    return {"forecast_reuse": receipt} if receipt else {}


def _current_targets():
    from src.projections.projection_meta import get_projection_meta
    meta = get_projection_meta("qb")
    season, week = int(meta["default_season"]), int(meta["default_week"])
    seasons = {season, int(meta.get("upcoming_season") or season)}
    from src.draft_hub import storage
    if storage.DRAFT_HUB_DB.exists():
        with storage.get_conn() as conn:
            for row in conn.execute("SELECT season FROM league UNION SELECT season FROM hub_workspace"):
                if row[0] and int(row[0]) >= season:
                    seasons.add(int(row[0]))
    from src.core.projection_context import is_nfl_offseason
    weekly = [("weekly", season, week)] if 1 <= week <= 18 and not is_nfl_offseason() else []
    return weekly + [("draft", s, 1) for s in sorted(seasons)] + ([("ros", season, week)] if 1 <= week <= 18 else [])


@observe_job("season_refresh", cadence_s=SEASON_AUTO_REFRESH_SECONDS)
def run_season_refresh():
    try:
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            targets = read_status()
            prepared, failed = 0, 0
            for kind, season, week in _current_targets():
                key = target_key(kind, season, week)
                if not target_due(kind, season, week) and targets.get(key, {}).get("status") != "error":
                    continue
                now = datetime.now(timezone.utc)
                previous = targets.get(key, {})
                attempted = timestamp(previous.get("started_at"))
                if attempted and (now - attempted).total_seconds() < PROJECTION_REFRESH_RETRY_SECONDS:
                    continue
                status = {"status": "running", "started_at": now.isoformat(),
                          "last_success_at": previous.get("last_success_at")}
                targets[key] = status
                _save(targets)
                try:
                    publication = call_phase(kind, _prepare, kind, season, week)
                    status.update(publication or {})
                    status.update(status="ok", last_success_at=datetime.now(timezone.utc).isoformat())
                    prepared += 1
                except Exception:
                    status["status"] = "error"
                    failed += 1
                    logging.getLogger(__name__).exception("Automatic season refresh failed: %s", key)
                status["completed_at"] = datetime.now(timezone.utc).isoformat()
                _save(targets)
            annotate_job(prepared=prepared, failed=failed)
            return {"status": "error" if failed else "ok", "prepared": prepared, "failed": failed}
    except RefreshBusy:
        return {"status": "busy"}
