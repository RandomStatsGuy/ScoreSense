"""SCORE-28 media coverage states + SCORE-34 preseason media modes.

Default response states:

* ``current`` — coverage exists for the requested season/week
* ``historical_available`` — no current coverage, but older coverage exists
* ``none`` — no usable coverage

Historical text must never be presented as current-week narrative. Callers that
want older commentary must pass ``include_historical=True`` (explicit opt-in)
or ``media_mode=older``.

SCORE-34 preseason modes (cheap, cached; never per-request LLM/YouTube):

* ``outlook`` — recent preseason commentary (publication lookback, week=0 bucket)
* ``week1_pulse`` — content mapped to Week 1 schedule windows
* ``older`` — explicit opt-in historical commentary (never auto-shown as current)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

import pandas as pd

MEDIA_STATE_CURRENT = "current"
MEDIA_STATE_HISTORICAL_AVAILABLE = "historical_available"
MEDIA_STATE_NONE = "none"
MEDIA_STATES = (
    MEDIA_STATE_CURRENT,
    MEDIA_STATE_HISTORICAL_AVAILABLE,
    MEDIA_STATE_NONE,
)

# SCORE-34 — explicit preseason / media mode selectors
MEDIA_MODE_OUTLOOK = "outlook"
MEDIA_MODE_WEEK1_PULSE = "week1_pulse"
MEDIA_MODE_OLDER = "older"
MEDIA_MODES = (
    MEDIA_MODE_OUTLOOK,
    MEDIA_MODE_WEEK1_PULSE,
    MEDIA_MODE_OLDER,
)

# Synthetic week bucket for outlook features (not a real NFL week).
PRESEASON_OUTLOOK_WEEK = 0
# Publication lookback for outlook (ticket: last 14–30 days). Default 30.
PRESEASON_OUTLOOK_LOOKBACK_DAYS = 30
PRESEASON_OUTLOOK_MIN_LOOKBACK_DAYS = 14

PublishBucket = Literal["outlook", "week1", "in_season", "older", "drop"]


@dataclass(frozen=True)
class MediaWeekResolution:
    """Resolved slate for media/narrative payloads."""

    serve_season: int
    serve_week: int
    requested_season: int
    requested_week: int
    state: str
    historical_season: int | None = None
    historical_week: int | None = None
    include_historical: bool = False
    media_mode: str | None = None

    @property
    def serving_historical(self) -> bool:
        return (
            self.state == MEDIA_STATE_HISTORICAL_AVAILABLE
            and self.include_historical
            and self.historical_season is not None
            and self.historical_week is not None
        )

    @property
    def context_fallback(self) -> bool:
        """Legacy flag: true only when opted-in historical content is served."""
        return self.serving_historical


def normalize_media_mode(
    media_mode: str | None,
    *,
    include_historical: bool = False,
) -> str | None:
    """Normalize API media_mode; ``include_historical`` aliases to ``older``."""
    raw = str(media_mode or "").strip().lower()
    if raw in MEDIA_MODES:
        return raw
    if include_historical:
        return MEDIA_MODE_OLDER
    return None


def modes_available_flags(
    *,
    has_outlook: bool = False,
    has_week1_pulse: bool = False,
    has_older: bool = False,
) -> dict[str, bool]:
    return {
        MEDIA_MODE_OUTLOOK: bool(has_outlook),
        MEDIA_MODE_WEEK1_PULSE: bool(has_week1_pulse),
        MEDIA_MODE_OLDER: bool(has_older),
    }


def media_context_has_narrative(media_context: dict[str, Any] | None) -> bool:
    if not media_context:
        return False
    if media_context.get("summary") or media_context.get("excerpt"):
        return True
    if media_context.get("sources"):
        return True
    if int(media_context.get("source_count") or 0) > 0:
        return True
    if media_context.get("signal"):
        return True
    return False


def annotate_media_mode(
    media_context: dict[str, Any] | None,
    *,
    mode: str | None,
    modes_available: dict[str, bool] | None = None,
) -> dict[str, Any]:
    """Attach mode metadata without changing narrative fields."""
    base = dict(media_context or empty_media_context())
    base["mode"] = mode if mode in MEDIA_MODES else None
    if modes_available is not None:
        base["modes_available"] = {
            MEDIA_MODE_OUTLOOK: bool(modes_available.get(MEDIA_MODE_OUTLOOK)),
            MEDIA_MODE_WEEK1_PULSE: bool(modes_available.get(MEDIA_MODE_WEEK1_PULSE)),
            MEDIA_MODE_OLDER: bool(modes_available.get(MEDIA_MODE_OLDER)),
        }
    return base


def classify_publish_bucket(
    published_at: Any,
    season: int,
    *,
    mapped_week: int | None = None,
    now: datetime | None = None,
    outlook_lookback_days: int = PRESEASON_OUTLOOK_LOOKBACK_DAYS,
) -> PublishBucket:
    """Classify a video for preseason mode bucketing by publication date.

    * Week 1 schedule mapping → ``week1``
    * Other in-season weeks → ``in_season``
    * Unmapped + within outlook lookback → ``outlook``
    * Unmapped + older than lookback → ``older`` (not auto-shown)
    * Unusable timestamp → ``drop``
    """
    if mapped_week is not None:
        week = int(mapped_week)
        if week == 1:
            return "week1"
        if week > 1:
            return "in_season"
        if week == PRESEASON_OUTLOOK_WEEK:
            return "outlook"

    if published_at is None or (isinstance(published_at, float) and pd.isna(published_at)):
        return "drop"
    try:
        ts = pd.Timestamp(published_at)
    except (TypeError, ValueError):
        return "drop"
    if pd.isna(ts):
        return "drop"
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")

    now_ts = pd.Timestamp(now or datetime.now(timezone.utc))
    if now_ts.tzinfo is None:
        now_ts = now_ts.tz_localize("UTC")
    else:
        now_ts = now_ts.tz_convert("UTC")

    if ts > now_ts:
        return "drop"

    lookback = max(int(outlook_lookback_days), int(PRESEASON_OUTLOOK_MIN_LOOKBACK_DAYS))
    cutoff = now_ts - pd.Timedelta(days=lookback)
    if ts >= cutoff:
        return "outlook"
    return "older"


def resolve_publish_week_for_features(
    published_at: Any,
    season: int,
    *,
    mapped_week: int | None,
    now: datetime | None = None,
    outlook_lookback_days: int = PRESEASON_OUTLOOK_LOOKBACK_DAYS,
) -> int | None:
    """Map a publish time to a feature week, including synthetic outlook week=0."""
    bucket = classify_publish_bucket(
        published_at,
        season,
        mapped_week=mapped_week,
        now=now,
        outlook_lookback_days=outlook_lookback_days,
    )
    if bucket == "week1":
        return 1
    if bucket == "in_season" and mapped_week is not None:
        return int(mapped_week)
    if bucket == "outlook":
        return PRESEASON_OUTLOOK_WEEK
    return None


def empty_media_context(
    *,
    state: str = MEDIA_STATE_NONE,
    historical_season: int | None = None,
    historical_week: int | None = None,
    mode: str | None = None,
    modes_available: dict[str, bool] | None = None,
) -> dict[str, Any]:
    historical = None
    if historical_season is not None and historical_week is not None:
        historical = {"season": int(historical_season), "week": int(historical_week)}
    out: dict[str, Any] = {
        "state": state if state in MEDIA_STATES else MEDIA_STATE_NONE,
        "signal": None,
        "source_count": 0,
        "summary": None,
        "excerpt": None,
        "sources": [],
        "updated_at": None,
        "historical": historical,
        "affects_projection": False,
        "mode": mode if mode in MEDIA_MODES else None,
    }
    if modes_available is not None:
        out["modes_available"] = modes_available_flags(
            has_outlook=bool(modes_available.get(MEDIA_MODE_OUTLOOK)),
            has_week1_pulse=bool(modes_available.get(MEDIA_MODE_WEEK1_PULSE)),
            has_older=bool(modes_available.get(MEDIA_MODE_OLDER)),
        )
    return out


def media_context_block(
    resolution: MediaWeekResolution,
    *,
    signal: str | None = None,
    source_count: int = 0,
    summary: str | None = None,
    excerpt: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    updated_at: str | None = None,
) -> dict[str, Any]:
    """Build a media_context object that never mislabels historical as current."""
    historical = None
    if (
        resolution.historical_season is not None
        and resolution.historical_week is not None
    ):
        historical = {
            "season": int(resolution.historical_season),
            "week": int(resolution.historical_week),
        }
    source_list = list(sources or [])

    if resolution.state == MEDIA_STATE_CURRENT:
        return {
            "state": MEDIA_STATE_CURRENT,
            "signal": signal,
            "source_count": int(source_count or 0),
            "summary": summary,
            "excerpt": excerpt,
            "sources": source_list,
            "updated_at": updated_at,
            "historical": None,
            "affects_projection": False,
        }

    if resolution.state == MEDIA_STATE_HISTORICAL_AVAILABLE:
        if resolution.include_historical:
            return {
                "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
                "signal": signal,
                "source_count": int(source_count or 0),
                "summary": summary,
                "excerpt": excerpt,
                "sources": source_list,
                "updated_at": updated_at,
                "historical": historical,
                "affects_projection": False,
            }
        return empty_media_context(
            state=MEDIA_STATE_HISTORICAL_AVAILABLE,
            historical_season=resolution.historical_season,
            historical_week=resolution.historical_week,
        )

    return empty_media_context(state=MEDIA_STATE_NONE)


def strip_historical_content(media_context: dict[str, Any] | None) -> dict[str, Any]:
    """Serve-path helper: drop historical narrative unless already opted in."""
    if not media_context:
        return empty_media_context()
    state = str(media_context.get("state") or MEDIA_STATE_NONE)
    historical = media_context.get("historical")
    hist_season = None
    hist_week = None
    if isinstance(historical, dict):
        if historical.get("season") is not None and historical.get("week") is not None:
            hist_season = int(historical["season"])
            hist_week = int(historical["week"])
    if state == MEDIA_STATE_CURRENT:
        return {
            "state": MEDIA_STATE_CURRENT,
            "signal": media_context.get("signal"),
            "source_count": int(media_context.get("source_count") or 0),
            "summary": media_context.get("summary"),
            "excerpt": media_context.get("excerpt"),
            "sources": list(media_context.get("sources") or []),
            "updated_at": media_context.get("updated_at"),
            "historical": None,
            "affects_projection": False,
        }
    if state == MEDIA_STATE_HISTORICAL_AVAILABLE:
        return empty_media_context(
            state=MEDIA_STATE_HISTORICAL_AVAILABLE,
            historical_season=hist_season,
            historical_week=hist_week,
        )
    return empty_media_context(state=MEDIA_STATE_NONE)


def apply_historical_opt_in(media_context: dict[str, Any] | None) -> dict[str, Any]:
    """Promote stored historical narrative while keeping state historical_available."""
    if not media_context:
        return empty_media_context()
    state = str(media_context.get("state") or MEDIA_STATE_NONE)
    if state != MEDIA_STATE_HISTORICAL_AVAILABLE:
        return dict(media_context)
    historical = media_context.get("historical")
    if not isinstance(historical, dict):
        return strip_historical_content(media_context)
    return {
        "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
        "signal": historical.get("signal"),
        "source_count": int(historical.get("source_count") or 0),
        "summary": historical.get("summary"),
        "excerpt": historical.get("excerpt"),
        "sources": list(historical.get("sources") or []),
        "updated_at": historical.get("updated_at"),
        "historical": {
            "season": int(historical["season"]),
            "week": int(historical["week"]),
        }
        if historical.get("season") is not None and historical.get("week") is not None
        else None,
        "affects_projection": False,
    }


def latest_week_with_rows(
    features: pd.DataFrame,
    *,
    has_coverage: Callable[[pd.DataFrame], pd.Series],
    position_filter: Callable[[pd.DataFrame], pd.DataFrame] | None = None,
) -> tuple[int, int] | None:
    """Return the latest (season, week) that has coverage rows."""
    if features is None or features.empty:
        return None
    scoped = position_filter(features) if position_filter is not None else features
    if scoped.empty:
        return None
    # Exclude synthetic outlook week from in-season historical resolution.
    if "week" in scoped.columns:
        scoped = scoped[scoped["week"].astype(int) != PRESEASON_OUTLOOK_WEEK]
    if scoped.empty:
        return None
    mask = has_coverage(scoped)
    covered = scoped[mask]
    if covered.empty:
        return None
    latest = covered.sort_values(["season", "week"]).iloc[-1]
    return int(latest["season"]), int(latest["week"])


def resolve_media_week(
    features: pd.DataFrame,
    *,
    season: int,
    week: int,
    has_coverage: Callable[[pd.DataFrame], pd.Series],
    position_filter: Callable[[pd.DataFrame], pd.DataFrame] | None = None,
    include_historical: bool = False,
    allow_cross_season: bool = True,
) -> MediaWeekResolution:
    """Resolve which slate to serve without silent historical injection.

    When the requested slate has no coverage, the default response stays on the
    requested season/week with ``state=historical_available`` (or ``none``).
    Opt-in via ``include_historical`` is required to serve older rows.
    """
    requested_season, requested_week = int(season), int(week)
    if features is None or features.empty or "season" not in features.columns:
        return MediaWeekResolution(
            serve_season=requested_season,
            serve_week=requested_week,
            requested_season=requested_season,
            requested_week=requested_week,
            state=MEDIA_STATE_NONE,
            include_historical=bool(include_historical),
        )

    scoped = position_filter(features) if position_filter is not None else features
    # Outlook (week=0) is a separate mode — never treat it as current/historical week.
    if "week" in scoped.columns and requested_week != PRESEASON_OUTLOOK_WEEK:
        scoped = scoped[scoped["week"].astype(int) != PRESEASON_OUTLOOK_WEEK]
    current = scoped[
        (scoped["season"].astype(int) == requested_season)
        & (scoped["week"].astype(int) == requested_week)
    ]
    if not current.empty and bool(has_coverage(current).any()):
        return MediaWeekResolution(
            serve_season=requested_season,
            serve_week=requested_week,
            requested_season=requested_season,
            requested_week=requested_week,
            state=MEDIA_STATE_CURRENT,
            include_historical=bool(include_historical),
        )

    # Prefer same-season prior weeks, then optional cross-season latest.
    season_scoped = scoped[scoped["season"].astype(int) == requested_season]
    season_covered = season_scoped[has_coverage(season_scoped)] if not season_scoped.empty else season_scoped
    hist: tuple[int, int] | None = None
    if not season_covered.empty:
        latest_row = season_covered.sort_values("week").iloc[-1]
        hist = (requested_season, int(latest_row["week"]))
        if hist[1] == requested_week:
            hist = None

    if hist is None and allow_cross_season:
        max_season = int(features["season"].max())
        if requested_season <= max_season + 1:
            hist = latest_week_with_rows(
                features,
                has_coverage=has_coverage,
                position_filter=position_filter,
            )
            if hist is not None and hist == (requested_season, requested_week):
                hist = None

    if hist is None:
        return MediaWeekResolution(
            serve_season=requested_season,
            serve_week=requested_week,
            requested_season=requested_season,
            requested_week=requested_week,
            state=MEDIA_STATE_NONE,
            include_historical=bool(include_historical),
        )

    hist_season, hist_week = hist
    if include_historical:
        return MediaWeekResolution(
            serve_season=hist_season,
            serve_week=hist_week,
            requested_season=requested_season,
            requested_week=requested_week,
            state=MEDIA_STATE_HISTORICAL_AVAILABLE,
            historical_season=hist_season,
            historical_week=hist_week,
            include_historical=True,
        )

    return MediaWeekResolution(
        serve_season=requested_season,
        serve_week=requested_week,
        requested_season=requested_season,
        requested_week=requested_week,
        state=MEDIA_STATE_HISTORICAL_AVAILABLE,
        historical_season=hist_season,
        historical_week=hist_week,
        include_historical=False,
    )


def find_player_historical_row(
    features: pd.DataFrame,
    player_id: str,
    *,
    season: int,
    week: int,
    has_coverage: Callable[[pd.Series], bool] | None = None,
) -> tuple[int, int, pd.Series] | None:
    """Latest coverage row for a player that is not the requested slate."""
    if features is None or features.empty or "player_id" not in features.columns:
        return None
    pid = str(player_id)
    scoped = features[features["player_id"].astype(str) == pid]
    if scoped.empty:
        return None

    # Exclude synthetic outlook week from "older" historical candidates.
    scoped = scoped[scoped["week"].astype(int) != PRESEASON_OUTLOOK_WEEK]
    if scoped.empty:
        return None

    def _covered(row: pd.Series) -> bool:
        if has_coverage is not None:
            return bool(has_coverage(row))
        return float(row.get("yt_mention_count") or 0) > 0

    exact = scoped[
        (scoped["season"].astype(int) == int(season))
        & (scoped["week"].astype(int) == int(week))
    ]
    if not exact.empty and _covered(exact.iloc[0]):
        return None

    prior = scoped[
        (scoped["season"].astype(int) < int(season))
        | (
            (scoped["season"].astype(int) == int(season))
            & (scoped["week"].astype(int) < int(week))
        )
    ]
    # Also allow any other non-exact coverage (e.g. only later weeks exist).
    candidates = prior if not prior.empty else scoped[
        ~(
            (scoped["season"].astype(int) == int(season))
            & (scoped["week"].astype(int) == int(week))
        )
    ]
    if candidates.empty:
        return None
    covered_rows = [row for _, row in candidates.iterrows() if _covered(row)]
    if not covered_rows:
        return None
    covered_rows.sort(key=lambda r: (int(r["season"]), int(r["week"])))
    row = covered_rows[-1]
    return int(row["season"]), int(row["week"]), row


def _mode_payload_has_content(payload: dict[str, Any] | None) -> bool:
    if not payload:
        return False
    if media_context_has_narrative(payload):
        return True
    historical = payload.get("historical")
    if isinstance(historical, dict) and (
        historical.get("summary")
        or historical.get("excerpt")
        or historical.get("sources")
        or int(historical.get("source_count") or 0) > 0
        or historical.get("signal")
    ):
        return True
    if (
        payload.get("state") == MEDIA_STATE_HISTORICAL_AVAILABLE
        and isinstance(historical, dict)
        and historical.get("season") is not None
        and historical.get("week") is not None
    ):
        return True
    return False


def build_media_modes_available(media_modes: dict[str, Any] | None) -> dict[str, bool]:
    modes = media_modes if isinstance(media_modes, dict) else {}
    return modes_available_flags(
        has_outlook=_mode_payload_has_content(modes.get(MEDIA_MODE_OUTLOOK)),
        has_week1_pulse=_mode_payload_has_content(modes.get(MEDIA_MODE_WEEK1_PULSE)),
        has_older=_mode_payload_has_content(modes.get(MEDIA_MODE_OLDER)),
    )


def select_media_context_for_mode(
    *,
    media_context: dict[str, Any] | None,
    media_modes: dict[str, Any] | None,
    media_mode: str | None,
    include_historical: bool = False,
) -> dict[str, Any]:
    """Serve-path selector for SCORE-34 modes (artifact-only; no live fetches).

    Default (no mode): SCORE-28 behavior — strip historical unless opted in.
    ``older`` / ``include_historical``: promote historical narrative, never label
    it as current-week coverage.
    ``outlook`` / ``week1_pulse``: serve the matching cached mode bucket.
    """
    mode = normalize_media_mode(media_mode, include_historical=include_historical)
    modes = media_modes if isinstance(media_modes, dict) else {}
    available = build_media_modes_available(modes)

    if mode == MEDIA_MODE_OUTLOOK:
        outlook = modes.get(MEDIA_MODE_OUTLOOK)
        if isinstance(outlook, dict) and media_context_has_narrative(outlook):
            return annotate_media_mode(
                {
                    "state": MEDIA_STATE_CURRENT,
                    "signal": outlook.get("signal"),
                    "source_count": int(outlook.get("source_count") or 0),
                    "summary": outlook.get("summary"),
                    "excerpt": outlook.get("excerpt"),
                    "sources": list(outlook.get("sources") or []),
                    "updated_at": outlook.get("updated_at"),
                    "historical": None,
                    "affects_projection": False,
                },
                mode=MEDIA_MODE_OUTLOOK,
                modes_available=available,
            )
        return annotate_media_mode(
            empty_media_context(state=MEDIA_STATE_NONE),
            mode=MEDIA_MODE_OUTLOOK,
            modes_available=available,
        )

    if mode == MEDIA_MODE_WEEK1_PULSE:
        pulse = modes.get(MEDIA_MODE_WEEK1_PULSE)
        if isinstance(pulse, dict) and media_context_has_narrative(pulse):
            return annotate_media_mode(
                {
                    "state": MEDIA_STATE_CURRENT,
                    "signal": pulse.get("signal"),
                    "source_count": int(pulse.get("source_count") or 0),
                    "summary": pulse.get("summary"),
                    "excerpt": pulse.get("excerpt"),
                    "sources": list(pulse.get("sources") or []),
                    "updated_at": pulse.get("updated_at"),
                    "historical": None,
                    "affects_projection": False,
                },
                mode=MEDIA_MODE_WEEK1_PULSE,
                modes_available=available,
            )
        return annotate_media_mode(
            empty_media_context(state=MEDIA_STATE_NONE),
            mode=MEDIA_MODE_WEEK1_PULSE,
            modes_available=available,
        )

    if mode == MEDIA_MODE_OLDER:
        older = modes.get(MEDIA_MODE_OLDER)
        if isinstance(older, dict):
            if isinstance(older.get("historical"), dict) and (
                older["historical"].get("summary")
                or older["historical"].get("excerpt")
                or older["historical"].get("sources")
                or int(older["historical"].get("source_count") or 0) > 0
            ):
                promoted = apply_historical_opt_in(older)
            elif media_context_has_narrative(older):
                promoted = {
                    "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
                    "signal": older.get("signal"),
                    "source_count": int(older.get("source_count") or 0),
                    "summary": older.get("summary"),
                    "excerpt": older.get("excerpt"),
                    "sources": list(older.get("sources") or []),
                    "updated_at": older.get("updated_at"),
                    "historical": older.get("historical")
                    if isinstance(older.get("historical"), dict)
                    else None,
                    "affects_projection": False,
                }
            else:
                promoted = apply_historical_opt_in(media_context)
        else:
            promoted = apply_historical_opt_in(media_context)
        return annotate_media_mode(
            promoted,
            mode=MEDIA_MODE_OLDER,
            modes_available=available,
        )

    # Default SCORE-28 path.
    if include_historical:
        selected = apply_historical_opt_in(media_context)
    else:
        selected = strip_historical_content(media_context)
        raw_hist = (media_context or {}).get("historical") if isinstance(media_context, dict) else None
        if (
            selected.get("state") == MEDIA_STATE_HISTORICAL_AVAILABLE
            and isinstance(raw_hist, dict)
            and raw_hist.get("season") is not None
            and raw_hist.get("week") is not None
        ):
            selected["historical"] = {
                "season": int(raw_hist["season"]),
                "week": int(raw_hist["week"]),
            }
    return annotate_media_mode(selected, mode=None, modes_available=available)
