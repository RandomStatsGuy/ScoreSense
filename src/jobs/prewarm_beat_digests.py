"""Deprecated shim — use prewarm_fantasy_media_digests.

Fantasy-show digests are not beat reporting; this module remains only so older
cron/import paths keep working during the SCORE-29 rename.
"""

from src.jobs.prewarm_fantasy_media_digests import (  # noqa: F401
    prewarm_beat_digests,
    prewarm_fantasy_media_digests,
)

__all__ = ["prewarm_fantasy_media_digests", "prewarm_beat_digests"]
