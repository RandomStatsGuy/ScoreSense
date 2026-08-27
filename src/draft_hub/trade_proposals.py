"""Multi-party trade proposals: validate, propose/accept, and execute."""

from __future__ import annotations

import copy
from typing import Any

from src.draft_hub import storage
from src.draft_hub.contracts import cap_hit
from src.draft_hub.pre_draft_cap import (
    ROSTER_CUT_BEFORE_DRAFT,
    contract_on_cut_status_change,
    is_active_for_pre_draft,
    total_pre_draft_dead_cap,
)
from src.draft_hub.rules_engine import (
    cap_relevant_roster,
    cut_refund,
    normalize_position,
    roster_limits,
)
from src.draft_hub.schemas import LeagueRules


def _trade_event_summary(league_id: str, parties: list[dict[str, Any]]) -> dict[str, Any]:
    """Compact bid-log payload for a mid-draft trade."""
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    by_team = storage.list_league_rosters_by_team(league_id)
    owner: dict[str, dict[str, Any]] = {}
    for tid, rows in by_team.items():
        for row in rows:
            pid = str(row.get("player_id") or "")
            if pid:
                owner[pid] = row
    names = [str((teams.get(str(p["team_id"])) or {}).get("name") or "Team") for p in parties]
    moved: list[str] = []
    for party in parties:
        from_name = str((teams.get(str(party["team_id"])) or {}).get("name") or "Team")
        for send in party.get("sends") or []:
            row = owner.get(str(send.get("player_id") or ""))
            player = (row or {}).get("player_name") or send.get("player_id")
            to_name = str((teams.get(str(send.get("to_team_id"))) or {}).get("name") or "Team")
            moved.append(f"{player} ({from_name} → {to_name})")
    if len(names) >= 2:
        headline = f"{names[0]} ↔ {names[1]}"
    else:
        headline = names[0] if names else "Trade"
    return {
        "summary": headline if not moved else f"{headline} · {', '.join(moved[:4])}",
        "team_names": names,
        "players": moved,
    }


def drop_dead_cap_amount(rules: LeagueRules, row: dict[str, Any]) -> float:
    """Current-season dead money if this active player were cut before the draft."""
    sal = float(cap_hit(row, 0) or 0)
    if sal <= 0:
        return 0.0
    return round(sal - cut_refund(rules, sal), 2)


def _party_team_ids(parties: list[dict[str, Any]]) -> list[str]:
    return [str(p["team_id"]) for p in parties]


def normalize_parties(
    parties: list[dict[str, Any]],
    *,
    dead_cap_assignments: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Normalize sends to {player_id, to_team_id} and ensure drop dead-cap legs."""
    if len(parties) < 2:
        raise ValueError("Trade needs at least two teams")
    team_ids = _party_team_ids(parties)
    if len(set(team_ids)) != len(team_ids):
        raise ValueError("Duplicate team in trade parties")

    norm: list[dict[str, Any]] = []
    for party in parties:
        tid = str(party["team_id"])
        sends_in = party.get("sends") or []
        sends_out: list[dict[str, Any]] = []
        for s in sends_in:
            if isinstance(s, str):
                # 2-team shorthand: send to the other party
                others = [x for x in team_ids if x != tid]
                if len(others) != 1:
                    raise ValueError("Multi-team trades require send destinations (to_team_id)")
                sends_out.append({"player_id": s, "to_team_id": others[0]})
            else:
                pid = str(s.get("player_id") or "")
                to_id = str(s.get("to_team_id") or "")
                if not pid or not to_id:
                    raise ValueError("Each send needs player_id and to_team_id")
                if to_id not in team_ids:
                    raise ValueError(f"Send destination {to_id} is not a party to the trade")
                if to_id == tid:
                    raise ValueError("Cannot send a player to the same team")
                sends_out.append({"player_id": pid, "to_team_id": to_id})
        drops = [str(d if isinstance(d, str) else d.get("player_id")) for d in (party.get("drops") or [])]
        drops = [d for d in drops if d]
        norm.append({"team_id": tid, "sends": sends_out, "drops": drops})

    assignments = list(dead_cap_assignments or [])
    drop_keys: set[tuple[str, str]] = set()
    for party in norm:
        for pid in party["drops"]:
            drop_keys.add((party["team_id"], pid))

    by_drop = {(str(a.get("from_team_id")), str(a.get("player_id"))): a for a in assignments}
    for from_tid, pid in drop_keys:
        if (from_tid, pid) not in by_drop:
            # Default: assigner keeps dead cap (still must be explicit for clarity — default to self)
            assignments.append(
                {
                    "player_id": pid,
                    "from_team_id": from_tid,
                    "assigned_to_team_id": from_tid,
                }
            )
    for a in assignments:
        if str(a.get("assigned_to_team_id") or "") not in team_ids:
            raise ValueError("Dead-cap assignee must be a party to the trade")
        if (str(a.get("from_team_id")), str(a.get("player_id"))) not in drop_keys:
            raise ValueError(
                f"Dead-cap assignment for {a.get('player_id')} has no matching drop"
            )

    return norm, assignments


def simulate_rosters(
    league_id: str,
    parties: list[dict[str, Any]],
    dead_cap_assignments: list[dict[str, Any]],
    *,
    rules: LeagueRules,
) -> dict[str, list[dict[str, Any]]]:
    """Return post-trade roster lists keyed by team_id (active + cut rows)."""
    by_team = storage.list_league_rosters_by_team(league_id)
    team_ids = _party_team_ids(parties)
    sim: dict[str, list[dict[str, Any]]] = {
        tid: [copy.deepcopy(r) for r in by_team.get(tid, [])] for tid in team_ids
    }

    # Index ownership
    owner: dict[str, str] = {}
    for tid, rows in sim.items():
        for r in rows:
            owner[str(r["player_id"])] = tid

    # Apply sends
    for party in parties:
        from_tid = str(party["team_id"])
        for send in party.get("sends") or []:
            pid = str(send["player_id"])
            to_tid = str(send["to_team_id"])
            if owner.get(pid) != from_tid:
                raise ValueError(f"Player {pid} is not on team {from_tid}")
            rows = sim[from_tid]
            idx = next(i for i, r in enumerate(rows) if str(r["player_id"]) == pid)
            row = rows.pop(idx)
            row["team_id"] = to_tid
            sim[to_tid].append(row)
            owner[pid] = to_tid

    # Apply drops: move cut obligation to assignee
    assign_map = {
        (str(a["from_team_id"]), str(a["player_id"])): str(a["assigned_to_team_id"])
        for a in dead_cap_assignments
    }
    for party in parties:
        from_tid = str(party["team_id"])
        for pid in party.get("drops") or []:
            pid = str(pid)
            if owner.get(pid) != from_tid:
                raise ValueError(f"Drop {pid} is not on team {from_tid}")
            rows = sim[from_tid]
            idx = next(i for i, r in enumerate(rows) if str(r["player_id"]) == pid)
            row = rows.pop(idx)
            assignee = assign_map.get((from_tid, pid), from_tid)
            amount = drop_dead_cap_amount(rules, row)
            contract = contract_on_cut_status_change(row, roster_status=ROSTER_CUT_BEFORE_DRAFT) or dict(
                row.get("contract") or {}
            )
            row["roster_status"] = ROSTER_CUT_BEFORE_DRAFT
            row["contract"] = contract
            row["team_id"] = assignee
            row["_trade_dead_cap"] = amount
            sim[assignee].append(row)
            owner[pid] = assignee

    return sim


def validate_simulated_trade(
    rules: LeagueRules,
    sim: dict[str, list[dict[str, Any]]],
    *,
    draft_completed: bool = False,
    team_names: dict[str, str] | None = None,
) -> list[str]:
    errors: list[str] = []
    limits = roster_limits(rules)
    max_years = int(rules.contracts.max_years)
    names = team_names or {}
    for tid, rows in sim.items():
        label = names.get(str(tid)) or str(tid)
        active = [r for r in rows if is_active_for_pre_draft(r)]
        scoped = cap_relevant_roster(rules, active)
        counts: dict[str, int] = {}
        for r in scoped:
            pos = normalize_position(r.get("position"))
            counts[pos] = counts.get(pos, 0) + 1

        for pos, lim in limits.items():
            pos_key = pos.upper()
            count = counts.get(pos_key, 0)
            if draft_completed and count < lim["min"]:
                errors.append(
                    f"{label}: need {lim['min'] - count} more {pos_key} (min {lim['min']})"
                )
            if count > lim["max"]:
                errors.append(
                    f"{label}: {count - lim['max']} too many {pos_key} (max {lim['max']})"
                )

        for row in scoped:
            yrs = int(row.get("contract_years") or 1)
            if yrs < 1 or yrs > max_years:
                name = row.get("player_name") or row.get("player_id")
                errors.append(f"{label}: {name} contract years must be 1–{max_years}")

        spent = sum(float(cap_hit(r, 0) or 0) for r in scoped)
        if draft_completed:
            remaining = float(rules.salary_cap) - spent
            if remaining < -0.01:
                errors.append(f"{label}: over cap by ${abs(remaining):.0f}")
            continue

        cuts = [r for r in rows if str(r.get("roster_status")) == ROSTER_CUT_BEFORE_DRAFT]
        dead = total_pre_draft_dead_cap(rules, cuts, year_offset=0)
        remaining = float(rules.salary_cap) - spent - dead
        if remaining < -0.01:
            errors.append(
                f"{label}: over cap by ${abs(remaining):.0f} "
                f"(spent ${spent:.0f} + dead ${dead:.0f})"
            )
    return errors


def enrich_dead_cap_amounts(
    rules: LeagueRules,
    league_id: str,
    parties: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_team = storage.list_league_rosters_by_team(league_id)
    out: list[dict[str, Any]] = []
    for a in assignments:
        from_tid = str(a["from_team_id"])
        pid = str(a["player_id"])
        row = next((r for r in by_team.get(from_tid, []) if str(r.get("player_id")) == pid), None)
        if not row:
            raise ValueError(f"Cannot price dead cap for {pid}")
        amount = drop_dead_cap_amount(rules, row)
        out.append({**a, "amount": amount})
    return out


def validate_trade_package(
    league_id: str,
    parties: list[dict[str, Any]],
    dead_cap_assignments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league["rules"])
    norm, assignments = normalize_parties(parties, dead_cap_assignments=dead_cap_assignments)
    assignments = enrich_dead_cap_amounts(rules, league_id, norm, assignments)

    # Basic integrity: no player in both send and drop; unique players
    seen: set[str] = set()
    for party in norm:
        for s in party["sends"]:
            pid = s["player_id"]
            if pid in seen:
                raise ValueError(f"Player {pid} appears more than once in the trade")
            seen.add(pid)
        for pid in party["drops"]:
            if pid in seen:
                raise ValueError(f"Player {pid} cannot be both sent and dropped")
            seen.add(pid)

    sim = simulate_rosters(league_id, norm, assignments, rules=rules)
    from src.draft_hub.acquisition_window import resolve_acquisition_window, trade_lock_reason

    window = resolve_acquisition_window(
        {
            "mode": "league",
            "draft_completed": bool(league.get("draft_completed")),
            "league_status": league.get("status"),
            "season": league.get("season"),
        }
    )
    if window.get("trade_scope") == "surviving_contracts":
        by_team = storage.list_league_rosters_by_team(league_id)
        owned: dict[str, dict[str, Any]] = {}
        for rows in by_team.values():
            for row in rows:
                pid = str(row.get("player_id") or "")
                if pid:
                    owned[pid] = row
        lock_errors: list[str] = []
        for party in norm:
            for send in party["sends"]:
                reason = trade_lock_reason(owned.get(str(send["player_id"])), window)
                if reason:
                    lock_errors.append(reason)
        if lock_errors:
            raise ValueError("; ".join(dict.fromkeys(lock_errors)))

    team_names = {
        str(t["id"]): str(t.get("name") or t["id"])
        for t in storage.list_league_teams(league_id)
    }
    errors = validate_simulated_trade(
        rules,
        sim,
        draft_completed=bool(league.get("draft_completed")),
        team_names=team_names,
    )
    preview: dict[str, Any] = {}
    for tid, rows in sim.items():
        active = [r for r in rows if is_active_for_pre_draft(r)]
        scoped = cap_relevant_roster(rules, active)
        spent = sum(float(cap_hit(r, 0) or 0) for r in scoped)
        cuts = [r for r in rows if str(r.get("roster_status")) == ROSTER_CUT_BEFORE_DRAFT]
        dead = (
            0.0
            if league.get("draft_completed")
            else total_pre_draft_dead_cap(rules, cuts, year_offset=0)
        )
        by_pos: dict[str, int] = {}
        for r in scoped:
            pos = normalize_position(r.get("position"))
            by_pos[pos] = by_pos.get(pos, 0) + 1
        preview[tid] = {
            "team_name": team_names.get(str(tid), str(tid)),
            "active_count": len(active),
            "cut_count": len(cuts),
            "committed": round(spent, 2),
            "dead_cap": round(dead, 2),
            "unspent": round(float(rules.salary_cap) - spent - dead, 2),
            "by_position_count": by_pos,
        }
    return {
        "ok": not errors,
        "errors": errors,
        "parties": norm,
        "dead_cap_assignments": assignments,
        "preview": preview,
        "salary_cap": float(rules.salary_cap),
    }


def execute_multiparty_trade(
    league_id: str,
    parties: list[dict[str, Any]],
    dead_cap_assignments: list[dict[str, Any]] | None = None,
    *,
    proposal_id: str | None = None,
) -> dict[str, Any]:
    """Hard-validate then apply transfers + drops. Raises ValueError on failure."""
    check = validate_trade_package(league_id, parties, dead_cap_assignments)
    if not check["ok"]:
        raise ValueError("; ".join(check["errors"]) or "Trade failed validation")

    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws_id = storage.roster_workspace_for_league(league)
    rules = LeagueRules.model_validate(league["rules"])
    norm = check["parties"]
    assignments = check["dead_cap_assignments"]
    event_summary = _trade_event_summary(league_id, norm)

    # Apply sends
    from src.draft_hub.contract_service import apply_trade_drop, apply_trade_transfer

    for party in norm:
        from_tid = str(party["team_id"])
        for send in party["sends"]:
            moved = apply_trade_transfer(
                league_id, ws_id, [send["player_id"]], from_tid, send["to_team_id"]
            )
            if moved != 1:
                raise ValueError(f"Failed to move {send['player_id']}")

    # Apply drops: cut + move to assignee if needed
    assign_map = {
        (str(a["from_team_id"]), str(a["player_id"])): a for a in assignments
    }
    for party in norm:
        from_tid = str(party["team_id"])
        for pid in party["drops"]:
            a = assign_map[(from_tid, pid)]
            assignee = str(a["assigned_to_team_id"])
            apply_trade_drop(
                league_id,
                ws_id,
                pid,
                from_team_id=from_tid,
                assignee_team_id=assignee,
            )

    # Log (pairwise summary for legacy table + full parties in send_a json)
    team_ids = _party_team_ids(norm)
    storage.log_league_trade(
        league_id,
        team_a_id=team_ids[0],
        team_b_id=team_ids[1] if len(team_ids) > 1 else team_ids[0],
        send_a=[s["player_id"] for p in norm for s in p["sends"] if p["team_id"] == team_ids[0]],
        send_b=[s["player_id"] for p in norm for s in p["sends"] if p["team_id"] != team_ids[0]],
        proposal_id=proposal_id,
        parties=norm,
        dead_cap_assignments=assignments,
    )

    session = storage.get_draft_session(league_id) or {}
    if session.get("status") in ("nominating", "bidding", "picking") and not league.get("draft_completed"):
        from src.draft_hub.draft_budgets import sync_league_auction_budgets

        sync_league_auction_budgets(league_id)
        storage.append_draft_event(league_id, "trade", event_summary)

    by_team = {
        tid: storage.list_team_roster(league_id, tid) for tid in team_ids
    }
    return {
        "parties": norm,
        "dead_cap_assignments": assignments,
        "rosters": by_team,
        "validation_errors": [],
    }


def execute_league_trade(
    league_id: str,
    *,
    team_a_id: str,
    team_b_id: str,
    send_a: list[str],
    send_b: list[str],
) -> dict[str, Any]:
    """Backward-compatible 2-team execute with hard validation."""
    parties = [
        {"team_id": team_a_id, "sends": send_a, "drops": []},
        {"team_id": team_b_id, "sends": send_b, "drops": []},
    ]
    result = execute_multiparty_trade(league_id, parties)
    new_a = result["rosters"].get(team_a_id, [])
    new_b = result["rosters"].get(team_b_id, [])
    return {
        "team_a": {"team_id": team_a_id, "roster": new_a, "validation_errors": []},
        "team_b": {"team_id": team_b_id, "roster": new_b, "validation_errors": []},
        "validation_errors": [],
    }


def propose_trade(
    league_id: str,
    *,
    created_by_sub: str,
    proposer_team_id: str,
    parties: list[dict[str, Any]],
    dead_cap_assignments: list[dict[str, Any]] | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    check = validate_trade_package(league_id, parties, dead_cap_assignments)
    if not check["ok"]:
        raise ValueError("; ".join(check["errors"]))
    team_ids = _party_team_ids(check["parties"])
    if proposer_team_id not in team_ids:
        raise ValueError("Your team must be a party to the trade")
    acceptances = {tid: ("accepted" if tid == proposer_team_id else "pending") for tid in team_ids}
    return storage.create_trade_proposal(
        league_id,
        created_by_sub=created_by_sub,
        parties=check["parties"],
        dead_cap_assignments=check["dead_cap_assignments"],
        acceptances=acceptances,
        note=note,
        status="pending",
    )


def respond_to_proposal(
    proposal_id: str,
    *,
    team_id: str,
    approve: bool,
    user_sub: str,
) -> dict[str, Any]:
    prop = storage.get_trade_proposal(proposal_id)
    if not prop:
        raise ValueError("Proposal not found")
    if prop["status"] != "pending":
        raise ValueError(f"Proposal is {prop['status']}")
    team_ids = _party_team_ids(prop["parties"])
    if team_id not in team_ids:
        raise ValueError("Your team is not a party to this trade")
    team = storage.get_team(team_id)
    if not team or str(team.get("user_sub")) != str(user_sub):
        raise ValueError("You do not manage this team")

    acceptances = dict(prop["acceptances"] or {})
    if not approve:
        acceptances[team_id] = "rejected"
        return storage.update_trade_proposal(
            proposal_id, status="rejected", acceptances=acceptances
        ) or prop

    acceptances[team_id] = "accepted"
    updated = storage.update_trade_proposal(proposal_id, acceptances=acceptances)
    if updated and all(acceptances.get(tid) == "accepted" for tid in team_ids):
        # Auto-execute when unanimous
        try:
            execute_multiparty_trade(
                prop["league_id"],
                prop["parties"],
                prop["dead_cap_assignments"],
                proposal_id=proposal_id,
            )
        except ValueError as exc:
            # Keep pending but surface error via note
            return storage.update_trade_proposal(
                proposal_id,
                acceptances=acceptances,
                note=f"Accepted but execute failed: {exc}",
            ) or updated
        return storage.update_trade_proposal(
            proposal_id, status="executed", acceptances=acceptances
        ) or updated
    return updated or prop


def force_execute_proposal(
    proposal_id: str,
    *,
    commissioner_sub: str,
) -> dict[str, Any]:
    prop = storage.get_trade_proposal(proposal_id)
    if not prop:
        raise ValueError("Proposal not found")
    if prop["status"] not in {"pending", "accepted"}:
        raise ValueError(f"Cannot force-apply a {prop['status']} proposal")
    league = storage.get_league(prop["league_id"])
    if not league or str(league.get("commissioner_sub")) != str(commissioner_sub):
        raise ValueError("Commissioner only")
    execute_multiparty_trade(
        prop["league_id"],
        prop["parties"],
        prop["dead_cap_assignments"],
        proposal_id=proposal_id,
    )
    team_ids = _party_team_ids(prop["parties"])
    acceptances = {tid: "accepted" for tid in team_ids}
    return storage.update_trade_proposal(
        proposal_id, status="executed", acceptances=acceptances
    ) or prop


def cancel_proposal(proposal_id: str, *, user_sub: str, is_commissioner: bool) -> dict[str, Any]:
    prop = storage.get_trade_proposal(proposal_id)
    if not prop:
        raise ValueError("Proposal not found")
    if prop["status"] != "pending":
        raise ValueError(f"Cannot cancel a {prop['status']} proposal")
    if is_commissioner or str(prop.get("created_by_sub")) == str(user_sub):
        return storage.update_trade_proposal(proposal_id, status="cancelled") or prop
    # Party managers may cancel
    for party in prop.get("parties") or []:
        team = storage.get_team(str(party.get("team_id")))
        if team and str(team.get("user_sub")) == str(user_sub):
            return storage.update_trade_proposal(proposal_id, status="cancelled") or prop
    raise ValueError("Only a party or commissioner can cancel")
