"""League player-acquisition windows: draft, post-draft FA, waivers, free agency, offseason.

Players-tab adds are not a year-round commissioner shortcut. The window decides
whether managers bid (same FAAB-style process after the draft and during
waivers), add immediately (in-season after waivers), or keep rosters locked.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from src.integrations.sleeper import get_nfl_state

PHASE_PRE_DRAFT = "pre_draft"
PHASE_LIVE_DRAFT = "live_draft"
PHASE_IN_SEASON = "in_season"
PHASE_OFFSEASON = "offseason"

ET = ZoneInfo("America/New_York")

WINDOW_SOLO = "solo"
WINDOW_PRE_DRAFT = "pre_draft"
WINDOW_LIVE_DRAFT = "live_draft"
WINDOW_POST_DRAFT_FA = "post_draft_fa"
WINDOW_WAIVERS = "waivers"
WINDOW_FREE_AGENCY = "free_agency"
WINDOW_OFFSEASON = "offseason"

ADD_LOCKED = "locked"
ADD_BID = "bid"
ADD_INSTANT = "add"

TRADE_SURVIVING = "surviving_contracts"
TRADE_ACTIVE = "active"
TRADE_MID_DRAFT = "mid_draft"

# Sleeper-style FAAB: claims run Tuesday through Wednesday morning ET.
_WAIVER_WEEKDAYS = {1}  # Tuesday
_WAIVER_WEDNESDAY = 2
_WAIVER_WEDNESDAY_CUTOFF_HOUR = 10

_WINDOW_LABELS = {
    WINDOW_SOLO: "Solo prep",
    WINDOW_PRE_DRAFT: "Pre-draft",
    WINDOW_LIVE_DRAFT: "Live draft",
    WINDOW_POST_DRAFT_FA: "Post-draft FA bidding",
    WINDOW_WAIVERS: "Waiver bidding",
    WINDOW_FREE_AGENCY: "Free agency",
    WINDOW_OFFSEASON: "Offseason",
}

_ADD_COPY = {
    ADD_LOCKED: "Rosters are locked. Use Trades for players whose contracts survive the upcoming draft.",
    ADD_BID: "Place a bid. The highest bid wins when this window processes — same as post-draft FA.",
    ADD_INSTANT: "Waiver period is over. You can add available players now.",
}


def _now_et(now: datetime | None = None) -> datetime:
    clock = now or datetime.now(tz=ET)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=ET)
    return clock.astimezone(ET)


def _nfl_state(nfl_state: dict[str, Any] | None = None) -> dict[str, Any]:
    if nfl_state is not None:
        return nfl_state
    try:
        return get_nfl_state(use_cache=True) or {}
    except Exception:
        return {}


def is_waiver_period(now: datetime | None = None) -> bool:
    """True during the weekly waiver claim window (Tue 00:00 ET–Wed 10:00 ET)."""
    et = _now_et(now)
    if et.weekday() == _WAIVER_WEDNESDAY:
        return et.hour < _WAIVER_WEDNESDAY_CUTOFF_HOUR
    return et.weekday() in _WAIVER_WEEKDAYS


def window_id_for(
    window: str,
    *,
    season: int | None,
    week: int | None,
) -> str | None:
    if window == WINDOW_POST_DRAFT_FA:
        return f"{int(season or 0)}-post-draft"
    if window == WINDOW_WAIVERS:
        return f"{int(season or 0)}-w{int(week or 0)}-waiver"
    return None


def resolve_acquisition_window(
    ctx: dict[str, Any] | None,
    *,
    now: datetime | None = None,
    nfl_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the current add/bid/trade policy for this hub context."""
    ctx = ctx or {}
    if ctx.get("mode") != "league":
        return {
            "id": WINDOW_SOLO,
            "label": _WINDOW_LABELS[WINDOW_SOLO],
            "add_mode": ADD_INSTANT,
            "can_instant_add": True,
            "can_bid": False,
            "roster_locked": False,
            "trade_scope": TRADE_ACTIVE,
            "window_id": None,
            "message": "Solo prep — add players to build a practice roster.",
            "season": ctx.get("season"),
            "week": None,
            "nfl_season_type": None,
        }

    state = _nfl_state(nfl_state)
    nfl_type = str(state.get("season_type") or "off").lower()
    week = state.get("week")
    try:
        week_n = int(week) if week is not None else None
    except (TypeError, ValueError):
        week_n = None
    season = ctx.get("season") or state.get("season")
    try:
        season_n = int(season) if season is not None else None
    except (TypeError, ValueError):
        season_n = None

    from src.draft_hub.league_home import resolve_league_phase

    phase = resolve_league_phase(
        draft_completed=bool(ctx.get("draft_completed")),
        league_status=ctx.get("league_status"),
        draft_session_status=ctx.get("draft_session_status"),
        nfl_season_type=nfl_type,
    )
    phase_id = phase.get("id")

    if phase_id == PHASE_LIVE_DRAFT:
        window = WINDOW_LIVE_DRAFT
        add_mode = ADD_LOCKED
        trade_scope = TRADE_MID_DRAFT
        message = "The draft room is live. Nominate and bid there instead of adding from Players."
    elif phase_id == PHASE_PRE_DRAFT:
        # Pre-draft: no Players-tab adds. Trades still allowed for anyone currently rostered.
        window = WINDOW_PRE_DRAFT
        add_mode = ADD_LOCKED
        trade_scope = TRADE_ACTIVE
        message = (
            "Pre-draft adds go through the draft. Rosters stay put until auction night, "
            "except trades of players already under contract."
        )
    elif phase_id == PHASE_IN_SEASON and is_waiver_period(now):
        window = WINDOW_WAIVERS
        add_mode = ADD_BID
        trade_scope = TRADE_ACTIVE
        message = _ADD_COPY[ADD_BID]
    elif phase_id == PHASE_IN_SEASON:
        window = WINDOW_FREE_AGENCY
        add_mode = ADD_INSTANT
        trade_scope = TRADE_ACTIVE
        message = _ADD_COPY[ADD_INSTANT]
    elif nfl_type == "pre":
        window = WINDOW_POST_DRAFT_FA
        add_mode = ADD_BID
        trade_scope = TRADE_ACTIVE
        message = "Post-draft free agents go to the highest bid, same as the auction."
    else:
        window = WINDOW_OFFSEASON
        add_mode = ADD_LOCKED
        trade_scope = TRADE_SURVIVING
        message = _ADD_COPY[ADD_LOCKED]

    return {
        "id": window,
        "label": _WINDOW_LABELS[window],
        "add_mode": add_mode,
        "can_instant_add": add_mode == ADD_INSTANT,
        "can_bid": add_mode == ADD_BID,
        "roster_locked": add_mode == ADD_LOCKED,
        "trade_scope": trade_scope,
        "window_id": window_id_for(window, season=season_n, week=week_n),
        "message": message,
        "season": season_n,
        "week": week_n,
        "nfl_season_type": nfl_type,
        "phase_id": phase_id,
    }


def attach_acquisition_window(
    ctx: dict[str, Any],
    *,
    now: datetime | None = None,
    nfl_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ctx["acquisition_window"] = resolve_acquisition_window(ctx, now=now, nfl_state=nfl_state)
    return ctx


def player_survives_upcoming_draft(row: dict[str, Any] | None) -> bool:
    """True when the deal continues beyond the upcoming draft.

    Offseason trades are limited to these contracts. One-year rentals,
    FA contracts, and deals that expire at the next draft stay put.
    """
    if not row:
        return False
    from src.draft_hub.acquisition_semantics import is_fa_contract
    from src.draft_hub.contracts import has_pending_extension
    from src.draft_hub.pre_draft_cap import is_active_for_pre_draft, years_remaining

    if not is_active_for_pre_draft(row):
        return False
    if is_fa_contract(row):
        return False
    if has_pending_extension(row):
        return True
    return years_remaining(row) > 1


def player_is_tradeable(row: dict[str, Any] | None, window: dict[str, Any] | None) -> bool:
    scope = str((window or {}).get("trade_scope") or TRADE_ACTIVE)
    if scope in {TRADE_ACTIVE, TRADE_MID_DRAFT}:
        return True
    return player_survives_upcoming_draft(row)


def trade_lock_reason(row: dict[str, Any] | None, window: dict[str, Any] | None) -> str | None:
    if player_is_tradeable(row, window):
        return None
    name = str((row or {}).get("player_name") or "This player")
    return (
        f"{name} expires at the upcoming draft. Offseason trades are limited to "
        "contracts that continue beyond that draft."
    )
