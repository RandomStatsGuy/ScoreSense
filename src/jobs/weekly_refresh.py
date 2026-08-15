"""Weekly pipeline refresh job for cron / GitHub Actions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from src.config import CACHE_DIR, DEFAULT_TRAIN_SEASONS, DEFAULT_TEST_SEASONS
from src.draft_hub.draft_pool_cache import pool_artifact_status, save_pool_artifact
from src.projections.draft_meta import get_draft_meta
from src.projections.draft_projections import predict_draft_season
from src.projections.projection_meta import get_projection_meta
from src.core.projection_context import is_nfl_offseason
from src.projections.weekly_cache import prewarm_weekly_predictions
from src.projections.ros_cache import prewarm_ros_predictions
from src.etl.nflverse_etl import build_all_datasets
from src.integrations.sleeper import get_nfl_state, injured_players
from src.projections.predict import predict_all_positions, save_predictions
from src.pipeline.train import train_all

from bdb_companion.target_quality import save_target_quality_report

REFRESH_STATUS = CACHE_DIR / "last_refresh.json"


def run_weekly_refresh(
    retrain: bool = True,
    seasons: list[int] | None = None,
    draft_only: bool = False,
) -> dict:
    seasons = seasons or DEFAULT_TRAIN_SEASONS + DEFAULT_TEST_SEASONS
    started = datetime.now(timezone.utc).isoformat()

    build_all_datasets(seasons=seasons)
    if draft_only:
        from src.jobs.preseason_refresh import run_preseason_refresh

        draft_status = run_preseason_refresh(seasons=seasons)
        return {
            "started_at": started,
            "completed_at": draft_status["completed_at"],
            "mode": "draft_only",
            **draft_status,
        }

    if retrain:
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
    predictions = predict_all_positions(season=season, week=week)
    weekly_prewarm = prewarm_weekly_predictions(
        season,
        week,
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
                    "material_rows": (payload.get("meta") or {}).get("material_rows"),
                }
        projection_movement_status = movement_summary
    except Exception as exc:
        projection_movement_status = {"status": "error", "detail": str(exc)}
    ros_prewarm = prewarm_ros_predictions(
        season,
        week,
    )

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

    draft_counts = {}
    fp_draft_ecr = None
    draft_pool_status = None
    dfs_slate_status = None
    props_status = None
    sentiment_status = None
    if offseason:
        draft_season = int(get_draft_meta("qb")["default_season"])
        for position in ("qb", "rb", "wr"):
            draft_preds = predict_draft_season(position, season=draft_season)
            draft_counts[position] = len(draft_preds)
        save_pool_artifact(draft_season)
        draft_pool_status = pool_artifact_status(draft_season)
        try:
            from src.integrations.fantasypros import fantasypros_api_key_configured, prefetch_draft_season_ecr

            if fantasypros_api_key_configured():
                fp_draft_ecr = prefetch_draft_season_ecr(draft_season)
        except Exception as exc:
            fp_draft_ecr = {"status": "error", "detail": str(exc)}
    else:
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
        try:
            from src.jobs.sentiment_refresh import run_sentiment_refresh

            lookback = int(__import__("os").getenv("SENTIMENT_LOOKBACK_DAYS", "14"))
            sentiment_status = run_sentiment_refresh(
                season=season,
                week=week,
                lookback_days=lookback,
                fetch_transcripts=True,
                transcript_limit=500,
            )
        except Exception as exc:
            sentiment_status = {"status": "error", "detail": str(exc)}

    beat_digest_status = None
    try:
        from src.jobs.prewarm_beat_digests import prewarm_beat_digests

        beat_digest_status = prewarm_beat_digests(season=season, week=week)
    except Exception as exc:
        beat_digest_status = {"status": "error", "detail": str(exc)}

    # After weekly inj/no_inj + sentiment/digests so media_context can be materialized.
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
        "player_context_prewarm": player_context_status,
        "fantasypros_archive": fp_status,
        "fantasypros_draft_ecr": fp_draft_ecr,
        "dfs_slates": dfs_slate_status,
        "props_archive": props_status,
        "sentiment_refresh": sentiment_status,
        "beat_digest_prewarm": beat_digest_status,
        "draft_projections": draft_counts or None,
        "draft_pool_artifact": draft_pool_status,
    }
    REFRESH_STATUS.write_text(json.dumps(status, indent=2))
    return status


def get_refresh_status() -> dict:
    if REFRESH_STATUS.exists():
        return json.loads(REFRESH_STATUS.read_text())
    return {"status": "never_run"}


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
