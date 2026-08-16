"""Async prewarm of analyst digests — template first; LLM only when eligible + budgeted."""

from __future__ import annotations

from typing import Any

from src.config import BEAT_DIGEST_PREWARM_TOP_N
from src.draft_hub.value_sheet import _load_draft_pool
from src.sentiment.analyst_context import (
    budget_snapshot,
    reset_run_budget,
    should_async_llm,
)
from src.sentiment.fantasy_digest import fantasy_digest_for_player
from src.sentiment.fantasy_readout import build_fantasy_index


def prewarm_beat_digests(
    *,
    season: int | None = None,
    week: int | None = None,
    top_n: int | None = None,
    pool_cap: int = 400,
    prefer_llm: bool = True,
) -> dict[str, Any]:
    """
    Build/cache analyst digests for mention-rich draft-pool players.

    SCORE-27:
    - Always materialize template/extractive first (permanent fallback).
    - Optional async LLM only when eligibility rules + dollar budget allow.
    - Cache keys are player + week + evidence_hash + prompt_version.
    """
    top_n = int(top_n or BEAT_DIGEST_PREWARM_TOP_N)
    reset_run_budget()
    # Index build is request-safe (prefer_llm=False). LLM upgrades happen below.
    sentiment = build_fantasy_index(season, week)
    resolved_season = int(sentiment["season"])
    resolved_week = int(sentiment["week"])

    pool = _load_draft_pool(resolved_season)
    if pool.empty:
        return {
            "season": resolved_season,
            "week": resolved_week,
            "warmed": 0,
            "skipped": 0,
            "llm_attempted": 0,
            "llm_written": 0,
            "llm_skipped_budget": 0,
            "llm_skipped_ineligible": 0,
            "budget": budget_snapshot(),
        }

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
    llm_attempted = 0
    llm_written = 0
    llm_skipped_budget = 0
    llm_skipped_ineligible = 0

    for rank, (pid, sent) in enumerate(mention_ranked):
        name = str(sent.get("player") or pid)
        # Always write template/extractive fallback first.
        fantasy_digest_for_player(
            name,
            sent,
            scope="weekly",
            player_id=str(pid),
            season=resolved_season,
            week=resolved_week,
            prefer_llm=False,
        )
        warmed += 1

        if not prefer_llm:
            llm_skipped_ineligible += 1
            continue

        labels = [s.get("label") or s.get("network_label") for s in (sent.get("sources") or [])]
        labels = [s for s in labels if s]
        eligible = should_async_llm(
            sentiment_label=str(sent.get("sentiment_label") or "neutral"),
            injury_flag=float(sent.get("injury_flag") or 0),
            role_hype_flag=float(sent.get("role_hype_flag") or 0),
            mention_count=float(sent.get("mention_count") or 0),
            source_labels=labels,
            chapter_notes=str(sent.get("chapter_notes") or ""),
            rank=rank,
            top_n=top_n,
        )
        if not eligible:
            llm_skipped_ineligible += 1
            continue

        llm_attempted += 1
        result = fantasy_digest_for_player(
            name,
            sent,
            scope="weekly",
            player_id=str(pid),
            season=resolved_season,
            week=resolved_week,
            prefer_llm=True,
            return_meta=True,
            charge_budget=True,
        )
        source = result.get("fantasy_digest_source") if isinstance(result, dict) else None
        if source == "llm":
            llm_written += 1
        else:
            # Eligible but skipped (budget / LLM failure) — template remains.
            llm_skipped_budget += 1

    skipped = max(0, len(pool_ids) - warmed)
    return {
        "season": resolved_season,
        "week": resolved_week,
        "warmed": warmed,
        "skipped": skipped,
        "prefer_llm": prefer_llm,
        "target_count": len(mention_ranked),
        "llm_attempted": llm_attempted,
        "llm_written": llm_written,
        "llm_skipped_budget": llm_skipped_budget,
        "llm_skipped_ineligible": llm_skipped_ineligible,
        "budget": budget_snapshot(),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(prewarm_beat_digests(), indent=2))
