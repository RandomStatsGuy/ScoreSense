"""Solo test draft — bot teams that auto-bid in the auction room."""

from __future__ import annotations

import uuid
from typing import Any

from src.draft_hub import storage
from src.draft_hub.draft_state import get_room_state, place_bid
from src.draft_hub.schemas import LeagueRules

BOT_NAMES = [
    "Bot Alpha", "Bot Bravo", "Bot Charlie", "Bot Delta", "Bot Echo",
    "Bot Foxtrot", "Bot Golf", "Bot Hotel", "Bot India", "Bot Juliet",
    "Bot Kilo",
]


def setup_test_draft(league_id: str, commissioner_sub: str, bot_count: int = 3,
                     bot_budget: float | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != commissioner_sub:
        raise ValueError("Only commissioner can enable test mode")
    rules = LeagueRules.model_validate(league["rules"])
    budget = float(bot_budget if bot_budget is not None else rules.salary_cap)
    bot_count = max(1, min(int(bot_count), 11))

    existing = storage.list_league_teams(league_id)
    real_count = sum(1 for t in existing if not t.get("is_bot"))
    if real_count + bot_count > league["team_count"]:
        bot_count = max(1, league["team_count"] - real_count)

    added = []
    for i in range(bot_count):
        name = BOT_NAMES[i % len(BOT_NAMES)]
        bot_id = str(uuid.uuid4())
        storage.add_bot_team(league_id, bot_id, name, budget)
        added.append({"id": bot_id, "name": name, "budget_remaining": budget})

    storage.update_league_test_mode(league_id, True)
    return {"bots_added": added, "state": get_room_state(league_id)}


def reset_test_draft(league_id: str, commissioner_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != commissioner_sub:
        raise ValueError("Only commissioner can reset the draft")
    if not storage.league_test_mode(league_id):
        raise ValueError("Reset is only available for practice draft rooms")

    rules = LeagueRules.model_validate(league["rules"])
    cap = float(rules.salary_cap)

    storage.clear_league_team_rosters(league_id)
    storage.clear_draft_events(league_id)
    storage.reset_league_team_budgets(league_id, cap)
    storage.update_draft_session(
        league_id,
        status="setup",
        current_nominee_json=None,
        high_bid=None,
        high_bidder_team_id=None,
        nomination_deadline=None,
        bid_deadline=None,
        started_at=None,
        completed_at=None,
        last_bid_at=None,
        nominator_index=0,
        nomination_order_json=None,
    )
    storage.update_league_status(league_id, "setup")
    storage.update_league_settings(league_id, draft_completed=False)

    return {"state": get_room_state(league_id, commissioner_sub)}


def maybe_bot_nominate(league_id: str) -> dict[str, Any] | None:
    """When a bot is on the clock, nominate a top available player (test mode only)."""
    from src.draft_hub.draft_pool import build_nomination_pool
    from src.draft_hub.draft_state import _current_nominator_team_id, nominate
    from src.draft_hub.rules_engine import assert_can_acquire

    if not storage.league_test_mode(league_id):
        return None
    state = get_room_state(league_id)
    session = state.get("session") or {}
    if session.get("status") != "nominating":
        return None

    nominator_id = _current_nominator_team_id(session)
    if not nominator_id:
        return None
    team = storage.get_team(nominator_id)
    if not team or not team.get("is_bot"):
        return None

    league = storage.get_league(league_id)
    if not league:
        return None
    rules = LeagueRules.model_validate(league["rules"])
    ws = storage.roster_workspace_for_league(league)
    pool = build_nomination_pool(
        league_id=league_id,
        pool_mode=session.get("pool_mode"),
        season=int(league["season"]),
        rules=rules,
        workspace_id=ws,
    )
    roster = storage.list_team_roster(league_id, team["id"])
    candidates: list[dict[str, Any]] = []
    for row in pool.get("rows") or []:
        try:
            assert_can_acquire(rules, roster, row.get("position"))
            candidates.append(row)
        except ValueError:
            continue
    if not candidates:
        return None

    candidates.sort(
        key=lambda r: float(r.get("fair_value") or r.get("model_bid_hint") or r.get("season_proj") or 0),
        reverse=True,
    )
    pick = candidates[0]
    try:
        return nominate(
            league_id,
            f"bot:{team['id']}",
            {
                "player_id": pick["player_id"],
                "player_name": pick.get("player") or pick.get("player_name"),
                "team": pick.get("team", ""),
                "position": pick.get("position"),
                "fair_value": pick.get("fair_value"),
                "season_proj": pick.get("season_proj"),
                "per_game_proj": pick.get("per_game_proj"),
            },
        )
    except ValueError:
        return None


def maybe_bot_bid(league_id: str) -> dict[str, Any] | None:
    state = get_room_state(league_id)
    session = state.get("session") or {}
    if session.get("status") != "bidding":
        return None
    if not storage.league_test_mode(league_id):
        return None

    high_team_id = session.get("high_bidder_team_id")
    high_bid = float(session.get("high_bid") or 0)
    teams = state.get("teams") or []
    bots = [t for t in teams if t.get("is_bot")]
    if not bots:
        return None

    rules = LeagueRules.model_validate(state["league"]["rules"])
    min_bid = float(rules.auction.min_bid)

    for bot in bots:
        if bot["id"] == high_team_id:
            continue
        budget = float(bot.get("budget_remaining") or 0)
        next_bid = max(min_bid, high_bid + min_bid)
        if next_bid > budget:
            continue
        try:
            return place_bid(league_id, f"bot:{bot['id']}", next_bid)
        except ValueError:
            continue
    return None
