"""SCORE-43: Historic contract corrections with reason, modes, and snapshot versions.

Office Historic must not silently patch live state. Corrections:
- require an audit reason
- default to history-only (edited season published as a new snapshot revision)
- optionally preview / apply forward into the live planning roster after explicit approval
"""

from __future__ import annotations

import re
from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.contracts import build_contract_from_roster_edit
from src.draft_hub.legacy_contract_import import _norm_name
from src.draft_hub.schemas import LeagueRules

CorrectionMode = Literal["history_only", "preview_forward", "apply_forward"]

CORRECTABLE_FIELDS = frozenset(
    {
        "owner_label",
        "hub_team_name",
        "player_name",
        "player_id",
        "position",
        "base_salary",
        "cap_hit",
        "prior_salary",
        "original_draft_year",
        "roster_status",
        "contract_phase",
        "acquisition_type",
        "status_note",
        "confidence",
        "needs_review",
        "review_reason",
    }
)

SALARY_FIELDS = frozenset({"cap_hit", "base_salary", "prior_salary"})


def _player_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm_name(name).lower())


def _require_reason(reason: str | None) -> str:
    text = str(reason or "").strip()
    if len(text) < 3:
        raise ValueError("Correction reason is required (at least 3 characters)")
    return text


def _snapshot_phase_for_season(league_id: str, season_year: int) -> str | None:
    imports = storage.list_legacy_imports(league_id)
    for row in imports:
        if int(row.get("season_year") or 0) == int(season_year):
            phase = row.get("snapshot_phase")
            return str(phase) if phase else None
    return None


def _row_original_values(row: dict[str, Any]) -> dict[str, Any]:
    """Published values shown before a correction (source / phase / money fields)."""
    return {
        "source_kind": row.get("source_kind"),
        "contract_phase": row.get("contract_phase"),
        "roster_status": row.get("roster_status"),
        "cap_hit": row.get("cap_hit"),
        "base_salary": row.get("base_salary"),
        "prior_salary": row.get("prior_salary"),
        "owner_label": row.get("owner_label"),
        "player_name": row.get("player_name"),
        "player_id": row.get("player_id"),
        "position": row.get("position"),
        "status_note": row.get("status_note"),
        "acquisition_type": row.get("acquisition_type"),
    }


def correction_context(league_id: str, row_id: int) -> dict[str, Any]:
    """Provenance payload for the Correct historical record UI."""
    row = storage.get_league_contract_row(int(row_id))
    if not row or str(row.get("league_id")) != str(league_id):
        raise ValueError("Contract row not found")
    season_year = int(row["season_year"])
    revisions = storage.league_cache_revisions(league_id)
    return {
        "row": row,
        "row_id": int(row_id),
        "season_year": season_year,
        "source_kind": row.get("source_kind"),
        "contract_phase": row.get("contract_phase"),
        "snapshot_phase": _snapshot_phase_for_season(league_id, season_year),
        "original": _row_original_values(row),
        "historic_snapshot_revision": revisions["historic_snapshot_revision"],
        "live_roster_revision": revisions["live_roster_revision"],
        "modes": ["history_only", "preview_forward", "apply_forward"],
    }


def _normalize_updates(updates: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, val in (updates or {}).items():
        if key not in CORRECTABLE_FIELDS or val is None:
            continue
        cleaned[key] = val
    if "cap_hit" in cleaned and "base_salary" not in cleaned:
        cleaned["base_salary"] = cleaned["cap_hit"]
    return cleaned


def _find_live_slot(
    league_id: str,
    *,
    player_id: str | None,
    player_name: str | None,
) -> dict[str, Any] | None:
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError:
        return None
    pid = str(player_id or "").strip()
    name_key = _player_key(str(player_name or ""))
    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        for slot in block.get("roster") or []:
            if pid and str(slot.get("player_id") or "") == pid:
                return {**slot, "team_id": team.get("id"), "team_name": team.get("name")}
            if name_key and _player_key(str(slot.get("player_name") or "")) == name_key:
                return {**slot, "team_id": team.get("id"), "team_name": team.get("name")}
    return None


def _proposed_live_salary(after_row: dict[str, Any]) -> float | None:
    for key in ("cap_hit", "base_salary"):
        if after_row.get(key) is not None:
            return round(float(after_row[key]), 2)
    return None


def build_live_forward_preview(
    league_id: str,
    *,
    before_row: dict[str, Any],
    after_row: dict[str, Any],
) -> dict[str, Any]:
    """Propose live  planning-season changes from a historic correction (no writes)."""
    league = storage.get_league(league_id) or {}
    planning_season = int(league.get("season") or 0) or None
    slot = _find_live_slot(
        league_id,
        player_id=after_row.get("player_id") or before_row.get("player_id"),
        player_name=after_row.get("player_name") or before_row.get("player_name"),
    )
    proposed_salary = _proposed_live_salary(after_row)
    if not slot:
        return {
            "matched": False,
            "planning_season": planning_season,
            "change": None,
            "message": "No matching live roster player for forward rebuild",
        }
    before_salary = round(float(slot.get("salary") or 0), 2)
    after_salary = proposed_salary if proposed_salary is not None else before_salary
    changed = before_salary != after_salary
    return {
        "matched": True,
        "planning_season": planning_season,
        "change": {
            "player_id": slot.get("player_id"),
            "player_name": slot.get("player_name"),
            "team_id": slot.get("team_id"),
            "team_name": slot.get("team_name"),
            "field": "salary",
            "before": before_salary,
            "after": after_salary,
            "changed": changed,
            "contract_years": slot.get("contract_years"),
            "roster_status": slot.get("roster_status"),
        },
        "message": None if changed else "Live salary already matches corrected historic value",
    }


def _apply_live_forward(
    league_id: str,
    *,
    preview: dict[str, Any],
    edited_by_sub: str,
    reason: str,
) -> dict[str, Any]:
    change = preview.get("change") or {}
    if not preview.get("matched") or not change.get("changed"):
        return {
            "applied": False,
            "slot": None,
            "before": None,
            "after": None,
            "live_roster_revision": storage.league_cache_revisions(league_id)["live_roster_revision"],
        }
    league = storage.get_league(league_id) or {}
    ws = storage.roster_workspace_for_league(league)
    existing = storage.get_roster_slot(ws, str(change["player_id"]))
    if not existing:
        raise ValueError("Live roster player disappeared before apply")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    yrs = int(existing.get("contract_years") or 1)
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=float(change["after"]),
        years_remaining=yrs,
        existing=existing.get("contract"),
        step_up=float(rules.contracts.extension_step_up),
    )
    before = {
        "player_id": existing.get("player_id"),
        "salary": existing.get("salary"),
        "contract_years": existing.get("contract_years"),
        "roster_status": existing.get("roster_status"),
        "contract_type": (existing.get("contract") or {}).get("contract_type"),
    }
    slot = storage.update_roster_slot(
        ws,
        str(change["player_id"]),
        team_id=str(change.get("team_id") or existing.get("team_id") or ""),
        contract=contract,
        any_team=True,
        edited_by_sub=edited_by_sub,
        note=reason,
    )
    after = {
        "player_id": slot.get("player_id"),
        "salary": slot.get("salary"),
        "contract_years": slot.get("contract_years"),
        "roster_status": slot.get("roster_status"),
        "contract_type": (slot.get("contract") or {}).get("contract_type"),
    }
    return {
        "applied": True,
        "slot": slot,
        "before": before,
        "after": after,
        "live_roster_revision": storage.league_cache_revisions(league_id)["live_roster_revision"],
    }


def correct_historic_row(
    league_id: str,
    row_id: int,
    *,
    reason: str,
    mode: CorrectionMode,
    updates: dict[str, Any],
    edited_by_sub: str,
    forward_rebuild_approved: bool = False,
) -> dict[str, Any]:
    """Publish a historic correction and optionally preview/apply a live forward rebuild."""
    reason_text = _require_reason(reason)
    mode_key: CorrectionMode = mode  # type: ignore[assignment]
    if mode_key not in {"history_only", "preview_forward", "apply_forward"}:
        raise ValueError("mode must be history_only, preview_forward, or apply_forward")

    row = storage.get_league_contract_row(int(row_id))
    if not row or str(row.get("league_id")) != str(league_id):
        raise ValueError("Contract row not found")

    cleaned = _normalize_updates(updates)
    if not cleaned:
        raise ValueError("No correction fields provided")

    # Cut dead-cap normalization mirrors the existing PATCH path.
    if cleaned.get("roster_status") == "cut" or (
        str(row.get("roster_status") or "") == "cut" and "cap_hit" in cleaned
    ):
        from src.draft_hub.contract_history_audit import apply_cut_dead_cap_to_row_updates

        league = storage.get_league(league_id) or {}
        pct = float(LeagueRules.model_validate(league.get("rules") or {}).contracts.cut_refund_pct)
        cleaned = apply_cut_dead_cap_to_row_updates(row, cleaned, cut_refund_pct=pct)

    before_row = dict(row)
    after_probe = {**before_row, **cleaned}
    live_preview = build_live_forward_preview(
        league_id, before_row=before_row, after_row=after_probe
    )

    if mode_key == "preview_forward":
        # Dry-run: do not mutate historic or live; return proposed before/after.
        return {
            "mode": mode_key,
            "reason": reason_text,
            "applied": False,
            "row_id": int(row_id),
            "season_year": int(row["season_year"]),
            "source_kind": row.get("source_kind"),
            "contract_phase": row.get("contract_phase"),
            "snapshot_phase": _snapshot_phase_for_season(league_id, int(row["season_year"])),
            "before": _row_original_values(before_row),
            "after": _row_original_values(after_probe),
            "historic_snapshot_revision": storage.league_cache_revisions(league_id)[
                "historic_snapshot_revision"
            ],
            "live_preview": live_preview,
            "live_applied": False,
            "correction_id": None,
            "message": "Preview only — approve apply_forward to publish",
        }

    if mode_key == "apply_forward":
        if not forward_rebuild_approved:
            raise ValueError(
                "Forward rebuild into live roster requires explicit approval "
                "(forward_rebuild_approved=True)"
            )

    # Publish historic correction (new snapshot revision via update_league_contract_row).
    updated = storage.update_league_contract_row(
        int(row_id),
        cleaned,
        edited_by_sub=edited_by_sub,
        note=reason_text,
    )
    hist_rev = storage.league_cache_revisions(league_id)["historic_snapshot_revision"]

    live_result: dict[str, Any] = {
        "applied": False,
        "slot": None,
        "before": None,
        "after": None,
        "live_roster_revision": storage.league_cache_revisions(league_id)["live_roster_revision"],
    }
    if mode_key == "apply_forward":
        # Recompute preview against published after-state.
        live_preview = build_live_forward_preview(
            league_id, before_row=before_row, after_row=updated
        )
        live_result = _apply_live_forward(
            league_id,
            preview=live_preview,
            edited_by_sub=edited_by_sub,
            reason=f"[forward] {reason_text}",
        )

    correction_id = storage.insert_historic_correction(
        league_id,
        row_id=int(row_id),
        season_year=int(row["season_year"]),
        reason=reason_text,
        mode=mode_key,
        edited_by_sub=edited_by_sub,
        before_json=before_row,
        after_json=updated,
        historic_snapshot_revision=hist_rev,
        live_applied=bool(live_result.get("applied")),
        live_before_json=live_result.get("before"),
        live_after_json=live_result.get("after"),
        live_roster_revision=live_result.get("live_roster_revision"),
    )

    return {
        "mode": mode_key,
        "reason": reason_text,
        "applied": True,
        "row_id": int(row_id),
        "season_year": int(row["season_year"]),
        "source_kind": updated.get("source_kind"),
        "contract_phase": updated.get("contract_phase"),
        "snapshot_phase": _snapshot_phase_for_season(league_id, int(row["season_year"])),
        "before": _row_original_values(before_row),
        "after": _row_original_values(updated),
        "row": updated,
        "historic_snapshot_revision": hist_rev,
        "live_preview": live_preview,
        "live_applied": bool(live_result.get("applied")),
        "live_before": live_result.get("before"),
        "live_after": live_result.get("after"),
        "live_roster_revision": live_result.get("live_roster_revision"),
        "correction_id": correction_id,
        "message": None,
    }


def commissioner_override_before_after(
    existing: dict[str, Any],
    *,
    salary: float | None,
    contract_years: int | None,
    roster_status: str | None,
    contract_type: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Before/after snapshot for Office Current commissioner overrides."""
    before = {
        "player_id": existing.get("player_id"),
        "player_name": existing.get("player_name"),
        "salary": existing.get("salary"),
        "contract_years": existing.get("contract_years"),
        "roster_status": existing.get("roster_status"),
        "contract_type": (existing.get("contract") or {}).get("contract_type"),
    }
    after = dict(before)
    if salary is not None:
        after["salary"] = float(salary)
    if contract_years is not None:
        after["contract_years"] = int(contract_years)
    if roster_status is not None:
        after["roster_status"] = roster_status
    if contract_type is not None:
        after["contract_type"] = contract_type
    return before, after
