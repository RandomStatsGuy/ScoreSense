"""Daily prewarm of draft-room beat digests (LLM when configured)."""

from __future__ import annotations

from typing import Any

from src.config import BEAT_DIGEST_PREWARM_TOP_N
from src.draft_hub.value_sheet import _load_draft_pool
from src.sentiment.beat_digest import beat_digest_for_player
from src.sentiment.readout import build_sentiment_index


def prewarm_beat_digests(
    *,
    season: int | None = None,
    week: int | None = None,
    top_n: int | None = None,
    pool_cap: int = 400,
    prefer_llm: bool = True,
) -> dict[str, Any]:
    """
    Build/cache beat digests for mention-rich draft-pool players.
    Safe to run daily — cache keys are scoped to UTC date.
    """
    top_n = int(top_n or BEAT_DIGEST_PREWARM_TOP_N)
    sentiment = build_sentiment_index(season, week)
    resolved_season = int(sentiment["season"])
    resolved_week = int(sentiment["week"])

    pool = _load_draft_pool(resolved_season)
    if pool.empty:
        return {"season": resolved_season, "week": resolved_week, "warmed": 0, "skipped": 0}

    pool_ids = set()
    if "player_id" in pool.columns:
        pool_ids = set(pool.sort_values("Season Proj", ascending=False).head(pool_cap)["player_id"].astype(str))
    players = sentiment.get("players") or {}

    mention_ranked = sorted(
        (
            (pid, row)
            for pid, row in players.items()
            if float(row.get("mention_count") or 0) > 0 and pid in pool_ids
        ),
        key=lambda item: -float(item[1].get("mention_count") or 0),
    )[:top_n]

    warmed = 0
    skipped = 0
    for pid, sent in mention_ranked:
        name = str(sent.get("player") or pid)
        beat_digest_for_player(
            name,
            sent,
            player_id=str(pid),
            season=resolved_season,
            week=resolved_week,
            prefer_llm=prefer_llm,
        )
        warmed += 1

    skipped = max(0, len(pool_ids) - warmed)
    return {
        "season": resolved_season,
        "week": resolved_week,
        "warmed": warmed,
        "skipped": skipped,
        "prefer_llm": prefer_llm,
        "target_count": len(mention_ranked),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(prewarm_beat_digests(), indent=2))
