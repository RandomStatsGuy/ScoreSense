"""SCORE-28 media coverage states — no silent historical fallback.

Default response states:

* ``current`` — coverage exists for the requested season/week
* ``historical_available`` — no current coverage, but older coverage exists
* ``none`` — no usable coverage

Historical text must never be presented as current-week narrative. Callers that
want older commentary must pass ``include_historical=True`` (explicit opt-in).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

MEDIA_STATE_CURRENT = "current"
MEDIA_STATE_HISTORICAL_AVAILABLE = "historical_available"
MEDIA_STATE_NONE = "none"
MEDIA_STATES = (
    MEDIA_STATE_CURRENT,
    MEDIA_STATE_HISTORICAL_AVAILABLE,
    MEDIA_STATE_NONE,
)


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


def empty_media_context(
    *,
    state: str = MEDIA_STATE_NONE,
    historical_season: int | None = None,
    historical_week: int | None = None,
) -> dict[str, Any]:
    historical = None
    if historical_season is not None and historical_week is not None:
        historical = {"season": int(historical_season), "week": int(historical_week)}
    return {
        "state": state if state in MEDIA_STATES else MEDIA_STATE_NONE,
        "signal": None,
        "source_count": 0,
        "summary": None,
        "updated_at": None,
        "historical": historical,
        "affects_projection": False,
    }


def media_context_block(
    resolution: MediaWeekResolution,
    *,
    signal: str | None = None,
    source_count: int = 0,
    summary: str | None = None,
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

    if resolution.state == MEDIA_STATE_CURRENT:
        return {
            "state": MEDIA_STATE_CURRENT,
            "signal": signal,
            "source_count": int(source_count or 0),
            "summary": summary,
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
