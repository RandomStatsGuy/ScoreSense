"""Review cap agreements separately from authoritative Sleeper player ownership."""
from src.draft_hub import storage
from src.draft_hub.trade_proposals import execute_multiparty_trade


def record_synced_moves(workspace_id: str, moves: list[dict]) -> None:
    if not moves:
        return
    first_team = storage.get_team(moves[0]["to_team_id"])
    league = storage.get_league(first_team["league_id"]) if first_team else None
    if not league or not league.get("sleeper_league_id") or storage.roster_workspace_for_league(league) != workspace_id:
        return
    team_ids = {t["id"] for t in storage.list_league_teams(league["id"])}
    moves = [m for m in moves if m["from_team_id"] in team_ids and m["to_team_id"] in team_ids]
    tracked = set()
    for prop in storage.list_trade_proposals(league["id"]):
        if prop["status"] in {"awaiting_sleeper", "cap_review"}:
            tracked.update((p["team_id"], s["player_id"], s["to_team_id"])
                           for p in prop["parties"] for s in p.get("sends", []))
    untracked = [m for m in moves if (m["from_team_id"], m["player_id"], m["to_team_id"]) not in tracked]
    if not untracked:
        return
    ids = list(dict.fromkeys(tid for m in untracked for tid in (m["from_team_id"], m["to_team_id"])))
    parties = [{"team_id": tid, "sends": [{"player_id": m["player_id"],
                    "player_name": m.get("player_name"), "to_team_id": m["to_team_id"]}
                    for m in untracked if m["from_team_id"] == tid], "drops": [], "dead_cap_transfers": []}
               for tid in ids]
    storage.create_trade_proposal(league["id"], created_by_sub=league["commissioner_sub"],
        parties=parties, status="cap_review", acceptances={},
        note="Player moves synced from Sleeper. Review any agreed dead-cap terms; Sleeper does not provide them.")


def settle_sleeper_proposal(proposal_id: str, *, user_sub: str) -> dict:
    prop = storage.get_trade_proposal(proposal_id)
    if not prop or prop["status"] != "awaiting_sleeper":
        raise ValueError("This proposal is not waiting for Sleeper")
    league = storage.get_league(prop["league_id"])
    teams = [storage.get_team(p["team_id"]) for p in prop["parties"]]
    if user_sub != league["commissioner_sub"] and not any(t and t.get("user_sub") == user_sub for t in teams):
        raise ValueError("Only a participating manager or commissioner can apply agreed cap terms")
    execute_multiparty_trade(prop["league_id"], prop["parties"], prop["dead_cap_assignments"],
                            proposal_id=prop["id"], sleeper_confirmed=True)
    return storage.update_trade_proposal(prop["id"], status="executed")


def close_cap_review(proposal_id: str, *, user_sub: str) -> dict:
    prop = storage.get_trade_proposal(proposal_id)
    if not prop or prop["status"] != "cap_review":
        raise ValueError("This cap review is no longer open")
    league = storage.get_league(prop["league_id"])
    if user_sub != league["commissioner_sub"]:
        raise ValueError("Commissioner managed")
    if any(p.get("source_review_id") == proposal_id and p["status"] in {"pending", "awaiting_sleeper"}
           for p in storage.list_trade_proposals(prop["league_id"])):
        raise ValueError("Resolve the pending cap agreement before closing this review")
    return storage.update_trade_proposal(proposal_id, status="reviewed")
