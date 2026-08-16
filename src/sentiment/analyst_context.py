"""Template-first analyst context helpers (SCORE-27).

Request handlers must never call OpenAI. LLM work is async-only, gated by
evidence_hash cache keys, eligibility rules, and hard dollar budgets.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from src.config import (
    BEAT_DIGEST_CACHE_VERSION,
    BEAT_DIGEST_LLM_DAILY_BUDGET_USD,
    BEAT_DIGEST_LLM_ENABLED,
    BEAT_DIGEST_LLM_EST_COST_PER_CALL_USD,
    BEAT_DIGEST_LLM_PER_RUN_BUDGET_USD,
    BEAT_DIGEST_LLM_TOP_N,
    BEAT_DIGEST_PROMPT_VERSION,
    CACHE_DIR,
    OPENAI_API_KEY,
)

_BUDGET_DIR = CACHE_DIR / "llm_budget"
_EXCERPT_CLEAN = re.compile(r"(?:\d{1,2}:){1,2}\d{2}\s*")
_WHITESPACE = re.compile(r"\s+")

# In-process per-run spend (reset when a new prewarm job starts).
_RUN_SPENT_USD = 0.0
_RUN_CALLS = 0


def reset_run_budget() -> None:
    """Call at the start of an async LLM job."""
    global _RUN_SPENT_USD, _RUN_CALLS
    _RUN_SPENT_USD = 0.0
    _RUN_CALLS = 0


def prompt_version() -> str:
    return str(BEAT_DIGEST_PROMPT_VERSION or "v1").strip() or "v1"


def compute_evidence_hash(
    *,
    chapter_notes: str = "",
    top_sentence: str = "",
    snippet: str = "",
    sentiment_label: str = "neutral",
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    mention_count: float = 0.0,
    source_labels: list[str] | None = None,
    mention_trend: float | None = None,
    weeks_with_mentions: int | None = None,
) -> str:
    """Stable hash of structured evidence used for template + LLM input."""
    labels = sorted({str(s).strip() for s in (source_labels or []) if str(s).strip()})
    payload = {
        "chapter_notes": str(chapter_notes or "").strip(),
        "top_sentence": str(top_sentence or "").strip(),
        "snippet": str(snippet or "").strip()[:800],
        "sentiment_label": str(sentiment_label or "neutral"),
        "injury_flag": 1 if float(injury_flag or 0) > 0 else 0,
        "role_hype_flag": 1 if float(role_hype_flag or 0) > 0 else 0,
        "mention_count": round(float(mention_count or 0), 3),
        "source_labels": labels,
        "mention_trend": None if mention_trend is None else round(float(mention_trend), 4),
        "weeks_with_mentions": None if weeks_with_mentions is None else int(weeks_with_mentions),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:20]


def evidence_cache_key(
    *,
    player_id: str | None,
    player_name: str,
    season: int | None,
    week: int | None,
    evidence_hash: str,
    scope: str | None = None,
) -> str:
    """Cache by player + week + evidence_hash + prompt_version (+ optional scope)."""
    pid = str(player_id or player_name).strip()
    parts = [
        BEAT_DIGEST_CACHE_VERSION,
        prompt_version(),
        scope or "beat",
        pid,
        str(season),
        str(week),
        evidence_hash,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:24]


def strongest_excerpt(
    *,
    chapter_notes: str = "",
    top_sentence: str = "",
    snippet: str = "",
    max_len: int = 140,
) -> str:
    """Pick a short excerpt suitable for UI / LLM (never a full transcript)."""
    candidates: list[str] = []
    if chapter_notes:
        candidates.extend(p.strip() for p in str(chapter_notes).split(" | ") if p.strip())
    for raw in (top_sentence, snippet):
        text = _WHITESPACE.sub(" ", _EXCERPT_CLEAN.sub(" ", str(raw or ""))).strip()
        if text:
            candidates.append(text)
    for cand in candidates:
        cleaned = cand.strip(" -–—,.")
        if len(cleaned) < 12:
            continue
        if len(cleaned) > max_len:
            cleaned = cleaned[:max_len].rsplit(" ", 1)[0].rstrip(" ,.;:")
        return cleaned
    return ""


def template_analyst_summary(
    *,
    sentiment_label: str = "neutral",
    mention_count: float = 0.0,
    source_labels: list[str] | None = None,
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    chapter_notes: str = "",
    top_sentence: str = "",
    snippet: str = "",
    scope: str = "weekly",
) -> str:
    """Cheap structured template — default analyst context on every path."""
    labels = [s for s in (source_labels or []) if s][:3]
    shows = len(labels) if labels else max(0, int(round(float(mention_count or 0))))
    show_word = "fantasy show" if shows == 1 else "fantasy shows"
    if scope == "season":
        show_word = "fantasy channel" if shows == 1 else "fantasy channels"

    if float(injury_flag or 0) > 0 and float(role_hype_flag or 0) > 0:
        lead = "Injury and role both in focus"
    elif float(injury_flag or 0) > 0 or sentiment_label == "caution":
        lead = "Injury watch"
    elif float(role_hype_flag or 0) > 0 or sentiment_label == "hype":
        lead = "Role trending up"
    elif sentiment_label == "bullish":
        lead = "Analysts leaning bullish"
    elif sentiment_label == "bearish":
        lead = "Analysts leaning cautious"
    elif sentiment_label == "mixed":
        lead = "Sources disagree"
    else:
        lead = "In the conversation" if shows > 0 else "Quiet week"

    if shows > 0:
        period = "this season" if scope == "season" else "this week"
        lead_line = f"{lead} — discussed by {shows} {show_word} {period}."
    else:
        lead_line = f"{lead}."

    excerpt = strongest_excerpt(
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        snippet=snippet,
    )
    if excerpt and labels:
        return f'{lead_line} "{excerpt}" — {", ".join(labels)}.'
    if excerpt:
        return f'{lead_line} "{excerpt}."'
    if labels:
        return f"{lead_line} Sources: {', '.join(labels)}."
    return lead_line


def sources_disagree(*, sentiment_label: str, source_labels: list[str] | None = None) -> bool:
    labels = [s for s in (source_labels or []) if s]
    return sentiment_label == "mixed" and len(labels) >= 2


def injury_role_needs_llm(
    *,
    injury_flag: float,
    role_hype_flag: float,
    sentiment_label: str,
    chapter_notes: str = "",
) -> bool:
    """Flags that a short template cannot express cleanly."""
    inj = float(injury_flag or 0) > 0
    role = float(role_hype_flag or 0) > 0
    if inj and role:
        return True
    if inj and sentiment_label == "mixed":
        return True
    notes = str(chapter_notes or "").lower()
    if inj and ("but" in notes or "however" in notes or "|" in notes):
        return True
    return False


def should_async_llm(
    *,
    sentiment_label: str = "neutral",
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    mention_count: float = 0.0,
    source_labels: list[str] | None = None,
    chapter_notes: str = "",
    rank: int | None = None,
    top_n: int | None = None,
) -> bool:
    """SCORE-27 eligibility — only for async jobs, never request handlers."""
    if not BEAT_DIGEST_LLM_ENABLED or not OPENAI_API_KEY.strip():
        return False
    labels = [s for s in (source_labels or []) if s]
    if sources_disagree(sentiment_label=sentiment_label, source_labels=labels):
        return True
    if injury_role_needs_llm(
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
        sentiment_label=sentiment_label,
        chapter_notes=chapter_notes,
    ):
        return True
    # High-impact + several sources
    limit = int(top_n if top_n is not None else BEAT_DIGEST_LLM_TOP_N)
    high_impact = rank is not None and rank < limit
    if high_impact and len(labels) >= 3 and float(mention_count or 0) >= 3:
        return True
    return False


def _budget_path(day: date | None = None) -> Path:
    _BUDGET_DIR.mkdir(parents=True, exist_ok=True)
    d = day or date.today()
    return _BUDGET_DIR / f"{d.isoformat()}.json"


def _read_daily_budget(day: date | None = None) -> dict[str, Any]:
    path = _budget_path(day)
    if not path.exists():
        return {"spent_usd": 0.0, "calls": 0, "day": (day or date.today()).isoformat()}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "spent_usd": float(data.get("spent_usd") or 0),
            "calls": int(data.get("calls") or 0),
            "day": str(data.get("day") or (day or date.today()).isoformat()),
        }
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return {"spent_usd": 0.0, "calls": 0, "day": (day or date.today()).isoformat()}


def _write_daily_budget(data: dict[str, Any], day: date | None = None) -> None:
    path = _budget_path(day)
    payload = {
        "spent_usd": float(data.get("spent_usd") or 0),
        "calls": int(data.get("calls") or 0),
        "day": str(data.get("day") or (day or date.today()).isoformat()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def budget_allows_call(*, est_cost_usd: float | None = None) -> bool:
    """Hard per-run and daily dollar limits."""
    cost = float(est_cost_usd if est_cost_usd is not None else BEAT_DIGEST_LLM_EST_COST_PER_CALL_USD)
    if cost < 0:
        cost = 0.0
    daily = _read_daily_budget()
    if daily["spent_usd"] + cost > float(BEAT_DIGEST_LLM_DAILY_BUDGET_USD):
        return False
    if _RUN_SPENT_USD + cost > float(BEAT_DIGEST_LLM_PER_RUN_BUDGET_USD):
        return False
    return True


def record_llm_spend(*, cost_usd: float | None = None) -> dict[str, Any]:
    """Record an LLM call against daily + run budgets."""
    global _RUN_SPENT_USD, _RUN_CALLS
    cost = float(cost_usd if cost_usd is not None else BEAT_DIGEST_LLM_EST_COST_PER_CALL_USD)
    if cost < 0:
        cost = 0.0
    daily = _read_daily_budget()
    daily["spent_usd"] = float(daily["spent_usd"]) + cost
    daily["calls"] = int(daily["calls"]) + 1
    _write_daily_budget(daily)
    _RUN_SPENT_USD += cost
    _RUN_CALLS += 1
    return {
        "daily_spent_usd": daily["spent_usd"],
        "daily_calls": daily["calls"],
        "run_spent_usd": _RUN_SPENT_USD,
        "run_calls": _RUN_CALLS,
        "cost_usd": cost,
    }


def budget_snapshot() -> dict[str, Any]:
    daily = _read_daily_budget()
    return {
        "daily_spent_usd": daily["spent_usd"],
        "daily_calls": daily["calls"],
        "daily_budget_usd": float(BEAT_DIGEST_LLM_DAILY_BUDGET_USD),
        "run_spent_usd": _RUN_SPENT_USD,
        "run_calls": _RUN_CALLS,
        "per_run_budget_usd": float(BEAT_DIGEST_LLM_PER_RUN_BUDGET_USD),
        "est_cost_per_call_usd": float(BEAT_DIGEST_LLM_EST_COST_PER_CALL_USD),
        "prompt_version": prompt_version(),
    }
