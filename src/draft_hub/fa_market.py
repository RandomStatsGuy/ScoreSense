"""Post-draft FA and in-season waiver bidding (FAAB-style highest bid wins)."""

from __future__ import annotations

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
from src.draft_hub.rules_engine import assert_can_acquire
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
    if amount < 1:
        raise ValueError("Bid must be at least $1")
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    existing = storage.get_roster_slot(
        storage.roster_workspace_for_league(league),
        player_id,
    )
    if existing and str(existing.get("roster_status") or "active") == "active":
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
    return {"bid": row, "high_bid": _high_bid_payload(league_id, window_id, player_id)}


def list_market(
    league_id: str,
    *,
    window_id: str | None,
    team_id: str | None = None,
) -> dict[str, Any]:
    open_bids = storage.list_fa_bids(league_id, window_id=window_id, status=STATUS_OPEN)
    by_player: dict[str, list[dict[str, Any]]] = {}
    for bid in open_bids:
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
                "high_bid": float(high["bid_amount"]),
                "bid_count": len(ranked),
                "my_bid": float(mine["bid_amount"]) if mine else None,
            }
        )
    players.sort(key=lambda p: (-float(p["high_bid"]), str(p["player_name"] or "")))
    return {
        "window_id": window_id,
        "open_count": len(open_bids),
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
    ws_id = storage.roster_workspace_for_league(league)
    open_bids = storage.list_fa_bids(league_id, window_id=window_id, status=STATUS_OPEN)
    by_player: dict[str, list[dict[str, Any]]] = {}
    for bid in open_bids:
        by_player.setdefault(str(bid["player_id"]), []).append(bid)

    awarded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    acq = _acquisition_type(window_id)

    for pid, bids in by_player.items():
        ranked = sorted(bids, key=lambda b: (-float(b["bid_amount"]), str(b["created_at"])))
        existing = storage.get_roster_slot(ws_id, pid)
        if existing and str(existing.get("roster_status") or "active") == "active":
            storage.close_fa_bids_for_player(
                league_id, window_id, pid, winner_id=None
            )
            skipped.append({"player_id": pid, "reason": "already_rostered"})
            continue
        winner = None
        last_error = "no_eligible_bid"
        for bid in ranked:
            team_id = str(bid["team_id"])
            roster = storage.list_team_roster(league_id, team_id)
            try:
                assert_can_acquire(rules, roster, bid.get("position"))
            except ValueError as exc:
                last_error = str(exc)
                continue
            winner = bid
            break
        if winner is None:
            skipped.append({"player_id": pid, "reason": last_error})
            continue
        amount = float(winner["bid_amount"])
        hint = {
            "player_id": pid,
            "player_name": winner.get("player_name"),
            "team": winner.get("nfl_team"),
            "position": winner.get("position"),
        }
        is_rookie = auction_win_is_rookie(rules, hint)
        contract = build_auction_win_contract(rules, amount, is_rookie=is_rookie)
        contract["acquisition_type"] = acq
        if acq == "waiver":
            contract["contract_phase"] = "waiver_rental"
        preserve_cut_liability(ws_id, pid)
        slot = storage.add_roster_slot(
            ws_id,
            {
                "player_id": pid,
                "player_name": winner.get("player_name"),
                "team": winner.get("nfl_team"),
                "position": winner.get("position") or "WR",
                "salary": amount,
                "contract_years": int(contract.get("years_remaining") or 1),
                "contract": contract,
                "source": "fa_bid",
            },
            team_id=str(winner["team_id"]),
        )
        storage.close_fa_bids_for_player(
            league_id, window_id, pid, winner_id=str(winner["id"])
        )
        awarded.append(
            {
                "player_id": pid,
                "player_name": winner.get("player_name"),
                "team_id": winner["team_id"],
                "salary": amount,
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
