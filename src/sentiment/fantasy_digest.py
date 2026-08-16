"""Fantasy-show narrative digests (weekly slate vs season-long outlook)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import requests

from src.config import (
    BEAT_DIGEST_LLM_ENABLED,
    CACHE_DIR,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)
from src.sentiment.analyst_context import (
    budget_allows_call,
    compute_evidence_hash,
    evidence_cache_key,
    prompt_version,
    record_llm_spend,
    strongest_excerpt,
    template_analyst_summary,
)
from src.sentiment.beat_digest import (
    _collect_topics,
    _health_angle,
    _topic_phrase,
    extractive_beat_digest,
    snippet_to_brief,
)

FantasyDigestScope = Literal["weekly", "season"]

_WEEKLY_CACHE_DIR = CACHE_DIR / "fantasy_digest" / "weekly"
_SEASON_CACHE_DIR = CACHE_DIR / "fantasy_digest" / "season"

_LLM_WEEKLY_SYSTEM = (
    "You are an NFL fantasy analyst writing a short weekly update about one player.\n\n"
    "Write 1–2 complete sentences in third person. Synthesize the notes into one coherent storyline "
    "for fantasy managers deciding start/sit or waiver moves this week.\n\n"
    "Do NOT: list segment titles, quote podcast chapter names verbatim, mention timestamps, "
    "say 'sources flag', 'mentions', or name YouTube channels.\n\n"
    "DO: focus on role, usage, matchup, health, and what changed this week for fantasy lineups. "
    "Use the player's last name naturally."
)

_LLM_SEASON_SYSTEM = (
    "You are an NFL fantasy analyst writing a season-long outlook blurb about one player.\n\n"
    "Write 1–2 complete sentences in third person. Synthesize notes from multiple weeks into one "
    "coherent season narrative — rest-of-season value, role arc, dynasty/redraft context.\n\n"
    "Do NOT: list segment titles, quote podcast chapter names verbatim, mention timestamps, "
    "say 'sources flag', 'mentions', or name YouTube channels.\n\n"
    "DO: focus on trajectory, sustained usage, competition for touches, and whether analyst buzz "
    "is warming or cooling across the season. Use the player's last name naturally."
)


def _cache_dir(scope: FantasyDigestScope) -> Path:
    path = _WEEKLY_CACHE_DIR if scope == "weekly" else _SEASON_CACHE_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _cache_path(scope: FantasyDigestScope, key: str) -> Path:
    return _cache_dir(scope) / f"{key}.json"


def _cache_get_record(scope: FantasyDigestScope, key: str) -> dict[str, Any] | None:
    path = _cache_path(scope, key)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        if not str(data.get("digest") or ""):
            return None
        return data
    except (json.JSONDecodeError, OSError, ValueError):
        return None


def _cache_get(scope: FantasyDigestScope, key: str, *, max_age_hours: float | None = None) -> str | None:
    _ = max_age_hours
    data = _cache_get_record(scope, key)
    if not data:
        return None
    return str(data.get("digest") or "") or None


def _cache_set(
    scope: FantasyDigestScope,
    key: str,
    digest: str,
    *,
    template: str | None = None,
    source: str = "template",
    evidence_hash: str | None = None,
    excerpt: str | None = None,
    source_labels: list[str] | None = None,
) -> None:
    payload = {
        "digest": digest,
        "template": template if template is not None else digest,
        "digest_source": source,
        "evidence_hash": evidence_hash,
        "prompt_version": prompt_version(),
        "excerpt": excerpt or "",
        "source_labels": list(source_labels or []),
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_path(scope, key).write_text(json.dumps(payload), encoding="utf-8")


def _daily_cache_key(
    *,
    scope: FantasyDigestScope,
    player_id: str | None,
    player_name: str,
    season: int | None,
    week: int | None,
    evidence_hash: str = "",
) -> str:
    """Evidence-hash cache key (name kept for compatibility)."""
    return evidence_cache_key(
        player_id=player_id,
        player_name=player_name,
        season=season,
        week=week,
        evidence_hash=evidence_hash or "missing",
        scope=f"fantasy|{scope}",
    )


def extractive_fantasy_digest(
    player_name: str,
    *,
    scope: FantasyDigestScope = "weekly",
    snippet: str = "",
    chapter_notes: str = "",
    top_sentence: str = "",
    sentiment_label: str = "neutral",
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    mention_trend: float | None = None,
    weeks_with_mentions: int | None = None,
) -> str:
    """Rule-based fantasy narrative — weekly or season-long tone."""
    last = (player_name or "This player").split()[-1]
    topics = _collect_topics(
        player_name=player_name,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
    )

    if scope == "season":
        health_story = _health_angle(
            injury_flag=injury_flag,
            sentiment_label=sentiment_label,
            topics=topics,
            top_sentence=top_sentence,
            snippet=snippet,
        )
        weeks_note = f" across {weeks_with_mentions} weeks" if weeks_with_mentions and weeks_with_mentions > 1 else ""
        if health_story and not topics:
            return (
                f"Season-long fantasy talk on {last}{weeks_note} keeps circling injury and "
                f"availability — managers are pricing in risk on the ROS outlook."
            )
        if mention_trend is not None and mention_trend > 0.25:
            trend_phrase = "warming"
        elif mention_trend is not None and mention_trend < -0.25:
            trend_phrase = "cooling"
        else:
            trend_phrase = "steady"
        if topics:
            focus = _topic_phrase(topics[0])
            if len(topics) > 1:
                return (
                    f"The season narrative on {last} has been {trend_phrase}{weeks_note}, with fantasy "
                    f"shows emphasizing {focus} and {_topic_phrase(topics[1])}."
                )
            return (
                f"The season narrative on {last} has been {trend_phrase}{weeks_note}, "
                f"centered on {focus}."
            )
        if role_hype_flag > 0:
            return (
                f"Fantasy analysts have kept {last} on the radar{weeks_note} with "
                f"upward usage signals in season-long conversations."
            )
        return f"It has been a quiet season in fantasy channels for {last} — limited storyline volume."

    health_story = _health_angle(
        injury_flag=injury_flag,
        sentiment_label=sentiment_label,
        topics=topics,
        top_sentence=top_sentence,
        snippet=snippet,
    )
    if health_story:
        if topics:
            focus = _topic_phrase(topics[0])
            return (
                f"Fantasy shows are flagging health on {last} this week, with analyst talk "
                f"focused on {focus}."
            )
        return (
            f"Fantasy analysts are cautious on {last} this week with injury and availability "
            f"dominating the conversation."
        )

    if not topics:
        if role_hype_flag > 0:
            return (
                f"Fantasy analysts are pointing to upward usage signals on {last} "
                f"worth tracking this week."
            )
        return f"A quiet week in fantasy channels for {last} — no major storyline shifts."

    # Weekly: reuse beat extractive structure but with fantasy framing
    base = extractive_beat_digest(
        player_name,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        sentiment_label=sentiment_label,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
    )
    return (
        base.replace("team coverage", "fantasy shows")
        .replace("team channels", "fantasy channels")
        .replace("beat and fantasy shows", "fantasy shows")
    )


def build_fantasy_template_or_extractive(
    player_name: str,
    *,
    scope: FantasyDigestScope = "weekly",
    snippet: str = "",
    chapter_notes: str = "",
    top_sentence: str = "",
    sentiment_label: str = "neutral",
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    source_labels: list[str] | None = None,
    mention_count: float = 0.0,
    mention_trend: float | None = None,
    weeks_with_mentions: int | None = None,
) -> tuple[str, str]:
    template = template_analyst_summary(
        sentiment_label=sentiment_label,
        mention_count=mention_count,
        source_labels=source_labels,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        snippet=snippet,
        scope=scope,
    )
    topics = _collect_topics(
        player_name=player_name,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
    )
    if (
        float(injury_flag or 0) > 0
        or float(role_hype_flag or 0) > 0
        or (source_labels and mention_count > 0)
        or not topics
    ):
        return template, "template"
    extractive = extractive_fantasy_digest(
        player_name,
        scope=scope,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        sentiment_label=sentiment_label,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
        mention_trend=mention_trend,
        weeks_with_mentions=weeks_with_mentions,
    )
    return extractive, "extractive"


def _llm_fantasy_digest(
    player_name: str,
    *,
    scope: FantasyDigestScope,
    snippet: str,
    sentiment_label: str,
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    chapter_notes: str = "",
    top_sentence: str = "",
    mention_trend: float | None = None,
    weeks_with_mentions: int | None = None,
    charge_budget: bool = True,
) -> str | None:
    if not BEAT_DIGEST_LLM_ENABLED:
        return None
    api_key = OPENAI_API_KEY.strip()
    brief = snippet_to_brief(
        snippet,
        player_name,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
    )
    if not api_key or not brief.strip():
        return None
    if charge_budget and not budget_allows_call():
        return None
    flags: list[str] = []
    if injury_flag > 0:
        flags.append("injury concern in the notes")
    if role_hype_flag > 0:
        flags.append("usage/role hype")
    if scope == "season" and mention_trend is not None:
        if mention_trend > 0.25:
            flags.append("mention buzz warming recently")
        elif mention_trend < -0.25:
            flags.append("mention buzz cooling recently")
    flag_line = f"Context flags: {', '.join(flags)}." if flags else ""
    week_line = ""
    if scope == "season" and weeks_with_mentions:
        week_line = f"Weeks with fantasy mentions: {weeks_with_mentions}.\n"
    system = _LLM_WEEKLY_SYSTEM if scope == "weekly" else _LLM_SEASON_SYSTEM
    time_label = "this week" if scope == "weekly" else "this season"
    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": (
                            f"Player: {player_name}\n"
                            f"Overall tone: {sentiment_label}\n"
                            f"{flag_line}\n"
                            f"{week_line}"
                            f"Notes from {time_label} (snippets only):\n{brief[:1600]}"
                        ),
                    },
                ],
                "max_tokens": 160,
                "temperature": 0.35,
            },
            timeout=25,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        content = re.sub(r"^[\"']|[\"']$", "", content)
        if content and charge_budget:
            record_llm_spend()
        return content if content else None
    except Exception:
        return None


def fantasy_digest_for_player(
    player_name: str,
    sentiment: dict[str, Any],
    *,
    scope: FantasyDigestScope = "weekly",
    player_id: str | None = None,
    season: int | None = None,
    week: int | None = None,
    prefer_llm: bool = False,
    return_meta: bool = False,
    charge_budget: bool = True,
) -> str | dict[str, Any]:
    """Build fantasy digest. Default template/extractive — LLM only when prefer_llm=True (async)."""
    chapter_notes = str(sentiment.get("chapter_notes") or "")
    top_sentence = str(sentiment.get("top_sentence") or sentiment.get("snippet") or "")
    snippet = chapter_notes or top_sentence or str(sentiment.get("snippet") or "")
    label = str(sentiment.get("sentiment_label") or "neutral")
    injury_flag = float(sentiment.get("injury_flag") or 0)
    role_hype_flag = float(sentiment.get("role_hype_flag") or 0)
    mention_trend = sentiment.get("mention_trend")
    weeks_with_mentions = sentiment.get("weeks_with_mentions")
    sources = [s.get("label") or s.get("network_label") for s in (sentiment.get("sources") or [])]
    sources = [s for s in sources if s]
    if not sources:
        sources = [c for c in (sentiment.get("channels") or []) if c]
    mention_count = float(
        sentiment.get("mention_count")
        or sentiment.get("fantasy_mentions")
        or sentiment.get("narrative_source_count")
        or 0
    )

    ehash = compute_evidence_hash(
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        snippet=snippet,
        sentiment_label=label,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
        mention_count=mention_count,
        source_labels=sources,
        mention_trend=float(mention_trend) if mention_trend is not None else None,
        weeks_with_mentions=int(weeks_with_mentions) if weeks_with_mentions is not None else None,
    )
    cache_key = evidence_cache_key(
        player_id=player_id,
        player_name=player_name,
        season=season,
        week=week,
        evidence_hash=ehash,
        scope=f"fantasy|{scope}",
    )
    cached = _cache_get_record(scope, cache_key)
    if cached:
        digest = str(cached.get("digest") or "")
        source = str(cached.get("digest_source") or "cache")
        if digest and (not prefer_llm or source == "llm"):
            if return_meta:
                return {
                    "fantasy_digest": digest,
                    "fantasy_digest_source": "cache",
                    "template": cached.get("template") or digest,
                    "evidence_hash": ehash,
                    "prompt_version": cached.get("prompt_version") or prompt_version(),
                }
            return digest

    template, template_source = build_fantasy_template_or_extractive(
        player_name,
        scope=scope,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        sentiment_label=label,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
        source_labels=sources,
        mention_count=mention_count,
        mention_trend=float(mention_trend) if mention_trend is not None else None,
        weeks_with_mentions=int(weeks_with_mentions) if weeks_with_mentions is not None else None,
    )
    excerpt = strongest_excerpt(
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        snippet=snippet,
    )

    digest: str | None = None
    source = template_source
    if prefer_llm:
        digest = _llm_fantasy_digest(
            player_name,
            scope=scope,
            snippet=snippet,
            sentiment_label=label,
            injury_flag=injury_flag,
            role_hype_flag=role_hype_flag,
            chapter_notes=chapter_notes,
            top_sentence=top_sentence,
            mention_trend=float(mention_trend) if mention_trend is not None else None,
            weeks_with_mentions=int(weeks_with_mentions) if weeks_with_mentions is not None else None,
            charge_budget=charge_budget,
        )
        if digest:
            source = "llm"

    if not digest:
        digest = template

    _cache_set(
        scope,
        cache_key,
        digest,
        template=template,
        source=source,
        evidence_hash=ehash,
        excerpt=excerpt,
        source_labels=sources,
    )
    if return_meta:
        return {
            "fantasy_digest": digest,
            "fantasy_digest_source": source,
            "template": template,
            "evidence_hash": ehash,
            "prompt_version": prompt_version(),
        }
    return digest
