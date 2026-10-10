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
        if kind == "weekly":
            # Builds land on the hour, not an hour after the last deploy or rebuild.
            if built.timestamp() < clock.timestamp() - clock.timestamp() % WEEKLY_AUTO_REFRESH_SECONDS:
                return True
        elif (clock - built).total_seconds() >= SEASON_AUTO_REFRESH_SECONDS:
            return True
    return False


def availability_changed(kind, previous) -> bool:
    """A player's injury, active or depth status moved since the last weekly build."""
    if kind != "weekly" or not previous.get("player_availability"):
        return False
    from src.integrations.sleeper import forecast_player_revisions
    return forecast_player_revisions()[1] != previous["player_availability"]


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
    receipt = availability = None
    if kind == "weekly":
        from src.jobs import dfs_inputs
        from src.integrations.sleeper import forecast_player_revisions
        from src.projections.weekly_cache import load_weekly_prediction as loader
        dfs_inputs.prepare_sources(season)
        availability = forecast_player_revisions()[1]
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
        if (dfs_inputs.input_revision(season, week) != revision
                or forecast_player_revisions()[1] != availability):
            raise RuntimeError("Weekly inputs changed during refresh")
        outputs = dfs_inputs.output_revisions(season, week)
        if outputs is not None:
            receipt = {"version": dfs_inputs.VERSION, "revision": revision,
                       "outputs": outputs, "computed_epoch": computed_epoch}
        from src.jobs.dfs_refresh import _warm_supporting_data
        _warm_supporting_data(season, week)
    # DFS can assemble its specialist scores around these exact saved frames,
    # rather than repeat six model passes after the hourly worker publishes.
    publication = {"forecast_reuse": receipt} if receipt else {}
    if availability:
        publication["player_availability"] = availability
    return publication


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


def _reuse_dfs_weekly(season, week):
    """Adopt exact current-hour frames already computed by the DFS worker."""
    from src.jobs import dfs_inputs, dfs_refresh
    from src.integrations.sleeper import forecast_player_revisions
    from src.projections.weekly_cache import load_weekly_prediction
    shared = read_cached_metadata(dfs_refresh.STATUS_PATH)
    receipt = shared.get("forecast_reuse")
    if (shared.get("season") != season or shared.get("week") != week
            or not shared.get("player_availability") or not isinstance(receipt, dict)):
        return None
    now = datetime.now(timezone.utc).timestamp()
    epoch = receipt.get("computed_epoch")
    boundary = now - now % WEEKLY_AUTO_REFRESH_SECONDS
    if type(epoch) not in (int, float) or not boundary <= epoch <= now:
        return None
    try:
        dfs_inputs.prepare_sources(season)
        availability = forecast_player_revisions()[1]
        revision = dfs_inputs.input_revision(season, week)
        def unchanged():
            clock = datetime.now(timezone.utc).timestamp()
            return (epoch >= clock - clock % WEEKLY_AUTO_REFRESH_SECONDS
                    and availability == shared["player_availability"] == forecast_player_revisions()[1]
                    and revision == dfs_inputs.input_revision(season, week)
                    and dfs_inputs.can_reuse(shared, revision, season, week, now=clock,
                                            max_age=WEEKLY_AUTO_REFRESH_SECONDS))
        if not unchanged() or target_due("weekly", season, week):
            return None
        for pos in dfs_inputs.POSITIONS:
            for injury in (True, False):
                frame = load_weekly_prediction(pos, season, week, apply_injury_adjustments=injury,
                                               force=False, allow_compute=False, apply_identity=False)
                if frame.empty or frame.attrs.get("projection_stale"):
                    return None
        # Inputs and output files can be replaced while we read them. Never
        # certify a mixed publication or give old frames a new computation time.
        if unchanged():
            annotate_job(cache_hit=True, force=False, input_revision=revision)
            return {"forecast_reuse": receipt, "player_availability": availability}
    except Exception:
        logging.getLogger(__name__).warning("DFS weekly publication could not be reused", exc_info=True)
    return None


def _prepare_scheduled(kind, season, week):
    if kind == "weekly":
        publication = _reuse_dfs_weekly(season, week)
        if publication is not None:
            return publication
    annotate_job(cache_hit=False, force=True)
    return _prepare(kind, season, week)


def current_targets():
    return _current_targets()


def _target_needs_refresh(kind, season, week, previous):
    if (not target_due(kind, season, week) and previous.get("status") != "error"
            and not availability_changed(kind, previous)):
        return False
    attempted = timestamp(previous.get("started_at"))
    return not attempted or (datetime.now(timezone.utc) - attempted).total_seconds() >= PROJECTION_REFRESH_RETRY_SECONDS


def season_refresh_needed():
    """Cheap preflight before queueing; the worker rechecks under its OS lock."""
    targets = read_status()
    return any(_target_needs_refresh(kind, season, week, targets.get(target_key(kind, season, week), {}))
               for kind, season, week in _current_targets())


def _refresh_one(targets, kind, season, week, *, scheduled=False) -> bool:
    key = target_key(kind, season, week)
    previous = targets.get(key, {})
    status = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat(),
              "last_success_at": previous.get("last_success_at")}
    targets[key] = status
    _save(targets)
    ok = False
    try:
        publication = call_phase(kind, _prepare_scheduled if scheduled else _prepare, kind, season, week)
        status.update(publication or {})
        status.update(status="ok", last_success_at=datetime.now(timezone.utc).isoformat())
        ok = True
    except Exception:
        status["status"] = "error"
        logging.getLogger(__name__).exception("Season refresh failed: %s", key)
    status["completed_at"] = datetime.now(timezone.utc).isoformat()
    _save(targets)
    return ok


@observe_job("season_refresh", cadence_s=SEASON_AUTO_REFRESH_SECONDS)
def run_season_refresh():
    try:
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            targets = read_status()
            prepared, failed = 0, 0
            for kind, season, week in _current_targets():
                key = target_key(kind, season, week)
                previous = targets.get(key, {})
                if not _target_needs_refresh(kind, season, week, previous):
                    continue
                if _refresh_one(targets, kind, season, week, scheduled=True):
                    prepared += 1
                else:
                    failed += 1
            annotate_job(prepared=prepared, failed=failed)
            return {"status": "error" if failed else "ok", "prepared": prepared, "failed": failed}
    except RefreshBusy:
        return {"status": "busy"}


@observe_job("cache_rebuild")
def rebuild_target(kind, season, week=1):
    """Admin-forced rebuild of one target, even when it is not due."""
    if kind not in {"draft", "weekly", "ros"}:
        return {"status": "error"}
    try:
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            ok = _refresh_one(read_status(), kind, int(season), int(week))
            annotate_job(prepared=int(ok), failed=int(not ok))
            return {"status": "ok" if ok else "error"}
    except RefreshBusy:
        return {"status": "busy"}
