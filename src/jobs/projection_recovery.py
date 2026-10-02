"""Rebuild missing requested-context artifacts off the request path; no training."""
from __future__ import annotations

import logging

from src.config import CACHE_DIR
from src.jobs.refresh_lock import RefreshBusy, refresh_lock


def rebuild_projection_context(season: int, week: int, kinds: tuple[str, ...]) -> dict:
    errors = []
    try:
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            for kind in kinds:
                try:
                    if kind == "draft":
                        from src.draft_hub.draft_pool_cache import load_draft_pool, pool_fingerprint
                        from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
                        for _ in range(3):
                            revision = pool_fingerprint()
                            load_draft_pool(season, apply_identity=False)
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
                        result = refresh_dfs_pool(season, week)
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
                        for position in ("qb", "rb", "wr"):
                            try:
                                for injury in (True, False):
                                    frame = loader(position, season, week, apply_injury_adjustments=injury,
                                                   **({"force": True} if kind == "ros" else {}))
                                    if frame.empty:
                                        raise ValueError("Empty projection output")
                            except Exception:
                                errors.append(f"{kind}:{position}")
                                logging.getLogger(__name__).exception("Projection recovery failed: %s/%s", kind, position)
                except Exception:
                    errors.append(kind)
                    logging.getLogger(__name__).exception("Projection recovery failed: %s", kind)
    except RefreshBusy:
        return {"status": "busy"}
    return {"status": "error" if errors else "ok", "failed": errors}
