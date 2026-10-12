"""Offline exact-slot planning over declared accepted-entry snapshots.

No provider authentication, live reads, persistence, submission or public CSV
export occurs here. A numerical solver certificate is not an exact proof.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import csv
from decimal import Decimal, localcontext
import hashlib
import io
import itertools
import math
import re
import time
from types import SimpleNamespace

import numpy as np
import scipy
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from src.products.dfs_contest_portfolio import _check_exposure_shapes, _decimal
from src.products.dfs_portfolio_selection import exposure_counts, qb_dst_audit
from src.products.dfs_shared_outcomes import _hash, _id as _shared_id, _time as _shared_time, _context
from src.core.team_codes import normalize_team_for_match
from src.products.dfs_stack_rules import normalize_classic_stack_rules, audit_classic_stack, validate_receiving_rb_ids

SCHEMA = "dfs_late_swap_package_v1"
PREPARED_SCHEMA = "dfs_late_swap_prepared_v1"
PLAN_SCHEMA = "dfs_late_swap_plan_v1"
ENGINE_VERSION = "offline_exact_slot_assignment_v1"
SEMANTICS = "offline_declared_exact_slot_projection_planning_not_live_late_swap"
SLOTS = ("QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST")
HEADERS = ("QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST")
SOURCE_KINDS = {"user_platform_readback", "rules", "salary_catalog", "lock_snapshot", "projection_inputs"}
CAPABILITIES = {
    "offline_exact_slot_planning": True, "independent_hard_constraint_audit": True,
    "accepted_readback_authenticated": False, "current_lock_verified": False,
    "platform_export_ready": False, "conditional_remaining_evaluation": False,
    "expected_payout": False, "forecast_performance_verified": False,
}
WARNINGS = [
    "Accepted entries, rules, timing, permissions and player status are supplied declarations, not authenticated platform evidence.",
    "This is a read-only plan at the supplied timestamp; it does not change entries or verify current locks.",
    "The objective sums supplied inputs for unstarted players only; it is not a remaining-points forecast or contest return.",
    "The search covers supplied options only. Original accepted rosters and earlier exports remain unchanged.",
    "Late-swap platform export remains unavailable until actual acceptance and current locks are independently verified.",
]
CONTROL_FIELDS = {"player_exposure_limits", "group_exposure_limits", "locked_player_ids", "excluded_player_ids",
                  "max_exposure", "max_overlap", "classic_stack_rules", "block_qb_opposing_dst",
                  "max_per_team", "min_salary", "max_salary"}
NFL_TEAMS = {"ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
             "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"}


def _id(value, label):
    result = _shared_id(value, label)
    if len(result) > 100:
        raise ValueError(f"{label} supports at most 100 characters.")
    return result


def _time(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", value):
        raise ValueError(f"{label} requires an ISO timestamp with an explicit timezone.")
    try:
        return _shared_time(value, label)
    except (ValueError, OverflowError):
        raise ValueError(f"{label} requires a valid ISO timestamp with an explicit timezone.") from None


def _team(value):
    result = normalize_team_for_match(_id(value, "NFL team"))
    if result not in NFL_TEAMS:
        raise ValueError("Catalog team and opponent must be recognized NFL team identities.")
    return result


def _fields(raw, fields, label, *, required=None):
    if not isinstance(raw, dict) or set(raw) - set(fields) or set(required or ()) - set(raw):
        raise ValueError(f"{label} contains missing or unsupported fields.")
    return raw


def _whole(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label} requires a whole number from {low} through {high}.")
    return value


def _numeric_id(value, label):
    value = _id(value, label)
    if len(value) > 100 or not re.fullmatch(r"[0-9]+", value) or not value.strip("0"):
        raise ValueError(f"{label} requires a positive exact numeric string; keep IDs as text.")
    return value


def _digest(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", value):
        raise ValueError(f"{label} requires a 64-character hexadecimal content hash.")
    return value.lower()


def _rows(value, label, low, high):
    if not isinstance(value, list) or not low <= len(value) <= high or any(not isinstance(row, dict) for row in value):
        raise ValueError(f"{label} requires {low} through {high} explicit rows.")
    return value


def _at(value, label, decision):
    stamp = _time(value, label)
    if stamp > decision:
        raise ValueError(f"{label} cannot be later than the supplied decision time.")
    return stamp.isoformat()


def _projection(value, *, locked):
    if value is None and locked:
        return None
    number = _decimal(value, "Unstarted-player projection input", minimum=Decimal(-1000000), maximum=Decimal(1000000))
    if number.as_tuple().exponent < -12:
        raise ValueError("Player projection inputs support at most 12 decimal places.")
    return str(number)


def _slots(raw, catalog, label):
    _fields(raw, SLOTS, label, required=SLOTS)
    result = {slot: _id(raw[slot], f"{label} player ID") for slot in SLOTS}
    if len(set(result.values())) != 9 or set(result.values()) - set(catalog):
        raise ValueError(f"{label} contains duplicate or unknown player identities.")
    for slot, pid in result.items():
        allowed = {"RB", "WR", "TE"} if slot == "FLEX" else {re.sub(r"\d+$", "", slot)}
        if catalog[pid]["position"] not in allowed:
            raise ValueError(f"{label} has a player in an ineligible exact slot {slot}.")
    if sum(catalog[pid]["salary"] for pid in result.values()) > 50000:
        raise ValueError(f"{label} exceeds the DraftKings salary cap.")
    if len({catalog[pid]["game_id"] for pid in result.values()}) < 2:
        raise ValueError(f"{label} must include players from at least two declared games.")
    return result


def _id_list(value, label, universe):
    if not isinstance(value, list) or len(value) > 750:
        raise ValueError(f"{label} requires a bounded list of exact player IDs.")
    ids = [_id(pid, label) for pid in value]
    if len(set(ids)) != len(ids) or set(ids) - universe:
        raise ValueError(f"{label} contains duplicate or ineligible player IDs.")
    return sorted(ids)


def prepare_late_swap_package(payload, *, context=None):
    """Validate atomically and freeze declarations; hashes confer no trust."""
    required = {"schema_version", "context", "decision_at", "objective", "contest", "sources", "accepted_state", "catalog", "candidates", "controls"}
    _fields(payload, required, "Late-swap planning package", required=required)
    if payload["schema_version"] != SCHEMA or payload["objective"] != "projection_guided_snapshot":
        raise ValueError("Use the supported offline projection-guided late-swap package version and explicit objective.")
    scope = _context(payload["context"])
    _id(scope["slate_id"], "Slate ID")
    if context is not None and _context(context) != scope:
        raise ValueError("The planning package does not match the exact selected slate context.")
    decision = _time(payload["decision_at"], "Decision time")
    contest_fields = {"contest_id", "name", "late_swap_enabled", "lock_policy", "as_of"}
    contest = _fields(payload["contest"], contest_fields, "Contest declaration", required=contest_fields)
    if contest["late_swap_enabled"] is not True or contest["lock_policy"] != "individual_game":
        raise ValueError("Offline late-swap planning requires explicitly declared individual-game late-swap rules.")
    contest = {"contest_id": _numeric_id(contest["contest_id"], "Contest ID"), "name": _id(contest["name"], "Contest name"),
               "late_swap_enabled": True, "lock_policy": "individual_game", "as_of": _at(contest["as_of"], "Contest rules time", decision)}
    sources, source_ids, source_kinds = [], set(), set()
    for row in _rows(payload["sources"], "Source declarations", 5, 5):
        fields = {"source_id", "kind", "as_of", "content_sha256", "rights"}
        _fields(row, fields, "Source declaration", required=fields)
        sid = _id(row["source_id"], "Source ID")
        kind = row["kind"]
        if not isinstance(kind, str) or kind not in SOURCE_KINDS or sid in source_ids or kind in source_kinds:
            raise ValueError("Supply one distinct source receipt for each required declaration kind.")
        rights = _fields(row["rights"], {"personal_analysis", "hosted_ingestion", "display"}, "Source permissions",
                         required={"personal_analysis", "hosted_ingestion", "display"})
        if any(value is not True for value in rights.values()):
            raise ValueError("Each source requires declared personal analysis, hosted ingestion and display permission.")
        stamp = _at(row["as_of"], "Source time", decision)
        if kind == "lock_snapshot" and _time(stamp, "Lock snapshot time") != decision:
            raise ValueError("The declared lock snapshot must use the exact supplied decision time.")
        sources.append({"source_id": sid, "kind": kind, "as_of": stamp,
                        "content_sha256": _digest(row["content_sha256"], "Source hash"), "rights": dict(rights)})
        source_ids.add(sid); source_kinds.add(kind)
    if source_kinds != SOURCE_KINDS:
        raise ValueError("Supply all five required declaration source kinds.")
    sources.sort(key=lambda row: row["kind"])
    catalog, dfs_ids, games = {}, set(), {}
    player_fields = {"player_id", "dfs_id", "name", "position", "team", "opponent", "game_id", "salary", "kickoff_at", "lock_state", "status", "projection"}
    for row in _rows(payload["catalog"], "Exact-slate catalog", 1, 750):
        _fields(row, player_fields, "Catalog player", required=player_fields)
        pid = _id(row["player_id"], "Canonical player ID")
        dfs_id = _numeric_id(row["dfs_id"], "DraftKings player ID")
        name = _id(row["name"], "Player name")
        if re.match(r"^[\s\ufeff]*[=+@-]", name):
            raise ValueError("Player names cannot begin with spreadsheet formula characters.")
        if pid in catalog or dfs_id in dfs_ids:
            raise ValueError("The catalog repeats a canonical player or DraftKings ID.")
        if not isinstance(row["position"], str) or row["position"] not in {"QB", "RB", "WR", "TE", "DST"}:
            raise ValueError("Catalog position must be an explicit supported Classic position.")
        if not isinstance(row["lock_state"], str) or row["lock_state"] not in {"locked", "unlocked"}:
            raise ValueError("Unknown or missing player lock state blocks offline late-swap planning.")
        if not isinstance(row["status"], str) or row["status"] not in {"eligible", "out", "inactive", "unknown"}:
            raise ValueError("Catalog status must distinguish eligible, out, inactive and unknown.")
        kickoff = _time(row["kickoff_at"], "Player kickoff")
        locked = row["lock_state"] == "locked"
        if locked != (kickoff <= decision):
            raise ValueError("Declared player lock state contradicts kickoff at the supplied decision time.")
        team, opponent = _team(row["team"]), _team(row["opponent"])
        if team == opponent:
            raise ValueError("A catalog player's team and opponent must differ.")
        game = _id(row["game_id"], "Exact game ID")
        game_identity = (kickoff.isoformat(), row["lock_state"], tuple(sorted((team, opponent))))
        if game in games and games[game] != game_identity:
            raise ValueError("Players in one exact game disagree on timing, lock state or teams.")
        games[game] = game_identity
        catalog[pid] = {"player_id": pid, "dfs_id": dfs_id, "name": name, "position": row["position"],
                        "team": team, "opponent": opponent, "game_id": game,
                        "salary": _whole(row["salary"], "Player salary", 1, 50000), "kickoff_at": kickoff.isoformat(),
                        "lock_state": row["lock_state"], "status": row["status"], "projection": _projection(row["projection"], locked=locked)}
        dfs_ids.add(dfs_id)
    state_fields = {"source_id", "readback_sha256", "portfolio_version", "export_version", "as_of", "entries"}
    state = _fields(payload["accepted_state"], state_fields, "Accepted-entry declaration", required=state_fields)
    receipt = next(row for row in sources if row["kind"] == "user_platform_readback")
    state_source = _id(state["source_id"], "Readback source ID")
    readback_hash = _digest(state["readback_sha256"], "Readback hash")
    state_at = _at(state["as_of"], "Readback time", decision)
    if (receipt["source_id"], receipt["content_sha256"], receipt["as_of"]) != (state_source, readback_hash, state_at):
        raise ValueError("Accepted-entry declaration must match its exact readback source, hash and timestamp.")
    entries, entry_ids = [], set()
    for row in _rows(state["entries"], "Accepted-entry declarations", 1, 150):
        _fields(row, {"entry_id", "contest_id", "slots"}, "Accepted entry", required={"entry_id", "contest_id", "slots"})
        eid = _numeric_id(row["entry_id"], "Entry ID")
        cid = _numeric_id(row["contest_id"], "Entry contest ID")
        if eid in entry_ids or cid != contest["contest_id"]:
            raise ValueError("Accepted entries must have distinct IDs and match the exact selected contest.")
        entries.append({"entry_id": eid, "contest_id": cid, "slots": _slots(row["slots"], catalog, f"Accepted entry {eid}")})
        entry_ids.add(eid)
    entries.sort(key=lambda row: row["entry_id"])
    by_entry = {row["entry_id"]: row for row in entries}
    candidates, candidate_ids = [], set()
    for row in _rows(payload["candidates"], "Supplied alternatives", 0, 600):
        _fields(row, {"candidate_id", "entry_id", "slots"}, "Entry alternative", required={"candidate_id", "entry_id", "slots"})
        aid = _id(row["candidate_id"], "Candidate ID")
        eid = _numeric_id(row["entry_id"], "Candidate entry ID")
        if aid in candidate_ids or aid.startswith("baseline:") or eid not in by_entry:
            raise ValueError("Alternatives need distinct non-baseline candidate IDs and an existing exact Entry ID.")
        slots = _slots(row["slots"], catalog, f"Alternative {aid}")
        baseline = by_entry[eid]["slots"]
        locked_slots = {slot: pid for slot, pid in baseline.items() if catalog[pid]["lock_state"] == "locked"}
        if any(slots[slot] != pid for slot, pid in locked_slots.items()):
            raise ValueError(f"Alternative {aid} changes a locked player identity or exact slot.")
        if any(catalog[pid]["lock_state"] == "locked" and locked_slots.get(slot) != pid for slot, pid in slots.items()):
            raise ValueError(f"Alternative {aid} adds or moves a started player outside its accepted exact slot.")
        candidates.append({"candidate_id": aid, "entry_id": eid, "slots": slots})
        candidate_ids.add(aid)
    candidates.sort(key=lambda row: (row["entry_id"], row["candidate_id"]))
    raw_controls = _fields(payload["controls"], CONTROL_FIELDS, "Late-swap strategy controls")
    controls = {"player_exposure_limits": deepcopy(raw_controls.get("player_exposure_limits", {})),
                "group_exposure_limits": deepcopy(raw_controls.get("group_exposure_limits", [])),
                "locked_player_ids": _id_list(raw_controls.get("locked_player_ids", []), "Global locks", set(catalog)),
                "excluded_player_ids": _id_list(raw_controls.get("excluded_player_ids", []), "Global exclusions", set(catalog)),
                "max_exposure": raw_controls.get("max_exposure"), "max_overlap": raw_controls.get("max_overlap"),
                "classic_stack_rules": normalize_classic_stack_rules(raw_controls.get("classic_stack_rules")),
                "block_qb_opposing_dst": raw_controls.get("block_qb_opposing_dst", True),
                "max_per_team": raw_controls.get("max_per_team"), "min_salary": raw_controls.get("min_salary"),
                "max_salary": raw_controls.get("max_salary", 50000)}
    if type(controls["block_qb_opposing_dst"]) is not bool:
        raise ValueError("QB/opposing-DST prevention requires an explicit boolean.")
    for key, low, high in (("max_overlap", 0, 9), ("max_per_team", 1, 9), ("min_salary", 0, 50000), ("max_salary", 1, 50000)):
        if controls[key] is not None:
            _whole(controls[key], key.replace("_", " "), low, high)
    if controls["max_salary"] is None or (controls["min_salary"] or 0) > controls["max_salary"]:
        raise ValueError("Minimum salary cannot exceed a known maximum salary.")
    if controls["max_exposure"] is not None:
        _decimal(controls["max_exposure"], "Global maximum exposure fraction", minimum=Decimal(0), maximum=Decimal(1))
    if not isinstance(controls["player_exposure_limits"], dict) or not isinstance(controls["group_exposure_limits"], list):
        raise ValueError("Player bounds require an object and pair/core bounds require an explicit list.")
    _check_exposure_shapes(controls["player_exposure_limits"], controls["group_exposure_limits"], set(catalog), len(entries), controls["max_exposure"])
    if len(controls["group_exposure_limits"]) > 50:
        raise ValueError("Late-swap planning supports at most 50 pair/core bounds.")
    if controls["classic_stack_rules"]:
        validate_receiving_rb_ids(controls["classic_stack_rules"], [SimpleNamespace(**row) for row in catalog.values()])
    normalized = {"schema_version": SCHEMA, "context": scope, "decision_at": decision.isoformat(), "objective": payload["objective"],
                  "contest": contest, "sources": sources, "accepted_state": {"source_id": state_source, "readback_sha256": readback_hash,
                  "portfolio_version": _id(state["portfolio_version"], "Portfolio version"), "export_version": _id(state["export_version"], "Export version"),
                  "as_of": state_at, "entries": entries}, "catalog": sorted(catalog.values(), key=lambda row: row["player_id"]),
                  "candidates": candidates, "controls": controls}
    return {"schema_version": PREPARED_SCHEMA, "content_id": _hash(normalized), "content": normalized}


def _verified(prepared):
    _fields(prepared, {"schema_version", "content_id", "content"}, "Frozen late-swap package", required={"schema_version", "content_id", "content"})
    if prepared["schema_version"] != PREPARED_SCHEMA or prepared["content_id"] != _hash(prepared["content"]):
        raise ValueError("The frozen planning snapshot changed; preview and select it again.")
    checked = prepare_late_swap_package(prepared["content"])
    if checked["content_id"] != prepared["content_id"]:
        raise ValueError("The frozen planning snapshot is not canonical.")
    return checked["content"]


def _option_issues(slots, catalog, controls):
    ids = set(slots.values())
    issues = []
    if not set(controls["locked_player_ids"]).issubset(ids):
        issues.append("missing_global_lock")
    if ids.intersection(controls["excluded_player_ids"]):
        issues.append("global_exclusion")
    salary = sum(catalog[pid]["salary"] for pid in ids)
    if not (controls["min_salary"] or 0) <= salary <= controls["max_salary"]:
        issues.append("strategy_salary_range")
    if controls["max_per_team"] is not None and max(Counter(catalog[pid]["team"] for pid in ids).values()) > controls["max_per_team"]:
        issues.append("strategy_team_limit")
    if any(catalog[pid]["lock_state"] == "unlocked" and catalog[pid]["status"] != "eligible" for pid in ids):
        issues.append("unstarted_status_not_declared_eligible")
    players = {pid: SimpleNamespace(**row) for pid, row in catalog.items()}
    lineup = {"lineup": [{"player_id": pid} for pid in ids]}
    if controls["block_qb_opposing_dst"]:
        qb = qb_dst_audit(lineup, players)
        if qb["conflicts"] or qb["unknown"]:
            issues.append("qb_opposing_dst")
    if controls["classic_stack_rules"]:
        stack = audit_classic_stack(lineup, list(players.values()), controls["classic_stack_rules"])
        issues.extend(f"classic_stack:{issue}" for issue in stack["issues"])
    return sorted(issues)


def _options(content):
    catalog = {row["player_id"]: row for row in content["catalog"]}
    baselines = [{"candidate_id": f"baseline:{row['entry_id']}", "entry_id": row["entry_id"], "slots": row["slots"]}
                 for row in content["accepted_state"]["entries"]]
    options = []
    for row in baselines + content["candidates"]:
        slots = row["slots"]
        options.append({**deepcopy(row), "salary": sum(catalog[pid]["salary"] for pid in slots.values()),
                        "projection": sum((Decimal(catalog[pid]["projection"]) for pid in slots.values()
                                           if catalog[pid]["lock_state"] == "unlocked"), Decimal(0)),
                        "issues": _option_issues(slots, catalog, content["controls"])})
    return sorted(options, key=lambda row: (row["entry_id"], row["candidate_id"]))


def _rules(content):
    controls, count = content["controls"], len(content["accepted_state"]["entries"])
    rules = []
    default_max = Decimal(str(controls["max_exposure"])) if controls["max_exposure"] is not None else Decimal(1)
    for player in content["catalog"]:
        pid = player["player_id"]
        counts = exposure_counts(controls["player_exposure_limits"].get(pid, {}), count)
        counts["maximum_count"] = min(counts["maximum_count"], math.floor(default_max * count))
        if pid in controls["locked_player_ids"]:
            counts["minimum_count"] = count
        rules.append({"id": pid, "scope": "player", "player_ids": [pid], **counts})
    for group in controls["group_exposure_limits"]:
        rules.append({"id": group["id"], "scope": "group", "player_ids": sorted(group["player_ids"]),
                      **exposure_counts({key: group[key] for key in ("min", "target", "max") if key in group}, count)})
    return rules


def _audit(content, selected, rules):
    catalog = {row["player_id"]: row for row in content["catalog"]}
    baselines = {row["entry_id"]: row for row in content["accepted_state"]["entries"]}
    issues, seen, sets = [], set(), []
    for option in selected:
        eid = option["entry_id"]
        if eid in seen or eid not in baselines:
            issues.append("entry_assignment")
            continue
        seen.add(eid)
        try:
            slots = _slots(option["slots"], catalog, "Proposed entry")
        except (TypeError, KeyError, ValueError):
            issues.append("structural_lineup")
            continue
        locked = {slot: pid for slot, pid in baselines[eid]["slots"].items() if catalog[pid]["lock_state"] == "locked"}
        if any(slots.get(slot) != pid for slot, pid in locked.items()):
            issues.append("locked_exact_slot")
        if any(catalog[pid]["lock_state"] == "locked" and locked.get(slot) != pid for slot, pid in slots.items()):
            issues.append("incoming_started_player")
        issues.extend(_option_issues(slots, catalog, content["controls"]))
        sets.append(set(slots.values()))
    if seen != set(baselines) or len(selected) != len(baselines):
        issues.append("entry_count")
    actuals = []
    for rule in rules:
        actual = sum(set(rule["player_ids"]).issubset(ids) for ids in sets)
        actuals.append({**rule, "actual_count": actual})
        if not rule["minimum_count"] <= actual <= rule["maximum_count"]:
            issues.append(f"hard_{rule['scope']}_exposure:{rule['id']}")
    overlap = content["controls"]["max_overlap"]
    if overlap is not None and any(len(a & b) > overlap for index, a in enumerate(sets) for b in sets[:index]):
        issues.append("hard_overlap")
    return {"ok": not issues, "issues": sorted(set(issues)), "entry_count": len(selected),
            "locked_slots_preserved": not any(code in issues for code in ("locked_exact_slot", "incoming_started_player", "entry_count")),
            "hard_counts": actuals}


def _miss(audit):
    # Up to 800 targets may have 24 decimal places. Keep the aggregate exact,
    # including tiny differences beside a large common target miss.
    with localcontext() as decimal_context:
        decimal_context.prec = 80
        return sum((abs(Decimal(row["actual_count"]) - Decimal(row["target_count"]))
                    for row in audit["hard_counts"] if row["target_count"] is not None), Decimal(0))


def _rejections(options):
    return [{"entry_id": row["entry_id"], "candidate_id": row["candidate_id"], "issues": list(row["issues"])}
            for row in options if row["issues"]]


def late_swap_summary(prepared):
    content = _verified(prepared)
    catalog = {row["player_id"]: row for row in content["catalog"]}
    options = _options(content)
    return {"schema_version": "dfs_late_swap_preview_v1", "content_id": prepared["content_id"],
            "semantics": SEMANTICS, "context": deepcopy(content["context"]), "decision_at": content["decision_at"],
            "contest": deepcopy(content["contest"]), "entry_count": len(content["accepted_state"]["entries"]),
            "candidate_count": len(content["candidates"]), "option_count": len(options),
            "locked_slot_count": sum(catalog[pid]["lock_state"] == "locked" for entry in content["accepted_state"]["entries"] for pid in entry["slots"].values()),
            "rejected_options": _rejections(options), "sources": deepcopy(content["sources"]),
            "capabilities": dict(CAPABILITIES), "warnings": list(WARNINGS)}


def _report_id(report):
    return _hash({key: value for key, value in report.items() if key not in {"plan_id", "runtime_seconds"}})


def _entry_report(row, before, catalog, contest_id):
    changes = [{"entry_id": row["entry_id"], "slot": slot, "before_player_id": before["slots"][slot],
                "after_player_id": row["slots"][slot], "before_dfs_id": catalog[before["slots"][slot]]["dfs_id"],
                "after_dfs_id": catalog[row["slots"][slot]]["dfs_id"], "locked": False}
               for slot in SLOTS if before["slots"][slot] != row["slots"][slot]]
    locked = {slot: pid for slot, pid in before["slots"].items() if catalog[pid]["lock_state"] == "locked"}
    lineup = [{"slot": slot, "player_id": row["slots"][slot], "dfs_id": catalog[row["slots"][slot]]["dfs_id"],
               "player": catalog[row["slots"][slot]]["name"], "position": catalog[row["slots"][slot]]["position"],
               "team": catalog[row["slots"][slot]]["team"], "salary": catalog[row["slots"][slot]]["salary"],
               "projection": catalog[row["slots"][slot]]["projection"], "locked": catalog[row["slots"][slot]]["lock_state"] == "locked"}
              for slot in SLOTS]
    return {"entry_id": row["entry_id"], "contest_id": contest_id, "candidate_id": row["candidate_id"],
            "before_slots": deepcopy(before["slots"]), "after_slots": deepcopy(row["slots"]), "locked_slots": locked,
            "changes": changes, "projection_before": str(before["projection"]), "projection_after": str(row["projection"]),
            "salary_before": before["salary"], "salary_after": row["salary"], "lineup": lineup}


def plan_late_swap(prepared, *, time_limit=8):
    """Choose exactly one legal option per declared entry, without editing it."""
    started = time.monotonic()
    if isinstance(time_limit, bool) or not isinstance(time_limit, (int, float)) or not math.isfinite(time_limit) or not 0 < time_limit <= 60:
        raise ValueError("Planning time limit must be finite, above zero and at most 60 seconds.")
    content = _verified(prepared)
    options, rules = _options(content), _rules(content)
    baselines = [row for row in options if row["candidate_id"].startswith("baseline:")]
    count = len(baselines)
    grouped = [[i for i, row in enumerate(options) if row["entry_id"] == baseline["entry_id"] and not row["issues"]] for baseline in baselines]
    report = {"schema_version": PLAN_SCHEMA, "semantics": SEMANTICS, "package_id": prepared["content_id"],
              "context": deepcopy(content["context"]), "decision_at": content["decision_at"], "contest": deepcopy(content["contest"]),
              "entry_count": count, "requested_count": count, "selected_count": 0, "unique_count": 0,
              "candidate_count": len(content["candidates"]), "option_count": len(options), "complete": False,
              "entries": [], "changes": [], "constraints": deepcopy(rules), "controls": deepcopy(content["controls"]),
              "targets": [], "rejected_options": _rejections(options), "audit": {"ok": False, "issues": ["no_complete_plan"]},
              "solver": {"status": "not_started", "method": None, "candidate_pool_only": True, "proven_optimal": False,
                         "numerical_optimal": False, "bound": None, "gap": None, "evaluated_trials": 0,
                         "target_policy": "minimum absolute appearance miss, then unstarted-player input sum",
                         "objective": "unstarted_player_input_sum", "time_limit_seconds": time_limit},
              "baseline": {"projection_sum": str(sum((row["projection"] for row in baselines), Decimal(0))), "salary_sum": sum(row["salary"] for row in baselines)},
              "proposed": None, "input_manifest": {"package_id": prepared["content_id"],
              "engine": {"version": ENGINE_VERSION, "numpy": np.__version__, "scipy": scipy.__version__}, "sources": deepcopy(content["sources"]),
              "accepted_readback_sha256": content["accepted_state"]["readback_sha256"],
              "portfolio_version": content["accepted_state"]["portfolio_version"], "export_version": content["accepted_state"]["export_version"],
              "objective": content["objective"], "controls_id": _hash(content["controls"]), "catalog_id": _hash(content["catalog"]),
              "accepted_state_id": _hash(content["accepted_state"]), "candidates_id": _hash(content["candidates"])},
              "capabilities": dict(CAPABILITIES), "warnings": list(WARNINGS)}

    def finish(status, chosen=None, error=None):
        report["solver"]["status"] = status
        selected = [options[i] for i in (chosen or [])]
        if selected:
            audit = _audit(content, selected, rules)
            if not audit["ok"]:
                report["audit"] = audit
                report["solver"].update(status="solver_error", proven_optimal=False, numerical_optimal=False)
                error = "The proposed plan failed its independent hard-constraint audit; no proposal was released."
            else:
                report["audit"] = audit
                catalog = {row["player_id"]: row for row in content["catalog"]}
                baseline_by_entry = {row["entry_id"]: row for row in baselines}
                for row in selected:
                    before = baseline_by_entry[row["entry_id"]]
                    public_entry = _entry_report(row, before, catalog, content["contest"]["contest_id"])
                    report["entries"].append(public_entry)
                    report["changes"].extend(public_entry["changes"])
                report.update(complete=True, selected_count=count, unique_count=len({tuple(sorted(row["slots"].values())) for row in selected}))
                report["proposed"] = {"projection_sum": str(sum((row["projection"] for row in selected), Decimal(0))), "salary_sum": sum(row["salary"] for row in selected)}
                report["targets"] = [{"id": row["id"], "scope": row["scope"], "player_ids": row["player_ids"],
                    "target_count": row["target_count"], "actual_count": row["actual_count"],
                    "deviation_count": str(Decimal(row["actual_count"]) - Decimal(row["target_count"]))}
                    for row in audit["hard_counts"] if row["target_count"] is not None]
                report["solver"]["target_deviation_count"] = str(_miss(audit))
        if error:
            report["error"] = error
        report["runtime_seconds"] = round(time.monotonic() - started, 6)
        report["plan_id"] = _report_id(report)
        return report

    if any(not choices for choices in grouped) or any(rule["minimum_count"] > rule["maximum_count"] for rule in rules):
        return finish("constraint_conflict", error="An entry has no strategy-compatible option, or a minimum exceeds its maximum. Review the explicit rejected options and hard bounds; no rule was relaxed.")
    combinations = math.prod(len(choices) for choices in grouped)
    if combinations <= 4096:
        report["solver"]["method"] = "exact_candidate_assignment_enumeration"
        best, best_key, exhausted = None, None, True
        for combination in itertools.product(*grouped):
            if time.monotonic() - started >= time_limit:
                exhausted = False
                break
            report["solver"]["evaluated_trials"] += 1
            selected = [options[i] for i in combination]
            audit = _audit(content, selected, rules)
            if not audit["ok"]:
                continue
            key = (_miss(audit), -sum((row["projection"] for row in selected), Decimal(0)), tuple(row["candidate_id"] for row in selected))
            if best_key is None or key < best_key:
                best, best_key = list(combination), key
        if exhausted:
            report["solver"].update(proven_optimal=best is not None, gap=0 if best is not None else None,
                                    target_stage_status="exact_candidate_pool" if best is not None else "infeasible_candidate_pool")
            return finish("optimal_candidate_pool" if best is not None else "infeasible_candidate_pool", best,
                          None if best is not None else "No complete feasible assignment exists in the supplied candidate pool; no hard rule was relaxed.")
        return finish("feasible_time_limit" if best is not None else "time_limit", best,
                      None if best is not None else "The search reached its time limit without a complete audited proposal.")

    report["solver"]["method"] = "bounded_per_entry_candidate_milp"
    m = len(options)
    sets = [set(row["slots"].values()) for row in options]
    targets = [rule for rule in rules if rule["target_count"] is not None]
    nv = m + 2 * len(targets)
    rr, cc, dd, lower, upper = [], [], [], [], []

    def add(coefficients, lb, ub):
        r = len(lower)
        for col, value in coefficients.items():
            rr.append(r); cc.append(col); dd.append(float(value))
        lower.append(float(lb)); upper.append(float(ub))

    for baseline in baselines:
        add({i: 1 for i, row in enumerate(options) if row["entry_id"] == baseline["entry_id"]}, 1, 1)
    for rule in rules:
        add({i: 1 for i, ids in enumerate(sets) if set(rule["player_ids"]).issubset(ids)}, rule["minimum_count"], rule["maximum_count"])
    overlap = content["controls"]["max_overlap"]
    if overlap is not None:
        for i in range(m):
            for j in range(i):
                if options[i]["entry_id"] != options[j]["entry_id"] and len(sets[i] & sets[j]) > overlap:
                    add({i: 1, j: 1}, 0, 1)
    for ti, rule in enumerate(targets):
        coefficients = {i: 1 for i, ids in enumerate(sets) if set(rule["player_ids"]).issubset(ids)}
        coefficients.update({m + 2 * ti: -1, m + 2 * ti + 1: 1})
        target = Decimal(rule["target_count"])
        add(coefficients, target, target)
    bounds = Bounds(np.zeros(nv), np.array([0.0 if row["issues"] else 1.0 for row in options] + [float(count)] * (nv - m)))
    integrality = np.array([1] * m + [0] * (nv - m))

    def solve(cost):
        remaining = time_limit - (time.monotonic() - started)
        if remaining <= 0:
            return None
        matrix = coo_matrix((dd, (rr, cc)), shape=(len(lower), nv)).tocsc()
        return milp(np.array(cost), integrality=integrality, bounds=bounds,
                    constraints=LinearConstraint(matrix, np.array(lower), np.array(upper)),
                    options={"time_limit": remaining, "mip_rel_gap": 0.0})

    def selection(solved):
        x = getattr(solved, "x", None)
        if x is None or len(x) != nv or not all(math.isfinite(float(v)) for v in x):
            return None
        if any(abs(x[i] - round(x[i])) > 1e-5 for i in range(m)):
            return None
        indices = [i for i in range(m) if x[i] > .5]
        return indices if _audit(content, [options[i] for i in indices], rules)["ok"] else None

    incumbent = None
    if targets:
        target_result = solve([0.0] * m + [1.0] * (nv - m))
        incumbent = selection(target_result)
        report["solver"]["target_stage_status"] = "numerical_optimal" if getattr(target_result, "status", None) == 0 else "unresolved"
        if getattr(target_result, "status", None) != 0 or incumbent is None:
            code = getattr(target_result, "status", None)
            return finish("feasible_time_limit" if incumbent is not None else "infeasible_candidate_pool" if code == 2 else "time_limit" if code in {None, 1} else "solver_error", incumbent,
                          None if incumbent is not None else "No complete audited assignment was returned during target selection.")
        add({i: 1 for i in range(m, nv)}, 0, float(target_result.fun) + 1e-7)
    solved = solve([-float(row["projection"]) for row in options] + [0.0] * (nv - m))
    chosen = selection(solved)
    code = getattr(solved, "status", None)
    target_fallback = False
    if chosen is not None and incumbent is not None and _miss(_audit(content, [options[i] for i in chosen], rules)) > _miss(_audit(content, [options[i] for i in incumbent], rules)):
        # Numerical stage tolerances must never worsen the exact preference
        # already achieved. Keep its audited incumbent and discard the score
        # certificate, which does not describe the returned assignment.
        chosen = incumbent
        target_fallback = True
        report["solver"].update(incumbent_stage="soft_targets", score_stage_candidate_rejected="worse_exact_target_miss")
    if chosen is None and code in {None, 1}:
        chosen = incumbent
    for key, attr in (("bound", "mip_dual_bound"), ("gap", "mip_gap")):
        value = getattr(solved, attr, None)
        report["solver"][key] = float(value) if not target_fallback and value is not None and math.isfinite(float(value)) else None
    report["solver"].update(numerical_optimal=code == 0 and chosen is not None and not target_fallback,
                            bound_units="minimized negative unstarted-player input sum; floating numerical certificate")
    if code == 0 and chosen is None:
        return finish("solver_error", error="The numerical solver returned no independently audited complete assignment.")
    status = "feasible_candidate_pool" if code == 0 else "feasible_time_limit" if chosen is not None else "infeasible_candidate_pool" if code == 2 else "time_limit" if code in {None, 1} else "solver_error"
    return finish(status, chosen, None if chosen is not None else "No complete audited assignment was returned; this result applies only to the supplied options.")


def build_late_swap_csv_preview(template_text, prepared, report):
    """Internal dry-run bytes; never a platform-ready late-swap artifact."""
    content = _verified(prepared)
    if not isinstance(template_text, str) or len(template_text.encode("utf-8")) > 8 * 1024 * 1024:
        raise ValueError("The internal template preview requires bounded UTF-8 CSV text.")
    if not isinstance(report, dict) or report.get("schema_version") != PLAN_SCHEMA or report.get("package_id") != prepared["content_id"] or report.get("plan_id") != _report_id(report) or report.get("complete") is not True:
        raise ValueError("Use the unchanged complete plan for this exact frozen package.")
    options = {row["candidate_id"]: row for row in _options(content)}
    frozen_catalog = {row["player_id"]: row for row in content["catalog"]}
    frozen_baselines = {row["entry_id"]: row for row in options.values() if row["candidate_id"].startswith("baseline:")}
    if not isinstance(report.get("entries"), list) or any(not isinstance(entry, dict) for entry in report["entries"]):
        raise ValueError("The complete plan needs explicit exact entry records.")
    selected = []
    for entry in report["entries"]:
        candidate = options.get(entry.get("candidate_id"))
        if candidate is None or candidate["entry_id"] != entry.get("entry_id") or candidate["slots"] != entry.get("after_slots"):
            raise ValueError("A proposed entry no longer matches its exact supplied option.")
        expected = _entry_report(candidate, frozen_baselines[candidate["entry_id"]], frozen_catalog, content["contest"]["contest_id"])
        if entry != expected:
            raise ValueError("A proposed entry's frozen identities, slots, salary or change manifest no longer matches its package.")
        selected.append(candidate)
    audit = _audit(content, selected, _rules(content))
    if not audit["ok"]:
        raise ValueError("The internal preview failed its fresh hard-constraint audit.")
    try:
        rows = list(csv.reader(io.StringIO(template_text.lstrip("\ufeff"), newline=""), strict=True))
    except csv.Error as exc:
        raise ValueError("The original entry template is malformed CSV.") from exc
    def key(value):
        return re.sub(r"[^a-z0-9]", "", value.lower())
    header_at = next((i for i, row in enumerate(rows) if {"entryid", "contestid", "contestname", "entryfee"}.issubset({key(cell) for cell in row})), None)
    if header_at is None:
        raise ValueError("Use the original DraftKings Edit Entries template with entry and contest metadata.")
    header = rows[header_at]
    keys = [key(cell) for cell in header]
    entry_col, contest_col = keys.index("entryid"), keys.index("contestid")
    starts = [i for i in range(len(header)) if tuple(cell.strip().upper() for cell in header[i:i+9]) == HEADERS]
    if len(starts) != 1 or any(keys.count(name) != 1 for name in ("entryid", "contestid", "contestname", "entryfee")):
        raise ValueError("The original template must contain one exact ordered Classic roster section and unambiguous metadata columns.")
    start = starts[0]
    catalog = {row["player_id"]: row for row in content["catalog"]}
    baselines = {row["entry_id"]: row for row in content["accepted_state"]["entries"]}
    proposal = {row["entry_id"]: row for row in selected}
    changed_rows, seen = [], set()
    original = deepcopy(rows)
    for row_index in range(header_at + 1, len(rows)):
        row = rows[row_index]
        eid = row[entry_col] if len(row) > entry_col else ""
        if eid != eid.strip() and eid.strip() in baselines:
            raise ValueError("A selected template Entry ID has padding; preserve exact identity text.")
        if not eid or not re.fullmatch(r"[0-9]+", eid):
            continue
        if eid in seen:
            raise ValueError("The original template repeats an Entry ID.")
        seen.add(eid)
        if eid not in baselines:
            continue
        if len(row) < start + 9 or len(row) <= contest_col or row[contest_col] != content["contest"]["contest_id"]:
            raise ValueError("A selected entry has incomplete slots or a different contest in the original template.")
        before = baselines[eid]["slots"]
        def dfs_id(cell):
            match = re.fullmatch(r"[0-9]+", cell.strip()) or re.search(r"\(([0-9]+)\)\s*$", cell)
            return match.group(0) if match and match.lastindex is None else match.group(1) if match else None
        if [dfs_id(cell) for cell in row[start:start+9]] != [catalog[before[slot]]["dfs_id"] for slot in SLOTS]:
            raise ValueError("The original entry template does not match the exact declared accepted baseline slots.")
        after = proposal[eid]["slots"]
        cells = [row[start + i] if before[slot] == after[slot] else f"{catalog[after[slot]]['name']} ({catalog[after[slot]]['dfs_id']})" for i, slot in enumerate(SLOTS)]
        row[start:start+9] = cells
        changed_rows.append({"entry_id": eid, "row_index": row_index, "before": original[row_index][start:start+9], "after": list(cells)})
    if set(baselines) - seen:
        raise ValueError("The original template is missing a selected accepted Entry ID.")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL)
    writer.writerows(rows)
    csv_text = output.getvalue()
    reparsed = list(csv.reader(io.StringIO(csv_text, newline=""), strict=True))
    if reparsed != rows:
        raise ValueError("Internal CSV round-trip validation failed.")
    for index, (old, new) in enumerate(zip(original, rows)):
        if any(change["row_index"] == index for change in changed_rows):
            if old[:start] != new[:start] or old[start+9:] != new[start+9:]:
                raise ValueError("Internal CSV preview changed entry metadata.")
        elif old != new:
            raise ValueError("Internal CSV preview changed an unrelated row.")
    manifest = {"schema_version": "dfs_late_swap_csv_dry_run_v1", "package_id": prepared["content_id"], "plan_id": report["plan_id"],
                "artifact": "internal_engineering_preview", "platform_export_ready": False, "selected_entry_count": len(baselines),
                "template_sha256": hashlib.sha256(template_text.encode("utf-8")).hexdigest(),
                "csv_sha256": hashlib.sha256(csv_text.encode("utf-8")).hexdigest(), "changes": changed_rows,
                "metadata_preserved": True, "unselected_rows_preserved": True, "round_trip_passed": True, "audit": audit}
    return {"csv": csv_text, "manifest": manifest}
