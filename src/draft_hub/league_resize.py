"""Staff add/remove of auction-league franchises.

Configured ``league.team_count`` is a create-time seat cap today. This module
is the single resize path: bump the cap, create or delete a franchise row, and
tell staff what else has to happen (invite, schedule, Strategy values).

Allowed window: setup / pre-draft only (draft not completed, room not live).
A completed season must advance the year first so the new club joins the next
auction with a full cap and no keepers. Existing contracts stay on their clubs.
"""

from __future__ import annotations

import json
from typing import Any

from src.draft_hub import storage
from src.draft_hub.pre_draft_cap import is_active_for_pre_draft
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.trade_proposals import cancel_proposal

MIN_TEAM_COUNT = 2
MAX_TEAM_COUNT = 20
LIVE_SESSION = frozenset({"nominating", "bidding", "picking"})


class LeagueResizeError(ValueError):
    """Staff-facing blocker for add/remove franchise."""


def _rules(league: dict[str, Any]) -> LeagueRules:
    raw = league.get("rules") or {}
    if isinstance(raw, LeagueRules):
        return raw
    return LeagueRules.model_validate(raw)


def next_count_on_add(configured: int, actual: int) -> int:
    return max(int(configured or 0), int(actual) + 1, MIN_TEAM_COUNT)


def next_count_on_remove(configured: int, actual: int) -> int:
    remaining = int(actual) - 1
    configured = int(configured or 0)
    if remaining < MIN_TEAM_COUNT:
        return max(MIN_TEAM_COUNT, configured)
    if actual >= configured:
        return max(MIN_TEAM_COUNT, remaining)
    return max(MIN_TEAM_COUNT, configured)


def _phase_blocker(league: dict[str, Any], session: dict[str, Any] | None) -> str | None:
    status = str((session or {}).get("status") or "").lower()
    if status in LIVE_SESSION or str(league.get("status") or "").lower() == "live":
        return "The auction is live. Finish or reset the draft first."
    if league.get("draft_completed"):
        return (
            "This season is already drafted. Advance the year, then add or remove "
            "a franchise before the next auction."
        )
    return None


def _active_contracts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if is_active_for_pre_draft(row)]


def _pending_trades_for_team(league_id: str, team_id: str) -> list[dict[str, Any]]:
    tid = str(team_id)
    out: list[dict[str, Any]] = []
    for prop in storage.list_trade_proposals(league_id, status="pending"):
        parties = prop.get("parties") or []
        if any(str(p.get("team_id")) == tid for p in parties):
            out.append(prop)
    return out


def _pending_invites_for_team(league_id: str, team: dict[str, Any]) -> list[dict[str, Any]]:
    name = str(team.get("name") or "").strip().lower()
    if not name:
        return []
    return [
        inv
        for inv in storage.list_league_invites(league_id)
        if str(inv.get("status") or "") == "pending"
        and str(inv.get("team_name") or "").strip().lower() == name
    ]


def _open_fa_bids_for_team(league_id: str, team_id: str) -> list[dict[str, Any]]:
    tid = str(team_id)
    return [
        bid
        for bid in storage.list_fa_bids(league_id, status="open")
        if str(bid.get("team_id")) == tid
    ]


def _maybe_rebuild_schedule(league_id: str, league: dict[str, Any]) -> bool:
    season = int(league.get("season") or 0)
    if not season:
        return False
    if storage.list_season_team_scores(league_id, season):
        return False
    if not storage.list_season_matchups(league_id, season):
        return False
    from src.draft_hub.hub_scoring import ensure_season_schedule

    ensure_season_schedule(league_id, season=season, rules=_rules(league), force=True)
    return True


def _sync_nomination_order(league_id: str, team_ids: list[str]) -> None:
    session = storage.get_draft_session(league_id) or {}
    order = [str(x) for x in (session.get("nomination_order") or [])]
    if not order:
        return
    wanted = [tid for tid in team_ids]
    kept = [tid for tid in order if tid in set(wanted)]
    for tid in wanted:
        if tid not in kept:
            kept.append(tid)
    storage.update_draft_session(league_id, nomination_order_json=json.dumps(kept))


def preview_add_franchise(league_id: str, name: str | None = None) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise LeagueResizeError("League not found")
    session = storage.get_draft_session(league_id)
    teams = storage.list_league_teams(league_id)
    rules = _rules(league)
    cap = float(rules.salary_cap)
    configured = int(league.get("team_count") or 0)
    next_count = next_count_on_add(configured, len(teams))
    clean = str(name or "").strip()
    blocker = _phase_blocker(league, session)
    if next_count > MAX_TEAM_COUNT:
        blocker = blocker or f"Leagues stop at {MAX_TEAM_COUNT} franchises."
    if clean:
        taken = {str(t.get("name") or "").strip().lower() for t in teams}
        if clean.lower() in taken:
            blocker = blocker or f"{clean} is already a franchise in this league."
    consequences = [
        f"League becomes {next_count} teams.",
        f"New club starts at ${cap:g} with no keepers.",
        "Existing contracts stay on their current clubs.",
        "Strategy prices move — more seats, more relevant players.",
        "Invite the manager after the seat exists.",
    ]
    if league.get("sleeper_league_id"):
        consequences.append("Sleeper is separate. Add the roster there, then map it under Access.")
    return {
        "ok": blocker is None,
        "action": "add",
        "blocker": blocker,
        "name": clean or None,
        "current_team_count": configured,
        "next_team_count": next_count,
        "actual_teams": len(teams),
        "salary_cap": cap,
        "sleeper_linked": bool(league.get("sleeper_league_id")),
        "consequences": consequences,
    }


def apply_add_franchise(league_id: str, name: str) -> dict[str, Any]:
    preview = preview_add_franchise(league_id, name)
    if not preview["ok"]:
        raise LeagueResizeError(preview["blocker"] or "Cannot add this franchise")
    clean = str(name or "").strip()
    if not clean:
        raise LeagueResizeError("Name the franchise")
    league = storage.get_league(league_id)
    if not league:
        raise LeagueResizeError("League not found")
    team = storage.add_unclaimed_team(league_id, clean, float(preview["salary_cap"]))
    updated = storage.update_league_team_count(league_id, int(preview["next_team_count"]))
    teams = storage.list_league_teams(league_id)
    _sync_nomination_order(league_id, [str(t["id"]) for t in teams])
    rebuilt = _maybe_rebuild_schedule(league_id, updated or league)
    return {
        "ok": True,
        "action": "add",
        "team": team,
        "league": updated or storage.get_league(league_id),
        "schedule_rebuilt": rebuilt,
        "preview": preview_add_franchise(league_id),
    }


def preview_remove_franchise(league_id: str, team_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise LeagueResizeError("League not found")
    session = storage.get_draft_session(league_id)
    team = storage.get_team(team_id)
    if not team or str(team.get("league_id")) != str(league_id):
        raise LeagueResizeError("Team not found in this league")
    teams = storage.list_league_teams(league_id)
    configured = int(league.get("team_count") or 0)
    rows = storage.list_team_roster(league_id, team_id)
    active = _active_contracts(rows)
    trades = _pending_trades_for_team(league_id, team_id)
    invites = _pending_invites_for_team(league_id, team)
    bids = _open_fa_bids_for_team(league_id, team_id)
    scored = storage.team_has_week_scores(league_id, team_id)
    comm_sub = str(league.get("commissioner_sub") or "")
    is_primary = bool(team.get("user_sub")) and str(team.get("user_sub")) == comm_sub

    blocker = _phase_blocker(league, session)
    if is_primary:
        blocker = blocker or "The primary commissioner franchise stays."
    if len(teams) <= 1:
        blocker = blocker or "The last franchise stays. Add another club before you fold this one."
    if active:
        blocker = blocker or (
            f"{len(active)} contract{'s' if len(active) != 1 else ''} still on this roster. "
            "Cut or trade them on Contracts first."
        )
    if scored:
        blocker = blocker or "This franchise already has week scores. Historic clubs stay."

    next_count = next_count_on_remove(configured, len(teams))

    consequences = [
        f"League becomes {next_count} teams." if next_count != configured
        else "The seat closes. Configured league size stays the same.",
        "The seat closes. Invite and claim links for this name stop.",
        "Strategy prices move — fewer seats, tighter relevant pool.",
    ]
    if trades:
        consequences.append(f"{len(trades)} pending trade{'s' if len(trades) != 1 else ''} will cancel.")
    if invites:
        consequences.append("Pending email invites for this name will revoke.")
    if bids:
        consequences.append(f"{len(bids)} open FA bid{'s' if len(bids) != 1 else ''} will cancel.")
    if league.get("sleeper_league_id"):
        consequences.append("Sleeper is separate. Remove the roster there if it should leave that league too.")

    return {
        "ok": blocker is None,
        "action": "remove",
        "blocker": blocker,
        "team_id": str(team_id),
        "team_name": team.get("name"),
        "claimed": bool(team.get("user_sub")),
        "current_team_count": configured,
        "next_team_count": next_count,
        "actual_teams": len(teams),
        "active_contracts": len(active),
        "pending_trades": len(trades),
        "pending_invites": len(invites),
        "open_fa_bids": len(bids),
        "has_week_scores": scored,
        "sleeper_linked": bool(league.get("sleeper_league_id")),
        "consequences": consequences,
    }


def apply_remove_franchise(
    league_id: str,
    team_id: str,
    *,
    actor_sub: str,
) -> dict[str, Any]:
    preview = preview_remove_franchise(league_id, team_id)
    if not preview["ok"]:
        raise LeagueResizeError(preview["blocker"] or "Cannot remove this franchise")
    league = storage.get_league(league_id)
    if not league:
        raise LeagueResizeError("League not found")

    for prop in _pending_trades_for_team(league_id, team_id):
        cancel_proposal(str(prop["id"]), user_sub=actor_sub, is_commissioner=True)
    for inv in _pending_invites_for_team(league_id, storage.get_team(team_id) or {}):
        storage.revoke_league_invite(league_id, str(inv["id"]))
    storage.cancel_open_fa_bids_for_team(league_id, team_id)
    storage.delete_league_team(league_id, team_id)

    remaining = storage.list_league_teams(league_id)
    next_count = int(preview["next_team_count"])
    updated = storage.update_league_team_count(league_id, next_count)
    _sync_nomination_order(league_id, [str(t["id"]) for t in remaining])
    rebuilt = _maybe_rebuild_schedule(league_id, updated or league)
    return {
        "ok": True,
        "action": "remove",
        "deleted_team_id": team_id,
        "league": updated or storage.get_league(league_id),
        "schedule_rebuilt": rebuilt,
        "preview": preview,
    }


def league_resize_snapshot(league_id: str) -> dict[str, Any]:
    """Members-pane payload: add preview plus a remove preview per franchise."""
    league = storage.get_league(league_id)
    if not league:
        raise LeagueResizeError("League not found")
    teams = storage.list_league_teams(league_id)
    add = preview_add_franchise(league_id)
    removals = []
    for team in teams:
        try:
            removals.append(preview_remove_franchise(league_id, str(team["id"])))
        except LeagueResizeError as exc:
            removals.append(
                {
                    "ok": False,
                    "action": "remove",
                    "blocker": str(exc),
                    "team_id": str(team["id"]),
                    "team_name": team.get("name"),
                }
            )
    return {
        "team_count": int(league.get("team_count") or 0),
        "actual_teams": len(teams),
        "add": add,
        "removals": removals,
    }
