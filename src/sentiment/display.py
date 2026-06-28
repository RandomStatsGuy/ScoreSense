"""Human-readable sentiment labels for API / UI readout."""

from __future__ import annotations


def sentiment_label(score: float, *, injury_flag: float = 0.0, role_hype_flag: float = 0.0) -> str:
    """Return bullish | bearish | caution | hype | neutral | mixed."""
    if injury_flag > 0 and score <= -0.05:
        return "caution"
    if role_hype_flag > 0 and score >= 0.05:
        return "hype"
    if score >= 0.2:
        return "bullish"
    if score <= -0.2:
        return "bearish"
    if abs(score) < 0.08:
        return "neutral"
    return "mixed"


def sentiment_label_text(label: str) -> str:
    return {
        "bullish": "Bullish",
        "bearish": "Bearish",
        "caution": "Injury concern",
        "hype": "Role hype",
        "neutral": "Neutral",
        "mixed": "Mixed",
    }.get(label, "Neutral")


def sentiment_summary(
    *,
    label: str,
    mention_count: float,
    source_labels: list[str] | None = None,
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
) -> str:
    """One-line weekly narrative summary for UI tooltips."""
    parts: list[str] = [sentiment_label_text(label)]
    mentions = int(round(mention_count))
    if mentions > 0:
        parts.append(f"{mentions} mention{'s' if mentions != 1 else ''}")
    if injury_flag > 0:
        parts.append("injury talk")
    if role_hype_flag > 0 and label != "hype":
        parts.append("usage hype")
    labels = [s for s in (source_labels or []) if s][:3]
    if labels:
        parts.append(" · ".join(labels) if len(labels) == 1 else f"via {', '.join(labels)}")
    return " · ".join(parts)
