"""Latest-note readout for a player — locker room first, digest second.

The cached player-context artifact is often cold or filled with YouTube
chapter scraps. This composer always returns a structured note from the
local Sleeper cache, and only uses context media when it reads like a
sentence a manager would use.
"""

from __future__ import annotations

import re
from typing import Any

from src.draft_hub.draft_enrichment import (
    _sleeper_lookup_tables,
    _sleeper_row_for_hint,
)

_CHAPTER_RE = re.compile(
    r"(sources flag|mentioned|\d{1,2}:\d{2}|youtube|podcast chapter)",
    re.IGNORECASE,
)
_SENTENCE_RE = re.compile(r"[.!?](\s|$)")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _is_useful_sentence(text: str) -> bool:
    body = _text(text)
    if len(body) < 28:
        return False
    if _CHAPTER_RE.search(body):
        return False
    words = body.split()
    if len(words) < 6:
        return False
    return bool(_SENTENCE_RE.search(body)) or len(words) >= 12


def _sleeper_row(player_id: str, player_name: str | None, team: str | None):
    df, by_gsis, by_sleeper_id, by_name_team, by_name = _sleeper_lookup_tables()
    return _sleeper_row_for_hint(
        df,
        player_id=player_id,
        player_name=player_name,
        team=team,
        by_gsis=by_gsis,
        by_name_team=by_name_team,
        by_sleeper_id=by_sleeper_id,
        by_name=by_name,
    )


def sleeper_latest_fields(row) -> dict[str, Any]:
    if row is None:
        return {}
    return {
        "injury_status": _text(row.get("injury_status")) or None,
        "injury_notes": _text(row.get("injury_notes")) or None,
        "injury_body_part": _text(row.get("injury_body_part")) or None,
        "practice_description": _text(row.get("practice_description")) or None,
        "practice_participation": _text(row.get("practice_participation")) or None,
        "news_updated": row.get("news_updated"),
    }


def compose_latest(
    *,
    sleeper: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pick one latest note. Locker-room facts beat a cold digest."""
    locker = sleeper or {}
    ctx = context or {}
    avail = ctx.get("availability") if isinstance(ctx.get("availability"), dict) else {}
    media = ctx.get("media_context") if isinstance(ctx.get("media_context"), dict) else {}

    status = locker.get("injury_status") or avail.get("status")
    notes = locker.get("injury_notes")
    practice = locker.get("practice_description") or avail.get("practice")
    body_part = locker.get("injury_body_part")
    digest = media.get("summary") if _is_useful_sentence(str(media.get("summary") or "")) else None
    excerpt = media.get("excerpt") if _is_useful_sentence(str(media.get("excerpt") or "")) else None
    updated = locker.get("news_updated") or avail.get("updated_at") or media.get("updated_at")

    if notes:
        headline = _text(status) or _text(practice) or "Locker note"
        if body_part and body_part.lower() not in headline.lower():
            headline = f"{headline} · {body_part}" if headline != "Locker note" else body_part
        return {
            "headline": headline,
            "detail": notes,
            "kind": "locker",
            "updated_at": updated,
            "source": "Locker room",
        }

    if practice:
        extra = _text(status)
        return {
            "headline": practice,
            "detail": extra if extra and extra.lower() not in practice.lower() else None,
            "kind": "practice",
            "updated_at": updated,
            "source": "Practice report",
        }

    if digest or excerpt:
        body = digest or excerpt
        return {
            "headline": body.split(".")[0].strip()[:96],
            "detail": body,
            "kind": "digest",
            "updated_at": updated,
            "source": "Week context",
        }

    if status:
        return {
            "headline": str(status),
            "detail": None,
            "kind": "status",
            "updated_at": updated,
            "source": "Availability",
        }

    return {
        "headline": None,
        "detail": None,
        "kind": "none",
        "updated_at": None,
        "source": None,
    }


def build_player_latest(
    player_id: str,
    *,
    player_name: str | None = None,
    team: str | None = None,
    season: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    """Serve a latest note without requiring a warm player-context artifact."""
    row = _sleeper_row(player_id, player_name, team)
    sleeper = sleeper_latest_fields(row)
    context = None
    try:
        from src.projections.player_context import get_player_context

        context = get_player_context(player_id, season=season, week=week)
    except (FileNotFoundError, ValueError, OSError):
        context = None
    latest = compose_latest(sleeper=sleeper, context=context)
    return {
        "player_id": str(player_id),
        "latest": latest,
        "meta": {
            "season": season,
            "week": week,
            "has_locker": bool(sleeper.get("injury_notes") or sleeper.get("practice_description")),
            "has_context": context is not None,
        },
    }
