"""This-week player note — locker / practice first, optional projection delta.

Page views never call YouTube or an LLM. Sentiment snippets stay research
until a raw sentence passes the usefulness filter. They are not baked into
the current-week story.
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
_SHOW_COPY_RE = re.compile(
    r"(fantasy shows|fantasy analysts|fantasy channels|team coverage|"
    r"a quiet week in fantasy|discussed by \d+ fantasy)",
    re.IGNORECASE,
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def is_useful_sentence(text: str) -> bool:
    """True when a raw snippet reads like a manager-facing sentence."""
    body = _text(text)
    if len(body) < 28:
        return False
    if _CHAPTER_RE.search(body):
        return False
    if _SHOW_COPY_RE.search(body):
        return False
    words = body.split()
    if len(words) < 6:
        return False
    return bool(_SENTENCE_RE.search(body)) or len(words) >= 12


def compose_projection_line(delta: Any) -> str | None:
    """One line when the week slate moved versus the healthy number."""
    try:
        if delta is None or delta == "":
            return None
        pts = float(delta)
    except (TypeError, ValueError):
        return None
    if abs(pts) < 0.01:
        return None
    mag = f"{abs(pts):.1f}"
    if pts > 0:
        return f"Week is {mag} above the healthy slate."
    return f"Week is {mag} below the healthy slate."


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


def _research_snippet(media: dict[str, Any] | None) -> str | None:
    """Raw snippet only — never an extractive / LLM rewrite."""
    if not isinstance(media, dict):
        return None
    for key in ("excerpt", "summary"):
        raw = _text(media.get(key))
        if is_useful_sentence(raw):
            return raw
    return None


def compose_this_week(
    *,
    sleeper: dict[str, Any] | None = None,
    availability: dict[str, Any] | None = None,
    projection: dict[str, Any] | None = None,
    media_context: dict[str, Any] | None = None,
    allow_research_snippet: bool = False,
) -> dict[str, Any]:
    """Locker / practice sentence plus an optional projection delta."""
    locker = sleeper or {}
    avail = availability or {}
    proj = projection or {}

    notes = locker.get("injury_notes") or avail.get("injury_notes")
    practice = (
        locker.get("practice_description")
        or locker.get("practice_participation")
        or avail.get("practice")
    )
    status = locker.get("injury_status") or avail.get("status")
    body_part = locker.get("injury_body_part") or avail.get("injury_body_part")
    updated = locker.get("news_updated") or avail.get("updated_at")
    projection_line = compose_projection_line(proj.get("injury_delta"))

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
            "projection_line": projection_line,
        }

    if practice:
        extra = _text(status)
        return {
            "headline": practice,
            "detail": extra if extra and extra.lower() not in practice.lower() else None,
            "kind": "practice",
            "updated_at": updated,
            "source": "Practice report",
            "projection_line": projection_line,
        }

    if status:
        return {
            "headline": str(status),
            "detail": None,
            "kind": "status",
            "updated_at": updated,
            "source": "Availability",
            "projection_line": projection_line,
        }

    snippet = _research_snippet(media_context) if allow_research_snippet else None
    if snippet:
        return {
            "headline": snippet.split(".")[0].strip()[:96],
            "detail": snippet,
            "kind": "digest",
            "updated_at": (media_context or {}).get("updated_at") or updated,
            "source": "Week context",
            "projection_line": projection_line,
        }

    return {
        "headline": None,
        "detail": None,
        "kind": "none",
        "updated_at": None,
        "source": None,
        "projection_line": projection_line,
    }


def compose_latest(
    *,
    sleeper: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    projection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pick one latest note. Locker-room facts beat a cold digest."""
    ctx = context or {}
    avail = ctx.get("availability") if isinstance(ctx.get("availability"), dict) else {}
    media = ctx.get("media_context") if isinstance(ctx.get("media_context"), dict) else {}
    proj = projection if projection is not None else (
        ctx.get("projection") if isinstance(ctx.get("projection"), dict) else {}
    )
    return compose_this_week(
        sleeper=sleeper,
        availability=avail,
        projection=proj,
        media_context=media,
        allow_research_snippet=True,
    )


def strip_youtube_from_this_week(media_context: dict[str, Any] | None) -> dict[str, Any]:
    """Drop show-description bodies from the default this-week media block."""
    from src.sentiment.media_context import MEDIA_STATE_CURRENT

    media = dict(media_context or {})
    if str(media.get("state") or "") == MEDIA_STATE_CURRENT:
        media["summary"] = None
        media["excerpt"] = None
        media["sources"] = []
    media["affects_projection"] = False
    return media


def attach_this_week(payload: dict[str, Any], *, media_mode: str | None = None) -> dict[str, Any]:
    """Stamp ``this_week`` and hide YouTube copy on the default this-week view."""
    if media_mode is None:
        payload["media_context"] = strip_youtube_from_this_week(payload.get("media_context"))
    payload["this_week"] = compose_this_week(
        availability=payload.get("availability")
        if isinstance(payload.get("availability"), dict)
        else {},
        projection=payload.get("projection")
        if isinstance(payload.get("projection"), dict)
        else {},
        media_context=payload.get("media_context")
        if isinstance(payload.get("media_context"), dict)
        else {},
        allow_research_snippet=False,
    )
    return payload


def build_player_latest(
    player_id: str,
    *,
    player_name: str | None = None,
    team: str | None = None,
    season: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    """Serve a this-week note without requiring a warm player-context artifact."""
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
        "this_week": latest,
        "meta": {
            "season": season,
            "week": week,
            "has_locker": bool(sleeper.get("injury_notes") or sleeper.get("practice_description")),
            "has_context": context is not None,
        },
    }
