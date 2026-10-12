"""Bounded restoration of user-supplied immutable comparison inputs.

Hashes detect edits, not ownership or source authenticity. This read-only path
does not resolve a live salary catalog or confer entry/export permissions.
"""
from __future__ import annotations

from copy import deepcopy
import math

import pandas as pd

from src.products.dfs_config import get_site_config
from src.products.dfs_snapshots import canonical_json, verify_build_snapshot

MAX_BYTES = 8 * 1024 * 1024
MAX_PLAYERS = 750


def restore_comparison_inputs(record, *, site, request_values):
    if site not in {"draftkings_showdown", "fanduel_single"}:
        raise ValueError("Frozen Captain comparisons require a single-game format.")
    if not request_values.get("include_captain_comparison") and not request_values.get("comparison_player_id"):
        raise ValueError("A frozen comparison snapshot is read-only and cannot build or replace lineups.")
    if not isinstance(record, dict) or set(record) != {"id", "captured_at", "content"}:
        raise ValueError("Use a complete saved build-input snapshot.")
    try:
        raw = canonical_json(record)
    except (ValueError, TypeError, RecursionError):
        raise ValueError("The comparison snapshot must contain finite, bounded JSON inputs.") from None
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError("The comparison snapshot exceeds the 8 MB limit. Build again with the selected slate to compare; existing lineups are unchanged.")
    if not verify_build_snapshot(record):
        content = record.get("content")
        if isinstance(content, dict) and content.get("content_hash_encoding") is None:
            raise ValueError("This older build snapshot could not be verified: its content identity changed. Build again to compare; existing lineups are unchanged.")
        raise ValueError("The comparison snapshot content identity changed. Build again to compare; existing lineups are unchanged.")
    content = record["content"]
    if not isinstance(content.get("rules"), dict) or content["rules"].get("site") != site:
        raise ValueError("This comparison snapshot belongs to another format.")
    source = content.get("source_context")
    parameters = content.get("parameters")
    rows = content.get("input_pool")
    if not isinstance(source, dict) or not isinstance(parameters, dict) or not isinstance(rows, list) or not 1 <= len(rows) <= MAX_PLAYERS:
        raise ValueError("The frozen snapshot needs bounded player inputs and original settings.")
    if source.get("pool_meta") is not None and not isinstance(source["pool_meta"], dict):
        raise ValueError("Frozen pool metadata must be an object.")
    for key in ("locked_player_ids", "excluded_player_ids", "candidate_player_ids"):
        ids = parameters.get(key)
        if ids is not None and (not isinstance(ids, list) or len(ids) > MAX_PLAYERS or
                               any(not isinstance(pid, str) or not pid or len(pid) > 100 for pid in ids)):
            raise ValueError("Frozen player controls require bounded canonical ID arrays.")
    captain_limits = parameters.get("captain_exposure_limits") or {}
    if not isinstance(captain_limits, dict) or any(not isinstance(pid, str) or not pid or
        not isinstance(limit, (int, float)) or isinstance(limit, bool) or not math.isfinite(limit) or not 0 <= limit <= 1
        for pid, limit in captain_limits.items()):
        raise ValueError("Frozen Captain limits require canonical IDs and finite fractions.")
    if any(not isinstance(row, dict) or len(row) > 200 or not isinstance(row.get("player_id"), str) or not row["player_id"] for row in rows):
        raise ValueError("Frozen player inputs require exact canonical identities.")
    if len({row["player_id"] for row in rows}) != len(rows):
        raise ValueError("Frozen player inputs repeat a canonical identity.")
    for row in rows:
        for key in ("salary", "cpt_salary", "value", "Projected Points", "Low (P10)", "High (P90)"):
            value = row.get(key)
            if value is None:
                continue
            try:
                if isinstance(value, bool) or not isinstance(value, (str, int, float)) or not math.isfinite(float(value)) or abs(float(value)) > 1000000:
                    raise ValueError()
            except (ValueError, OverflowError):
                raise ValueError("Frozen salaries and forecast inputs must be finite numeric scalars or null.") from None
        for key in ("Player", "Team", "Position", "Opponent", "dfs_id", "cpt_dfs_id", "Injury Status"):
            if row.get(key) is not None and not isinstance(row[key], str):
                raise ValueError("Frozen player labels, statuses and provider identities must be text or null.")
        if row.get("on_bye") is not None and not isinstance(row["on_bye"], (bool, int, float)):
            raise ValueError("Frozen bye status must be a scalar flag or null.")
    for key, source_key in (("season", "requested_season"), ("week", "requested_week"), ("slate_id", "client_slate_id")):
        if source_key in source and request_values.get(key) != source[source_key]:
            raise ValueError("This comparison snapshot belongs to another season, week or slate.")
    config = get_site_config(site)
    expected = {key: parameters.get(key) for key in (
        "objective", "salary_cap", "min_salary", "max_per_team", "block_bye_weeks",
        "locked_player_ids", "excluded_player_ids", "candidate_player_ids", "locked_captain_id", "showdown_rules")}
    actual = {key: request_values.get(key) for key in expected}
    actual["objective"] = str(actual["objective"] or "median").lower()
    actual["salary_cap"] = actual["salary_cap"] if actual["salary_cap"] is not None else config["salary_cap"]
    actual["max_per_team"] = actual["max_per_team"] or config.get("max_per_team_default")
    actual["min_salary"] = actual["min_salary"] or None
    for values in (expected, actual):
        for key in ("locked_player_ids", "excluded_player_ids", "candidate_player_ids"):
            values[key] = sorted(values[key] or [])
    if canonical_json(expected) != canonical_json(actual):
        raise ValueError("Use the original objective, locks, exclusions and single-lineup rules for this frozen comparison.")
    context = deepcopy(source)
    context["comparison_source_snapshot_id"] = record["id"]
    context["comparison_scope"] = "supplied_frozen_build_inputs_not_live_state"
    context["original_portfolio_controls"] = {key: deepcopy(parameters.get(key)) for key in (
        "lineup_count", "max_exposure", "captain_exposure_limits", "max_overlap", "randomness",
        "player_exposure_limits", "group_exposure_limits")}
    context["original_portfolio_controls"]["scope"] = "diagnostic_context_only_not_enforced_by_single_lineup_comparison"
    context["original_captain_exclusions"] = sorted(pid for pid, limit in captain_limits.items() if limit == 0)
    meta = deepcopy(source.get("pool_meta") or {})
    meta["comparison_source_snapshot_id"] = record["id"]
    meta["frozen_comparison"] = True
    return pd.DataFrame(deepcopy(rows)), meta, context
