"""Cached player-context read model (SCORE-23 / SCORE-30).

Background jobs join weekly inj/no_inj projections, a frozen injury snapshot,
and pre-aggregated sentiment digests into a versioned parquet artifact.

Page-view serving reads that artifact only — never YouTube ingest, LLM, Sleeper
polling, or live ``predict_*``.

SCORE-30: ``GET /api/players/context`` defaults to a compact table payload
(injury badge/age, adjustment, analyst signal + source_count, detail_available).
Heavy excerpts/sources/summaries/drivers are lazy-loaded via
``GET /api/player/{id}/context``.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from src.config import (
    BEAT_DIGEST_CACHE_VERSION,
    PLAYER_CONTEXT_DIR,
    PROCESSED_DATA_DIR,
    SENTIMENT_FEATURES_PATH,
)
from src.draft_hub.player_latest import (
    attach_this_week,
    compose_this_week,
    is_useful_sentence,
)
from src.core.projection_context import resolve_projection_context
from src.integrations.injury_snapshot import (
    build_injury_snapshot,
    index_availability_by_player_id,
    name_to_player_ids,
    save_injury_snapshot,
)
from src.projections.weekly_cache import load_weekly_prediction, weekly_fingerprint
from src.sentiment.media_context import (
    MEDIA_MODE_OLDER,
    MEDIA_MODE_OUTLOOK,
    MEDIA_MODE_WEEK1_PULSE,
    MEDIA_STATE_CURRENT,
    MEDIA_STATE_HISTORICAL_AVAILABLE,
    MEDIA_STATE_NONE,
    PRESEASON_OUTLOOK_WEEK,
    empty_media_context,
    find_player_historical_row,
    normalize_media_mode,
    select_media_context_for_mode,
)

POSITIONS = ("qb", "rb", "wr")
SCHEMA_VERSION = "player_context_v4"
_P50_KEYS = ("Projected Points", "P50", "p50")

_CONTEXT_CACHE: dict[str, tuple[str, pd.DataFrame, dict[str, Any]]] = {}

_NOTE_SEGMENT_RE = re.compile(
    r"^\s*(?P<name>.+?)\s*(?:\((?P<status>[^)]*)\))?\s*$"
)


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.bool_,)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _pick_num(row: dict[str, Any] | pd.Series, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        if isinstance(row, dict):
            if key not in row:
                continue
            value = row[key]
        else:
            if key not in row.index:
                continue
            value = row[key]
        num = _json_safe(value)
        if isinstance(num, (int, float)):
            return float(num)
    return None


def season_week_context(season: int | None, week: int | None) -> tuple[int, int]:
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"])
    return resolve_projection_context(df, season, week)


def _artifact_paths(season: int, week: int) -> tuple[Path, Path]:
    PLAYER_CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"{int(season)}_w{int(week)}"
    return (
        PLAYER_CONTEXT_DIR / f"{stem}.parquet",
        PLAYER_CONTEXT_DIR / f"{stem}.meta.json",
    )


def player_context_fingerprint(
    *,
    injury_snapshot_id: str,
    sentiment_mtime_ns: int | None = None,
) -> str:
    parts = [
        f"schema:{SCHEMA_VERSION}",
        f"weekly:{weekly_fingerprint()}",
        f"injury:{injury_snapshot_id}",
        f"digest_cache:{BEAT_DIGEST_CACHE_VERSION}",
    ]
    if sentiment_mtime_ns is not None:
        parts.append(f"sentiment:{sentiment_mtime_ns}")
    elif SENTIMENT_FEATURES_PATH.exists():
        parts.append(f"sentiment:{SENTIMENT_FEATURES_PATH.stat().st_mtime_ns}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def slugify_player_name(name: str) -> str:
    text = str(name or "").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")


def parse_opportunity_drivers(
    injury_note: str,
    *,
    name_index: dict[str, str] | None = None,
) -> list[str]:
    """Parse ``Injury Note`` into driver ids (gsis/sleeper) or name slugs."""
    note = str(injury_note or "").strip()
    if not note:
        return []
    name_index = name_index or {}
    drivers: list[str] = []
    seen: set[str] = set()
    for segment in note.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        match = _NOTE_SEGMENT_RE.match(segment)
        raw_name = (match.group("name") if match else segment).strip()
        if not raw_name:
            continue
        mapped = name_index.get(raw_name.lower())
        token = mapped or slugify_player_name(raw_name)
        if not token or token in seen:
            continue
        seen.add(token)
        drivers.append(token)
    return drivers


def _media_signal(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    if float(row.get("yt_role_hype_flag") or 0) > 0:
        return "role_up"
    if float(row.get("yt_injury_flag") or 0) > 0:
        return "injury_watch"
    if float(row.get("yt_mention_count") or 0) > 0:
        return "mentioned"
    return None


def _media_source_count(row: dict[str, Any] | None) -> int:
    if not row:
        return 0
    for key in ("narrative_source_count", "yt_channel_count", "yt_mention_count"):
        num = _json_safe(row.get(key))
        if isinstance(num, (int, float)) and num > 0:
            return int(num)
    return 0


def _media_excerpt(row: dict[str, Any] | None) -> str | None:
    """Raw snippet only when it survives the Latest usefulness filter."""
    if not row:
        return None
    for key in ("yt_top_snippet", "top_sentence", "yt_top_sentence", "snippet"):
        text = str(row.get(key) or "").strip()
        if is_useful_sentence(text):
            return text
    return None


def _media_sources(row: dict[str, Any] | None) -> list[dict[str, str]]:
    """Compact source labels from pre-aggregated sentiment features (no network)."""
    if not row:
        return []
    raw = row.get("source_labels") or row.get("channels") or row.get("yt_channels")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    if isinstance(raw, str):
        tokens = [t.strip() for t in raw.split("|") if t.strip()]
    elif isinstance(raw, (list, tuple)):
        tokens = []
        for item in raw:
            if isinstance(item, dict):
                label = str(item.get("label") or item.get("network") or "").strip()
                if label:
                    tokens.append(label)
            else:
                label = str(item or "").strip()
                if label:
                    tokens.append(label)
    else:
        tokens = []
    for label in tokens:
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"label": label})
    return out


def injury_age_hours(
    updated_at: str | None,
    *,
    now: datetime | None = None,
) -> float | None:
    """Hours since injury/availability ``updated_at`` (serve-time badge age)."""
    if not updated_at:
        return None
    try:
        ts = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    age = (clock - ts).total_seconds() / 3600.0
    if age < 0:
        return 0.0
    return round(age, 2)


def attach_inclusion_trust(
    payload: dict[str, Any],
    *,
    artifact_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """SCORE-33: stamp inclusion_trust so UI never falsely claims Included."""
    from src.integrations.injury_poll import compute_inclusion_trust

    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    art = artifact_meta or {}
    opp = (
        payload.get("opportunity_adjustment")
        if isinstance(payload.get("opportunity_adjustment"), dict)
        else {}
    )
    avail = payload.get("availability") if isinstance(payload.get("availability"), dict) else {}
    projection_at = (
        meta.get("artifact_built_at")
        or meta.get("context_built_at")
        or art.get("built_at")
        or art.get("injury_snapshot_built_at")
        or meta.get("injury_snapshot_built_at")
    )
    stale = bool(meta.get("stale") if "stale" in meta else art.get("stale"))
    trust = compute_inclusion_trust(
        opportunity_included=bool(opp.get("included")),
        artifact_stale=stale,
        projection_freshness_at=projection_at,
        injury_status_freshness_at=avail.get("updated_at"),
    )
    payload["inclusion_trust"] = trust
    # Mirror can_label onto opportunity_adjustment for compact consumers.
    payload["opportunity_adjustment"] = {
        **opp,
        "can_label_included": trust["can_label_included"],
        "stale_vs_projection": trust["stale_vs_projection"],
        "safeguard_message": trust["message"],
    }
    return payload


def detail_available_for_payload(payload: dict[str, Any]) -> bool:
    """True when expand would surface narrative, drivers, or injury explanation."""
    media = payload.get("media_context") if isinstance(payload.get("media_context"), dict) else {}
    opp = (
        payload.get("opportunity_adjustment")
        if isinstance(payload.get("opportunity_adjustment"), dict)
        else {}
    )
    avail = payload.get("availability") if isinstance(payload.get("availability"), dict) else {}

    this_week = payload.get("this_week") if isinstance(payload.get("this_week"), dict) else {}
    if this_week.get("detail") or this_week.get("headline") or this_week.get("projection_line"):
        return True
    if media.get("summary") or media.get("excerpt"):
        return True
    if media.get("sources"):
        return True
    if int(media.get("source_count") or 0) > 0 or media.get("signal"):
        return True
    if str(media.get("state") or "") == MEDIA_STATE_HISTORICAL_AVAILABLE:
        return True
    if opp.get("included") or (opp.get("drivers") or []):
        return True
    if avail.get("status") or avail.get("practice") or avail.get("injury_notes"):
        return True
    return False


def compact_player_context(
    payload: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Table/list shape: badge fields only — no excerpts, sources, summaries, drivers."""
    avail = payload.get("availability") if isinstance(payload.get("availability"), dict) else {}
    opp = (
        payload.get("opportunity_adjustment")
        if isinstance(payload.get("opportunity_adjustment"), dict)
        else {}
    )
    media = payload.get("media_context") if isinstance(payload.get("media_context"), dict) else {}
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}

    compact_media: dict[str, Any] = {
        "state": media.get("state") or MEDIA_STATE_NONE,
        "signal": media.get("signal"),
        "source_count": int(media.get("source_count") or 0),
        "affects_projection": bool(media.get("affects_projection")),
    }
    if media.get("mode") is not None:
        compact_media["mode"] = media.get("mode")
    if isinstance(media.get("modes_available"), dict):
        compact_media["modes_available"] = media.get("modes_available")
    # Preserve historical week pointer without narrative bodies.
    if str(media.get("state") or "") == MEDIA_STATE_HISTORICAL_AVAILABLE:
        hist = media.get("historical")
        if isinstance(hist, dict) and hist.get("season") is not None and hist.get("week") is not None:
            compact_media["historical"] = {
                "season": int(hist["season"]),
                "week": int(hist["week"]),
            }

    compact = {
        "player_id": payload.get("player_id"),
        "player_name": payload.get("player_name"),
        "position": payload.get("position"),
        "team": payload.get("team"),
        "availability": {
            "status": avail.get("status"),
            "practice": avail.get("practice"),
            "updated_at": avail.get("updated_at"),
            "age_hours": injury_age_hours(avail.get("updated_at"), now=now),
        },
        "opportunity_adjustment": {
            "points": opp.get("points"),
            "included": bool(opp.get("included")),
        },
        "media_context": compact_media,
        "this_week": {
            "kind": (payload.get("this_week") or {}).get("kind")
            if isinstance(payload.get("this_week"), dict)
            else "none",
            "has_note": bool(
                isinstance(payload.get("this_week"), dict)
                and (
                    payload["this_week"].get("detail")
                    or payload["this_week"].get("headline")
                )
            ),
            "has_delta": bool(
                isinstance(payload.get("this_week"), dict)
                and payload["this_week"].get("projection_line")
            ),
        },
        "detail_available": detail_available_for_payload(payload),
        "meta": {
            "season": meta.get("season"),
            "week": meta.get("week"),
            "stale": bool(meta.get("stale")),
            "fingerprint": meta.get("fingerprint"),
            "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
            "view": "compact",
            "artifact_built_at": meta.get("artifact_built_at") or meta.get("context_built_at"),
            "context_built_at": meta.get("context_built_at"),
            "injury_snapshot_built_at": meta.get("injury_snapshot_built_at"),
        },
    }
    return attach_inclusion_trust(compact, artifact_meta=meta)


def _load_sentiment_features_frame() -> pd.DataFrame:
    if not SENTIMENT_FEATURES_PATH.exists():
        return pd.DataFrame()
    try:
        df = pd.read_parquet(SENTIMENT_FEATURES_PATH)
    except (OSError, ValueError):
        return pd.DataFrame()
    if df.empty or "player_id" not in df.columns:
        return pd.DataFrame()
    return df


def _load_sentiment_index(season: int, week: int) -> dict[str, dict[str, Any]]:
    """Index sentiment feature rows for season/week by player_id (no LLM)."""
    df = _load_sentiment_features_frame()
    if df.empty:
        return {}
    scoped = df
    if "season" in df.columns:
        scoped = scoped[scoped["season"].astype(int) == int(season)]
    if "week" in scoped.columns:
        scoped = scoped[scoped["week"].astype(int) == int(week)]
    if scoped.empty:
        return {}
    index: dict[str, dict[str, Any]] = {}
    for _, row in scoped.iterrows():
        pid = str(row["player_id"])
        index[pid] = {str(k): _json_safe(v) for k, v in row.items()}
    return index


def _narrative_media_from_sentiment(
    pid: str,
    player_name: str,
    season: int,
    week: int,
    sent: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Build a narrative media block from a sentiment row (build-time only)."""
    if not sent:
        return None
    source_count = _media_source_count(sent)
    if source_count <= 0:
        return None
    signal = _media_signal(sent)
    excerpt = _media_excerpt(sent)
    sources = _media_sources(sent)
    media_updated = None
    if sent and SENTIMENT_FEATURES_PATH.exists():
        media_updated = datetime.fromtimestamp(
            SENTIMENT_FEATURES_PATH.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    # Research candidate only — never an extractive / LLM show recap.
    return {
        "state": MEDIA_STATE_CURRENT,
        "signal": signal,
        "source_count": source_count,
        "summary": None,
        "excerpt": excerpt,
        "sources": sources,
        "updated_at": media_updated,
        "historical": None,
        "affects_projection": False,
    }


def _build_media_context_for_player(
    pid: str,
    player_name: str,
    season: int,
    week: int,
    *,
    sentiment_index: dict[str, dict[str, Any]],
    features: pd.DataFrame,
    outlook_index: dict[str, dict[str, Any]] | None = None,
    week1_index: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build default media_context + SCORE-34 media_modes (cached at build time)."""
    sent = sentiment_index.get(pid)
    signal = _media_signal(sent)
    source_count = _media_source_count(sent)
    media_updated = None
    if sent and SENTIMENT_FEATURES_PATH.exists():
        media_updated = datetime.fromtimestamp(
            SENTIMENT_FEATURES_PATH.stat().st_mtime, tz=timezone.utc
        ).isoformat()

    if sent and source_count > 0:
        # This-week story is locker / delta. Do not bake show copy here.
        media_context: dict[str, Any] = {
            "state": MEDIA_STATE_NONE,
            "signal": signal,
            "source_count": source_count,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": media_updated,
            "historical": None,
            "affects_projection": False,
        }
    else:
        hist = find_player_historical_row(features, pid, season=season, week=week)
        if hist is None:
            media_context = empty_media_context(state=MEDIA_STATE_NONE)
        else:
            hist_season, hist_week, hist_row = hist
            hist_dict = {str(k): _json_safe(v) for k, v in hist_row.items()}
            hist_signal = _media_signal(hist_dict)
            hist_count = _media_source_count(hist_dict)
            hist_excerpt = _media_excerpt(hist_dict)
            hist_sources = _media_sources(hist_dict)
            hist_summary = None
            hist_updated = None
            if hist_dict and SENTIMENT_FEATURES_PATH.exists():
                hist_updated = datetime.fromtimestamp(
                    SENTIMENT_FEATURES_PATH.stat().st_mtime, tz=timezone.utc
                ).isoformat()

            # Store historical narrative under nested key for opt-in serve; top-level stays empty.
            media_context = {
                "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
                "signal": None,
                "source_count": 0,
                "summary": None,
                "excerpt": None,
                "sources": [],
                "updated_at": None,
                "historical": {
                    "season": hist_season,
                    "week": hist_week,
                    "signal": hist_signal,
                    "source_count": hist_count,
                    "summary": hist_summary,
                    "excerpt": hist_excerpt,
                    "sources": hist_sources,
                    "updated_at": hist_updated,
                },
                "affects_projection": False,
            }

    outlook = _narrative_media_from_sentiment(
        pid,
        player_name,
        season,
        PRESEASON_OUTLOOK_WEEK,
        (outlook_index or {}).get(pid),
    )
    # Week 1 pulse: prefer dedicated week-1 index, else current slate when week==1.
    week1_sent = (week1_index or {}).get(pid)
    if week1_sent is None and int(week) == 1 and sent and source_count > 0:
        week1_sent = sent
    week1_pulse = _narrative_media_from_sentiment(
        pid, player_name, season, 1, week1_sent
    )

    older: dict[str, Any] | None = None
    if media_context.get("state") == MEDIA_STATE_HISTORICAL_AVAILABLE:
        older = {
            "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": media_context.get("historical"),
            "affects_projection": False,
        }
    elif isinstance(media_context.get("historical"), dict):
        older = {
            "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": media_context.get("historical"),
            "affects_projection": False,
        }

    media_modes = {
        MEDIA_MODE_OUTLOOK: outlook,
        MEDIA_MODE_WEEK1_PULSE: week1_pulse,
        MEDIA_MODE_OLDER: older,
    }
    return media_context, media_modes


def _cached_digest_summary(
    player_id: str,
    player_name: str,
    season: int,
    week: int,
    sentiment_row: dict[str, Any] | None,
) -> tuple[str | None, str | None]:
    """Read prewarmed fantasy digest cache only — never call LLM/extractive."""
    if not sentiment_row:
        return None, None
    try:
        from src.sentiment.fantasy_digest import (
            _cache_get,
            _daily_cache_key,
        )
    except Exception:
        return None, None

    cache_key = _daily_cache_key(
        scope="weekly",
        player_id=player_id,
        player_name=player_name,
        season=season,
        week=week,
    )
    cached = _cache_get("weekly", cache_key)
    if cached:
        return cached, datetime.now(timezone.utc).isoformat()

    # Fallback: materialize extractive summary at *build* time only (caller).
    snippet = str(
        sentiment_row.get("yt_top_snippet")
        or sentiment_row.get("top_sentence")
        or sentiment_row.get("snippet")
        or ""
    ).strip()
    if not snippet and float(sentiment_row.get("yt_mention_count") or 0) <= 0:
        return None, None
    try:
        from src.sentiment.fantasy_digest import extractive_fantasy_digest

        digest = extractive_fantasy_digest(
            player_name,
            scope="weekly",
            snippet=snippet,
            chapter_notes="",
            top_sentence=snippet,
            sentiment_label=str(sentiment_row.get("sentiment_label") or "neutral"),
            injury_flag=float(sentiment_row.get("yt_injury_flag") or 0),
            role_hype_flag=float(sentiment_row.get("yt_role_hype_flag") or 0),
        )
        return digest or None, datetime.now(timezone.utc).isoformat()
    except Exception:
        return (snippet or None), datetime.now(timezone.utc).isoformat()


def _load_weekly_pair(season: int, week: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load inj + no_inj weekly artifacts with allow_compute=False."""
    frames_inj: list[pd.DataFrame] = []
    frames_base: list[pd.DataFrame] = []
    for pos in POSITIONS:
        inj = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=True,
            allow_compute=False,
        )
        base = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=False,
            allow_compute=False,
        )
        if not inj.empty:
            frames_inj.append(inj)
        if not base.empty:
            frames_base.append(base)
    inj_df = pd.concat(frames_inj, ignore_index=True) if frames_inj else pd.DataFrame()
    base_df = pd.concat(frames_base, ignore_index=True) if frames_base else pd.DataFrame()
    return inj_df, base_df


def _row_by_player_id(df: pd.DataFrame) -> dict[str, pd.Series]:
    if df.empty or "player_id" not in df.columns:
        return {}
    out: dict[str, pd.Series] = {}
    for _, row in df.iterrows():
        pid = str(row["player_id"])
        if pid not in out:
            out[pid] = row
    return out


def build_player_context_rows(
    season: int,
    week: int,
    *,
    injury_snapshot: dict[str, Any] | None = None,
    force_injury_refresh: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Join pipeline outputs into per-player context payloads (build path)."""
    if injury_snapshot is None:
        injury_snapshot = build_injury_snapshot(
            season=season,
            week=week,
            force_refresh=force_injury_refresh,
        )
        save_injury_snapshot(injury_snapshot)

    inj_df, base_df = _load_weekly_pair(season, week)
    if inj_df.empty and base_df.empty:
        raise FileNotFoundError(
            f"Weekly prediction artifacts missing for {season} week {week}. "
            "Run weekly/preseason refresh before building player context."
        )

    inj_index = _row_by_player_id(inj_df)
    base_index = _row_by_player_id(base_df)
    player_ids = list(dict.fromkeys([*inj_index.keys(), *base_index.keys()]))

    avail_index = index_availability_by_player_id(injury_snapshot)
    name_index = name_to_player_ids(injury_snapshot)
    # Also index names from weekly rows for driver resolution.
    for pid, row in {**base_index, **inj_index}.items():
        pname = str(row.get("Player") or "").strip().lower()
        if pname and pname not in name_index:
            name_index[pname] = pid

    sentiment_index = _load_sentiment_index(season, week)
    outlook_index = _load_sentiment_index(season, PRESEASON_OUTLOOK_WEEK)
    week1_index = (
        sentiment_index if int(week) == 1 else _load_sentiment_index(season, 1)
    )
    sentiment_features = _load_sentiment_features_frame()
    snapshot_id = str(injury_snapshot["injury_snapshot_id"])
    built_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []

    for pid in player_ids:
        inj_row = inj_index.get(pid)
        base_row = base_index.get(pid)
        primary = inj_row if inj_row is not None else base_row
        assert primary is not None

        final_pts = _pick_num(inj_row, _P50_KEYS) if inj_row is not None else None
        base_pts = _pick_num(base_row, _P50_KEYS) if base_row is not None else None
        if final_pts is None:
            final_pts = base_pts
        if base_pts is None:
            base_pts = final_pts
        injury_delta = None
        if base_pts is not None and final_pts is not None:
            injury_delta = round(float(final_pts) - float(base_pts), 2)

        injury_note = ""
        if inj_row is not None:
            injury_note = str(inj_row.get("Injury Note") or "")
        drivers = parse_opportunity_drivers(injury_note, name_index=name_index)
        included = bool(injury_delta and abs(injury_delta) >= 0.01)

        avail = avail_index.get(pid) or {
            "status": None,
            "practice": None,
            "injury_notes": None,
            "injury_body_part": None,
            "updated_at": None,
        }
        # Prefer projection Injury Status when snapshot has no status.
        if not avail.get("status") and inj_row is not None:
            status = str(inj_row.get("Injury Status") or "").strip() or None
            if status:
                avail = {**avail, "status": status}

        player_name = str(primary.get("Player") or "")
        media_context, media_modes = _build_media_context_for_player(
            pid,
            player_name,
            season,
            week,
            sentiment_index=sentiment_index,
            features=sentiment_features,
            outlook_index=outlook_index,
            week1_index=week1_index,
        )

        payload = {
            "player_id": pid,
            "player_name": player_name or None,
            "position": str(primary.get("Position") or "").upper() or None,
            "team": primary.get("Team"),
            "projection": {
                "base": None if base_pts is None else round(float(base_pts), 2),
                "final": None if final_pts is None else round(float(final_pts), 2),
                "injury_delta": injury_delta,
                "injury_snapshot_id": snapshot_id,
            },
            "availability": {
                "status": avail.get("status"),
                "practice": avail.get("practice"),
                "injury_notes": avail.get("injury_notes"),
                "injury_body_part": avail.get("injury_body_part"),
                "updated_at": avail.get("updated_at"),
            },
            "opportunity_adjustment": {
                "points": injury_delta if included else (0.0 if injury_delta is not None else None),
                "drivers": drivers,
                "included": included,
            },
            "media_context": media_context,
            "media_modes": media_modes,
            "meta": {
                "season": int(season),
                "week": int(week),
                "context_built_at": built_at,
                "schema_version": SCHEMA_VERSION,
            },
        }
        payload["this_week"] = compose_this_week(
            availability=payload["availability"],
            projection=payload["projection"],
            allow_research_snippet=False,
        )
        rows.append(payload)

    meta = {
        "season": int(season),
        "week": int(week),
        "schema_version": SCHEMA_VERSION,
        "injury_snapshot_id": snapshot_id,
        "injury_snapshot_built_at": injury_snapshot.get("built_at"),
        "built_at": built_at,
        "rows": len(rows),
        "fingerprint": player_context_fingerprint(injury_snapshot_id=snapshot_id),
        "weekly_fingerprint": weekly_fingerprint(),
    }
    return rows, meta


def save_player_context_artifact(
    season: int,
    week: int,
    *,
    rows: list[dict[str, Any]] | None = None,
    meta: dict[str, Any] | None = None,
    force_injury_refresh: bool = False,
) -> Path:
    """Persist player-context parquet + meta sidecar; refresh in-process cache."""
    if rows is None or meta is None:
        rows, meta = build_player_context_rows(
            season,
            week,
            force_injury_refresh=force_injury_refresh,
        )
    parquet_path, meta_path = _artifact_paths(season, week)
    frame = pd.DataFrame(
        {
            "player_id": [r["player_id"] for r in rows],
            "player_name": [r.get("player_name") for r in rows],
            "position": [r.get("position") for r in rows],
            "team": [r.get("team") for r in rows],
            "payload_json": [json.dumps(r, default=str) for r in rows],
        }
    )
    frame.to_parquet(parquet_path, index=False)
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    fp = str(meta["fingerprint"])
    _CONTEXT_CACHE[f"{season}:w{week}"] = (fp, frame, meta)
    return parquet_path


def prewarm_player_context(
    season: int,
    week: int,
    *,
    force_injury_refresh: bool = False,
) -> dict[str, Any]:
    """Job helper: build + save player-context artifact."""
    path = save_player_context_artifact(
        season,
        week,
        force_injury_refresh=force_injury_refresh,
    )
    meta_path = _artifact_paths(season, week)[1]
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return {
        "status": "ok",
        "path": str(path),
        "rows": meta.get("rows"),
        "fingerprint": meta.get("fingerprint"),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "built_at": meta.get("built_at"),
    }


def invalidate_player_context_cache() -> None:
    _CONTEXT_CACHE.clear()


def load_player_context_frame(
    season: int,
    week: int,
    *,
    require_fresh: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Serve-only load of player-context artifact (no compute / no network)."""
    key = f"{int(season)}:w{int(week)}"
    parquet_path, meta_path = _artifact_paths(season, week)
    if not parquet_path.exists() or not meta_path.exists():
        raise FileNotFoundError(
            f"Player context artifact missing for {season} week {week}. "
            "Run player-context prewarm / weekly refresh."
        )
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise FileNotFoundError(
            f"Player context meta unreadable for {season} week {week}"
        ) from exc

    expected_fp = player_context_fingerprint(
        injury_snapshot_id=str(meta.get("injury_snapshot_id") or ""),
    )
    cached = _CONTEXT_CACHE.get(key)
    if cached is not None and cached[0] == meta.get("fingerprint"):
        return cached[1].copy(), dict(cached[2])

    if require_fresh and meta.get("fingerprint") != expected_fp:
        # Stale relative to current weekly/sentiment inputs — still serve with
        # staleness flag rather than recomputing on the request path.
        meta = {**meta, "stale": True, "expected_fingerprint": expected_fp}
    else:
        meta = {**meta, "stale": False}

    df = pd.read_parquet(parquet_path)
    _CONTEXT_CACHE[key] = (str(meta.get("fingerprint") or ""), df.copy(), meta)
    return df, meta


def _payloads_from_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if df.empty or "payload_json" not in df.columns:
        return out
    for raw in df["payload_json"].tolist():
        try:
            out.append(json.loads(raw))
        except (TypeError, json.JSONDecodeError):
            continue
    return out


def _synthesize_media_modes_from_legacy(
    payload: dict[str, Any],
) -> dict[str, Any]:
    """v3 artifacts lack media_modes — derive best-effort buckets from media_context."""
    media = payload.get("media_context") if isinstance(payload.get("media_context"), dict) else {}
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    modes: dict[str, Any] = {
        MEDIA_MODE_OUTLOOK: None,
        MEDIA_MODE_WEEK1_PULSE: None,
        MEDIA_MODE_OLDER: None,
    }
    if media.get("state") == MEDIA_STATE_CURRENT and (
        media.get("summary")
        or media.get("excerpt")
        or media.get("sources")
        or int(media.get("source_count") or 0) > 0
        or media.get("signal")
    ):
        if int(meta.get("week") or 0) == 1:
            modes[MEDIA_MODE_WEEK1_PULSE] = {
                "state": MEDIA_STATE_CURRENT,
                "signal": media.get("signal"),
                "source_count": int(media.get("source_count") or 0),
                "summary": media.get("summary"),
                "excerpt": media.get("excerpt"),
                "sources": list(media.get("sources") or []),
                "updated_at": media.get("updated_at"),
                "historical": None,
                "affects_projection": False,
            }
    if media.get("state") == MEDIA_STATE_HISTORICAL_AVAILABLE or isinstance(
        media.get("historical"), dict
    ):
        modes[MEDIA_MODE_OLDER] = {
            "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": media.get("historical"),
            "affects_projection": False,
        }
    return modes


def _finalize_media_context(
    payload: dict[str, Any],
    *,
    include_historical: bool,
    media_mode: str | None = None,
) -> dict[str, Any]:
    """Serve-path: select SCORE-34 mode or SCORE-28 historical opt-in."""
    modes = payload.get("media_modes") if isinstance(payload.get("media_modes"), dict) else None
    if modes is None:
        modes = _synthesize_media_modes_from_legacy(payload)
    selected = select_media_context_for_mode(
        media_context=payload.get("media_context")
        if isinstance(payload.get("media_context"), dict)
        else None,
        media_modes=modes,
        media_mode=media_mode,
        include_historical=include_historical,
    )
    payload["media_context"] = selected
    # Drop bulky mode bodies from the response; flags live on media_context.
    payload.pop("media_modes", None)
    return payload


def get_player_context(
    player_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
    include_historical: bool = False,
    media_mode: str | None = None,
) -> dict[str, Any]:
    """Serve a single player's full cached context payload (lazy-load detail)."""
    pid = str(player_id or "").strip()
    if not pid:
        raise ValueError("player_id is required")
    mode = normalize_media_mode(media_mode, include_historical=include_historical)
    resolved_season, resolved_week = season_week_context(season, week)
    df, meta = load_player_context_frame(resolved_season, resolved_week)
    if "player_id" not in df.columns:
        raise FileNotFoundError("Player context artifact has no player_id column")
    hit = df[df["player_id"].astype(str) == pid]
    if hit.empty:
        raise ValueError(f"No player context for player_id={pid}")
    payload = json.loads(str(hit.iloc[0]["payload_json"]))
    payload = _finalize_media_context(
        payload,
        include_historical=include_historical,
        media_mode=mode,
    )
    payload = attach_this_week(payload, media_mode=mode)
    # Ensure detail keys exist even on older v2 artifacts.
    media = payload.get("media_context")
    if isinstance(media, dict):
        media.setdefault("excerpt", None)
        media.setdefault("sources", [])
        payload["media_context"] = media
    payload["detail_available"] = detail_available_for_payload(payload)
    payload["meta"] = {
        **(payload.get("meta") or {}),
        "season": resolved_season,
        "week": resolved_week,
        "artifact_built_at": meta.get("built_at"),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "injury_snapshot_built_at": meta.get("injury_snapshot_built_at"),
        "fingerprint": meta.get("fingerprint"),
        "stale": bool(meta.get("stale")),
        "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
        "include_historical": bool(include_historical) or mode == MEDIA_MODE_OLDER,
        "media_mode": mode,
        "view": "detail",
    }
    # Serve-time injury badge age for detail consumers.
    avail = payload.get("availability")
    if isinstance(avail, dict):
        avail = {
            **avail,
            "age_hours": injury_age_hours(avail.get("updated_at")),
        }
        payload["availability"] = avail
    return attach_inclusion_trust(payload, artifact_meta=meta)


def list_player_context(
    *,
    season: int | None = None,
    week: int | None = None,
    player_ids: list[str] | None = None,
    include_historical: bool = False,
    media_mode: str | None = None,
    compact: bool = True,
) -> dict[str, Any]:
    """Serve player-context list for a slate.

    Default ``compact=True`` (SCORE-30) omits heavy narrative bodies so weekly
    tables stay small; open a player via ``get_player_context`` for detail.
    """
    mode = normalize_media_mode(media_mode, include_historical=include_historical)
    resolved_season, resolved_week = season_week_context(season, week)
    df, meta = load_player_context_frame(resolved_season, resolved_week)
    players = _payloads_from_frame(df)
    if player_ids:
        wanted = {str(p).strip() for p in player_ids if str(p).strip()}
        players = [p for p in players if str(p.get("player_id")) in wanted]
    players = [
        attach_this_week(
            _finalize_media_context(
                p,
                include_historical=include_historical,
                media_mode=mode,
            ),
            media_mode=mode,
        )
        for p in players
    ]
    list_meta = {
        "season": resolved_season,
        "week": resolved_week,
        "built_at": meta.get("built_at"),
        "injury_snapshot_built_at": meta.get("injury_snapshot_built_at"),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "fingerprint": meta.get("fingerprint"),
        "stale": bool(meta.get("stale")),
        "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
        "rows": meta.get("rows"),
        "include_historical": bool(include_historical) or mode == MEDIA_MODE_OLDER,
        "media_mode": mode,
        "compact": bool(compact),
        "view": "compact" if compact else "detail",
    }
    if compact:
        stamped: list[dict[str, Any]] = []
        for player in players:
            player_meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
            player["meta"] = {
                **player_meta,
                "stale": bool(meta.get("stale")),
                "artifact_built_at": meta.get("built_at"),
                "injury_snapshot_built_at": meta.get("injury_snapshot_built_at"),
            }
            stamped.append(compact_player_context(player))
        players = stamped
    else:
        enriched: list[dict[str, Any]] = []
        for player in players:
            media = player.get("media_context")
            if isinstance(media, dict):
                media.setdefault("excerpt", None)
                media.setdefault("sources", [])
                player["media_context"] = media
            avail = player.get("availability")
            if isinstance(avail, dict):
                player["availability"] = {
                    **avail,
                    "age_hours": injury_age_hours(avail.get("updated_at")),
                }
            player["detail_available"] = detail_available_for_payload(player)
            player_meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
            player["meta"] = {
                **player_meta,
                "view": "detail",
                "stale": bool(meta.get("stale")),
                "artifact_built_at": meta.get("built_at"),
                "injury_snapshot_built_at": meta.get("injury_snapshot_built_at"),
            }
            enriched.append(attach_inclusion_trust(player, artifact_meta=meta))
        players = enriched
    return {
        "count": len(players),
        "players": players,
        "meta": list_meta,
    }
