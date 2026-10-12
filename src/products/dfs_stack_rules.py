"""Versioned Classic construction constraints, independent of projection scores.

Receiving RB eligibility is an explicit user declaration, never inferred from an
RB position or relabeled as model evidence. Athlete identities count across slots.
"""
from __future__ import annotations

from src.core.team_codes import normalize_team_for_match

MODES = {"minimum", "maximum", "exact", "optional", "forbidden"}


def normalize_classic_stack_rules(raw):
    if raw is None:
        return None
    if (not isinstance(raw, dict) or type(raw.get("version")) is not int
            or raw["version"] != 1 or set(raw) - {"version", "attachments", "bring_back"}):
        raise ValueError("Classic stack rules require version 1 and attachments/bring_back controls only.")
    result = {"version": 1}
    for key in ("attachments", "bring_back"):
        control = raw.get(key, {"mode": "optional", "count": 0})
        fields = {"mode", "count", "receiving_rb_ids"} if key == "attachments" else {"mode", "count"}
        if not isinstance(control, dict) or set(control) - fields:
            raise ValueError(f"Unsupported {key} control field.")
        mode, count = control.get("mode"), control.get("count")
        if (not isinstance(mode, str) or mode not in MODES or type(count) is not int
                or not 0 <= count <= 7 or (mode in {"optional", "forbidden"} and count != 0)):
            raise ValueError(f"{key} requires a supported mode and whole count 0 through 7; optional/forbidden require count 0.")
        result[key] = {"mode": mode, "count": count}
        if key == "attachments":
            ids = control.get("receiving_rb_ids", [])
            if (not isinstance(ids, list) or len(ids) > 500
                    or any(not isinstance(pid, str) or not pid.strip() or len(pid) > 100 for pid in ids)
                    or len(set(ids)) != len(ids)):
                raise ValueError("Receiving RB eligibility needs distinct canonical player ID strings.")
            result[key]["receiving_rb_ids"] = sorted(ids)
    return result


def validate_stack_request(raw, *, portfolio_mode, site, require_qb_stack=False,
                           qb_stack_count=None, stack_bring_back=False):
    rules = normalize_classic_stack_rules(raw)
    if rules is not None:
        if portfolio_mode != "global" or site not in {"draftkings", "fanduel"}:
            raise ValueError("Native Classic stack rules require global Classic portfolio mode.")
        if require_qb_stack or qb_stack_count or stack_bring_back:
            raise ValueError("Native Classic stack rules cannot be mixed with legacy stack or bring-back controls.")
    return rules


def _team(value):
    team = normalize_team_for_match(value)
    return "" if team in {"", "NAN", "NONE", "NULL", "BYE"} else team


def _bounds(control):
    mode, count = control["mode"], control["count"]
    return {"minimum": (count, 7), "maximum": (0, count), "exact": (count, count),
            "forbidden": (0, 0), "optional": (0, 7)}[mode]


def _relationship_team(qb, key):
    if qb is None:
        return ""
    team = _team(qb.team)
    if key == "attachments":
        return team
    opponent = _team(qb.opponent)
    return opponent if team and opponent and opponent != team else ""


def _eligible_attachment(player, receiving_ids):
    return player.position in {"WR", "TE"} or (player.position == "RB" and player.player_id in receiving_ids)


def validate_receiving_rb_ids(rules, players):
    by_id = {player.player_id: player for player in players}
    for pid in rules["attachments"]["receiving_rb_ids"]:
        if pid not in by_id or by_id[pid].position != "RB":
            raise ValueError(f"Receiving eligibility {pid} must reference an eligible RB in this player pool.")


def compile_classic_stack_constraints(players, raw):
    """Compile conditional cardinalities for whichever QB is selected."""
    rules = normalize_classic_stack_rules(raw)
    if rules is None:
        return []
    validate_receiving_rb_ids(rules, players)
    constraints = []
    receiving_ids = set(rules["attachments"]["receiving_rb_ids"])
    for qb in (player for player in players if player.position == "QB"):
        for key in ("attachments", "bring_back"):
            control = rules[key]
            if control["mode"] == "optional":
                continue
            team = _relationship_team(qb, key)
            if not team:
                constraints.append(({qb.player_id: 1}, 0, 0))
                continue
            eligible = [player for player in players if (
                _eligible_attachment(player, receiving_ids) if key == "attachments"
                else player.position in {"RB", "WR", "TE"})]
            # Unknown identity cannot establish an exact group relationship.
            constraints.extend(({player.player_id: 1}, 0, 0) for player in eligible if not _team(player.team))
            members = [player.player_id for player in eligible if _team(player.team) == team]
            lower, upper = _bounds(control)
            if lower:
                constraints.append(({**dict.fromkeys(members, 1), qb.player_id: -lower}, 0, float("inf")))
            if upper < len(members):
                constraints.append(({**dict.fromkeys(members, 1), qb.player_id: len(members)-upper}, 0, len(members)))
    return constraints


def audit_classic_stack(entry, players, raw):
    """Recount actual selected identities; never trust solver-reported counts."""
    rules = normalize_classic_stack_rules(raw)
    if rules is None:
        return None
    validate_receiving_rb_ids(rules, players)
    by_id = {player.player_id: player for player in players}
    ids = {row.get("player_id") for row in entry.get("lineup", [])}
    selected = [by_id[pid] for pid in ids if pid in by_id]
    qbs = [player for player in selected if player.position == "QB"]
    issues = []
    if ids - set(by_id):
        issues.append("unknown_player_id")
    if len(qbs) != 1:
        issues.append("selected_qb_count")
    qb = qbs[0] if len(qbs) == 1 else None
    result = {"version": 1, "qb_id": qb.player_id if qb else None,
              "receiving_rb_eligibility": "user-declared canonical IDs"}
    receiving_ids = set(rules["attachments"]["receiving_rb_ids"])
    for key in ("attachments", "bring_back"):
        control = rules[key]
        team = _relationship_team(qb, key)
        eligible = [player for player in selected if (
            _eligible_attachment(player, receiving_ids) if key == "attachments"
            else player.position in {"RB", "WR", "TE"})]
        known = bool(team) and all(_team(player.team) for player in eligible)
        members = sorted(player.player_id for player in eligible if team and _team(player.team) == team)
        lower, upper = _bounds(control)
        if control["mode"] != "optional":
            if not known:
                issues.append(f"{key}_unknown_relationship")
            if len(members) < lower:
                issues.append(f"{key}_below_minimum")
            if len(members) > upper:
                issues.append(f"{key}_above_maximum")
        result[key] = {"mode": control["mode"], "count": control["count"],
                       "actual_count": len(members), "player_ids": members,
                       "relationship_known": bool(known)}
    return {**result, "ok": not issues, "issues": issues}


def locked_stack_conflicts(players, rules, locked_ids):
    if rules is None or not any(player.position == "QB" and player.player_id in locked_ids for player in players):
        return []
    audit = audit_classic_stack({"lineup": [{"player_id": pid} for pid in locked_ids]}, players, rules)
    return [f"Locked selection conflicts with Classic stack rules: {issue.replace('_', ' ')}. Change the rule or locks before rebuilding."
            for issue in audit["issues"] if not issue.endswith("below_minimum")]
