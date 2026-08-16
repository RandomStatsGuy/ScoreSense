"""Draft room state machine — nomination, bidding, cuts."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from src.draft_hub.rules_engine import cut_refund, normalize_position, assert_can_acquire, roster_capacity
from src.draft_hub.schemas import LeagueRules
from src.draft_hub import storage
from src.draft_hub.draft_pool import normalize_pool_mode, resolve_nomination_player


def _resolve_team(league_id: str, user_sub: str) -> dict[str, Any] | None:
    if user_sub.startswith("bot:"):
        team_id = user_sub.split(":", 1)[1]
        team = storage.get_team(team_id)
        if team and team.get("league_id") == league_id and team.get("is_bot"):
            return team
        return None
    return storage.get_team_by_user(league_id, user_sub)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _deadline(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _extend_bid_deadline(session: dict[str, Any], rules: LeagueRules) -> str:
    """Add a few seconds to the bid clock on each new bid (do not reset to full timer)."""
    ext = int(getattr(rules.auction, "bid_extension_sec", 5) or 5)
    now = datetime.now(timezone.utc)
    current = session.get("bid_deadline")
    if current:
        try:
            deadline = datetime.fromisoformat(str(current))
        except ValueError:
            deadline = now
        base = max(deadline, now)
    else:
        base = now
    return (base + timedelta(seconds=ext)).isoformat()


def _build_nomination_order(teams: list[dict[str, Any]]) -> list[str]:
    """Humans first (commissioner, then join order), then bots."""
    humans = [t for t in teams if not t.get("is_bot")]
    bots = [t for t in teams if t.get("is_bot")]
    humans.sort(key=lambda t: (not t.get("is_commissioner"), t.get("joined_at") or ""))
    bots.sort(key=lambda t: t.get("joined_at") or "")
    return [str(t["id"]) for t in humans + bots]


def _current_nominator_team_id(session: dict[str, Any]) -> str | None:
    order = session.get("nomination_order") or []
    if not order:
        return None
    idx = int(session.get("nominator_index") or 0) % len(order)
    return str(order[idx])


def _advance_nominator(league_id: str) -> None:
    session = storage.get_draft_session(league_id) or {}
    order = session.get("nomination_order") or []
    if not order:
        return
    idx = (int(session.get("nominator_index") or 0) + 1) % len(order)
    storage.update_draft_session(league_id, nominator_index=idx)


def _bot_delay_elapsed(session: dict[str, Any], rules: LeagueRules) -> bool:
    delay = int(getattr(rules.auction, "bot_reaction_delay_sec", 4) or 4)
    last = session.get("last_bid_at")
    if not last:
        return True
    try:
        last_at = datetime.fromisoformat(str(last))
    except ValueError:
        return True
    return datetime.now(timezone.utc) >= last_at + timedelta(seconds=delay)


def update_auction_rules(league_id: str, user_sub: str, updates: dict[str, Any]) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can change auction settings")
    session = storage.get_draft_session(league_id) or {}
    if session.get("status") and session.get("status") != "setup":
        raise ValueError("Auction settings can only change before the draft starts")
    rules = LeagueRules.model_validate(league["rules"])
    auction = rules.auction.model_dump()
    for key in ("min_bid", "nomination_timer_sec", "bid_timer_sec", "bid_extension_sec", "bot_reaction_delay_sec"):
        if updates.get(key) is not None:
            auction[key] = int(updates[key])
    rules = rules.model_copy(update={"auction": rules.auction.model_copy(update=auction)})
    storage.update_league_rules(league_id, rules)
    return get_room_state(league_id, user_sub)


def set_nomination_order(league_id: str, user_sub: str, team_ids: list[str]) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can set nomination order")
    session = storage.get_draft_session(league_id) or {}
    if session.get("status") not in ("setup", None, ""):
        raise ValueError("Nomination order can only change before the draft starts")
    teams = storage.list_league_teams(league_id)
    valid = {str(t["id"]) for t in teams}
    order = [str(tid) for tid in team_ids if str(tid) in valid]
    if not order:
        raise ValueError("Nomination order must include at least one team")
    storage.update_draft_session(
        league_id,
        nomination_order_json=json.dumps(order),
        nominator_index=0,
    )
    return get_room_state(league_id, user_sub)


def _pick_value_grade(amount: float, fair_value: float | None, per_game: float | None = None) -> str:
    if fair_value is None or amount <= 0:
        return "pick"
    ratio = float(fair_value) / float(amount)
    if ratio >= 1.25:
        return "steal"
    if ratio >= 1.08:
        return "great_value"
    if ratio >= 0.92:
        return "fair"
    if ratio >= 0.75:
        return "slight_reach"
    if ratio >= 0.6:
        return "reach"
    return "major_reach"


def _pick_value_blurb(grade: str, *, amount: float, fair_value: float | None, per_game: float | None) -> str:
    ppg = f"{per_game:.1f} PPG" if per_game is not None else None
    fair = f"${fair_value:.0f} fair" if fair_value is not None else None
    spent = f"${amount:.0f} spent"
    meta = " · ".join(x for x in (ppg, fair, spent) if x)
    labels = {
        "steal": "Steal!",
        "great_value": "Great value",
        "fair": "Fair price",
        "slight_reach": "Slight reach",
        "reach": "Reach",
        "major_reach": "Major reach",
        "pick": "Sold!",
    }
    head = labels.get(grade, "Sold!")
    return f"{head} — {meta}" if meta else head


def get_room_state(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    session = storage.get_draft_session(league_id) or {}
    rules = LeagueRules.model_validate(league["rules"])
    teams = storage.list_league_teams(league_id)
    events = storage.list_draft_events(league_id, limit=50)
    rosters = storage.list_league_rosters_by_team(league_id)
    draft_completed = bool(league.get("draft_completed"))
    from src.draft_hub.draft_budgets import team_auction_finance

    enriched_teams: list[dict[str, Any]] = []
    for team in teams:
        roster = rosters.get(team["id"]) or []
        finance = team_auction_finance(
            rules,
            roster,
            draft_completed=draft_completed,
            budget_remaining=float(team.get("budget_remaining") or 0),
        )
        enriched_teams.append({**team, **finance})
    out: dict[str, Any] = {
        "league": league,
        "session": session,
        "teams": enriched_teams,
        "events": events,
        "rosters": rosters,
        "roster_limits": rules.roster,
        "roster_size_max": int(getattr(rules, "roster_size_max", None) or 0) or None,
        "pool_mode": normalize_pool_mode(session.get("pool_mode")),
        "nominator_team_id": _current_nominator_team_id(session) if session else None,
    }
    if user_sub:
        team = storage.get_team_by_user(league_id, user_sub)
        if team:
            team_roster = rosters.get(team["id"]) or []
            finance = team_auction_finance(
                rules,
                team_roster,
                draft_completed=draft_completed,
                budget_remaining=float(team.get("budget_remaining") or 0),
            )
            out["viewer"] = {
                "team_id": team["id"],
                "team_name": team["name"],
                "roster": team_roster,
                "capacity": roster_capacity(rules, team_roster),
                **finance,
            }
    return out


def start_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can start draft")
    rules = LeagueRules.model_validate(league["rules"])
    from src.draft_hub.draft_budgets import sync_league_auction_budgets

    sync_league_auction_budgets(league_id)
    teams = storage.list_league_teams(league_id)
    order = _build_nomination_order(teams)
    storage.update_league_status(league_id, "live")
    storage.update_draft_session(
        league_id,
        status="nominating",
        started_at=_now_iso(),
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        nomination_order_json=json.dumps(order),
        nominator_index=0,
        last_bid_at=None,
    )
    storage.append_draft_event(league_id, "start", {"by": user_sub})
    return get_room_state(league_id, user_sub)


def end_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can end the draft")
    session = storage.get_draft_session(league_id)
    if not session:
        raise ValueError("No draft session")
    status = session.get("status")
    if status in ("setup", "completed", None, ""):
        raise ValueError("Draft is not in progress")

    nominee = None
    if session.get("current_nominee_json"):
        nominee = json.loads(session["current_nominee_json"])

    storage.update_draft_session(
        league_id,
        status="completed",
        completed_at=_now_iso(),
        current_nominee_json=None,
        high_bid=None,
        high_bidder_team_id=None,
        bid_deadline=None,
        nomination_deadline=None,
        last_bid_at=None,
    )
    storage.update_league_status(league_id, "completed")
    was_complete = bool(league.get("draft_completed"))
    storage.update_league_settings(league_id, draft_completed=True)
    year_tick = None
    if not was_complete:
        from src.draft_hub.contract_year_clock import tick_contracts_on_draft_complete

        year_tick = tick_contracts_on_draft_complete(league_id)

    payload: dict[str, Any] = {"by": user_sub}
    if nominee:
        payload["released_nominee"] = nominee.get("player_name")
        payload["released_player_id"] = nominee.get("player_id")
    if year_tick:
        payload["contract_year_tick"] = {
            "advanced": year_tick.get("advanced"),
            "expired": year_tick.get("expired"),
        }
    storage.append_draft_event(league_id, "end", payload)
    state = get_room_state(league_id, user_sub)
    if year_tick:
        state["contract_year_tick"] = year_tick
    return state


def reset_live_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    """Undo a live (non-practice) draft: clear auction picks/events, restore session to setup.

    Keepers (non-draft sources) stay. If draft was already marked complete, rewinds the
    contract year clock for remaining keepers (players who expired on End are not restored).
    """
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can reset the draft")
    if storage.league_test_mode(league_id):
        raise ValueError("Use practice draft reset for mock rooms")

    session = storage.get_draft_session(league_id) or {}
    status = session.get("status") or "setup"
    was_completed = bool(league.get("draft_completed")) or status == "completed"
    if status in ("setup", None, "") and not was_completed:
        raise ValueError("Draft has not started")

    picks_removed = storage.clear_league_draft_picks(league_id)
    storage.clear_draft_events(league_id)
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

    year_rewind = None
    if was_completed:
        from src.draft_hub.contract_year_clock import rewind_contracts_on_draft_reset

        year_rewind = rewind_contracts_on_draft_reset(league_id)

    from src.draft_hub.draft_budgets import sync_league_auction_budgets

    sync_league_auction_budgets(league_id)

    state = get_room_state(league_id, user_sub)
    warning = None
    if was_completed and year_rewind is not None:
        if year_rewind.get("lossless"):
            warning = None
        else:
            warning = year_rewind.get("note")
    return {
        "state": state,
        "picks_removed": picks_removed,
        "year_rewind": year_rewind,
        "warning": warning,
    }


def set_pool_mode(league_id: str, user_sub: str, pool_mode: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can change pool mode")
    session = storage.get_draft_session(league_id)
    if not session or session.get("status") not in ("setup", "nominating"):
        raise ValueError("Pool mode can only change before or during open nominations")
    mode = normalize_pool_mode(pool_mode)
    storage.update_draft_session(league_id, pool_mode=mode)
    return get_room_state(league_id, user_sub)


def nominate(league_id: str, user_sub: str, player: dict[str, Any]) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    team = _resolve_team(league_id, user_sub)
    if not team:
        raise ValueError("Not a league member")
    session = storage.get_draft_session(league_id)
    if not session or session.get("status") not in ("nominating", "bidding"):
        raise ValueError("Draft not accepting nominations")
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session)
    is_commissioner = league["commissioner_sub"] == user_sub
    test_mode = storage.league_test_mode(league_id)
    if nominator_id and not test_mode and not is_commissioner and str(team["id"]) != str(nominator_id):
        nominator = storage.get_team(nominator_id)
        name = (nominator or {}).get("name") or "another team"
        raise ValueError(f"It is {name}'s turn to nominate")
    from src.draft_hub.draft_pool import list_drafted_player_ids

    if str(player.get("player_id") or "") in list_drafted_player_ids(league_id):
        raise ValueError("Player already drafted")
    workspace_id = storage.roster_workspace_for_league(league)
    ws = storage.get_workspace_by_id(workspace_id) if league.get("workspace_id") else None
    sleeper_ids = set((ws or {}).get("sleeper_player_ids") or [])
    resolved = resolve_nomination_player(
        league_id=league_id,
        pool_mode=session.get("pool_mode"),
        player_id=str(player.get("player_id") or ""),
        season=int(league["season"]),
        rules=rules,
        workspace_id=workspace_id,
        sleeper_player_ids=sleeper_ids,
    )
    pos = normalize_position(resolved.get("position") or player.get("position"))
    team_roster = storage.list_team_roster(league_id, team["id"])
    assert_can_acquire(rules, team_roster, pos)
    nominee = {
        "player_id": resolved.get("player_id") or player.get("player_id"),
        "player_name": resolved.get("player") or resolved.get("player_name") or player.get("player_name"),
        "team": resolved.get("team") or player.get("team"),
        "position": pos,
        "nominating_team_id": team["id"],
    }
    for key in ("fair_value", "season_proj", "per_game_proj", "is_rookie", "years_exp", "nfl_years_exp"):
        val = resolved.get(key)
        if val is None:
            val = player.get(key)
        if val is not None:
            nominee[key] = val
    storage.update_draft_session(
        league_id,
        status="bidding",
        current_nominee_json=json.dumps(nominee),
        high_bid=None,
        high_bidder_team_id=None,
        bid_deadline=_deadline(rules.auction.bid_timer_sec),
        last_bid_at=_now_iso(),
    )
    storage.append_draft_event(league_id, "nominate", nominee)
    return get_room_state(league_id, user_sub)


def place_bid(league_id: str, user_sub: str, amount: float) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    team = _resolve_team(league_id, user_sub)
    if not team:
        raise ValueError("Not a league member")
    session = storage.get_draft_session(league_id)
    if not session or session.get("status") != "bidding":
        raise ValueError("No active bidding")
    rules = LeagueRules.model_validate(league["rules"])
    from src.draft_hub.draft_budgets import assert_can_afford_auction_bid

    bidder_roster = storage.list_team_roster(league_id, team["id"])
    assert_can_afford_auction_bid(
        rules,
        bidder_roster,
        float(team["budget_remaining"]),
        amount,
        draft_completed=bool(league.get("draft_completed")),
    )
    nominee = session.get("current_nominee") or {}
    nominee_pos = nominee.get("position")
    if nominee_pos:
        assert_can_acquire(rules, bidder_roster, nominee_pos)
    current = float(session.get("high_bid") or 0)
    if amount <= current:
        raise ValueError("Bid must exceed current high bid")
    storage.update_draft_session(
        league_id,
        high_bid=amount,
        high_bidder_team_id=team["id"],
        bid_deadline=_extend_bid_deadline(session, rules),
        last_bid_at=_now_iso(),
    )
    storage.append_draft_event(
        league_id,
        "bid",
        {"team_id": team["id"], "team_name": team["name"], "amount": amount},
    )
    return get_room_state(league_id, user_sub)


def award_nominee(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session:
        raise ValueError("Invalid session")
    nominee = session.get("current_nominee")
    winner_id = session.get("high_bidder_team_id")
    amount = session.get("high_bid")
    if not nominee or not winner_id or amount is None:
        storage.update_draft_session(
            league_id,
            status="nominating",
            current_nominee_json=None,
            high_bid=None,
            high_bidder_team_id=None,
            bid_deadline=None,
            last_bid_at=None,
            nomination_deadline=_deadline(
                LeagueRules.model_validate(league["rules"]).auction.nomination_timer_sec
            ),
        )
        _advance_nominator(league_id)
        storage.append_draft_event(
            league_id,
            "pass",
            {
                "player_id": nominee.get("player_id") if nominee else None,
                "player_name": nominee.get("player_name") if nominee else None,
                "reason": "no_bids",
            },
        )
        return get_room_state(league_id, user_sub)

    winner = storage.get_team(winner_id)
    if not winner:
        raise ValueError("Winning team not found")
    rules = LeagueRules.model_validate(league["rules"])
    winner_roster = storage.list_team_roster(league_id, winner_id)
    try:
        assert_can_acquire(rules, winner_roster, nominee.get("position"))
    except ValueError:
        storage.update_draft_session(
            league_id,
            status="nominating",
            current_nominee_json=None,
            high_bid=None,
            high_bidder_team_id=None,
            bid_deadline=None,
            last_bid_at=None,
            nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        )
        _advance_nominator(league_id)
        storage.append_draft_event(
            league_id,
            "pass",
            {"player_id": nominee.get("player_id"), "reason": "position_cap"},
        )
        return get_room_state(league_id, user_sub)
    new_budget = float(winner["budget_remaining"]) - float(amount)
    storage.update_team_budget(winner_id, new_budget)
    # Must match the workspace list_team_roster reads from, or picks vanish.
    ws_id = storage.roster_workspace_for_league(league)
    from src.draft_hub.contracts import auction_win_is_rookie, build_auction_win_contract
    from src.draft_hub.draft_budgets import preserve_cut_liability

    preserve_cut_liability(ws_id, str(nominee["player_id"]))
    is_rookie = auction_win_is_rookie(rules, nominee)
    contract = build_auction_win_contract(rules, float(amount), is_rookie=is_rookie)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": nominee["player_id"],
            "player_name": nominee.get("player_name"),
            "team": nominee.get("team"),
            "position": nominee.get("position"),
            "salary": float(amount),
            "contract_years": int(contract.get("years_remaining") or 2),
            "contract": contract,
            "source": "draft",
        },
        team_id=winner_id,
    )
    grade = _pick_value_grade(
        float(amount),
        float(nominee["fair_value"]) if nominee.get("fair_value") is not None else None,
        float(nominee["per_game_proj"]) if nominee.get("per_game_proj") is not None else None,
    )
    storage.append_draft_event(
        league_id,
        "win",
        {
            "team_id": winner_id,
            "team_name": winner.get("name"),
            "amount": amount,
            "value_grade": grade,
            "value_blurb": _pick_value_blurb(
                grade,
                amount=float(amount),
                fair_value=float(nominee["fair_value"]) if nominee.get("fair_value") is not None else None,
                per_game=float(nominee["per_game_proj"]) if nominee.get("per_game_proj") is not None else None,
            ),
            "fair_value": nominee.get("fair_value"),
            "per_game_proj": nominee.get("per_game_proj"),
            "season_proj": nominee.get("season_proj"),
            **nominee,
        },
    )
    rules = LeagueRules.model_validate(league["rules"])
    storage.update_draft_session(
        league_id,
        status="nominating",
        current_nominee_json=None,
        high_bid=None,
        high_bidder_team_id=None,
        bid_deadline=None,
        last_bid_at=None,
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
    )
    _advance_nominator(league_id)
    return get_room_state(league_id, user_sub)


def cut_player(league_id: str, user_sub: str, player_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league["rules"])
    if not rules.auction.allow_mid_draft_cuts:
        raise ValueError("Mid-draft cuts disabled")
    team = storage.get_team_by_user(league_id, user_sub)
    if not team:
        raise ValueError("Not a league member")
    ws_id = storage.roster_workspace_for_league(league)
    roster = storage.list_team_roster(league_id, team["id"])
    slot = next((r for r in roster if str(r.get("player_id")) == player_id), None)
    if not slot:
        raise ValueError("Player not on roster")
    refund = cut_refund(rules, float(slot["salary"]))
    storage.remove_roster_slot(ws_id, player_id)
    storage.update_team_budget(team["id"], float(team["budget_remaining"]) + refund)
    storage.append_draft_event(
        league_id,
        "cut",
        {
            "team_id": team["id"],
            "player_id": player_id,
            "player_name": slot.get("player_name"),
            "position": slot.get("position"),
            "refund": refund,
        },
    )
    return get_room_state(league_id, user_sub)


def set_draft_contracts(
    league_id: str,
    user_sub: str,
    items: list[dict[str, Any]],
    max_years: int = 4,
) -> dict[str, Any]:
    """Owners no longer choose auction contract years.

    Rookies get a flat 2-year deal at the sale price; veterans get 2 years
    with the league step-up. Year control is only the pre-draft rookie
    extension window.
    """
    _ = (items, max_years, user_sub)
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    raise ValueError(
        "Auction contracts are assigned automatically (rookies 2 years flat, "
        "veterans 2 years with step-up). Choose years only during the "
        "pre-draft rookie extension window."
    )


def _parse_utc(iso: str) -> datetime:
    text = str(iso).replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def check_timers(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    """Auto-pass expired bids/nominations; bots may bid/nominate in test mode."""
    from src.draft_hub.test_draft import maybe_bot_bid, maybe_bot_nominate

    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session:
        return get_room_state(league_id, user_sub)
    now = datetime.now(timezone.utc)
    status = session.get("status")
    test_mode = storage.league_test_mode(league_id)
    # Bot actions build state under the bot's identity — rebuild with the
    # caller's sub or the polling client would adopt the bot's viewer/team.
    if status == "nominating" and test_mode:
        bot_state = maybe_bot_nominate(league_id)
        if bot_state:
            return get_room_state(league_id, user_sub)
    if status == "bidding" and session.get("bid_deadline"):
        deadline = _parse_utc(session["bid_deadline"])
        if now >= deadline:
            return award_nominee(league_id, user_sub)
        if _bot_delay_elapsed(session, LeagueRules.model_validate(league["rules"])):
            bot_state = maybe_bot_bid(league_id)
            if bot_state:
                return get_room_state(league_id, user_sub)
    if status == "nominating" and session.get("nomination_deadline"):
        deadline = _parse_utc(session["nomination_deadline"])
        if now >= deadline:
            storage.update_draft_session(
                league_id,
                nomination_deadline=_deadline(
                    LeagueRules.model_validate(league["rules"]).auction.nomination_timer_sec
                ),
            )
    return get_room_state(league_id, user_sub)
