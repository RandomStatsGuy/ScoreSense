"""Format-specific, explicitly resolved Showdown strategy controls.

Quarterback selection is evidence or a user's choice, never a pool-order guess.
Missing controls preserve legacy construction and add review advice only.
"""
from __future__ import annotations

from src.core.team_codes import normalize_team_for_match

RULE_VERSION = "showdown_strategy_v1"


def validate_showdown_rule_shape(rules):
    """Reject malformed public controls before identity normalization."""
    if rules is None:
        return
    if not isinstance(rules, dict) or set(rules) - {"receiver_captain_qb", "approved_qb_ids"}:
        raise ValueError("Showdown rules contain unsupported fields.")
    policy = rules.get("receiver_captain_qb", "warn")
    if not isinstance(policy, str) or policy not in {"require", "warn", "off"}:
        raise ValueError("WR/TE Captain pairing must be Require, Warn or Off.")
    approved = rules.get("approved_qb_ids", {})
    if not isinstance(approved, dict) or len(approved) > 32:
        raise ValueError("Approved quarterbacks must be grouped by at most 32 teams.")
    for team, ids in approved.items():
        if (not isinstance(team, str) or not team.strip() or len(team) > 8
                or not isinstance(ids, list) or not ids or len(ids) > 8
                or any(not isinstance(pid, str) or not pid.strip() or len(pid) > 100 for pid in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError("Choose distinct canonical quarterback IDs for each approved team.")


def resolve_showdown_rules(rules, *, site, players, pool=None):
    validate_showdown_rule_shape(rules)
    if site not in {"draftkings_showdown", "fanduel_single"}:
        if rules:
            raise ValueError("Showdown strategy rules require a single-game format.")
        return None
    legacy = rules is None or "receiver_captain_qb" not in rules
    if rules is None:
        rules = {}
    if not isinstance(rules, dict) or set(rules) - {"receiver_captain_qb", "approved_qb_ids"}:
        raise ValueError("Showdown rules contain unsupported fields.")
    policy = rules.get("receiver_captain_qb", "warn")
    if policy not in {"require", "warn", "off"}:
        raise ValueError("WR/TE Captain pairing must be Require, Warn or Off.")
    approved = rules.get("approved_qb_ids") or {}
    if not isinstance(approved, dict):
        raise ValueError("Approved quarterbacks must be grouped by team.")
    records = pool.to_dict("records") if pool is not None else [
        {"player_id": p.player_id, "Team": p.team, "Position": p.position} for p in players
    ]
    catalog = {str(row.get("player_id")): row for row in records}
    eligible = {p.player_id: p for p in players}
    normalized = {}
    for raw_team, ids in approved.items():
        team = normalize_team_for_match(raw_team)
        if not team or team in normalized or not isinstance(ids, list) or not ids or len(ids) > 8:
            raise ValueError("Choose one or more eligible quarterbacks for each approved team.")
        if any(not isinstance(pid, str) or not pid for pid in ids) or len(set(ids)) != len(ids):
            raise ValueError("Approved quarterback identities must be distinct canonical IDs.")
        for pid in ids:
            row = catalog.get(pid)
            if not row or row.get("Position") != "QB" or normalize_team_for_match(row.get("Team")) != team:
                raise ValueError("An approved quarterback does not match that team in this player pool.")
        normalized[team] = sorted(ids)
    by_team, evidence = {}, {}
    for p in players:
        if p.position != "QB":
            continue
        team = normalize_team_for_match(p.team)
        row = catalog[p.player_id]
        if team in normalized:
            trusted = p.player_id in normalized[team]
            basis = "user_approved"
        else:
            trusted = (row.get("verified_starting_qb") is True or
                       (row.get("qb_role_verified") is True and row.get("qb_role") == "starter"))
            basis = "verified_starter_role"
        if trusted:
            by_team.setdefault(team, []).append(p.player_id)
            evidence[p.player_id] = basis
    for team in by_team:
        by_team[team].sort()
    unresolved = sorted(p.player_id for p in players if p.position in {"WR", "TE"}
                        and not by_team.get(normalize_team_for_match(p.team)))
    return {"version": RULE_VERSION, "receiver_captain_qb": policy,
            "approved_qb_ids": normalized, "qb_by_team": by_team,
            "qb_evidence": evidence, "unresolved_receiver_ids": unresolved,
            "legacy_policy": legacy,
            "unavailable_approved_qb_ids": sorted(pid for ids in normalized.values() for pid in ids
                                                  if pid not in eligible)}


def pairing_issue(rows, rules):
    """Independent identity-based check; no reliance on MILP variable output."""
    if not rules or rules.get("receiver_captain_qb") != "require":
        return None
    captain = next((row for row in rows if row.get("slot") in {"CPT", "MVP"}), None)
    if not captain or captain.get("position") not in {"WR", "TE"}:
        return None
    team = normalize_team_for_match(captain.get("team"))
    wanted = set(rules.get("qb_by_team", {}).get(team, []))
    selected = {row.get("player_id") for row in rows if row.get("position") == "QB"
                and normalize_team_for_match(row.get("team")) == team}
    if not wanted:
        return "receiver_captain_qb_mapping_unavailable"
    if not wanted.intersection(selected):
        return "receiver_captain_qb_required"
    return None


def pairing_blocker(rules, captain_id=None):
    if not rules or rules.get("receiver_captain_qb") != "require":
        return None
    unresolved = rules.get("unresolved_receiver_ids", [])
    if captain_id and captain_id in unresolved:
        return {"code": "receiver_captain_qb_mapping_unavailable", "player_ids": [captain_id],
                "reason": "The locked receiver Captain has no eligible verified or approved quarterback. Choose its quarterback, change the Captain, or change the strategy policy."}
    return None
