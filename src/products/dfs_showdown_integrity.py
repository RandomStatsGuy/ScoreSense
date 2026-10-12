"""Pure, frozen-input Showdown scoring and review contracts.

Rows emitted by the Captain solver already contain weighted points and salary.
These helpers never apply the Captain multiplier again, fetch current data,
change coefficients, or interpret an advisory finding as platform invalidity.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from copy import deepcopy
import json
import math
import re

from src.core.team_codes import normalize_team_for_match

SCHEMA_VERSION = "showdown_integrity_v1"
_CAPTAIN_SLOTS = {"CPT", "MVP"}


def _text(value):
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    text = str(value).strip()
    return text if text and text.lower() not in {"nan", "none", "<na>"} else None


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _first(row, *keys):
    for key in keys:
        value = _text(row.get(key))
        if value is not None:
            return value
    return None


def normalize_injury_status(value):
    """Canonical display status; absence is unknown, never inferred active."""
    text = _text(value)
    if text is None:
        return "Unknown"
    key = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    aliases = {
        "q": "Questionable", "questionable": "Questionable",
        "d": "Doubtful", "doubtful": "Doubtful", "o": "Out", "out": "Out",
        "ir": "IR", "injured reserve": "IR", "reserve injured": "IR",
        "pup": "PUP", "physically unable to perform": "PUP",
        "inactive": "Inactive", "suspended": "Suspended",
        "active": "Active", "healthy": "Active", "available": "Active",
        "limited": "Limited", "limited practice": "Limited",
        "lp": "Limited", "dnp": "Did not practice", "did not practice": "Did not practice",
        "probable": "Probable", "unknown": "Unknown",
    }
    if key in aliases:
        return aliases[key]
    for phrase in ("questionable", "doubtful", "injured reserve", "inactive", "suspended"):
        if key.startswith(phrase + " "):
            return aliases[phrase]
    if key.startswith("out "):
        return "Out"
    if key.startswith("ir ") or key.endswith(" injured reserve"):
        return "IR"
    if key.startswith("pup ") or key.startswith("reserve pup"):
        return "PUP"
    return "Unknown"


def _ids(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    return sorted({_text(item) for item in value if _text(item)}) if isinstance(value, (list, tuple)) else []


def player_provenance(row, *, pool_metadata=None):
    """Capture only provided components; no reverse engineering unknown models.

    ``raw_inputs`` means the frozen FLEX-basis solver inputs, not unadjusted
    model heads. Baseline/adjustment components are separately nullable.
    """
    meta = pool_metadata or {}
    existing = row.get("diagnostics")
    if isinstance(existing, Mapping):
        return deepcopy(dict(existing))
    source = _first(row, "projection_source", "source_type") or "Unknown"
    imported = source.lower() in {"imported", "imported estimate", "user import", "user override"}
    statistic = _first(row, "projection_statistic") or _text(meta.get("projection_statistic")) or "unknown"
    # Existing numeric overrides carry no vendor estimand/conditioning claim.
    # They must not inherit the replaced model row's semantic metadata.
    if imported:
        statistic = "unknown"
    if statistic not in {"median", "mean", "point_estimate", "mixed", "unknown"}:
        statistic = "unknown"
    conditioning = _first(row, "availability_conditioning") or _text(meta.get("availability_conditioning")) or "unknown"
    if imported:
        conditioning = "unknown"
    if conditioning not in {"conditional_active", "scenario_mixture", "user_scenario", "unknown"}:
        conditioning = "unknown"
    role = row.get("role_evidence")
    role = deepcopy(dict(role)) if isinstance(role, Mapping) else None
    return {
        "schema_version": SCHEMA_VERSION,
        "canonical_id": _first(row, "player_id"),
        "provider_id": _first(row, "provider_id", "sleeper_id"),
        "slate_id": _first(row, "slate_id") or _text(meta.get("slate_id")),
        "slate_player_id": _first(row, "dfs_id"),
        "captain_slate_id": _first(row, "cpt_dfs_id"),
        "source_type": source,
        "model": None if imported else _first(row, "projection_model", "model_version"),
        "forecast_at": None if imported else _first(row, "forecast_at", "projection_built_at") or _text(meta.get("built_at")),
        "data_at": _first(row, "data_at", "source_updated_at"),
        "forecast_snapshot_id": None if imported else _first(row, "forecast_snapshot_id") or _text(meta.get("forecast_snapshot_id")),
        "injury_snapshot_id": _first(row, "injury_snapshot_id") or _text(meta.get("injury_snapshot_id")),
        "season": _number(row.get("Season", meta.get("season"))),
        "week": _number(row.get("Week", meta.get("week"))),
        "observed_period": deepcopy(row.get("observed_period")) if isinstance(row.get("observed_period"), (dict, list, str)) else None,
        "raw_inputs": {"p10": _number(row.get("Low (P10)")), "projection": _number(row.get("Projected Points")), "p90": _number(row.get("High (P90)")), "basis": "FLEX"},
        "projection_statistic": statistic,
        "score_system_id": None if imported else _first(row, "score_system_id", "projection_site") or _text(meta.get("score_system_id")),
        "availability_conditioning": conditioning,
        "build_injury_status": normalize_injury_status(row.get("Injury Status", row.get("injury_status"))),
        "build_injury_status_raw": _first(row, "Injury Status", "injury_status"),
        "injury_status_at": _first(row, "availability_updated_at", "injury_status_at"),
        "baseline_inputs": deepcopy(row.get("baseline_inputs")) if not imported and isinstance(row.get("baseline_inputs"), Mapping) else None,
        "own_status_adjustment": None if imported else _number(row.get("availability_adjustment")),
        "teammate_opportunity_adjustment": None if imported else _number(row.get("opportunity_adjustment")),
        "teammate_opportunity_fraction": None if imported else _number(row.get("Opportunity Adjustment", row.get("Injury Boost"))),
        "adjustments_embedded": row.get("adjustments_embedded") if not imported and isinstance(row.get("adjustments_embedded"), bool) else None,
        "driver_player_ids": [] if imported else _ids(row.get("driver_player_ids")),
        "unresolved_personnel_ids": _ids(row.get("unresolved_personnel_ids")),
        "scenario_id": _first(row, "scenario_id"),
        "imported_override": imported,
        "eligibility_reason": _first(row, "projection_missing_reason", "eligibility_reason"),
        "projection_stale": row.get("projection_stale") is True or meta.get("projection_stale") is True,
        "role_evidence": role,
        "current_role_estimate": deepcopy(row.get("current_role_estimate")) if isinstance(row.get("current_role_estimate"), Mapping) else None,
        "predicted_zero_probability": _number(row.get("predicted_zero_probability")),
    }


def _combined(values, allowed=None):
    values = {value for value in values if value is not None}
    if not values or "unknown" in values:
        return "unknown"
    if len(values) > 1:
        return "mixed" if allowed is None else "unknown"
    value = next(iter(values))
    return value if allowed is None or value in allowed else "unknown"


def score_lineup(rows, objective, *, score_system_id=None, forecast_snapshot_id=None,
                 injury_snapshot_id=None, solver_status="unknown"):
    """Sum already weighted row inputs without changing legacy precision.

    An optional exact ``objective_coefficient`` avoids renderer-rounding drift.
    Value uses each slot's points per $1,000 of its actual slot salary.
    """
    if objective not in {"median", "floor", "ceiling", "value"}:
        raise ValueError("Unknown scoring objective")
    diagnostics = [row.get("diagnostics") or {} for row in rows]
    statistic = _combined([item.get("projection_statistic", "unknown") for item in diagnostics])
    conditioning = _combined([item.get("availability_conditioning", "unknown") for item in diagnostics],
                             {"conditional_active", "scenario_mixture", "user_scenario"})
    projections = [_number(row.get("projection_coefficient", row.get("proj"))) for row in rows]
    projection_sum = math.fsum(projections) if all(v is not None for v in projections) else None
    coefficients = []
    for row in rows:
        coefficient = _number(row.get("objective_coefficient"))
        if coefficient is None:
            if objective == "value":
                salary, proj = _number(row.get("salary")), _number(row.get("proj"))
                coefficient = proj / salary * 1000 if salary and proj is not None else None
            else:
                coefficient = _number(row.get({"median": "proj", "floor": "floor", "ceiling": "ceiling"}[objective]))
        coefficients.append(coefficient)
    objective_score = math.fsum(coefficients) if all(v is not None for v in coefficients) else None
    projection_label = {"median": "Sum of player medians", "mean": "Sum of player means",
                        "point_estimate": "Projection sum", "mixed": "Mixed projection sum", "unknown": "Projection sum"}[statistic]
    labels = {"ceiling": "P90-input score", "floor": "P10-input score", "median": projection_label, "value": "Value-input score"}
    semantics = {
        "ceiling": "Adds each player's P90 input, including the Captain multiplier. Not a predicted lineup percentile.",
        "floor": "Adds each player's P10 input, including the Captain multiplier. Not a predicted lineup percentile.",
        "median": "Adds the frozen player projection inputs, including the Captain multiplier. A sum of player medians is not a lineup median.",
        "value": "Adds each slot's projected points per $1,000 of that slot's salary. Not fantasy points, a probability, or expected payout.",
    }
    return {
        "schema_version": SCHEMA_VERSION, "objective_key": objective,
        "objective_label": labels[objective], "objective_score": objective_score,
        "objective_units": "points_per_1000_salary_sum" if objective == "value" else "fantasy_points_input_sum",
        "objective_semantics": semantics[objective], "projection_sum": projection_sum,
        "projection_statistic": statistic, "projection_label": projection_label,
        "score_system_id": _combined([item.get("score_system_id") or "unknown" for item in diagnostics]) if diagnostics else (score_system_id or "unknown"),
        "captain_multiplier_applied": any(str(row.get("slot", "")).upper() in _CAPTAIN_SLOTS for row in rows),
        "forecast_snapshot_id": forecast_snapshot_id or _single_snapshot(diagnostics, "forecast_snapshot_id"),
        "injury_snapshot_id": injury_snapshot_id or _single_snapshot(diagnostics, "injury_snapshot_id"),
        "availability_conditioning": conditioning, "solver_status": solver_status,
        "display_precision": 2, "numeric_tolerance": 1e-8,
    }


def _single_snapshot(diagnostics, key):
    ids = {item.get(key) for item in diagnostics}
    return next(iter(ids)) if len(ids) == 1 and None not in ids else None


def audit_showdown_lineup(rows, *, showdown_rules=None):
    """Independent strategy advice. Findings never alter player coefficients."""
    rules = showdown_rules or {}
    policy = rules.get("receiver_captain_qb", "warn")
    qb_by_team = rules.get("qb_by_team") or rules.get("resolved_qb_ids") or {}
    findings = []
    selected = {str(row.get("player_id")): row for row in rows}
    captain = next((row for row in rows if str(row.get("slot", "")).upper() in _CAPTAIN_SLOTS), None)

    def finding(code, affected, action, *, evidence=None, severity="warning", overridden=False):
        findings.append({"code": code, "severity": severity,
                         "player_ids": sorted({str(row.get("player_id")) for row in affected}),
                         "evidence_basis": evidence or {"kind": "frozen_roster", "schema_version": SCHEMA_VERSION},
                         "suggested_action": action, "policy_overridden": overridden})

    if captain and str(captain.get("position", "")).upper() in {"WR", "TE"}:
        team = normalize_team_for_match(captain.get("team") or "")
        mapped = qb_by_team.get(team) or []
        mapped = [mapped] if isinstance(mapped, str) else list(mapped)
        paired = [selected[pid] for pid in mapped if pid in selected and selected[pid].get("position") == "QB"
                  and normalize_team_for_match(selected[pid].get("team") or "") == team]
        if not mapped:
            finding("receiver_captain_qb_unknown", [captain], "Choose a verified quarterback for this Captain's team.",
                    severity="error" if policy == "require" else "warning",
                    evidence={"kind": "strategy_policy", "policy": policy, "team": team, "verified_qb_ids": []}, overridden=policy == "off")
        elif not paired:
            finding("receiver_captain_without_qb", [captain], "Review the receiver Captain without his configured quarterback.",
                    severity="error" if policy == "require" else "warning",
                    evidence={"kind": "strategy_policy", "policy": policy, "team": team, "verified_qb_ids": mapped}, overridden=policy == "off")
    defenses = [row for row in rows if str(row.get("position", "")).upper() in {"DST", "DEF"}]
    for defense in defenses:
        defense_team = normalize_team_for_match(defense.get("team") or "")
        for row in rows:
            if row is defense:
                continue
            opposing = bool(defense_team) and normalize_team_for_match(row.get("team") or "") != defense_team
            if opposing and row.get("position") == "QB":
                finding("qb_opposing_dst", [row, defense], "Review the quarterback against the selected defense.")
            if opposing and row is captain:
                finding("captain_opposing_dst", [row, defense], "Review the Captain against the selected defense.")
    by_team = defaultdict(list)
    for row in rows:
        if row.get("position") == "RB":
            by_team[normalize_team_for_match(row.get("team") or "")].append(row)
    for team, backs in sorted(by_team.items()):
        if team and len(backs) > 1:
            finding("shared_backfield", backs, "Review shared backfield exposure.",
                    evidence={"kind": "frozen_roster", "team": team, "rb_captain": captain in backs})
    dependencies = defaultdict(list)
    for row in rows:
        diag = row.get("diagnostics") or {}
        status = normalize_injury_status(diag.get("build_injury_status", row.get("injury_status")))
        if status in {"Questionable", "Doubtful", "Limited", "Did not practice", "Out", "IR", "PUP", "Inactive", "Suspended"}:
            finding("selected_availability", [row], "Review the player's at-build availability and active conditioning.",
                    evidence={"kind": "build_status", "status": status, "at": diag.get("injury_status_at"),
                              "conditioning": diag.get("availability_conditioning", "unknown")})
        source = str(diag.get("source_type", "")).lower()
        if source in {"roster estimate", "historical estimate", "fixed estimate", "missing projection"}:
            finding("projection_fallback", [row], "Inspect the estimate's source and role uncertainty.",
                    evidence={"kind": "forecast_source", "source": diag.get("source_type")})
        if diag.get("projection_stale") is True:
            finding("stale_forecast", [row], "Review the frozen forecast timestamp before using current inputs.",
                    evidence={"kind": "forecast_source", "forecast_at": diag.get("forecast_at")})
        if not diag.get("current_role_estimate"):
            finding("role_unavailable", [row], "Current role estimate unavailable.", severity="info")
        elif (diag.get("role_evidence") or {}).get("stale") is True:
            finding("stale_role_evidence", [row], "Review the observed period; usage is not a current role forecast.")
        for driver in diag.get("unresolved_personnel_ids") or []:
            dependencies[str(driver)].append(row)
    for driver, affected in sorted(dependencies.items()):
        if len(affected) > 1:
            finding("shared_personnel_assumption", affected, "Review players relying on the same unresolved personnel assumption.",
                    evidence={"kind": "declared_unresolved_dependency", "driver_player_id": driver})
    return findings


def showdown_portfolio_review(lineups, *, showdown_rules=None):
    """Actual-denominator exposure math and recurring, nonbinding findings."""
    total, captains, flex, pairs = Counter(), Counter(), Counter(), Counter()
    reviewed, groups = [], defaultdict(list)
    for index, lineup in enumerate(lineups):
        rows = lineup.get("lineup", []) if isinstance(lineup, Mapping) else lineup
        findings = audit_showdown_lineup(rows, showdown_rules=showdown_rules)
        reviewed.append({"lineup_index": index, "findings": findings,
                         "needs_review": any(item["severity"] in {"warning", "error"} for item in findings)})
        for finding in findings:
            groups[finding["code"]].append(index)
        ids = sorted({str(row.get("player_id")) for row in rows})
        total.update(ids)
        for row in rows:
            (captains if str(row.get("slot", "")).upper() in _CAPTAIN_SLOTS else flex).update([str(row.get("player_id"))])
        for i, first in enumerate(ids):
            for second in ids[i + 1:]:
                pairs[(first, second)] += 1
    denominator = len(lineups)
    exposures = [{"player_id": pid, "total_count": total[pid], "captain_count": captains[pid], "flex_count": flex[pid],
                  "total_share": total[pid] / denominator, "captain_share": captains[pid] / denominator,
                  "flex_share": flex[pid] / denominator, "denominator": denominator} for pid in sorted(total)] if denominator else []
    return {"schema_version": SCHEMA_VERSION, "denominator": denominator,
            "needs_review_count": sum(item["needs_review"] for item in reviewed), "lineups": reviewed,
            "finding_groups": [{"code": code, "lineup_indices": sorted(set(indices)), "lineup_count": len(set(indices))} for code, indices in sorted(groups.items())],
            "exposures": exposures, "pair_counts": [{"player_ids": list(pair), "count": count, "share": count / denominator} for pair, count in sorted(pairs.items())],
            "captain_concentration": [{"player_id": item["player_id"], "count": item["captain_count"], "share": item["captain_share"]} for item in exposures if item["captain_count"]],
            "policy": deepcopy(showdown_rules or {"receiver_captain_qb": "legacy"})}
