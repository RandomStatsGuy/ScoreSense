"""Weekly pipeline refresh job for cron / GitHub Actions."""

from __future__ import annotations

import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from src.jobs.refresh_lock import refresh_lock, RefreshBusy

from src.config import CACHE_DIR, DEFAULT_TRAIN_SEASONS, DEFAULT_TEST_SEASONS
from src.draft_hub.draft_pool_cache import pool_artifact_status, save_pool_artifact
from src.projections.draft_meta import get_draft_meta
from src.projections.projection_meta import get_projection_meta
from src.core.projection_context import is_nfl_offseason
from src.projections.weekly_cache import invalidate_weekly_cache, prewarm_weekly_predictions
from src.projections.ros_cache import invalidate_ros_cache, prewarm_ros_predictions
from src.etl.nflverse_etl import build_all_datasets
from src.integrations.sleeper import get_nfl_state, injured_players
from src.projections.predict import predict_all_positions
from src.pipeline.train import train_all

from bdb_companion.target_quality import save_target_quality_report

REFRESH_STATUS = CACHE_DIR / "last_refresh.json"


def _write_refresh_status(payload: dict) -> None:
    REFRESH_STATUS.parent.mkdir(parents=True, exist_ok=True)
    # Readers must never see a half-written status during a progress update.
    previous = get_refresh_status()
    if payload.get("started_at") == previous.get("started_at"):
        payload = {**previous, **payload}
    if payload.get("status") == "completed":
        payload["last_completed_at"] = payload["completed_at"]
        payload["stage"] = "completed"
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    fd, name = tempfile.mkstemp(dir=REFRESH_STATUS.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, default=str)
        os.replace(name, REFRESH_STATUS)
    finally:
        Path(name).unlink(missing_ok=True)


def record_refresh_failure(error: str) -> None:
    _write_refresh_status({**get_refresh_status(), "status": "error", "error": error,
                           "completed_at": datetime.now(timezone.utc).isoformat()})


def _progress(stage: str) -> None:
    _write_refresh_status({**get_refresh_status(), "stage": stage})


def mark_refresh_started(*, retrain: bool = True, draft_only: bool = False) -> dict:
    """Persist a running marker so the UI can wait instead of refetching stale artifacts."""
    started = datetime.now(timezone.utc).isoformat()
    payload = {
        "status": "running",
        "stage": "queued",
        "started_at": started,
        "retrain": retrain,
        "draft_only": draft_only,
    }
    existing = get_refresh_status()
    prev = existing.get("last_completed_at") or (existing.get("completed_at") if existing.get("status") == "completed" else None)
    if prev:
        payload["last_completed_at"] = prev
    _write_refresh_status(payload)
    return payload


def run_weekly_refresh(retrain=True, seasons=None, draft_only=False, started_at=None) -> dict:
    for attempt in range(50):
        try:
            with refresh_lock(REFRESH_STATUS.with_suffix(".lock")):
                current = get_refresh_status()
                if started_at and current.get("started_at") != started_at:
                    return current  # a newer request superseded this queued task
                return _execute_weekly_refresh(retrain, seasons, draft_only, started_at)
        except RefreshBusy:
            current = get_refresh_status()
            # A status reader can briefly own the lock before our queued task starts.
            if started_at and current.get("stage") == "queued" and attempt < 49:
                time.sleep(0.1)
                continue
            return current



def public_refresh_status() -> dict:
    status = get_refresh_status()
    if status.get("status") != "running":
        return status
    try:
        with refresh_lock(REFRESH_STATUS.with_suffix(".lock")):
            status = get_refresh_status()
            if status.get("status") != "running":
                return status
            # A submitted process has a short window to start and acquire its lock.
            started = datetime.fromisoformat(status["started_at"])
            age = (datetime.now(timezone.utc) - started).total_seconds()
            if status.get("stage") == "queued" and age < 120:
                return status
            return {**status, "status": "error", "error": "Refresh stopped before finishing. Start it again."}
    except RefreshBusy:
        return status


def _execute_weekly_refresh(
    retrain: bool = True,
    seasons: list[int] | None = None,
    draft_only: bool = False,
    started_at: str | None = None,
) -> dict:
    seasons = seasons or DEFAULT_TRAIN_SEASONS + DEFAULT_TEST_SEASONS
    started = started_at or mark_refresh_started(retrain=retrain, draft_only=draft_only)["started_at"]
    _progress("starting")

    try:
        return _run_weekly_refresh(
            retrain=retrain,
            seasons=seasons,
            draft_only=draft_only,
            started=started,
        )
    except Exception as exc:
        _write_refresh_status(
            {
                "status": "error",
                "started_at": started,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error": str(exc),
                "retrain": retrain,
                "draft_only": draft_only,
            }
        )
        raise


def _run_weekly_refresh(
    *,
    retrain: bool,
    seasons: list[int],
    draft_only: bool,
    started: str,
) -> dict:
    # UI / --no-retrain reuses existing mlready. Full ETL is the hang on Refresh.
    if retrain or draft_only:
        _progress("datasets")
        build_all_datasets(seasons=seasons)
    invalidate_weekly_cache()
    invalidate_ros_cache()
    if draft_only:
        from src.jobs.preseason_refresh import run_preseason_refresh

        _progress("draft")
        draft_status = run_preseason_refresh(seasons=seasons)
        status = {
            **draft_status,
            "started_at": started,
            "completed_at": draft_status["completed_at"],
            "mode": "draft_only",
            "status": "completed",
        }
        _write_refresh_status(status)
        return status

    if retrain:
        _progress("training")
        train_all(train_seasons=DEFAULT_TRAIN_SEASONS)
        save_target_quality_report()

    state = get_nfl_state()
    offseason = is_nfl_offseason()
    proj_meta = get_projection_meta("qb")
    season = int(proj_meta["default_season"])
    week = int(proj_meta["default_week"])
    # Fallback if meta is unavailable for some reason.
    if season <= 0 or week <= 0:
        season = int(state.get("season", seasons[-1]))
        week = int(state.get("week", 1)) or 1
    _progress("inputs")
    fp_status = None
    try:
        from src.integrations.fantasypros import archive_fantasypros_week, fantasypros_api_key_configured
        from src.integrations.fantasypros_enrich import enrich_position_mlready

        if fantasypros_api_key_configured():
            fp_status = archive_fantasypros_week(season, week)
            for position in ("qb", "rb", "wr"):
                enrich_position_mlready(position, seasons=[season])
    except Exception as exc:
        fp_status = {"status": "error", "detail": str(exc)}

    sentiment_status = None
    if retrain and not offseason:
        try:
            from src.jobs.sentiment_refresh import run_sentiment_refresh

            lookback = int(__import__("os").getenv("SENTIMENT_LOOKBACK_DAYS", "14"))
            sentiment_status = run_sentiment_refresh(
                season=season,
                week=week,
                lookback_days=lookback,
                fetch_transcripts=retrain,
                transcript_limit=500,
            )
        except Exception as exc:
            sentiment_status = {"status": "error", "detail": str(exc)}
    _progress("weekly")
    predictions = predict_all_positions(season=season, week=week)
    weekly_prewarm = prewarm_weekly_predictions(
        season,
        week,
        force=False,
    )
    # Movement artifacts are written inside save_weekly_artifact during prewarm.
    projection_movement_status = None
    try:
        from src.projections.projection_movement import build_projection_movement_payload

        movement_summary: dict = {"status": "ok", "variants": {}}
        for pos in ("qb", "rb", "wr"):
            for apply_injury in (True, False):
                key = f"{pos}:inj{int(apply_injury)}"
                payload = build_projection_movement_payload(
                    pos,
                    season,
                    week,
                    apply_injury_adjustments=apply_injury,
                )
                movement_summary["variants"][key] = {
                    "available": payload.get("available"),
                    "count": payload.get("count"),
                    "empty_reason": payload.get("empty_reason"),
                    "material_rows": (payload.get("meta") or {}).get("material_rows"),
                    "removed_rows": (payload.get("meta") or {}).get("removed_rows"),
                }
        projection_movement_status = movement_summary
    except Exception as exc:
        projection_movement_status = {"status": "error", "detail": str(exc)}
    _progress("season")
    ros_prewarm = prewarm_ros_predictions(
        season,
        week,
        force=True,
    )

    draft_counts = {}
    fp_draft_ecr = None
    draft_pool_status = None
    dfs_slate_status = None
    props_status = None
    _progress("draft")
    draft_season = int(get_draft_meta("qb")["default_season"])
    save_pool_artifact(draft_season)
    draft_pool_status = pool_artifact_status(draft_season)
    draft_counts = draft_pool_status.get("position_counts", {})
    try:
        from src.integrations.fantasypros import fantasypros_api_key_configured, prefetch_draft_season_ecr

        if fantasypros_api_key_configured():
            fp_draft_ecr = prefetch_draft_season_ecr(draft_season)
    except Exception as exc:
        fp_draft_ecr = {"status": "error", "detail": str(exc)}
    if not offseason:
        _progress("slates")
        try:
            from src.integrations.dfs_slates import prefetch_all_main_slates

            dfs_slate_status = prefetch_all_main_slates()
        except Exception as exc:
            dfs_slate_status = {"status": "error", "detail": str(exc)}
        try:
            from src.integrations.odds_api import archive_props_for_week, odds_api_key_configured

            if odds_api_key_configured():
                props_status = archive_props_for_week(season, week)
        except Exception as exc:
            props_status = {"status": "error", "detail": str(exc)}

    _progress("notes")
    fantasy_media_digest_status = None
    try:
        from src.jobs.prewarm_fantasy_media_digests import prewarm_fantasy_media_digests

        fantasy_media_digest_status = prewarm_fantasy_media_digests(season=season, week=week)
    except Exception as exc:
        fantasy_media_digest_status = {"status": "error", "detail": str(exc)}

    # After weekly inj/no_inj + sentiment/digests so media_context can be materialized.
    injury_overlay_status = None
    try:
        from src.projections.injury_overlay import prewarm_injury_overlays

        injury_overlay_status = prewarm_injury_overlays(season, week, force=True)
    except Exception as exc:
        injury_overlay_status = {"status": "error", "detail": str(exc)}

    player_context_status = None
    try:
        from src.projections.player_context import prewarm_player_context

        player_context_status = prewarm_player_context(season, week)
    except Exception as exc:
        player_context_status = {"status": "error", "detail": str(exc)}

    status = {
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "season": season,
        "week": week,
        "offseason": offseason,
        "injured_players": len(injured_players()),
        "predictions": {
            pos: len(df) for pos, df in predictions.items()
        },
        "weekly_predictions_prewarm": weekly_prewarm,
        "projection_movement": projection_movement_status,
        "ros_predictions_prewarm": ros_prewarm,
        "injury_overlay_prewarm": injury_overlay_status,
        "player_context_prewarm": player_context_status,
        "fantasypros_archive": fp_status,
        "fantasypros_draft_ecr": fp_draft_ecr,
        "dfs_slates": dfs_slate_status,
        "props_archive": props_status,
        "sentiment_refresh": sentiment_status,
        "fantasy_media_digest_prewarm": fantasy_media_digest_status,
        "draft_projections": draft_counts or None,
        "draft_pool_artifact": draft_pool_status,
        "status": "completed",
    }
    status["warnings"] = [key for key, value in status.items() if isinstance(value, dict) and value.get("status") == "error"]
    _write_refresh_status(status)
    return status


def get_refresh_status() -> dict:
    if not REFRESH_STATUS.exists():
        return {"status": "never_run"}
    try:
        data = json.loads(REFRESH_STATUS.read_text())
    except (json.JSONDecodeError, OSError):
        return {"status": "never_run"}
    if not isinstance(data, dict):
        return {"status": "never_run"}
    if "status" not in data:
        data["status"] = "completed" if data.get("completed_at") else "unknown"
    return data


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Weekly ScoreSense refresh")
    parser.add_argument("--no-retrain", action="store_true", help="Skip model retraining")
    parser.add_argument(
        "--draft-only",
        action="store_true",
        help="Rebuild ETL and draft projection CSVs only (skip train + weekly predict)",
    )
    args = parser.parse_args()
    status = run_weekly_refresh(retrain=not args.no_retrain, draft_only=args.draft_only)
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()
