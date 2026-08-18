"""Heuristic injury return estimates from Sleeper designation + body part."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from src.config import PROJECT_ROOT

HEURISTICS_PATH = PROJECT_ROOT / "data" / "injury" / "return_heuristics.yaml"

# Designations that imply the player may still play this week. Body/note
# patterns must not advertise a longer absence than the designation itself.
_PLAYING_STATUSES = frozenset({"Questionable", "Doubtful", "Probable"})


@dataclass(frozen=True)
class InjuryTimeline:
    label: str
    weeks_min: int | None
    weeks_max: int | None
    confidence: str
    rationale: str
    is_estimate: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@lru_cache(maxsize=1)
def _load_heuristics() -> dict:
    if not HEURISTICS_PATH.exists():
        return {}
    return yaml.safe_load(HEURISTICS_PATH.read_text(encoding="utf-8")) or {}


def _norm(value: str | None) -> str:
    return str(value or "").strip().lower()


def _match_patterns(text: str, patterns: list[dict]) -> dict | None:
    for row in patterns or []:
        needle = _norm(row.get("match"))
        if needle and needle in text:
            return row
    return None


def _weeks_max(row: dict | None) -> int | None:
    if not row:
        return None
    raw = row.get("weeks_max")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _exceeds_status_window(pattern: dict | None, status_default: dict | None) -> bool:
    """True when a body/note window is longer than the official designation."""
    pattern_max = _weeks_max(pattern)
    status_max = _weeks_max(status_default)
    if pattern_max is None or status_max is None:
        return False
    return pattern_max > status_max


def _usable_pattern(
    pattern: dict | None,
    status: str,
    status_default: dict | None,
) -> dict | None:
    if not pattern:
        return None
    if status in _PLAYING_STATUSES and _exceeds_status_window(pattern, status_default):
        return None
    return pattern


def _pick_specificity(
    status_default: dict,
    body_hit: dict | None,
    note_hit: dict | None,
    status: str,
) -> InjuryTimeline:
    """Prefer body-part / note patterns over generic status when more specific.

    Questionable / Doubtful / Probable cap the window to the designation.
    An ACL tag on a Q player must not show "Season / multi-month" next to a
    full weekly projection.
    """
    status_u = str(status or "").strip()
    candidates: list[tuple[int, dict]] = []
    note_hit = _usable_pattern(note_hit, status_u, status_default)
    body_hit = _usable_pattern(body_hit, status_u, status_default)

    if status_default:
        candidates.append((1, status_default))
    if note_hit:
        candidates.append((3, note_hit))
    if body_hit:
        candidates.append((4, body_hit))

    if status_u in ("IR", "PUP", "Out") and body_hit and _norm(body_hit.get("match")) in ("acl", "achilles"):
        candidates.append((5, body_hit))

    if status_u == "Out":
        severe_body = body_hit and _norm(body_hit.get("match")) in ("acl", "achilles")
        if note_hit or severe_body:
            pass  # keep elevated note/body candidates
        elif body_hit:
            candidates = [(score, row) for score, row in candidates if row is not body_hit]

    if not candidates:
        return InjuryTimeline(
            label="Unknown",
            weeks_min=None,
            weeks_max=None,
            confidence="low",
            rationale="Insufficient injury detail",
        )

    _, best = max(candidates, key=lambda item: item[0])

    return InjuryTimeline(
        label=str(best.get("label") or "Unknown"),
        weeks_min=best.get("weeks_min"),
        weeks_max=best.get("weeks_max"),
        confidence=str(best.get("confidence") or "low"),
        rationale=str(best.get("rationale") or "Heuristic estimate"),
    )


def estimate_injury_return(
    injury_status: str | None,
    injury_body_part: str | None = None,
    injury_notes: str | None = None,
    *,
    practice_participation: str | None = None,
) -> InjuryTimeline:
    """Return a transparent ETA window from Sleeper injury fields."""
    status = str(injury_status or "").strip()
    if not status:
        return InjuryTimeline(
            label="Unknown",
            weeks_min=None,
            weeks_max=None,
            confidence="low",
            rationale="No injury status",
        )

    cfg = _load_heuristics()
    defaults = cfg.get("defaults") or {}
    status_default = defaults.get(status)

    combined = " ".join(
        part for part in (_norm(injury_body_part), _norm(injury_notes), _norm(practice_participation)) if part
    )
    body_hit = _match_patterns(combined, cfg.get("body_part_patterns") or [])
    note_hit = _match_patterns(combined, cfg.get("note_patterns") or [])

    timeline = _pick_specificity(status_default, body_hit, note_hit, status)

    if practice_participation:
        practice = _norm(practice_participation)
        if practice in ("full", "full participation") and status == "Questionable":
            return InjuryTimeline(
                label="Game-time decision",
                weeks_min=0,
                weeks_max=0,
                confidence="medium",
                rationale="Full practice with questionable tag",
            )
        if practice in ("did not participate", "dnp") and status == "Questionable":
            return InjuryTimeline(
                label="1-2 weeks",
                weeks_min=1,
                weeks_max=2,
                confidence="low",
                rationale="DNP with questionable tag",
            )

    return timeline


def attach_return_estimates(records: list[dict]) -> list[dict]:
    """Add return_estimate dict to each injury record."""
    out: list[dict] = []
    for row in records:
        enriched = dict(row)
        timeline = estimate_injury_return(
            row.get("injury_status"),
            row.get("injury_body_part"),
            row.get("injury_notes"),
            practice_participation=row.get("practice_participation"),
        )
        enriched["return_estimate"] = timeline.to_dict()
        out.append(enriched)
    return out
