"""Prepare shared Fantasy reads before an API process accepts traffic.

No league state, lineup writes, live inference, or roster refresh is involved.
Data jobs remain responsible for replacing the source snapshots.
"""
import logging


def warm_fantasy_week_context() -> dict:
    try:
        from src.draft_hub.prepared_week_context import refresh_week_contexts
        return refresh_week_contexts(current_only=True, max_preparations=None)
    except Exception:
        logging.getLogger(__name__).warning("Fantasy context warmup unavailable", exc_info=True)
        return {"status": "error"}
