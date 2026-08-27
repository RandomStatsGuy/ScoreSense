"""Acquisition windows: when Players-tab adds, bids, and offseason trades are allowed."""

from datetime import datetime
from zoneinfo import ZoneInfo

from src.draft_hub.acquisition_window import (
    ADD_BID,
    ADD_INSTANT,
    ADD_LOCKED,
    TRADE_SURVIVING,
    WINDOW_FREE_AGENCY,
    WINDOW_OFFSEASON,
    WINDOW_POST_DRAFT_FA,
    WINDOW_PRE_DRAFT,
    WINDOW_WAIVERS,
    is_waiver_period,
    player_is_tradeable,
    resolve_acquisition_window,
    trade_lock_reason,
)
from src.draft_hub.pre_draft_cap import years_remaining

ET = ZoneInfo("America/New_York")


def _ctx(**overrides):
    base = {
        "mode": "league",
        "draft_completed": True,
        "league_status": "complete",
        "season": 2026,
    }
    base.update(overrides)
    return base


def test_waiver_period_tuesday_and_wednesday_morning():
    tue = datetime(2026, 9, 22, 8, 0, tzinfo=ET)
    wed_am = datetime(2026, 9, 23, 9, 0, tzinfo=ET)
    wed_pm = datetime(2026, 9, 23, 15, 0, tzinfo=ET)
    thu = datetime(2026, 9, 24, 12, 0, tzinfo=ET)
    assert is_waiver_period(tue) is True
    assert is_waiver_period(wed_am) is True
    assert is_waiver_period(wed_pm) is False
    assert is_waiver_period(thu) is False


def test_in_season_after_waivers_allows_instant_add():
    window = resolve_acquisition_window(
        _ctx(),
        now=datetime(2026, 9, 24, 12, 0, tzinfo=ET),
        nfl_state={"season_type": "regular", "week": 3, "season": 2026},
    )
    assert window["id"] == WINDOW_FREE_AGENCY
    assert window["add_mode"] == ADD_INSTANT
    assert window["can_instant_add"] is True


def test_in_season_waivers_require_bids():
    window = resolve_acquisition_window(
        _ctx(),
        now=datetime(2026, 9, 22, 10, 0, tzinfo=ET),
        nfl_state={"season_type": "regular", "week": 3, "season": 2026},
    )
    assert window["id"] == WINDOW_WAIVERS
    assert window["add_mode"] == ADD_BID
    assert window["window_id"] == "2026-w3-waiver"


def test_preseason_after_draft_is_fa_bidding():
    window = resolve_acquisition_window(
        _ctx(),
        nfl_state={"season_type": "pre", "week": 1, "season": 2026},
    )
    assert window["id"] == WINDOW_POST_DRAFT_FA
    assert window["add_mode"] == ADD_BID
    assert window["window_id"] == "2026-post-draft"


def test_offseason_locks_adds_and_limits_trades():
    window = resolve_acquisition_window(
        _ctx(),
        nfl_state={"season_type": "off", "week": 1, "season": 2026},
    )
    assert window["id"] == WINDOW_OFFSEASON
    assert window["add_mode"] == ADD_LOCKED
    assert window["trade_scope"] == TRADE_SURVIVING
    keeper = {"player_name": "Keeper", "contract_years": 2, "roster_status": "active"}
    rental = {"player_name": "Rental", "contract_years": 1, "roster_status": "active"}
    assert years_remaining(keeper) == 2
    assert player_is_tradeable(keeper, window) is True
    assert player_is_tradeable(rental, window) is False
    assert "Rental" in (trade_lock_reason(rental, window) or "")


def test_pre_draft_locks_adds():
    window = resolve_acquisition_window(
        _ctx(draft_completed=False, league_status="setup"),
        nfl_state={"season_type": "off", "week": 1, "season": 2026},
    )
    assert window["id"] == WINDOW_PRE_DRAFT
    assert window["add_mode"] == ADD_LOCKED


def test_solo_prep_always_allows_adds():
    window = resolve_acquisition_window({"mode": "solo", "season": 2026})
    assert window["add_mode"] == ADD_INSTANT
    assert window["id"] == "solo"


def test_pending_extension_is_tradeable_in_offseason():
    window = resolve_acquisition_window(
        _ctx(),
        nfl_state={"season_type": "off", "week": 1, "season": 2026},
    )
    pending = {
        "player_name": "Extending",
        "contract_years": 1,
        "roster_status": "active",
        "contract": {"pending_extension": {"years": 2, "start_salary": 15}},
    }
    assert player_is_tradeable(pending, window) is True
