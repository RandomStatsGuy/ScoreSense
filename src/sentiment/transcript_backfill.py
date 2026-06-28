"""Backfill YouTube transcripts for cached videos mapped to NFL seasons."""

from __future__ import annotations

import pandas as pd

from src.core.schedule_utils import map_publish_time_to_week
from src.integrations.youtube import TRANSCRIPTS_DIR, fetch_transcript, load_raw_content_cache


def fetch_transcripts_for_seasons(
    seasons: list[int] | tuple[int, ...] = (2024, 2025),
    *,
    limit: int = 600,
) -> dict:
    """Fetch transcripts for season-mapped videos not yet cached."""
    df = load_raw_content_cache()
    if df.empty:
        return {"candidates": 0, "fetched": 0, "skipped_cached": 0, "seasons": list(seasons)}

    targets: list[str] = []
    for _, row in df.iterrows():
        for season in seasons:
            week = map_publish_time_to_week(str(row["team"]), pd.Timestamp(row["published_at"]), season)
            if week is not None and 1 <= week <= 18:
                targets.append(str(row["content_id"]))
                break

    seen: list[str] = []
    for cid in targets:
        if cid not in seen:
            seen.append(cid)

    fetched = 0
    skipped = 0
    for cid in seen:
        if fetched >= limit:
            break
        path = TRANSCRIPTS_DIR / f"{cid}.json"
        if path.exists():
            skipped += 1
            continue
        fetch_transcript(cid)
        fetched += 1

    return {
        "candidates": len(seen),
        "fetched": fetched,
        "skipped_cached": skipped,
        "seasons": list(seasons),
    }
