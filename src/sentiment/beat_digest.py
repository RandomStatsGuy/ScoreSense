"""Turn raw beat snippets into concise draft-room narrative blurbs."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import requests

from src.config import (
    BEAT_DIGEST_CACHE_VERSION,
    CACHE_DIR,
    BEAT_DIGEST_LLM_ENABLED,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)

_DIGEST_CACHE_DIR = CACHE_DIR / "draft_beat_digest"
_CHAPTER_SPLIT = re.compile(r"(?:\d{1,2}:){1,2}\d{2}\s*")
_TIMESTAMP_RE = re.compile(r"(?:\d{1,2}:){1,2}\d{2}")
_PODCAST_FILLER = re.compile(
    r"\b(?:timestamps?|locked on|podcast|episode|mailbag|react(?:ion)?s?)\b",
    re.I,
)
_HASHTAG_RE = re.compile(r"#\w+")
_CLICKBAIT_RE = re.compile(
    r"\b(?:SAVAGELY|STUNNING|DOMINATE|TRANSFORMATIVE|GUTSY|MUST\s+PRIORITIZE|EVER\s+HAD|MAJOR\s+PROBLEM)\b",
    re.I,
)
_HEALTH_TOPIC_KEYWORDS = (
    "injury",
    "injured",
    "hamstring",
    "concussion",
    "ankle",
    "knee",
    "questionable",
    "doubtful",
    "limited",
    "inactive",
    "did not practice",
    "dnp",
    "out ",
    " health",
    "availability",
)


def _cache_path(key: str) -> Path:
    _DIGEST_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _DIGEST_CACHE_DIR / f"{key}.json"


def _cache_get(key: str, *, max_age_hours: float = 24.0) -> str | None:
    path = _cache_path(key)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        cached_at = data.get("cached_at")
        if cached_at:
            ts = datetime.fromisoformat(str(cached_at))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0
            if age_h > max_age_hours:
                return None
        return str(data.get("digest") or "") or None
    except (json.JSONDecodeError, OSError, ValueError):
        return None


def _cache_set(key: str, digest: str) -> None:
    _cache_path(key).write_text(
        json.dumps({"digest": digest, "cached_at": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8",
    )


def _daily_cache_key(
    *,
    player_id: str | None,
    player_name: str,
    season: int | None,
    week: int | None,
) -> str:
    day = date.today().isoformat()
    pid = str(player_id or player_name).strip()
    return hashlib.sha256(f"{BEAT_DIGEST_CACHE_VERSION}|{pid}|{season}|{week}|{day}".encode()).hexdigest()[:24]


def parse_chapter_titles(snippet: str) -> list[str]:
    text = str(snippet or "").strip()
    if not text or not _TIMESTAMP_RE.search(text):
        return []
    text = re.sub(r"^timestamps?\s*", "", text, flags=re.I)
    parts = [p.strip(' "\'–—-') for p in _CHAPTER_SPLIT.split(text) if p.strip()]
    cleaned: list[str] = []
    for part in parts:
        part = re.sub(r"\s+", " ", part).strip()
        if len(part) < 4:
            continue
        if part.lower() in {"injury", "role hype", "injuries", "updates"}:
            continue
        if _PODCAST_FILLER.search(part) and len(part) < 24:
            continue
        cleaned.append(part)
    return cleaned[:5]


def _strip_hashtags(text: str) -> str:
    text = _HASHTAG_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def is_usable_snippet(topic: str) -> bool:
    """Whether a transcript/title line is fit for digest input."""
    text = str(topic or "").strip()
    if len(text) < 8:
        return False
    if len(text) > 110:
        return False
    if text.count(",") > 2:
        return False
    if "#" in text:
        return False
    if _CLICKBAIT_RE.search(text):
        return False
    words = [w for w in re.split(r"\s+", text) if w]
    if not words:
        return False
    shout = sum(1 for w in words if w.isupper() and len(w) > 2)
    if shout / len(words) > 0.34:
        return False
    return True


def _is_usable_topic(topic: str) -> bool:
    return is_usable_snippet(topic)


def _mentions_health(*chunks: str) -> bool:
    blob = " ".join(str(c or "") for c in chunks).lower()
    return any(k in blob for k in _HEALTH_TOPIC_KEYWORDS)


def _health_angle(
    *,
    injury_flag: float,
    sentiment_label: str,
    topics: list[str],
    top_sentence: str,
    snippet: str,
) -> bool:
    if injury_flag <= 0:
        return False
    if sentiment_label == "caution":
        return True
    return _mentions_health(" ".join(topics), top_sentence, snippet)


def _clean_topic(topic: str, player_name: str) -> str:
    text = _strip_hashtags(str(topic or "").strip())
    if not text:
        return ""
    name = str(player_name or "").strip()
    if name:
        text = re.sub(rf"^{re.escape(name)}\s*[:\-–—]\s*", "", text, flags=re.I)
        last = name.split()[-1]
        if last:
            text = re.sub(rf"^{re.escape(last)}\s*[:\-–—]\s*", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -–—,.")
    if len(text) > 100:
        text = text[:100].rsplit(" ", 1)[0]
    if not _is_usable_topic(text):
        return ""
    if text.lower().startswith(("the ", "a ", "an ")):
        return text[0].lower() + text[1:]
    return text[0].lower() + text[1:] if text else ""


def _collect_topics(
    *,
    player_name: str,
    snippet: str,
    chapter_notes: str,
    top_sentence: str,
) -> list[str]:
    raw_topics: list[str] = []
    if chapter_notes:
        raw_topics.extend(t.strip() for t in chapter_notes.split(" | ") if t.strip())
    if not raw_topics:
        raw_topics.extend(parse_chapter_titles(snippet))
    topics = _dedupe_topics([_clean_topic(t, player_name) for t in raw_topics])
    topics = [t for t in topics if t]
    if topics:
        return topics[:3]
    sentence = top_sentence or snippet
    cleaned = _clean_topic(sentence, player_name)
    if cleaned and len(cleaned) >= 12:
        return [cleaned]
    plain = _strip_hashtags(re.sub(r"(?:\d{1,2}:){1,2}\d{2}\s*", " ", sentence))
    plain = re.sub(r"\s+", " ", plain).strip()
    if len(plain) >= 20 and _is_usable_topic(plain[:100]):
        return [plain[0].lower() + plain[1:]]
    return []


def _dedupe_topics(topics: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for topic in topics:
        key = re.sub(r"[^a-z0-9]+", "", topic.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(topic)
    return out


def snippet_to_brief(
    snippet: str,
    player_name: str = "",
    *,
    chapter_notes: str = "",
    top_sentence: str = "",
) -> str:
    """Structured notes for LLM input — no timestamps."""
    if chapter_notes:
        topics = [_clean_topic(t, player_name) for t in chapter_notes.split(" | ")]
        topics = _dedupe_topics([t for t in topics if t])
        if topics:
            return "\n".join(f"- {t}" for t in topics)
    topics = [_clean_topic(t, player_name) for t in parse_chapter_titles(snippet)]
    topics = _dedupe_topics([t for t in topics if t])
    if topics:
        return "\n".join(f"- {t}" for t in topics)
    plain_source = top_sentence or snippet
    plain = re.sub(r"(?:\d{1,2}:){1,2}\d{2}\s*", " ", plain_source)
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain[:1200] if plain else ""


def _topic_phrase(topic: str) -> str:
    text = str(topic or "").strip()
    if not text:
        return "usage and role"
    if text[0].isupper() and text[0].isalpha():
        return text[0].lower() + text[1:]
    return text


def extractive_beat_digest(
    player_name: str,
    *,
    snippet: str = "",
    chapter_notes: str = "",
    top_sentence: str = "",
    sentiment_label: str = "neutral",
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    source_labels: list[str] | None = None,
) -> str:
    """Rule-based 1–2 sentence columnist-style update from chapter titles or transcript."""
    _ = source_labels  # sources shown separately in UI
    topics = _collect_topics(
        player_name=player_name,
        snippet=snippet,
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
    )
    last = (player_name or "This player").split()[-1]
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
            if len(topics) > 1:
                return (
                    f"Health is the headline on {last} this week — team coverage keeps circling "
                    f"{focus}, with follow-up talk about {_topic_phrase(topics[1])}."
                )
            return f"Health is the headline on {last} this week, with team podcasts focused on {focus}."
        return (
            f"The narrative on {last} skews cautious right now as beat and fantasy shows keep "
            f"flagging injury and availability questions ahead of draft season."
        )

    if not topics:
        if role_hype_flag > 0:
            return (
                f"There is not much volume on {last} in team channels, but fantasy analysts "
                f"keep pointing to upward usage signals worth tracking."
            )
        return f"It has been a quiet week in the echo chamber for {last} — no major storyline shifts."

    if injury_flag > 0:
        opener = f"The weekly storyline on {last} mixes health talk with broader coverage"
    elif sentiment_label in ("hype", "bullish"):
        opener = f"The draft-season drumbeat on {last} has been positive"
    elif sentiment_label == "bearish":
        opener = f"Skepticism around {last} picked up in recent team coverage"
    elif sentiment_label == "mixed":
        opener = f"The conversation on {last} this week landed in mixed territory"
    else:
        opener = f"The weekly storyline on {last}"

    if len(topics) == 1:
        return f"{opener}, centered on {_topic_phrase(topics[0])}."
    if len(topics) == 2:
        return (
            f"{opener}, with {_topic_phrase(topics[0])} and {_topic_phrase(topics[1])} "
            f"getting the most air time."
        )
    return (
        f"{opener} — notably {_topic_phrase(topics[0])}, {_topic_phrase(topics[1])}, "
        f"and {_topic_phrase(topics[2])}."
    )


_LLM_SYSTEM = (
    "You are an NFL fantasy columnist writing a short draft-room update about one player.\n\n"
    "Write 1–2 complete sentences in third person. Synthesize the notes into one coherent storyline — "
    "as if you're filing a beat for a fantasy magazine ahead of draft season.\n\n"
    "Do NOT: list segment titles, quote podcast chapter names verbatim, mention timestamps, "
    "say 'beat coverage', 'sources flag', 'mentions', or name YouTube channels.\n\n"
    "DO: focus on role, usage, health, competition for touches, and what changed this week "
    "for draft value. Use the player's last name naturally."
)


def _llm_beat_digest(
    player_name: str,
    *,
    snippet: str,
    sentiment_label: str,
    source_labels: list[str] | None,
    injury_flag: float = 0.0,
    role_hype_flag: float = 0.0,
    chapter_notes: str = "",
    top_sentence: str = "",
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
    _ = source_labels
    flags: list[str] = []
    if injury_flag > 0:
        flags.append("injury concern in the notes")
    if role_hype_flag > 0:
        flags.append("usage/role hype")
    flag_line = f"Context flags: {', '.join(flags)}." if flags else ""
    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": _LLM_SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Player: {player_name}\n"
                            f"Overall tone: {sentiment_label}\n"
                            f"{flag_line}\n"
                            f"Notes from this week:\n{brief[:1600]}"
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
        return content if content else None
    except Exception:
        return None


def beat_digest_for_player(
    player_name: str,
    sentiment: dict[str, Any],
    *,
    player_id: str | None = None,
    season: int | None = None,
    week: int | None = None,
    prefer_llm: bool = True,
    return_meta: bool = False,
) -> str | dict[str, Any]:
    chapter_notes = str(sentiment.get("chapter_notes") or "")
    top_sentence = str(sentiment.get("top_sentence") or sentiment.get("snippet") or "")
    snippet = chapter_notes or top_sentence or str(sentiment.get("snippet") or "")
    label = str(sentiment.get("sentiment_label") or "neutral")
    sources = [s.get("label") or s.get("network_label") for s in (sentiment.get("sources") or [])]
    sources = [s for s in sources if s]
    injury_flag = float(sentiment.get("injury_flag") or 0)
    role_hype_flag = float(sentiment.get("role_hype_flag") or 0)

    cache_key = _daily_cache_key(
        player_id=player_id,
        player_name=player_name,
        season=season,
        week=week,
    )
    cached = _cache_get(cache_key)
    if cached:
        if return_meta:
            return {"beat_digest": cached, "beat_digest_source": "cache"}
        return cached

    digest: str | None = None
    source = "extractive"
    if prefer_llm:
        digest = _llm_beat_digest(
            player_name,
            snippet=snippet,
            sentiment_label=label,
            source_labels=sources,
            injury_flag=injury_flag,
            role_hype_flag=role_hype_flag,
            chapter_notes=chapter_notes,
            top_sentence=top_sentence,
        )
        if digest:
            source = "llm"

    if not digest:
        digest = extractive_beat_digest(
            player_name,
            snippet=snippet,
            chapter_notes=chapter_notes,
            top_sentence=top_sentence,
            sentiment_label=label,
            injury_flag=injury_flag,
            role_hype_flag=role_hype_flag,
            source_labels=sources,
        )

    _cache_set(cache_key, digest)
    if return_meta:
        return {"beat_digest": digest, "beat_digest_source": source}
    return digest
