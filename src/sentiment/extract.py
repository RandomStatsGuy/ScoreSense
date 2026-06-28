"""Lexicon-based NLP for YouTube beat narrative text."""

from __future__ import annotations

import re
from dataclasses import dataclass

INJURY_KEYWORDS = (
    "out",
    "doubtful",
    "questionable",
    "limited",
    "injury",
    "injured",
    "hamstring",
    "concussion",
    "ankle",
    "knee",
    "did not practice",
    "dnP",
    "inactive",
    "ir",
    "pup",
)

ROLE_HYPE_KEYWORDS = (
    "breakout",
    "workhorse",
    "target share",
    "red zone",
    "redzone",
    "featured",
    "alpha",
    "every-down",
    "every down",
    "snap count",
    "touches",
    "volume",
    "step up",
    "emerging",
)

POSITIVE_HINTS = ("love", "excel", "dominat", "impress", "star", "upside", "explosive", "healthy")
NEGATIVE_HINTS = ("concern", "worry", "struggl", "declin", "bust", "disappoint", "slow", "pain")


@dataclass
class ExtractedMention:
    player_name: str
    sentence: str
    sentiment_score: float
    injury_flag: bool
    role_hype_flag: bool


def _split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def _keyword_hit(text: str, keywords: tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(k in lower for k in keywords)


def score_sentiment(text: str) -> float:
    """Rule-based sentiment in [-1, 1]; uses VADER when available."""
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

        analyzer = SentimentIntensityAnalyzer()
        return float(analyzer.polarity_scores(text)["compound"])
    except Exception:
        lower = text.lower()
        score = 0.0
        for hint in POSITIVE_HINTS:
            if hint in lower:
                score += 0.25
        for hint in NEGATIVE_HINTS:
            if hint in lower:
                score -= 0.25
        return max(-1.0, min(1.0, score))


def extract_mentions(text: str, roster_names: list[str]) -> list[ExtractedMention]:
    """Find roster player names in text and score surrounding sentences."""
    if not text or not roster_names:
        return []

    names = sorted({n.strip() for n in roster_names if n and len(n.strip()) >= 4}, key=len, reverse=True)
    sentences = _split_sentences(text)
    if not sentences and text:
        sentences = [text]

    mentions: list[ExtractedMention] = []
    seen: set[tuple[str, str]] = set()
    for sentence in sentences:
        lower = sentence.lower()
        for name in names:
            if name.lower() not in lower:
                continue
            key = (name.lower(), sentence[:80])
            if key in seen:
                continue
            seen.add(key)
            mentions.append(
                ExtractedMention(
                    player_name=name,
                    sentence=sentence[:300],
                    sentiment_score=score_sentiment(sentence),
                    injury_flag=_keyword_hit(sentence, INJURY_KEYWORDS),
                    role_hype_flag=_keyword_hit(sentence, ROLE_HYPE_KEYWORDS),
                )
            )
    return mentions
