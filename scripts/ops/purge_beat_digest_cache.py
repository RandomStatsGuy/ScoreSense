"""Drop cached beat-digest JSON files and invalidate in-process sentiment readout cache."""

from __future__ import annotations

import argparse

from src.config import CACHE_DIR
from src.sentiment.beat_digest import _DIGEST_CACHE_DIR
from src.sentiment.fantasy_readout import invalidate_fantasy_response_cache
from src.sentiment.readout import invalidate_sentiment_response_cache

_FANTASY_DIGEST_DIR = CACHE_DIR / "fantasy_digest"


def purge_beat_digest_cache() -> dict:
    cache_dir = _DIGEST_CACHE_DIR
    removed = 0
    if cache_dir.exists():
        for path in cache_dir.glob("*.json"):
            path.unlink(missing_ok=True)
            removed += 1
    fantasy_removed = 0
    if _FANTASY_DIGEST_DIR.exists():
        for path in _FANTASY_DIGEST_DIR.rglob("*.json"):
            path.unlink(missing_ok=True)
            fantasy_removed += 1
    invalidate_sentiment_response_cache()
    invalidate_fantasy_response_cache()
    return {"removed": removed, "fantasy_removed": fantasy_removed, "cache_dir": str(cache_dir)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge draft beat-digest file cache")
    parser.add_argument(
        "--rebuild-sentiment",
        action="store_true",
        help="Rebuild sentiment_features.parquet from cached YouTube content",
    )
    parser.add_argument("--season", type=int, default=None)
    args = parser.parse_args()

    result = purge_beat_digest_cache()
    print(result)

    if args.rebuild_sentiment:
        from src.sentiment.aggregate import rebuild_sentiment_features
        from src.projections.projection_meta import get_projection_meta

        season = args.season
        if season is None:
            season = int(get_projection_meta("qb")["default_season"])
        features = rebuild_sentiment_features(int(season))
        invalidate_sentiment_response_cache()
        invalidate_fantasy_response_cache()
        cols = [c for c in ("yt_chapter_notes", "yt_top_sentence") if c in features.columns]
        print({"rebuilt_season": season, "rows": len(features), "new_columns": cols})


if __name__ == "__main__":
    main()
