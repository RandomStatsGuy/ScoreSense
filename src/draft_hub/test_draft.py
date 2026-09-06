"""Solo test draft — bot teams that auto-bid in the auction room."""

from __future__ import annotations

import threading
import uuid
import zlib
from typing import Any

from src.draft_hub import storage
from src.draft_hub.bot_persona import BOT_NAMES, persona_ceiling_mult, persona_jump, resolve_bot_persona
from src.draft_hub.draft_state import get_room_state, place_bid
from src.draft_hub.draft_budgets import total_roster_slots
from src.draft_hub.schemas import LeagueRules

# Instant sims must not share a clock tick with the live ticker / room poller.
SIMULATING_LEAGUE_IDS: set[str] = set()
_SIMULATION_LOCK = threading.Lock()
_SIMULATION: dict[str, dict[str, Any]] = {}


def simulation_progress(league_id: str) -> dict[str, Any] | None:
    """In-flight simulate snapshot for room polls (done / total / status)."""
    with _SIMULATION_LOCK:
        snap = _SIMULATION.get(str(league_id))
        return dict(snap) if snap else None


def mark_simulation(league_id: str, **fields: Any) -> dict[str, Any]:
    key = str(league_id)
    with _SIMULATION_LOCK:
        cur = dict(_SIMULATION.get(key) or {})
        cur.update(fields)
        cur["league_id"] = key
        _SIMULATION[key] = cur
        return dict(cur)


def claim_simulation(league_id: str, **fields: Any) -> bool:
    """Atomically take the running slot. False if a sim is already in flight."""
    key = str(league_id)
    with _SIMULATION_LOCK:
        snap = _SIMULATION.get(key)
        if key in SIMULATING_LEAGUE_IDS or (snap and snap.get("status") == "running"):
            return False
        SIMULATING_LEAGUE_IDS.add(key)
        cur = dict(snap or {})
        cur.update(fields)
        cur["league_id"] = key
        cur["status"] = "running"
        cur.setdefault("done", 0)
        cur.setdefault("total", 0)
        cur["error"] = None
        _SIMULATION[key] = cur
        return True


def release_simulation_claim(league_id: str, *, error: str | None = None) -> None:
    """Drop a route-level claim if simulate_draft never finished bookkeeping."""
    key = str(league_id)
    with _SIMULATION_LOCK:
        SIMULATING_LEAGUE_IDS.discard(key)
        snap = _SIMULATION.get(key)
        if not snap or snap.get("status") != "running":
            return
        if error:
            cur = dict(snap)
            cur["status"] = "failed"
            cur["error"] = error
            _SIMULATION[key] = cur
            return
        _SIMULATION.pop(key, None)


def clear_simulation(league_id: str) -> None:
    key = str(league_id)
    with _SIMULATION_LOCK:
        _SIMULATION.pop(key, None)
        SIMULATING_LEAGUE_IDS.discard(key)


def simulation_is_running(league_id: str) -> bool:
    key = str(league_id)
    with _SIMULATION_LOCK:
        if key in SIMULATING_LEAGUE_IDS:
            return True
        snap = _SIMULATION.get(key)
        return bool(snap and snap.get("status") == "running")


def setup_test_draft(league_id: str, commissioner_sub: str, bot_count: int = 3,
                     bot_budget: float | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != commissioner_sub:
        raise ValueError("Only commissioner can enable test mode")
    if not storage.league_test_mode(league_id):
        raise ValueError(
            "Cannot run practice setup on a live league. Start a mock or sandbox room instead."
        )
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

    from src.draft_hub.draft_budgets import restore_sandbox_baseline, sync_league_auction_budgets

    restored = restore_sandbox_baseline(league_id)
    if not restored:
        storage.clear_league_team_rosters(league_id)
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
        paused=0,
        paused_at=None,
    )
    storage.update_league_status(league_id, "setup")
    storage.update_league_settings(league_id, draft_completed=False)
    sync_league_auction_budgets(league_id)

    return {"state": get_room_state(league_id, commissioner_sub)}


def _team_sub(team: dict[str, Any]) -> str | None:
    """Sub usable with nominate/place_bid for either a bot or a human team."""
    if team.get("is_bot"):
        return f"bot:{team['id']}"
    return team.get("user_sub")


def _payload_from_row(pick: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": pick["player_id"],
        "player_name": pick.get("player") or pick.get("player_name"),
        "team": pick.get("team", ""),
        "position": pick.get("position"),
        "fair_value": pick.get("fair_value"),
        "season_proj": pick.get("season_proj"),
        "per_game_proj": pick.get("per_game_proj"),
        "season_p10": pick.get("season_p10"),
        "season_p50": pick.get("season_p50"),
        "season_p90": pick.get("season_p90"),
    }


def _pick_nomination_payload(
    league_id: str,
    league: dict[str, Any],
    rules: LeagueRules,
    team: dict[str, Any],
    session: dict[str, Any],
) -> dict[str, Any] | None:
    """Next bot/autodraft player this team can still roster."""
    from src.draft_hub.bot_strategy import league_drafted_counts, select_pick_draft_player
    from src.draft_hub.draft_pool import build_nomination_pool
    from src.draft_hub.pick_draft import is_pick_draft
    from src.draft_hub.rules_engine import assert_can_acquire, nomination_sort_key, should_need_bid

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

    queue_ids = [str(pid) for pid in (team.get("nomination_queue") or []) if pid]
    if queue_ids:
        by_id = {str(r.get("player_id")): r for r in candidates}
        queued = [by_id[pid] for pid in queue_ids if pid in by_id]
        if queued:
            if is_pick_draft(rules):
                return _payload_from_row(queued[0])
            candidates = queued

    if is_pick_draft(rules):
        pick = select_pick_draft_player(
            rules,
            roster,
            candidates,
            session=session,
            team_id=str(team.get("id") or ""),
            team_count=int(league.get("team_count") or 12),
            drafted_counts=league_drafted_counts(league_id, rules),
        )
        return _payload_from_row(pick) if pick else None

    need_fill = [r for r in candidates if should_need_bid(rules, roster, r.get("position"))]
    if need_fill:
        candidates = need_fill
    candidates.sort(key=lambda r: nomination_sort_key(rules, roster, r))
    return _payload_from_row(candidates[0])


def maybe_bot_nominate(league_id: str) -> dict[str, Any] | None:
    """When a bot is on the clock, nominate a top available player (test mode only)."""
    from src.draft_hub.draft_state import _current_nominator_team_id, nominate

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
    payload = _pick_nomination_payload(league_id, league, rules, team, session)
    if not payload:
        return None
    try:
        return nominate(league_id, f"bot:{team['id']}", payload, from_pool=True)
    except ValueError:
        return None


def maybe_autodraft_nominate(league_id: str) -> dict[str, Any] | None:
    """On-clock human with autodraft enabled — queue, then format-aware pick."""
    from src.draft_hub.draft_state import _current_nominator_team_id, nominate

    state = get_room_state(league_id)
    session = state.get("session") or {}
    if session.get("status") != "nominating" or session.get("paused"):
        return None
    nominator_id = _current_nominator_team_id(session)
    if not nominator_id:
        return None
    team = storage.get_team(nominator_id)
    if not team or team.get("is_bot") or not team.get("autodraft"):
        return None
    sub = _team_sub(team)
    if not sub:
        return None
    league = storage.get_league(league_id)
    if not league:
        return None
    rules = LeagueRules.model_validate(league["rules"])
    payload = _pick_nomination_payload(league_id, league, rules, team, session)
    if not payload:
        return None
    try:
        return nominate(league_id, sub, payload, from_pool=True)
    except ValueError:
        return None


def maybe_bot_pick(league_id: str) -> dict[str, Any] | None:
    """When a bot is on the clock in a pick draft, take a human-like pick."""
    from src.draft_hub.draft_state import _current_nominator_team_id, make_pick

    if not storage.league_test_mode(league_id):
        return None
    state = get_room_state(league_id)
    session = state.get("session") or {}
    if session.get("status") != "picking":
        return None
    league = storage.get_league(league_id)
    if not league:
        return None
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session, rules)
    if not nominator_id:
        return None
    team = storage.get_team(nominator_id)
    if not team or not team.get("is_bot"):
        return None
    payload = _pick_nomination_payload(league_id, league, rules, team, session)
    if not payload:
        return None
    try:
        return make_pick(league_id, f"bot:{team['id']}", payload, from_pool=True)
    except ValueError:
        return None


def maybe_autodraft_pick(league_id: str) -> dict[str, Any] | None:
    """On-clock human with autodraft enabled — queue, then format-aware pick."""
    from src.draft_hub.draft_state import _current_nominator_team_id, make_pick

    state = get_room_state(league_id)
    session = state.get("session") or {}
    if session.get("status") != "picking" or session.get("paused"):
        return None
    league = storage.get_league(league_id)
    if not league:
        return None
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session, rules)
    if not nominator_id:
        return None
    team = storage.get_team(nominator_id)
    if not team or team.get("is_bot") or not team.get("autodraft"):
        return None
    sub = _team_sub(team)
    if not sub:
        return None
    payload = _pick_nomination_payload(league_id, league, rules, team, session)
    if not payload:
        return None
    try:
        return make_pick(league_id, sub, payload, from_pool=True)
    except ValueError:
        return None


def next_bot_bid(
    high_bid: float,
    ceiling: float,
    min_bid: float,
    persona: dict[str, Any] | None = None,
) -> float | None:
    """Next live-bot bid: jump toward the ceiling instead of dripping +$1.

    Real rooms move because bidders jump. A 35% gap step (at least 2× min bid)
    reaches a fair+$6 ceiling in a few ticks instead of a 90-second drip.
    Personalities scale the jump (Whale +$10, Copier min raise).
    """
    try:
        high = float(high_bid)
        ceil = float(ceiling)
        step = float(min_bid)
    except (TypeError, ValueError):
        return None
    return persona_jump(persona, high=high, ceiling=ceil, step=step)


def bot_max_price(
    bot_id: str,
    nominee: dict[str, Any],
    min_bid: float,
    *,
    team: dict[str, Any] | None = None,
    luxury: bool = False,
) -> float:
    """Per-bot price ceiling around the player's fair value.

    Deterministic (crc32 of bot+player) so a bot doesn't re-roll its valuation
    on every timer tick. Personality ranges replace the old 0.75x–1.15x band.
    Luxury bids (roster space but another position still needs filling) use
    the persona's luxury multiplier so leftover cap still clears talent.
    """
    try:
        fair = float(nominee.get("fair_value") or 0)
    except (TypeError, ValueError):
        fair = 0.0
    if fair <= 0:
        return min_bid * 3  # unvalued players are cheap fliers only
    seed = zlib.crc32(f"{bot_id}:{nominee.get('player_id')}".encode()) % 1000
    persona = resolve_bot_persona(team or {"id": bot_id, "is_bot": True})
    mult = persona_ceiling_mult(persona, seed=seed, luxury=luxury, fair=fair)
    return max(min_bid, round(fair * mult))


def _total_roster_slots(rules: LeagueRules) -> int:
    return total_roster_slots(rules)


def _blocks_luxury_min_steal(
    rules: LeagueRules,
    league_id: str,
    roster: list[dict[str, Any]],
    position: str | None,
) -> bool:
    """True when this team should not bid: others still need this positional min.

    Bot ceilings hash off random team ids, so a team that already filled TE
    can otherwise snag remaining TEs as cheap extras and starve another club.
    Relaxed sandboxes skip positional mins entirely.
    """
    from src.draft_hub.rules_engine import (
        normalize_position,
        salary_roster_limits_relaxed,
        unmet_minimum_positions,
    )

    if salary_roster_limits_relaxed(rules):
        return False
    pos = normalize_position(position)
    if not pos:
        return False
    if unmet_minimum_positions(rules, roster):
        return False
    for team in storage.list_league_teams(league_id):
        other = storage.list_team_roster(league_id, team["id"])
        if pos in unmet_minimum_positions(rules, other):
            return True
    return False


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
    nominee = session.get("current_nominee") or {}

    for bot in bots:
        if bot["id"] == high_team_id:
            continue
        budget = float(bot.get("budget_remaining") or 0)
        # Keep min_bid in reserve for every roster slot still to fill.
        from src.draft_hub.draft_budgets import open_roster_slots
        from src.draft_hub.rules_engine import salary_roster_limits_relaxed, should_need_bid

        roster = storage.list_team_roster(league_id, bot["id"])
        need = should_need_bid(rules, roster, nominee.get("position"))
        if _blocks_luxury_min_steal(rules, league_id, roster, nominee.get("position")):
            continue
        luxury = not need
        if salary_roster_limits_relaxed(rules):
            affordable = budget
        else:
            open_slots = open_roster_slots(rules, roster, draft_completed=False)
            affordable = budget - min_bid * max(0, open_slots - 1)
        ceiling = bot_max_price(
            bot["id"],
            nominee,
            min_bid,
            team=bot,
            luxury=luxury,
        )
        persona = resolve_bot_persona(bot)
        next_bid = next_bot_bid(high_bid, min(ceiling, affordable), min_bid, persona)
        if next_bid is None:
            continue
        try:
            return place_bid(league_id, f"bot:{bot['id']}", next_bid)
        except ValueError:
            continue
    return None


def _apply_uncontested_floor(league_id: str, session: dict[str, Any]) -> None:
    """If nobody contested a valued player, clear near 70% of fair.

    Live rooms still end at $1 when a human is the only bidder. Simulate
    nominates leftover stars into empty markets; paying a market floor
    spends leftover cap so recap awards are about the draft, not $1 bugs.
    """
    league = storage.get_league(league_id)
    if not league:
        return
    rules = LeagueRules.model_validate(league["rules"])
    min_bid = float(rules.auction.min_bid)
    nominee = session.get("current_nominee") or {}
    high = float(session.get("high_bid") or 0)
    try:
        fair = float(nominee.get("fair_value") or 0)
    except (TypeError, ValueError):
        fair = 0.0
    if high > min_bid + 1e-9 or fair < 8:
        return
    high_team_id = session.get("high_bidder_team_id")
    team = storage.get_team(high_team_id) if high_team_id else None
    if not team or not team.get("is_bot"):
        return
    ceiling = bot_max_price(team["id"], nominee, min_bid, team=team, luxury=True)
    floor = min(ceiling, max(min_bid, round(fair * 0.7)))
    if floor <= high:
        return
    sub = _team_sub(team)
    if not sub:
        return
    try:
        place_bid(league_id, sub, floor)
    except ValueError:
        pass


def _settle_auction(league_id: str) -> None:
    """Resolve the current auction with the same bot loop as the live room."""
    from src.draft_hub.draft_state import award_nominee

    session = storage.get_draft_session(league_id) or {}
    if session.get("status") != "bidding":
        return
    for _ in range(80):
        if maybe_bot_bid(league_id) is None:
            break
    session = storage.get_draft_session(league_id) or {}
    if session.get("status") != "bidding":
        return
    _apply_uncontested_floor(league_id, session)
    award_nominee(league_id)


def simulate_draft(
    league_id: str,
    commissioner_sub: str,
    max_picks: int | None = None,
) -> dict[str, Any]:
    """Run the whole draft instantly (dev tool, practice rooms only)."""
    from src.draft_hub.draft_state import (
        _advance_nominator,
        _current_nominator_team_id,
        end_draft,
        get_room_state,
        make_pick,
        nominate,
        start_draft,
        suppress_room_state,
    )
    from src.draft_hub.pick_draft import is_pick_draft

    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != commissioner_sub:
        raise ValueError("Only commissioner can simulate the draft")
    if not storage.league_test_mode(league_id):
        raise ValueError("Simulation is only available in practice draft rooms")

    session = storage.get_draft_session(league_id)
    if not session or session.get("status") == "setup":
        start_draft(league_id, commissioner_sub)

    rules = LeagueRules.model_validate(league["rules"])
    teams = storage.list_league_teams(league_id)
    pick_cap = int(max_picks) if max_picks else _total_roster_slots(rules) * max(1, len(teams))
    picks = 0
    stalled_turns = 0
    with _SIMULATION_LOCK:
        SIMULATING_LEAGUE_IDS.add(str(league_id))
    mark_simulation(league_id, status="running", done=0, total=pick_cap, error=None)
    try:
        with suppress_room_state():
            # Every iteration either nominates, settles an auction, or skips a full
            # roster — bounded by picks plus one skipped turn per team per pick.
            for _ in range(pick_cap * (len(teams) + 2) + 10):
                session = storage.get_draft_session(league_id) or {}
                status = session.get("status")
                if status == "completed" or picks >= pick_cap:
                    break
                if status == "bidding":
                    _settle_auction(league_id)
                    picks += 1
                    mark_simulation(league_id, done=picks, total=pick_cap)
                    continue
                if status == "picking":
                    nominator_id = _current_nominator_team_id(session, rules)
                    team = storage.get_team(nominator_id) if nominator_id else None
                    payload = (
                        _pick_nomination_payload(league_id, league, rules, team, session)
                        if team
                        else None
                    )
                    sub = _team_sub(team) if team else None
                    picked = False
                    if payload and sub:
                        try:
                            make_pick(league_id, sub, payload, from_pool=True)
                            picked = True
                            picks += 1
                            mark_simulation(league_id, done=picks, total=pick_cap)
                        except ValueError:
                            pass
                    if picked:
                        stalled_turns = 0
                    else:
                        _advance_nominator(league_id)
                        stalled_turns += 1
                        if stalled_turns >= max(1, len(teams)):
                            break
                    continue
                if status != "nominating":
                    break

                nominator_id = _current_nominator_team_id(
                    session, rules if is_pick_draft(rules) else None
                )
                team = storage.get_team(nominator_id) if nominator_id else None
                payload = (
                    _pick_nomination_payload(league_id, league, rules, team, session)
                    if team
                    else None
                )
                sub = _team_sub(team) if team else None
                nominated = False
                if payload and sub:
                    try:
                        nominate(league_id, sub, payload, from_pool=True)
                        nominated = True
                    except ValueError:
                        pass
                if nominated:
                    stalled_turns = 0
                else:
                    # Roster full (or pool empty) for this team — pass the clock along.
                    _advance_nominator(league_id)
                    stalled_turns += 1
                    if stalled_turns >= max(1, len(teams)):
                        break  # nobody can nominate: the draft is over

            session = storage.get_draft_session(league_id) or {}
            if session.get("status") != "completed":
                from src.draft_hub.draft_state import draft_completion_errors

                # Partial sims (max_picks) and starved pools still need a clean stop.
                force = max_picks is not None or bool(draft_completion_errors(league_id))
                end_draft(league_id, commissioner_sub, force=force)
        mark_simulation(league_id, status="completed", done=picks, total=pick_cap, error=None)
    except Exception as exc:
        mark_simulation(league_id, status="failed", error=str(exc) or "Simulation failed")
        raise
    finally:
        with _SIMULATION_LOCK:
            SIMULATING_LEAGUE_IDS.discard(str(league_id))
    return get_room_state(league_id, commissioner_sub)
