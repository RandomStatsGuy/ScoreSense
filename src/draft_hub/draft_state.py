"""Draft room state machine — nomination, bidding, cuts."""

from __future__ import annotations

import contextlib
import contextvars
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from src.draft_hub.rules_engine import (
    assert_can_acquire,
    cut_refund,
    occupying_min_errors,
    normalize_position,
    roster_capacity,
    salary_roster_limits_relaxed,
)
from src.draft_hub.schemas import LeagueRules
from src.draft_hub import storage
from src.draft_hub.draft_pool import normalize_pool_mode, resolve_nomination_player
from src.draft_hub.jsonutil import dumps as json_dumps
from src.draft_hub.jsonutil import json_safe
from src.draft_hub.pick_draft import (
    all_rosters_full,
    draft_type_of,
    is_pick_draft,
    pick_clock,
    team_at_pick_index,
    team_roster_is_full,
)

_RETURN_ROOM_STATE: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "draft_return_room_state",
    default=True,
)


@contextlib.contextmanager
def suppress_room_state() -> Iterator[None]:
    """Skip get_room_state rebuilds on nominate/award/pick during instant sims."""
    token = _RETURN_ROOM_STATE.set(False)
    try:
        yield
    finally:
        _RETURN_ROOM_STATE.reset(token)


def _emit_state(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    if not _RETURN_ROOM_STATE.get():
        return {}
    return get_room_state(league_id, user_sub)


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


def _parse_bid_deadline(value: Any, fallback: datetime) -> datetime:
    if not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _extend_bid_deadline(session: dict[str, Any], rules: LeagueRules) -> str:
    """Extend only late bids by a few seconds — never refill the opening clock.

    Early bids used to add `bid_extension_sec` back toward `bid_timer_sec`,
    which read as a 31-second reset on every +$1. Real rooms only bump the
    clock when time is almost gone.
    """
    ext = max(0, int(getattr(rules.auction, "bid_extension_sec", 5) or 0))
    now = datetime.now(timezone.utc)
    raw = session.get("bid_deadline")
    if not raw:
        return (now + timedelta(seconds=max(ext, 1))).isoformat()
    deadline = _parse_bid_deadline(raw, now)
    remaining = max(0.0, (deadline - now).total_seconds())
    late_window = float(max(ext, 1))
    if remaining > late_window:
        return deadline.isoformat()
    new_remaining = min(late_window + ext, remaining + ext)
    return (now + timedelta(seconds=new_remaining)).isoformat()


def _build_nomination_order(teams: list[dict[str, Any]]) -> list[str]:
    """Humans first (commissioner, then join order), then bots."""
    humans = [t for t in teams if not t.get("is_bot")]
    bots = [t for t in teams if t.get("is_bot")]
    humans.sort(key=lambda t: (not t.get("is_commissioner"), t.get("joined_at") or ""))
    bots.sort(key=lambda t: t.get("joined_at") or "")
    return [str(t["id"]) for t in humans + bots]


def nomination_order_for_start(
    league: dict[str, Any],
    teams: list[dict[str, Any]],
    session: dict[str, Any] | None = None,
) -> list[str]:
    """Honor claimed draft slots, then any saved order, then the default seating."""
    team_ids = {str(t["id"]) for t in teams}
    team_count = int(league.get("team_count") or 0) or len(teams)
    slotted: dict[int, str] = {}
    for team in teams:
        raw = team.get("draft_slot")
        if raw is None:
            continue
        try:
            slot = int(raw)
        except (TypeError, ValueError):
            continue
        tid = str(team["id"])
        if 1 <= slot <= max(team_count, len(teams)) and tid not in slotted.values():
            slotted.setdefault(slot, tid)
    existing = [
        str(tid)
        for tid in ((session or {}).get("nomination_order") or [])
        if str(tid) in team_ids
    ]
    leftover_source = existing or _build_nomination_order(teams)
    used = set(slotted.values())
    leftover = [tid for tid in leftover_source if tid not in used]
    leftover += [str(t["id"]) for t in teams if str(t["id"]) not in used and str(t["id"]) not in leftover]
    if not slotted:
        return leftover if leftover else _build_nomination_order(teams)
    order: list[str] = []
    leftover_i = 0
    span = max(team_count, len(teams), max(slotted) if slotted else 0)
    for index in range(1, span + 1):
        if index in slotted:
            order.append(slotted[index])
        elif leftover_i < len(leftover):
            order.append(leftover[leftover_i])
            leftover_i += 1
    while leftover_i < len(leftover):
        if leftover[leftover_i] not in order:
            order.append(leftover[leftover_i])
        leftover_i += 1
    return order


def _current_nominator_team_id(
    session: dict[str, Any],
    rules: LeagueRules | None = None,
) -> str | None:
    order = session.get("nomination_order") or []
    if not order:
        return None
    idx = int(session.get("nominator_index") or 0)
    if rules is not None and is_pick_draft(rules):
        return team_at_pick_index(order, idx, draft_type_of(rules))
    return str(order[idx % len(order)])


def _skip_full_on_clock(league_id: str) -> None:
    """Advance past teams that already filled every roster slot."""
    league = storage.get_league(league_id)
    if not league:
        return
    rules = LeagueRules.model_validate(league["rules"])
    session = storage.get_draft_session(league_id) or {}
    order = list(session.get("nomination_order") or [])
    if not order:
        return
    idx = int(session.get("nominator_index") or 0)
    n = len(order)
    if is_pick_draft(rules):
        dtype = draft_type_of(rules)
        for _ in range(n * 4 + 2):
            if all_rosters_full(league_id, rules):
                break
            tid = team_at_pick_index(order, idx, dtype)
            roster = storage.list_team_roster(league_id, tid) if tid else []
            if not team_roster_is_full(rules, roster):
                break
            idx += 1
        storage.update_draft_session(league_id, nominator_index=idx)
        return
    idx = idx % n
    for _ in range(n):
        if all_rosters_full(league_id, rules):
            break
        tid = order[idx]
        roster = storage.list_team_roster(league_id, tid) if tid else []
        if not team_roster_is_full(rules, roster):
            break
        idx = (idx + 1) % n
    storage.update_draft_session(league_id, nominator_index=idx)


def _advance_nominator(league_id: str) -> None:
    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id) or {}
    order = session.get("nomination_order") or []
    if not order:
        return
    rules = LeagueRules.model_validate(league["rules"]) if league else None
    idx = int(session.get("nominator_index") or 0)
    if rules is not None and is_pick_draft(rules):
        storage.update_draft_session(league_id, nominator_index=idx + 1)
        _skip_full_on_clock(league_id)
        return
    idx = (idx + 1) % len(order)
    storage.update_draft_session(league_id, nominator_index=idx)
    _skip_full_on_clock(league_id)


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
    timer_keys = (
        "min_bid",
        "nomination_timer_sec",
        "bid_timer_sec",
        "bid_extension_sec",
        "bot_reaction_delay_sec",
    )
    has_timer_updates = any(updates.get(key) is not None for key in timer_keys)
    if has_timer_updates and session.get("status") and session.get("status") != "setup":
        raise ValueError("Auction settings can only change before the draft starts")
    relax = updates.get("relax_salary_roster_limits")
    if relax is not None and not storage.league_test_mode(league_id):
        raise ValueError("Salary and roster limits can only be relaxed in a practice sandbox")
    rules = LeagueRules.model_validate(league["rules"])
    auction = rules.auction.model_dump()
    for key in timer_keys:
        if updates.get(key) is not None:
            auction[key] = int(updates[key])
    patch: dict[str, Any] = {"auction": rules.auction.model_copy(update=auction)}
    if relax is not None:
        patch["relax_salary_roster_limits"] = bool(relax)
    rules = rules.model_copy(update=patch)
    storage.update_league_rules(league_id, rules)
    if relax is not None:
        from src.draft_hub.draft_budgets import sync_league_auction_budgets

        sync_league_auction_budgets(league_id)
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


def _finite_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return num


def _pick_value_grade(amount: float, fair_value: float | None, per_game: float | None = None) -> str:
    fair = _finite_or_none(fair_value)
    if fair is None or amount <= 0:
        return "pick"
    ratio = fair / float(amount)
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
    pg = _finite_or_none(per_game)
    fair = _finite_or_none(fair_value)
    spent_n = _finite_or_none(amount)
    ppg = f"{pg:.1f} PPG" if pg is not None else None
    fair_s = f"${fair:.0f} fair" if fair is not None else None
    spent = f"${spent_n:.0f} spent" if spent_n is not None else None
    meta = " · ".join(x for x in (ppg, fair_s, spent) if x)
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


def _room_event_limit(rules: LeagueRules, team_count: int) -> int:
    """Auction keeps a short live log; pick drafts need every pick for the board."""
    if not is_pick_draft(rules):
        return 50
    roster_max = int(getattr(rules, "roster_size_max", None) or 16)
    n = max(2, int(team_count) or 2)
    return max(80, n * roster_max + 64)


def get_room_state(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    session = storage.get_draft_session(league_id) or {}
    rules = LeagueRules.model_validate(league["rules"])
    teams = storage.list_league_teams(league_id)
    configured_teams = int(league.get("team_count") or 0) or len(teams)
    events = storage.list_draft_events(
        league_id,
        limit=_room_event_limit(rules, max(len(teams), configured_teams)),
    )
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
    picks = [e for e in events if str(e.get("event_type") or "") == "pick"]
    out: dict[str, Any] = {
        "league": league,
        "session": session,
        "teams": enriched_teams,
        "events": events,
        "picks": picks,
        "rosters": rosters,
        "roster_limits": rules.roster,
        "roster_size_max": int(getattr(rules, "roster_size_max", None) or 0) or None,
        "pool_mode": normalize_pool_mode(session.get("pool_mode")),
        "nominator_team_id": _current_nominator_team_id(session, rules) if session else None,
        "draft_type": draft_type_of(rules),
        "pick": pick_clock(session, rules) if is_pick_draft(rules) else None,
        "empty_seats": empty_seat_count(league_id, league),
        "claimed_humans": len(claimed_human_teams(league_id)),
        "limits_relaxed": salary_roster_limits_relaxed(rules),
    }
    try:
        from src.draft_hub.test_draft import simulation_progress

        sim = simulation_progress(league_id)
    except Exception:
        sim = None
    if sim:
        out["simulation"] = sim
    if user_sub:
        team = storage.get_team_by_user(league_id, user_sub)
        is_staff = str(league.get("commissioner_sub") or "") == str(user_sub) or bool(
            team and team.get("is_commissioner")
        )
        if is_staff and not league.get("test_mode"):
            from src.draft_hub.league_claim import staff_claim_payload

            out["claim"] = staff_claim_payload(league)
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
                "nomination_queue": list(team.get("nomination_queue") or []),
                "autodraft": bool(team.get("autodraft")),
                "is_commissioner": (
                    str(league.get("commissioner_sub") or "") == str(user_sub)
                    or bool(team.get("is_commissioner"))
                ),
                "is_guest": storage.is_guest_sub(user_sub),
                **finance,
            }
    return json_safe(out)


def _require_commissioner(league: dict[str, Any], user_sub: str) -> None:
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can do that")

def user_is_draft_staff(league_id: str, user_sub: str) -> bool:
    """Primary commissioner or co-commissioner. Does not change hub focus."""
    league = storage.get_league(league_id)
    if not league:
        return False
    if str(league.get("commissioner_sub") or "") == str(user_sub):
        return True
    team = storage.get_team_by_user(league_id, user_sub)
    return bool(team and team.get("is_commissioner"))



def _assert_not_paused(session: dict[str, Any] | None) -> None:
    if session and session.get("paused"):
        raise ValueError("Draft is paused")


def _parse_league_start(starts_at: str, tz_name: str) -> datetime:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        zone = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception) as exc:
        raise ValueError(f"Unknown timezone: {tz_name}") from exc
    text = str(starts_at).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("draft_starts_at must be an ISO datetime") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zone)
    return dt.astimezone(timezone.utc)


def set_draft_schedule(
    league_id: str,
    user_sub: str,
    *,
    starts_at: str | None = None,
    timezone_name: str | None = None,
    clear: bool = False,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    _require_commissioner(league, user_sub)
    session = storage.get_draft_session(league_id) or {}
    if session.get("status") not in (None, "", "setup"):
        raise ValueError("Draft time can only change before the draft starts")
    if clear:
        storage.update_league_settings(league_id, clear_draft_start=True)
        return get_room_state(league_id, user_sub)
    tz = str(timezone_name or league.get("draft_timezone") or "America/New_York").strip() or "America/New_York"
    utc = None
    if starts_at:
        utc = _parse_league_start(starts_at, tz).replace(microsecond=0).isoformat()
    storage.update_league_settings(
        league_id,
        draft_starts_at=utc,
        draft_timezone=tz,
    )
    return get_room_state(league_id, user_sub)


def claimed_human_teams(league_id: str) -> list[dict[str, Any]]:
    return [
        t
        for t in storage.list_league_teams(league_id)
        if not t.get("is_bot") and t.get("user_sub")
    ]


def empty_seat_count(league_id: str, league: dict[str, Any] | None = None) -> int:
    row = league or storage.get_league(league_id) or {}
    target = int(row.get("team_count") or 0)
    return max(0, target - len(claimed_human_teams(league_id)))


def start_draft(
    league_id: str,
    user_sub: str,
    *,
    force: bool = False,
    allow_empty: bool = False,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league["commissioner_sub"] != user_sub:
        raise ValueError("Only commissioner can start draft")
    session = storage.get_draft_session(league_id) or {}
    if session.get("status") in ("nominating", "bidding", "picking"):
        return get_room_state(league_id, user_sub)
    starts = league.get("draft_starts_at")
    if starts and not force:
        when = _parse_utc(starts)
        if datetime.now(timezone.utc) < when:
            raise ValueError(
                "Draft is scheduled for later. Use Start now (force) to override."
            )
    if not storage.league_test_mode(league_id) and not allow_empty:
        empty = empty_seat_count(league_id, league)
        if empty:
            claimed = len(claimed_human_teams(league_id))
            target = int(league.get("team_count") or 0)
            noun = "seat" if empty == 1 else "seats"
            raise ValueError(
                f"{empty} empty {noun} ({claimed} of {target} claimed). "
                "Fill the room or start with empty seats."
            )
    rules = LeagueRules.model_validate(league["rules"])
    from src.draft_hub.draft_budgets import sync_league_auction_budgets

    sync_league_auction_budgets(league_id)
    teams = storage.list_league_teams(league_id)
    order = nomination_order_for_start(league, teams, session)
    storage.update_league_status(league_id, "live")
    status = "picking" if is_pick_draft(rules) else "nominating"
    storage.update_draft_session(
        league_id,
        status=status,
        started_at=_now_iso(),
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        nomination_order_json=json.dumps(order),
        nominator_index=0,
        last_bid_at=None,
        paused=0,
        paused_at=None,
    )
    if is_pick_draft(rules):
        _skip_full_on_clock(league_id)
        if all_rosters_full(league_id, rules):
            return end_draft(league_id, user_sub, force=True)
    storage.append_draft_event(
        league_id,
        "start",
        {"by": user_sub, "draft_type": draft_type_of(rules)},
    )
    return get_room_state(league_id, user_sub)


def pause_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    _require_commissioner(league, user_sub)
    session = storage.get_draft_session(league_id)
    if not session or session.get("status") not in ("nominating", "bidding", "picking"):
        raise ValueError("Draft is not in progress")
    if session.get("paused"):
        return get_room_state(league_id, user_sub)
    storage.update_draft_session(league_id, paused=1, paused_at=_now_iso())
    storage.append_draft_event(league_id, "pause", {"by": user_sub})
    return get_room_state(league_id, user_sub)


def resume_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    _require_commissioner(league, user_sub)
    session = storage.get_draft_session(league_id)
    if not session or not session.get("paused"):
        return get_room_state(league_id, user_sub)
    paused_at = session.get("paused_at")
    shift = timedelta(0)
    if paused_at:
        shift = datetime.now(timezone.utc) - _parse_utc(paused_at)
        if shift.total_seconds() < 0:
            shift = timedelta(0)
    updates: dict[str, Any] = {"paused": 0, "paused_at": None}
    for key in ("nomination_deadline", "bid_deadline"):
        raw = session.get(key)
        if raw:
            updates[key] = (_parse_utc(raw) + shift).isoformat()
    storage.update_draft_session(league_id, **updates)
    storage.append_draft_event(league_id, "resume", {"by": user_sub})
    return get_room_state(league_id, user_sub)


def skip_nomination(league_id: str, user_sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    _require_commissioner(league, user_sub)
    session = storage.get_draft_session(league_id)
    if not session or session.get("status") not in ("nominating", "picking"):
        raise ValueError("No pick or nomination to skip")
    _assert_not_paused(session)
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session, rules)
    team = storage.get_team(nominator_id) if nominator_id else None
    _advance_nominator(league_id)
    storage.update_draft_session(
        league_id,
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        last_bid_at=None,
    )
    storage.append_draft_event(
        league_id,
        "pass",
        {
            "reason": "commissioner_skip",
            "team_id": nominator_id,
            "team_name": (team or {}).get("name"),
        },
    )
    return get_room_state(league_id, user_sub)


def set_nomination_queue(
    league_id: str,
    user_sub: str,
    player_ids: list[str],
    autodraft: bool | None = None,
) -> dict[str, Any]:
    team = _resolve_team(league_id, user_sub)
    if not team:
        raise ValueError("Not a league member")
    cleaned = [str(pid).strip() for pid in player_ids if str(pid or "").strip()]
    if len(cleaned) > 40:
        raise ValueError("Nomination queue is limited to 40 players")
    storage.update_team_draft_prefs(
        team["id"],
        nomination_queue=cleaned,
        autodraft=autodraft,
    )
    return get_room_state(league_id, user_sub)


def _pop_queue_player(team: dict[str, Any], player_id: str) -> None:
    queue = [str(pid) for pid in (team.get("nomination_queue") or [])]
    pid = str(player_id or "")
    if pid not in queue:
        return
    storage.update_team_draft_prefs(
        team["id"],
        nomination_queue=[x for x in queue if x != pid],
    )


def draft_completion_errors(league_id: str) -> list[str]:
    """Per-team positional minimums still unfilled (keepers + awards)."""
    league = storage.get_league(league_id)
    if not league:
        return ["League not found"]
    rules = LeagueRules.model_validate(league["rules"])
    by_team = storage.list_league_rosters_by_team(league_id)
    lines: list[str] = []
    for team in storage.list_league_teams(league_id):
        name = str(team.get("name") or "Team")
        errs = occupying_min_errors(rules, by_team.get(team["id"]) or [])
        if errs:
            lines.append(f"{name}: {'; '.join(errs)}")
    return lines


def end_draft(league_id: str, user_sub: str, *, force: bool = False) -> dict[str, Any]:
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
    min_errors = draft_completion_errors(league_id)
    if min_errors and not force:
        raise ValueError(
            "Cannot end draft — rosters still under positional minimums. "
            + " | ".join(min_errors)
            + ". Nominate remaining needs, or end anyway to override."
        )

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

    payload: dict[str, Any] = {"by": user_sub, "forced": bool(force and min_errors)}
    if min_errors and force:
        payload["incomplete_rosters"] = min_errors
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
        state["contract_year_tick"] = json_safe(year_tick)
    return state


def reset_live_draft(league_id: str, user_sub: str) -> dict[str, Any]:
    """Undo a live (non-practice) draft: clear auction picks/events, restore session to setup.

    Keepers (non-draft sources) stay. If draft was already marked complete, rewinds the
    contract year clock. Expired keepers are restored from the pre-tick snapshot or
    from SCORE-45 archived expired rows (never silently dropped).
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
        paused=0,
        paused_at=None,
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
    if not session or session.get("status") not in ("setup", "nominating", "picking"):
        raise ValueError("Pool mode can only change before or during an open draft")
    mode = normalize_pool_mode(pool_mode)
    storage.update_draft_session(league_id, pool_mode=mode)
    return get_room_state(league_id, user_sub)


def _resolved_pool_player(
    league: dict[str, Any],
    session: dict[str, Any],
    player: dict[str, Any],
    *,
    from_pool: bool,
) -> dict[str, Any]:
    from src.draft_hub.draft_pool import list_drafted_player_ids

    if str(player.get("player_id") or "") in list_drafted_player_ids(league["id"]):
        raise ValueError("Player already drafted")
    if from_pool:
        resolved = dict(player)
        if not resolved.get("player") and resolved.get("player_name"):
            resolved["player"] = resolved.get("player_name")
        return resolved
    workspace_id = storage.roster_workspace_for_league(league)
    ws = storage.get_workspace_by_id(workspace_id) if league.get("workspace_id") else None
    sleeper_ids = set((ws or {}).get("sleeper_player_ids") or [])
    return resolve_nomination_player(
        league_id=league["id"],
        pool_mode=session.get("pool_mode"),
        player_id=str(player.get("player_id") or ""),
        season=int(league["season"]),
        rules=LeagueRules.model_validate(league["rules"]),
        workspace_id=workspace_id,
        sleeper_player_ids=sleeper_ids,
    )


def _maybe_end_if_rosters_full(
    league_id: str,
    league: dict[str, Any],
    rules: LeagueRules,
) -> dict[str, Any] | None:
    if not all_rosters_full(league_id, rules):
        return None
    comm = league.get("commissioner_sub")
    if not comm:
        return None
    try:
        ended = end_draft(league_id, comm, force=True)
    except ValueError:
        return None
    return ended if _RETURN_ROOM_STATE.get() else {}


def nominate(
    league_id: str,
    user_sub: str,
    player: dict[str, Any],
    *,
    force: bool = False,
    from_pool: bool = False,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    caller_team = _resolve_team(league_id, user_sub)
    if not caller_team:
        raise ValueError("Not a league member")
    session = storage.get_draft_session(league_id)
    rules = LeagueRules.model_validate(league["rules"])
    if is_pick_draft(rules):
        raise ValueError("This league uses a pick draft. Select a player to pick.")
    if not session or session.get("status") not in ("nominating", "bidding"):
        raise ValueError("Draft not accepting nominations")
    _assert_not_paused(session)
    nominator_id = _current_nominator_team_id(session, rules)
    is_commissioner = league["commissioner_sub"] == user_sub
    test_mode = storage.league_test_mode(league_id)
    forced = False
    team = caller_team
    if nominator_id and str(caller_team["id"]) != str(nominator_id):
        if test_mode:
            team = caller_team
        elif force and is_commissioner:
            on_clock = storage.get_team(nominator_id)
            if not on_clock:
                raise ValueError("On-clock team not found")
            team = on_clock
            forced = True
        else:
            nominator = storage.get_team(nominator_id)
            name = (nominator or {}).get("name") or "another team"
            raise ValueError(f"It is {name}'s turn to nominate")
    resolved = _resolved_pool_player(league, session, player, from_pool=from_pool)
    pos = normalize_position(resolved.get("position") or player.get("position"))
    team_roster = storage.list_team_roster(league_id, team["id"])
    assert_can_acquire(rules, team_roster, pos)
    min_bid = float(rules.auction.min_bid)
    from src.draft_hub.draft_budgets import assert_can_afford_auction_bid

    assert_can_afford_auction_bid(
        rules,
        team_roster,
        float(team.get("budget_remaining") or 0),
        min_bid,
        draft_completed=bool(league.get("draft_completed")),
    )
    nominee = {
        "player_id": resolved.get("player_id") or player.get("player_id"),
        "player_name": resolved.get("player") or resolved.get("player_name") or player.get("player_name"),
        "team": resolved.get("team") or player.get("team"),
        "position": pos,
        "nominating_team_id": team["id"],
        "nominating_team_name": team.get("name"),
    }
    for key in (
        "fair_value",
        "season_proj",
        "per_game_proj",
        "season_p10",
        "season_p50",
        "season_p90",
        "season_spread",
        "is_rookie",
        "years_exp",
        "nfl_years_exp",
    ):
        val = resolved.get(key)
        if val is None:
            val = player.get(key)
        if val is not None:
            nominee[key] = val
    if forced:
        nominee["forced"] = True
        nominee["forced_by"] = user_sub
    storage.update_draft_session(
        league_id,
        status="bidding",
        current_nominee_json=json_dumps(nominee),
        high_bid=min_bid,
        high_bidder_team_id=team["id"],
        bid_deadline=_deadline(rules.auction.bid_timer_sec),
        last_bid_at=_now_iso(),
    )
    storage.append_draft_event(league_id, "nominate", nominee)
    if forced:
        storage.append_draft_event(
            league_id,
            "force_nominate",
            {
                "by": user_sub,
                "team_id": team["id"],
                "team_name": team.get("name"),
                "player_id": nominee.get("player_id"),
                "player_name": nominee.get("player_name"),
                "position": nominee.get("position"),
            },
        )
    storage.append_draft_event(
        league_id,
        "bid",
        {
            "team_id": team["id"],
            "team_name": team.get("name"),
            "amount": min_bid,
            "opening": True,
        },
    )
    _pop_queue_player(team, nominee.get("player_id"))
    return _emit_state(league_id, user_sub)


def make_pick(
    league_id: str,
    user_sub: str,
    player: dict[str, Any],
    *,
    force: bool = False,
    from_pool: bool = False,
) -> dict[str, Any]:
    """Assign a player to the on-clock team in a snake/linear draft."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    caller_team = _resolve_team(league_id, user_sub)
    if not caller_team:
        raise ValueError("Not a league member")
    session = storage.get_draft_session(league_id)
    rules = LeagueRules.model_validate(league["rules"])
    if not is_pick_draft(rules):
        raise ValueError("This league uses an auction. Nominate the player instead.")
    if not session or session.get("status") != "picking":
        raise ValueError("Draft is not accepting picks")
    _assert_not_paused(session)
    on_clock_id = _current_nominator_team_id(session, rules)
    is_commissioner = league["commissioner_sub"] == user_sub
    forced = False
    team = caller_team
    if on_clock_id and str(caller_team["id"]) != str(on_clock_id):
        if force and is_commissioner:
            on_clock = storage.get_team(on_clock_id)
            if not on_clock:
                raise ValueError("On-clock team not found")
            team = on_clock
            forced = True
        else:
            on_clock = storage.get_team(on_clock_id)
            name = (on_clock or {}).get("name") or "another team"
            raise ValueError(f"It is {name}'s turn to pick")
    resolved = _resolved_pool_player(league, session, player, from_pool=from_pool)
    workspace_id = storage.roster_workspace_for_league(league)
    pos = normalize_position(resolved.get("position") or player.get("position"))
    team_roster = storage.list_team_roster(league_id, team["id"])
    assert_can_acquire(rules, team_roster, pos)
    if team_roster_is_full(rules, team_roster):
        raise ValueError("That roster is already full")
    clock = pick_clock(session, rules)
    picked = {
        "player_id": resolved.get("player_id") or player.get("player_id"),
        "player_name": resolved.get("player") or resolved.get("player_name") or player.get("player_name"),
        "team": resolved.get("team") or player.get("team"),
        "position": pos,
        "picking_team_id": team["id"],
        "picking_team_name": team.get("name"),
        "team_id": team["id"],
        "team_name": team.get("name"),
        "amount": 0,
        "overall": clock.get("overall"),
        "round": clock.get("round"),
        "slot": clock.get("slot"),
    }
    for key in (
        "fair_value",
        "season_proj",
        "per_game_proj",
        "season_p10",
        "season_p50",
        "season_p90",
        "season_spread",
        "is_rookie",
        "years_exp",
        "nfl_years_exp",
    ):
        val = resolved.get(key)
        if val is None:
            val = player.get(key)
        if val is not None:
            picked[key] = val
    if forced:
        picked["forced"] = True
        picked["forced_by"] = user_sub
    storage.add_roster_slot(
        workspace_id,
        {
            "player_id": picked["player_id"],
            "player_name": picked.get("player_name"),
            "team": picked.get("team"),
            "position": picked.get("position"),
            "salary": 0.0,
            "contract_years": 1,
            "source": "draft",
        },
        team_id=team["id"],
    )
    storage.append_draft_event(league_id, "pick", picked)
    _pop_queue_player(team, picked.get("player_id"))
    _advance_nominator(league_id)
    ended = _maybe_end_if_rosters_full(league_id, league, rules)
    if ended is not None:
        return ended
    storage.update_draft_session(
        league_id,
        status="picking",
        current_nominee_json=None,
        high_bid=None,
        high_bidder_team_id=None,
        bid_deadline=None,
        last_bid_at=None,
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
    )
    return _emit_state(league_id, user_sub)


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
    _assert_not_paused(session)
    rules = LeagueRules.model_validate(league["rules"])
    if is_pick_draft(rules):
        raise ValueError("This league uses a pick draft, not an auction")
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
    return _emit_state(league_id, user_sub)


def award_nominee(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session:
        raise ValueError("Invalid session")
    nominee = session.get("current_nominee")
    winner_id = session.get("high_bidder_team_id")
    amount = session.get("high_bid")
    rules = LeagueRules.model_validate(league["rules"])
    if is_pick_draft(rules):
        raise ValueError("This league uses a pick draft, not an auction")
    min_bid = float(rules.auction.min_bid)
    if not nominee:
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
        storage.append_draft_event(league_id, "pass", {"reason": "no_nominee"})
        return _emit_state(league_id, user_sub)
    if not winner_id or amount is None:
        winner_id = nominee.get("nominating_team_id")
        amount = min_bid
        if not winner_id:
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
                {
                    "player_id": nominee.get("player_id"),
                    "player_name": nominee.get("player_name"),
                    "reason": "no_bids",
                },
            )
            return _emit_state(league_id, user_sub)

    winner = storage.get_team(winner_id)
    if not winner:
        raise ValueError("Winning team not found")
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
        return _emit_state(league_id, user_sub)
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
        _finite_or_none(nominee.get("fair_value")),
        _finite_or_none(nominee.get("per_game_proj")),
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
                fair_value=_finite_or_none(nominee.get("fair_value")),
                per_game=_finite_or_none(nominee.get("per_game_proj")),
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
    ended = _maybe_end_if_rosters_full(league_id, league, rules)
    if ended is not None:
        return ended
    return _emit_state(league_id, user_sub)


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


def _session_timer_fingerprint(session: dict[str, Any] | None) -> tuple:
    if not session:
        return ()
    nominee = session.get("current_nominee") or {}
    return (
        session.get("status"),
        session.get("high_bid"),
        session.get("high_bidder_team_id"),
        session.get("nominator_index"),
        session.get("bid_deadline"),
        session.get("nomination_deadline"),
        nominee.get("player_id") if isinstance(nominee, dict) else None,
    )


def _expire_nomination(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    """Nomination clock hit zero: auto-nominate BPA, or skip the on-clock team."""
    from src.draft_hub.test_draft import _pick_nomination_payload, _team_sub

    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session or session.get("status") != "nominating":
        return get_room_state(league_id, user_sub)
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session)
    team = storage.get_team(nominator_id) if nominator_id else None
    payload = (
        _pick_nomination_payload(league_id, league, rules, team, session) if team else None
    )
    sub = _team_sub(team) if team else None
    if payload and sub:
        try:
            nominate(league_id, sub, payload, from_pool=True)
            return get_room_state(league_id, user_sub)
        except ValueError:
            pass
    _advance_nominator(league_id)
    storage.update_draft_session(
        league_id,
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        last_bid_at=None,
    )
    storage.append_draft_event(
        league_id,
        "pass",
        {
            "reason": "nomination_timeout",
            "team_id": nominator_id,
            "team_name": (team or {}).get("name"),
        },
    )
    return get_room_state(league_id, user_sub)


def _expire_pick(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    """Pick clock hit zero: auto-pick BPA, or skip the on-clock team."""
    from src.draft_hub.test_draft import _pick_nomination_payload, _team_sub

    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session or session.get("status") != "picking":
        return get_room_state(league_id, user_sub)
    rules = LeagueRules.model_validate(league["rules"])
    nominator_id = _current_nominator_team_id(session, rules)
    team = storage.get_team(nominator_id) if nominator_id else None
    payload = (
        _pick_nomination_payload(league_id, league, rules, team, session) if team else None
    )
    sub = _team_sub(team) if team else None
    if payload and sub:
        try:
            make_pick(league_id, sub, payload, from_pool=True)
            return get_room_state(league_id, user_sub)
        except ValueError:
            pass
    _advance_nominator(league_id)
    storage.update_draft_session(
        league_id,
        nomination_deadline=_deadline(rules.auction.nomination_timer_sec),
        last_bid_at=None,
    )
    storage.append_draft_event(
        league_id,
        "pass",
        {
            "reason": "pick_timeout",
            "team_id": nominator_id,
            "team_name": (team or {}).get("name"),
        },
    )
    return get_room_state(league_id, user_sub)




def tick_scheduled_starts() -> list[str]:
    """Auto-start live leagues whose published draft time has arrived."""
    started: list[str] = []
    for league_id, commissioner_sub in storage.list_due_scheduled_drafts():
        try:
            start_draft(league_id, commissioner_sub)
            started.append(league_id)
        except ValueError:
            continue
    return started


def tick_expired_drafts() -> list[str]:
    """Advance every in-progress auction. Returns league ids whose state changed."""
    changed: list[str] = tick_scheduled_starts()
    from src.draft_hub.test_draft import SIMULATING_LEAGUE_IDS

    for league_id in storage.list_in_progress_draft_league_ids():
        if league_id in changed or league_id in SIMULATING_LEAGUE_IDS:
            continue
        before = _session_timer_fingerprint(storage.get_draft_session(league_id))
        check_timers(league_id)
        after = _session_timer_fingerprint(storage.get_draft_session(league_id))
        if before != after:
            changed.append(league_id)
    return changed


def check_timers(league_id: str, user_sub: str | None = None) -> dict[str, Any]:
    """Auto-pass expired bids/nominations/picks; bots may act in test mode."""
    from src.draft_hub.test_draft import (
        SIMULATING_LEAGUE_IDS,
        maybe_autodraft_nominate,
        maybe_autodraft_pick,
        maybe_bot_bid,
        maybe_bot_nominate,
        maybe_bot_pick,
    )

    if league_id in SIMULATING_LEAGUE_IDS:
        return get_room_state(league_id, user_sub)

    league = storage.get_league(league_id)
    session = storage.get_draft_session(league_id)
    if not league or not session:
        return get_room_state(league_id, user_sub)
    if session.get("paused"):
        return get_room_state(league_id, user_sub)
    now = datetime.now(timezone.utc)
    status = session.get("status")
    test_mode = storage.league_test_mode(league_id)
    if test_mode and status in ("nominating", "bidding", "picking"):
        rules = LeagueRules.model_validate(league["rules"])
        if _maybe_end_if_rosters_full(league_id, league, rules) is not None:
            return get_room_state(league_id, user_sub)
    # Bot actions build state under the bot's identity — rebuild with the
    # caller's sub or the polling client would adopt the bot's viewer/team.
    if status == "nominating" and test_mode:
        bot_state = maybe_bot_nominate(league_id)
        if bot_state:
            return get_room_state(league_id, user_sub)
    if status == "nominating":
        auto_state = maybe_autodraft_nominate(league_id)
        if auto_state:
            return get_room_state(league_id, user_sub)
    if status == "picking" and test_mode:
        bot_state = maybe_bot_pick(league_id)
        if bot_state:
            return get_room_state(league_id, user_sub)
    if status == "picking":
        auto_state = maybe_autodraft_pick(league_id)
        if auto_state:
            return get_room_state(league_id, user_sub)
    if status == "bidding" and session.get("bid_deadline"):
        deadline = _parse_utc(session["bid_deadline"])
        if now >= deadline:
            return award_nominee(league_id, user_sub)
        if _bot_delay_elapsed(session, LeagueRules.model_validate(league["rules"])):
            bot_state = maybe_bot_bid(league_id)
            if bot_state:
                return get_room_state(league_id, user_sub)
    session = storage.get_draft_session(league_id) or session
    status = session.get("status")
    if status == "nominating" and session.get("nomination_deadline"):
        deadline = _parse_utc(session["nomination_deadline"])
        if now >= deadline:
            return _expire_nomination(league_id, user_sub)
    if status == "picking" and session.get("nomination_deadline"):
        deadline = _parse_utc(session["nomination_deadline"])
        if now >= deadline:
            return _expire_pick(league_id, user_sub)
    return get_room_state(league_id, user_sub)
