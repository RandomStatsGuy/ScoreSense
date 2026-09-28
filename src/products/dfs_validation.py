"""Independent checks of generated rows against the build's eligible pool.

This validates the existing roster configuration, not a certified site-scoring
profile, game-lock state, or contest entry acceptance.
"""
from __future__ import annotations

import math
from collections import Counter
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.products.lineup_optimizer import LineupPlayer

from src.products.dfs_config import get_site_config


def validate_generated_lineups(
    result: dict, players: list["LineupPlayer"], *, site: str,
    salary_cap: int | None = None, min_salary: int | None = None,
    max_per_team: int | None = None,
    locked_player_ids: list[str] | tuple[str, ...] = (),
    locked_captain_id: str | None = None,
) -> dict:
    if not result.get("ok"):
        return result
    config = get_site_config(site)
    captain_mode = bool(config["roster"].get("cpt"))
    captain_label = config.get("captain_label", "CPT")
    slots = {}
    for position, count in config["roster"].items():
        for i in range(count):
            slot = captain_label if position == "cpt" else position.upper()
            if count > 1:
                slot += str(i + 1)
            if captain_mode:
                eligible = {"QB", "RB", "WR", "TE", "DST", "K"}
            else:
                eligible = set(config["flex_positions"]) if position == "flex" else {position.upper()}
            slots[slot] = eligible
    catalog = {p.player_id: p for p in players}
    entries = result.get("lineups") if "lineups" in result else [result]
    issues = []
    seen_lineups = set()
    ids_complete = True
    if not isinstance(entries, list) or not entries:
        issues.append({"lineup": None, "code": "empty_result"})
        entries = []
    for number, entry in enumerate(entries or [], 1):
        rows = entry.get("lineup") if isinstance(entry, dict) else None
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            issues.append({"lineup": number, "code": "invalid_rows"})
            continue
        codes = set()
        if Counter(row.get("slot") for row in rows) != Counter(slots.keys()):
            codes.add("roster_slots")
        ids = [row.get("player_id") for row in rows]
        if len(ids) != len(set(ids)):
            codes.add("duplicate_player")
        if not set(locked_player_ids).issubset(ids):
            codes.add("missing_lock")
        captain = next((row.get("player_id") for row in rows if row.get("slot") == captain_label), None)
        if captain_mode and locked_captain_id and captain != locked_captain_id:
            codes.add("captain_lock")
        identity = (captain if captain_mode else None, tuple(sorted(str(pid) for pid in ids)))
        if identity in seen_lineups:
            codes.add("duplicate_lineup")
        seen_lineups.add(identity)
        salary = 0
        teams = Counter()
        for row in rows:
            player = catalog.get(row.get("player_id"))
            if player is None:
                codes.add("unknown_player")
                continue
            slot = row.get("slot")
            is_captain = captain_mode and slot == captain_label
            if player.position not in slots.get(slot, set()):
                codes.add("position_eligibility")
            if row.get("position") != player.position or row.get("team") != player.team:
                codes.add("player_identity")
            teams[player.team] += 1
            multiplier = config.get("captain_multiplier", 1.5) if is_captain else 1
            for key in ("proj", "floor", "ceiling"):
                value = row.get(key)
                expected = round(getattr(player, key) * multiplier, 2)
                if not isinstance(value, (int, float)) or not math.isfinite(value) or value != expected:
                    codes.add("projection_mismatch")
            expected_id = player.dfs_id
            if is_captain:
                expected_id = player.cpt_dfs_id or (player.dfs_id if captain_label == "MVP" else "")
            if str(row.get("dfs_id") or "") != str(expected_id or ""):
                codes.add("salary_id")
            ids_complete = ids_complete and bool(expected_id)
            if salary_cap is not None:
                expected_salary = player.salary
                if is_captain:
                    expected_salary = player.cpt_salary
                    if expected_salary is None and player.salary is not None:
                        expected_salary = round(player.salary * config.get("captain_salary_multiplier", 1.5))
                if expected_salary is None or expected_salary <= 0 or row.get("salary") != expected_salary:
                    codes.add("salary_mismatch")
                else:
                    salary += expected_salary
        if captain_mode and (len(teams) != 2 or "" in teams):
            codes.add("single_game_teams")
        if max_per_team and any(count > max_per_team for count in teams.values()):
            codes.add("team_limit")
        if salary_cap is not None:
            if salary > salary_cap or salary < (min_salary or 0):
                codes.add("salary_limit")
            if entry.get("total_salary") != salary or entry.get("salary_remaining") != salary_cap - salary:
                codes.add("salary_total")
        issues.extend({"lineup": number, "code": code} for code in sorted(codes))
    validation = {"version": 1, "ok": not issues, "issues": issues, "export_ids_complete": ids_complete}
    if issues:
        return {"ok": False, "error": "The generated lineups failed validation against this player pool. Reload the slate and rebuild.",
                "lineup": [], "validation": validation}
    return {**result, "validation": validation}
