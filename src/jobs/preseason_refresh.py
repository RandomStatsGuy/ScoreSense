"""Preseason / draft refresh — ETL + draft CSVs without full weekly predict."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from src.config import CACHE_DIR, DEFAULT_TEST_SEASONS, DEFAULT_TRAIN_SEASONS, PREDICTIONS_DIR
from src.draft_hub.draft_pool_cache import pool_artifact_status, save_pool_artifact
from src.projections.draft_meta import get_draft_meta
from src.projections.draft_projections import predict_draft_season
from src.projections.projection_meta import get_projection_meta
from src.projections.weekly_cache import prewarm_weekly_predictions
from src.projections.ros_cache import prewarm_ros_predictions
from src.etl.nflverse_etl import build_all_datasets

REFRESH_STATUS = CACHE_DIR / "last_preseason_refresh.json"


def _save_draft_csv(preds, position: str, season: int) -> Path:
    label = {"qb": "QB", "rb": "RB", "wr": "REC"}.get(position, position.upper())
    out_dir = PREDICTIONS_DIR / label / "draft"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"draft_{season}_{label}.csv"
    preds.to_csv(out_path, index=False)
    return out_path


def run_preseason_refresh(
    seasons: list[int] | None = None,
    draft_season: int | None = None,
) -> dict:
    """Rebuild datasets and write draft projection CSVs for upcoming season."""
    seasons = seasons or DEFAULT_TRAIN_SEASONS + DEFAULT_TEST_SEASONS
    started = datetime.now(timezone.utc).isoformat()

    build_all_datasets(seasons=seasons)

    if draft_season is None:
        draft_season = int(get_draft_meta("qb")["default_season"])

    draft_paths = {}
    draft_counts = {}
    for position in ("qb", "rb", "wr"):
        preds = predict_draft_season(position, season=draft_season)
        path = _save_draft_csv(preds, position, draft_season)
        draft_paths[position] = str(path)
        draft_counts[position] = len(preds)

    save_pool_artifact(draft_season)
    pool_status = pool_artifact_status(draft_season)

    proj_meta = get_projection_meta("qb")
    weekly_season = int(proj_meta["default_season"])
    weekly_week = int(proj_meta["default_week"])
    weekly_prewarm = prewarm_weekly_predictions(
        weekly_season,
        weekly_week,
    )
    ros_prewarm = prewarm_ros_predictions(
        weekly_season,
        weekly_week,
    )

    fp_ecr_status = None
    try:
        from src.integrations.fantasypros import fantasypros_api_key_configured, prefetch_draft_season_ecr

        if fantasypros_api_key_configured():
            fp_ecr_status = prefetch_draft_season_ecr(draft_season)
    except Exception as exc:
        fp_ecr_status = {"status": "error", "detail": str(exc)}

    sentiment_status = None
    try:
        from src.jobs.sentiment_refresh import run_sentiment_refresh

        sentiment_status = run_sentiment_refresh(
            season=draft_season,
            week=1,
            lookback_days=21,
            fetch_transcripts=True,
            transcript_limit=300,
        )
    except Exception as exc:
        sentiment_status = {"status": "error", "detail": str(exc)}

    fantasy_media_digest_status = None
    try:
        from src.jobs.prewarm_fantasy_media_digests import prewarm_fantasy_media_digests

        fantasy_media_digest_status = prewarm_fantasy_media_digests(
            season=draft_season, week=1
        )
    except Exception as exc:
        fantasy_media_digest_status = {"status": "error", "detail": str(exc)}

    injury_overlay_status = None
    try:
        from src.projections.injury_overlay import prewarm_injury_overlays

        injury_overlay_status = prewarm_injury_overlays(
            weekly_season, weekly_week, force=True
        )
    except Exception as exc:
        injury_overlay_status = {"status": "error", "detail": str(exc)}

    player_context_status = None
    try:
        from src.projections.player_context import prewarm_player_context

        player_context_status = prewarm_player_context(weekly_season, weekly_week)
    except Exception as exc:
        player_context_status = {"status": "error", "detail": str(exc)}

    status = {
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "draft_season": draft_season,
        "draft_projections": draft_counts,
        "draft_paths": draft_paths,
        "draft_pool_artifact": pool_status,
        "weekly_predictions_prewarm": weekly_prewarm,
        "ros_predictions_prewarm": ros_prewarm,
        "injury_overlay_prewarm": injury_overlay_status,
        "player_context_prewarm": player_context_status,
        "fantasypros_draft_ecr": fp_ecr_status,
        "sentiment_refresh": sentiment_status,
        "fantasy_media_digest_prewarm": fantasy_media_digest_status,
    }
    REFRESH_STATUS.write_text(json.dumps(status, indent=2))
    return status


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Preseason ETL + draft projection CSVs")
    parser.add_argument("--draft-season", type=int, default=None)
    args = parser.parse_args()
    status = run_preseason_refresh(draft_season=args.draft_season)
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()
