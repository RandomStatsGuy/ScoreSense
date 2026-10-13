"""Rebuild missing requested-context artifacts off the request path; no training."""
from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job, call_phase

import logging
import time
from datetime import datetime, timezone

from src.config import CACHE_DIR
from src.jobs.refresh_lock import RefreshBusy, refresh_lock


@observe_job("projection_repair")
def rebuild_projection_context(season: int, week: int, kinds: tuple[str, ...]) -> dict:
    annotate_job(season=season, week=week, checked=len(kinds))
    errors = []
    try:
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            from src.jobs.season_refresh import read_status, target_key, _save
            health = read_status()
            started_at = datetime.now(timezone.utc).isoformat()
            for kind in kinds:
                if kind in {"draft", "ros", "weekly"}:
                    key = target_key(kind, season, week)
                    health[key] = {**health.get(key, {}), "status": "running", "started_at": started_at}
            _save(health)
            weekly_publication = None
            for kind in kinds:
                try:
                    if kind == "draft":
                        from src.draft_hub.draft_pool_cache import load_draft_pool, pool_fingerprint
                        from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
                        for _ in range(3):
                            revision = pool_fingerprint()
                            call_phase("draft_pool", load_draft_pool, season, apply_identity=False)
                            values = warm_fantasy_value_snapshots(season=season)
                            if pool_fingerprint() != revision:
                                continue
                            if load_draft_pool(season, allow_compute=False, apply_identity=False).empty:
                                raise ValueError("Empty draft pool")
                            if values["unavailable"]:
                                raise ValueError("Fantasy valuations remain unavailable")
                            break
                        else:
                            raise ValueError("Draft inputs changed during recovery")
                    elif kind == "dfs":
                        from src.projections.dfs_pool import refresh_dfs_pool
                        result = call_phase("dfs", refresh_dfs_pool, season, week)
                        if result.get('historical_inputs_only') or result.get('special_history_refresh_failed'):
                            raise ValueError("Specialist inputs could not refresh; saved forecasts remain available")
                    elif kind == "specialists":
                        from src.integrations.sleeper import players_dataframe
                        from src.draft_hub.prepared_k_def_context import prepare_k_def_context
                        from src.draft_hub.k_def_pool_cache import k_def_projection_index
                        from src.core.schedule_utils import _load_schedules
                        players_dataframe(allow_refresh=True)
                        prepared = prepare_k_def_context()
                        if (prepared['status'] not in {'current', 'prepared'}
                                or not k_def_projection_index() or _load_schedules([season]).empty):
                            raise ValueError("Specialist identities or schedule unavailable")
                    else:
                        from src.projections.ros_cache import load_ros_prediction
                        from src.projections.weekly_cache import load_weekly_prediction
                        loader = load_ros_prediction if kind == "ros" else load_weekly_prediction
                        if kind == "weekly":
                            from src.jobs import dfs_inputs
                            from src.integrations.sleeper import forecast_player_revisions
                            from src.projections.refresh_policy import timestamp
                            dfs_inputs.prepare_sources(season)
                            weekly_revision = dfs_inputs.input_revision(season, week)
                            weekly_availability = forecast_player_revisions()[1]
                            weekly_started = time.time()
                            weekly_frames = []
                        for position in ("qb", "rb", "wr"):
                            try:
                                for injury in (True, False):
                                    frame = call_phase(f"{kind}_{position}_inj{int(injury)}", loader,
                                                       position, season, week, apply_injury_adjustments=injury)
                                    if frame.empty or frame.attrs.get("projection_stale"):
                                        raise ValueError("Projection output is empty or stale")
                                    if kind == "weekly":
                                        weekly_frames.append(frame)
                            except Exception:
                                errors.append(f"{kind}:{position}")
                                logging.getLogger(__name__).exception("Projection recovery failed: %s/%s", kind, position)
                        if kind == "weekly" and len(weekly_frames) == 6:
                            def stable_weekly_inputs():
                                return (dfs_inputs.input_revision(season, week) == weekly_revision
                                        and forecast_player_revisions()[1] == weekly_availability)
                            if not stable_weekly_inputs():
                                raise RuntimeError("Weekly inputs changed during recovery")
                            built = [timestamp(frame.attrs.get("built_at")) for frame in weekly_frames]
                            if all(stamp is not None and stamp.timestamp() >= weekly_started for stamp in built):
                                outputs = dfs_inputs.output_revisions(season, week)
                                if outputs is not None:
                                    from src.jobs.dfs_refresh import _warm_supporting_data
                                    call_phase("weekly_support", _warm_supporting_data, season, week)
                                    if (not stable_weekly_inputs()
                                            or dfs_inputs.output_revisions(season, week) != outputs):
                                        raise RuntimeError("Weekly publication changed during recovery")
                                    weekly_publication = {"forecast_reuse": {
                                        "version": dfs_inputs.VERSION, "revision": weekly_revision,
                                        "outputs": outputs, "computed_epoch": weekly_started,
                                    }, "player_availability": weekly_availability}
                except Exception:
                    errors.append(kind)
                    logging.getLogger(__name__).exception("Projection recovery failed: %s", kind)
            for kind in kinds:
                if kind in {"draft", "ros", "weekly"}:
                    item = health[target_key(kind, season, week)]
                    failed = any(error == kind or error.startswith(kind + ":") for error in errors)
                    item.update(status="error" if failed else "ok", completed_at=datetime.now(timezone.utc).isoformat())
                    if kind == "weekly":
                        item.pop("forecast_reuse", None)
                        item.pop("player_availability", None)
                        if not failed and weekly_publication is not None:
                            item.update(weekly_publication)
                    if not failed:
                        item["last_success_at"] = item["completed_at"]
            _save(health)
    except RefreshBusy:
        return {"status": "busy"}
    annotate_job(failed=len(errors))
    return {"status": "error" if errors else "ok", "failed": errors}
