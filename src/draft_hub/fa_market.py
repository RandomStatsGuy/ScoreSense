"""Post-draft FA and in-season waiver bidding (FAAB-style highest bid wins)."""

from __future__ import annotations

import math
from typing import Any

from src.draft_hub import storage
from src.draft_hub.acquisition_window import (
    ADD_BID,
    WINDOW_POST_DRAFT_FA,
    WINDOW_WAIVERS,
    resolve_acquisition_window,
)
from src.draft_hub.acquisition_semantics import POST_DRAFT_FA
from src.draft_hub.contracts import auction_win_is_rookie, build_auction_win_contract
from src.draft_hub.draft_budgets import preserve_cut_liability
from src.draft_hub.rules_engine import assert_can_acquire, blocking_acquisition_errors
from src.draft_hub.schemas import LeagueRules

STATUS_OPEN = "open"
STATUS_WON = "won"
STATUS_LOST = "lost"
STATUS_CANCELLED = "cancelled"


def _acquisition_type(window_id: str | None) -> str:
    key = str(window_id or "")
    if "waiver" in key:
        return "waiver"
    return POST_DRAFT_FA


def place_fa_bid(
    *,
    league_id: str,
    team_id: str,
    player_id: str,
    player_name: str,
    team: str,
    position: str,
    bid_amount: float,
    window_id: str,
    user_sub: str,
) -> dict[str, Any]:
    amount = round(float(bid_amount), 2)
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    bidder_team = storage.get_team(team_id)
    if not bidder_team or str(bidder_team.get("league_id")) != league_id:
        raise ValueError("Team does not belong to this league")
    rules = LeagueRules.model_validate(league["rules"])
    if rules.draft_type != "auction":
        raise ValueError("This league uses priority waiver claims")
    minimum = 1
    if not math.isfinite(amount) or amount < minimum:
        raise ValueError(f"Bid must be at least ${minimum}")
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
    if resolve_sleeper_league_id(league_id):
        raise ValueError("Add players in Sleeper, then sync this league.")
    if not league.get("test_mode"):
        from src.draft_hub.player_identity import resolve_acquisition_identity
        verified = resolve_acquisition_identity(
            {"player_id": player_id, "player_name": player_name, "team": team, "position": position},
            season=int(league["season"]))
        player_id, player_name, team, position = (verified[k] for k in ("player_id", "player_name", "team", "position"))
    roster = storage.list_team_roster(league_id, team_id)
    if not league.get("test_mode"):
        from src.draft_hub.player_identity import canonical_roster_metadata
        roster = canonical_roster_metadata(roster, season=int(league["season"]))
    assert_can_acquire(rules, roster, position)
    errors = blocking_acquisition_errors(rules, roster + [{"player_id": player_id, "position": position,
                                         "salary": amount if rules.draft_type == "auction" else 0}])
    if errors:
        raise ValueError(errors[0])
    existing = storage.get_occupying_player_identity(storage.roster_workspace_for_league(league),
                {"player_id": player_id}, season=int(league["season"]))
    if existing:
        raise ValueError(f"{player_name or 'Player'} is already on a roster")
    row = storage.upsert_fa_bid(
        league_id=league_id,
        team_id=team_id,
        player_id=player_id,
        player_name=player_name,
        nfl_team=team,
        position=position,
        bid_amount=amount,
        window_id=window_id,
        user_sub=user_sub,
    )
    return {"bid": row, "high_bid": None if "waiver" in window_id or rules.draft_type != "auction" else _high_bid_payload(league_id, window_id, player_id)}


def list_market(
    league_id: str,
    *,
    window_id: str | None,
    team_id: str | None = None,
) -> dict[str, Any]:
    open_bids = storage.list_fa_bids(league_id, window_id=window_id, status=STATUS_OPEN)
    league = storage.get_league(league_id)
    rules = LeagueRules.model_validate((league or {}).get("rules") or {})
    blind = "waiver" in str(window_id or "") or rules.draft_type != "auction"
    by_player: dict[str, list[dict[str, Any]]] = {}
    for bid in open_bids:
        if blind and str(bid["team_id"]) != str(team_id or ""):
            continue
        by_player.setdefault(str(bid["player_id"]), []).append(bid)
    players = []
    for pid, bids in by_player.items():
        ranked = sorted(bids, key=lambda b: (-float(b["bid_amount"]), str(b["created_at"])))
        high = ranked[0]
        mine = next((b for b in ranked if team_id and str(b["team_id"]) == str(team_id)), None)
        players.append(
            {
                "player_id": pid,
                "player_name": high.get("player_name"),
                "team": high.get("nfl_team"),
                "position": high.get("position"),
                "high_bid": None if blind else float(high["bid_amount"]),
                "bid_count": len(ranked),
                "my_bid": float(mine["bid_amount"]) if mine else None,
            }
        )
    players.sort(key=lambda p: (-float(p["high_bid"] or 0), str(p["player_name"] or "")))
    return {
        "window_id": window_id,
        "open_count": len([b for b in open_bids if not blind or str(b['team_id']) == str(team_id or '')]),
        "blind": blind,
        "players": players,
        "my_bids": [b for b in open_bids if team_id and str(b["team_id"]) == str(team_id)],
    }


def _high_bid_payload(league_id: str, window_id: str, player_id: str) -> dict[str, Any] | None:
    bids = storage.list_fa_bids(
        league_id, window_id=window_id, player_id=player_id, status=STATUS_OPEN
    )
    if not bids:
        return None
    ranked = sorted(bids, key=lambda b: (-float(b["bid_amount"]), str(b["created_at"])))
    high = ranked[0]
    return {
        "player_id": player_id,
        "high_bid": float(high["bid_amount"]),
        "bid_count": len(ranked),
        "player_name": high.get("player_name"),
    }


def process_window(league_id: str, window_id: str) -> dict[str, Any]:
    """Award each player to the highest open bid. Ties go to the earlier bid."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league["rules"])
    if rules.draft_type != "auction":
        raise ValueError("This league uses priority waiver claims")
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
    if resolve_sleeper_league_id(league_id):
        raise ValueError("Add players in Sleeper, then sync this league.")
    ws_id = storage.roster_workspace_for_league(league)
    open_bids = storage.list_fa_bids(league_id, window_id=window_id, status=STATUS_OPEN)
    by_player: dict[str, list[dict[str, Any]]] = {}
    for bid in open_bids:
        pid = str(bid["player_id"])
        if not league.get("test_mode"):
            from src.draft_hub.player_identity import cached_player_identity
            try:
                identity = cached_player_identity(pid, season=int(league["season"]))
                pid = identity["player_id"] if identity else pid
            except ValueError:
                pass  # The invalid claim is rejected below without blocking other players.
        by_player.setdefault(pid, []).append(bid)

    awarded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    acq = _acquisition_type(window_id)

    for pid, bids in by_player.items():
        ranked = sorted(bids, key=lambda b: (-float(b["bid_amount"]), str(b["created_at"])))
        existing = storage.get_occupying_player_identity(ws_id, {"player_id": pid}, season=int(league["season"]))
        if existing:
            for claimed_id in {str(bid["player_id"]) for bid in bids}:
                storage.close_fa_bids_for_player(league_id, window_id, claimed_id, winner_id=None)
            skipped.append({"player_id": pid, "reason": "already_rostered"})
            continue
        winner = None
        slot = None
        last_error = "no_eligible_bid"
        for bid in ranked:
            team_id = str(bid["team_id"])
            roster = storage.list_team_roster(league_id, team_id)
            if not league.get("test_mode"):
                from src.draft_hub.player_identity import canonical_roster_metadata
                roster = canonical_roster_metadata(roster, season=int(league["season"]))
            try:
                amount = float(bid["bid_amount"])
                hint = {"player_id": str(bid["player_id"]), "player_name": bid.get("player_name"), "team": bid.get("nfl_team"), "position": bid.get("position")}
                if not league.get("test_mode"):
                    from src.draft_hub.player_identity import resolve_acquisition_identity
                    hint = resolve_acquisition_identity(hint, season=int(league["season"]))
                    hint["_identity_guard"] = True
                assert_can_acquire(rules, roster, hint.get("position"))
                contract = build_auction_win_contract(rules, amount, is_rookie=auction_win_is_rookie(rules, hint)) if rules.draft_type == "auction" else {}
                contract["acquisition_type"] = acq
                if acq == "waiver":
                    contract["contract_phase"] = "waiver_rental"
                from src.draft_hub.hub_scoring import capture_native_lineups_before_roster_change
                capture_native_lineups_before_roster_change(league_id, [team_id])
                slot = storage.add_roster_slot(
                    ws_id,
                    {**hint,
                     "salary": amount if rules.draft_type == "auction" else 0,
                     "contract_years": int(contract.get("years_remaining") or 1),
                     "contract": contract, "source": "fa_bid"},
                    team_id=team_id, validate_rules=rules, winning_bid_id=str(bid["id"]),
                    bid_window_id=window_id, bid_amount=amount,
                )
            except ValueError as exc:
                last_error = str(exc)
                continue
            winner = bid
            break
        if winner is None:
            for claimed_id in {str(bid["player_id"]) for bid in bids}:
                storage.close_fa_bids_for_player(league_id, window_id, claimed_id, winner_id=None)
            skipped.append({"player_id": pid, "reason": last_error})
            continue
        amount = float(winner["bid_amount"])
        awarded.append(
            {
                "player_id": pid,
                "player_name": winner.get("player_name"),
                "team_id": winner["team_id"],
                "salary": float(slot.get("salary") or 0),
                "bid_amount": amount,
                "slot_id": slot.get("id"),
            }
        )

    return {
        "window_id": window_id,
        "awarded": awarded,
        "skipped": skipped,
        "awarded_count": len(awarded),
    }


def process_due_windows(league_id: str, current_window_id: str | None) -> dict[str, Any] | None:
    """Close any open bid windows that are no longer the active market."""
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
    if resolve_sleeper_league_id(league_id):
        return None
    open_ids = storage.list_open_fa_window_ids(league_id)
    results = []
    for wid in open_ids:
        if current_window_id and wid == current_window_id:
            continue
        results.append(process_window(league_id, wid))
    if not results:
        return None
    return {"processed": results}


def ensure_bidding_window(ctx: dict[str, Any]) -> dict[str, Any]:
    window = ctx.get("acquisition_window") or resolve_acquisition_window(ctx)
    if window.get("add_mode") != ADD_BID or not window.get("window_id"):
        raise ValueError(window.get("message") or "Bidding is not open right now")
    if window.get("id") not in {WINDOW_POST_DRAFT_FA, WINDOW_WAIVERS}:
        raise ValueError("Bidding is not open right now")
    return window
