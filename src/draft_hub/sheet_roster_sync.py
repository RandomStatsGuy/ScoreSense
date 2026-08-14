"""Historic year-sheet sync: Sleeper membership + manual overlays.

SCORE-39: never prefer Sleeper rows alone when manuals exist
(`use_rows = sleeper_rows or rows` is forbidden). Merge like
``contract_rows_merged.merge_owner_roster`` — manuals win on conflict.
"""

from __future__ import annotations

from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.legacy_contract_history import dedupe_contract_rows
from src.draft_hub.sleeper_week1_snapshot import SLEEPER_SHEET_SOURCE_KINDS

DeletionKind = Literal["sleeper_drop", "commissioner_cut", "leftover_cut"]

_MANUAL = "manual"


def _pk(row: dict[str, Any]) -> str:
    return _name_key(str(row.get("player_name") or ""))


def _owner(row: dict[str, Any]) -> str:
    return str(row.get("owner_label") or "").strip()


def _identity(row: dict[str, Any]) -> tuple[str, str]:
    return (_owner(row), _pk(row))


def list_manual_overlays(league_id: str, season_year: int) -> list[dict[str, Any]]:
    """Commissioner Historic corrections for one season (source_kind=manual)."""
    return [
        r
        for r in storage.list_league_contract_rows(league_id, season_year=int(season_year))
        if str(r.get("source_kind") or "") == _MANUAL
    ]


def merge_sleeper_with_manual_overlays(
    sleeper_rows: list[dict[str, Any]],
    manual_rows: list[dict[str, Any]],
    *,
    historic_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Merge Sleeper membership with manual Historic corrections.

    Manuals always win on the same owner/player key. Historic (Excel/import)
    rows fill gaps only when neither Sleeper nor manual covers the player.
    Never ``sleeper_rows or historic_rows``.
    """
    by_key: dict[tuple[str, str], dict[str, Any]] = {}

    for row in sleeper_rows or []:
        key = _identity(row)
        if not key[0] or not key[1]:
            continue
        by_key[key] = dict(row)

    for row in historic_rows or []:
        key = _identity(row)
        if not key[0] or not key[1]:
            continue
        if key in by_key:
            continue
        by_key[key] = dict(row)

    for row in manual_rows or []:
        key = _identity(row)
        if not key[0] or not key[1]:
            continue
        base = by_key.get(key)
        if base is None:
            by_key[key] = dict(row)
            continue
        # Manual overlay wins field-by-field (same idea as merge_owner_roster).
        merged = dict(base)
        for field in (
            "cap_hit",
            "base_salary",
            "prior_salary",
            "position",
            "roster_status",
            "acquisition_type",
            "contract_phase",
            "status_note",
            "hub_team_name",
            "original_draft_year",
            "needs_review",
            "review_reason",
            "player_name",
            "player_id",
        ):
            if row.get(field) is not None:
                merged[field] = row.get(field)
        merged["source_kind"] = _MANUAL
        merged["id"] = row.get("id") or merged.get("id")
        merged["manual_overlay"] = True
        by_key[key] = merged

    return dedupe_contract_rows(list(by_key.values()))


def classify_deletion(
    *,
    on_sleeper: bool,
    prior_row: dict[str, Any] | None,
    manual_row: dict[str, Any] | None,
) -> DeletionKind | None:
    """
    Explain why a prior sheet player is absent from the new Sleeper active set.

    - ``commissioner_cut``: manual overlay marks cut (commissioner intent).
    - ``leftover_cut``: prior row already cut (Excel/Sleeper cut carried forward).
    - ``sleeper_drop``: was active, not on Sleeper, no manual cut.
    """
    if on_sleeper:
        return None
    if manual_row is not None and str(manual_row.get("roster_status") or "active") == "cut":
        return "commissioner_cut"
    if prior_row is not None and str(prior_row.get("roster_status") or "active") == "cut":
        return "leftover_cut"
    if prior_row is not None and str(prior_row.get("roster_status") or "active") != "cut":
        return "sleeper_drop"
    if manual_row is not None and str(manual_row.get("roster_status") or "active") != "cut":
        # Manual-only active with no Sleeper membership — treat as intentional add,
        # not a deletion.
        return None
    return None


def reconcile_deletions(
    *,
    prior_rows: list[dict[str, Any]],
    sleeper_rows: list[dict[str, Any]],
    manual_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Classify prior-sheet players missing from the new Sleeper active roster."""
    sleeper_active = {
        _identity(r)
        for r in sleeper_rows
        if _identity(r)[0]
        and _identity(r)[1]
        and str(r.get("roster_status") or "active") != "cut"
    }
    manuals_by_key = {
        _identity(r): r for r in manual_rows if _identity(r)[0] and _identity(r)[1]
    }
    prior_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for r in prior_rows:
        key = _identity(r)
        if not key[0] or not key[1]:
            continue
        prev = prior_by_key.get(key)
        if prev is None or str(r.get("source_kind") or "") in SLEEPER_SHEET_SOURCE_KINDS:
            prior_by_key[key] = r

    buckets: dict[DeletionKind, list[dict[str, Any]]] = {
        "sleeper_drop": [],
        "commissioner_cut": [],
        "leftover_cut": [],
    }
    for key, prior in prior_by_key.items():
        kind = classify_deletion(
            on_sleeper=key in sleeper_active,
            prior_row=prior,
            manual_row=manuals_by_key.get(key),
        )
        if kind is None:
            continue
        buckets[kind].append(
            {
                "owner_label": key[0],
                "player_name": prior.get("player_name"),
                "prior_source_kind": prior.get("source_kind"),
                "prior_roster_status": prior.get("roster_status") or "active",
                "deletion_kind": kind,
            }
        )

    return {
        "sleeper_drop": buckets["sleeper_drop"],
        "commissioner_cut": buckets["commissioner_cut"],
        "leftover_cut": buckets["leftover_cut"],
        "sleeper_drop_count": len(buckets["sleeper_drop"]),
        "commissioner_cut_count": len(buckets["commissioner_cut"]),
        "leftover_cut_count": len(buckets["leftover_cut"]),
    }


def preserve_sleeper_base_after_manual_edit(
    league_id: str,
    *,
    season_year: int,
    original_row: dict[str, Any],
) -> dict[str, Any] | None:
    """
    After converting a Sleeper sheet row to ``manual``, re-seed the Sleeper
    membership row with the pre-edit values so later sync keeps a complete base.
    """
    kind = str(original_row.get("source_kind") or "")
    if kind not in SLEEPER_SHEET_SOURCE_KINDS:
        return None
    owner = _owner(original_row)
    pk = _pk(original_row)
    if not owner or not pk:
        return None
    # Skip if a sleeper row for this player already exists (re-edit of manual).
    for existing in storage.list_league_contract_rows(league_id, season_year=int(season_year)):
        if str(existing.get("source_kind") or "") != kind:
            continue
        if _identity(existing) == (owner, pk):
            return existing

    return storage.insert_league_contract_row(
        league_id,
        int(season_year),
        {
            "owner_label": owner,
            "hub_team_name": original_row.get("hub_team_name"),
            "player_name": original_row.get("player_name"),
            "player_id": original_row.get("player_id"),
            "position": original_row.get("position"),
            "base_salary": original_row.get("base_salary"),
            "cap_hit": original_row.get("cap_hit"),
            "prior_salary": original_row.get("prior_salary"),
            "original_draft_year": original_row.get("original_draft_year"),
            "roster_status": original_row.get("roster_status") or "active",
            "contract_phase": original_row.get("contract_phase"),
            "acquisition_type": original_row.get("acquisition_type"),
            "status_note": original_row.get("status_note"),
            "source_kind": kind,
            "confidence": original_row.get("confidence") or kind,
            "needs_review": bool(original_row.get("needs_review")),
            "review_reason": original_row.get("review_reason"),
            "sleeper_verified": bool(original_row.get("sleeper_verified")),
        },
    )


def sync_sleeper_year_sheet(
    league_id: str,
    *,
    season_year: int,
    mode: Literal["week1", "pre_draft"] = "week1",
    imported_by_sub: str | None = None,
    forward_rebuild: bool = False,
    forward_rebuild_approved: bool = False,
) -> dict[str, Any]:
    """
    Rebuild one Historic year sheet from Sleeper while keeping manual overlays.

    ``forward_rebuild`` is rejected unless explicitly approved — editing season Y
    must not cascade into Y+1 / live contracts.
    """
    if forward_rebuild and not forward_rebuild_approved:
        raise ValueError(
            "Forward rebuild into later seasons requires explicit approval "
            "(forward_rebuild_approved=True). Historic edits stay on the edited season only."
        )

    from src.draft_hub.sleeper_week1_snapshot import (
        build_and_persist_pre_draft_sheet,
        build_and_persist_week1_sheet,
    )

    prior_rows = list(storage.list_league_contract_rows(league_id, season_year=int(season_year)))
    manuals_before = list_manual_overlays(league_id, int(season_year))

    if mode == "pre_draft":
        report = build_and_persist_pre_draft_sheet(
            league_id,
            season_year=int(season_year),
            imported_by_sub=imported_by_sub,
        )
    else:
        report = build_and_persist_week1_sheet(
            league_id,
            season_year=int(season_year),
            imported_by_sub=imported_by_sub,
        )

    manuals_after = list_manual_overlays(league_id, int(season_year))
    sleeper_after = [
        r
        for r in storage.list_league_contract_rows(league_id, season_year=int(season_year))
        if str(r.get("source_kind") or "") in SLEEPER_SHEET_SOURCE_KINDS
    ]
    merged = merge_sleeper_with_manual_overlays(sleeper_after, manuals_after)
    deletions = reconcile_deletions(
        prior_rows=prior_rows,
        sleeper_rows=sleeper_after,
        manual_rows=manuals_after,
    )

    before_ids = {int(r["id"]) for r in manuals_before if r.get("id") is not None}
    after_ids = {int(r["id"]) for r in manuals_after if r.get("id") is not None}
    preserved = sorted(before_ids & after_ids)
    missing = sorted(before_ids - after_ids)

    return {
        **report,
        "manual_overlays_before": len(manuals_before),
        "manual_overlays_after": len(manuals_after),
        "manual_overlays_preserved": len(preserved),
        "manual_overlay_ids_preserved": preserved,
        "manual_overlay_ids_missing": missing,
        "merged_row_count": len(merged),
        "deletion_reconciliation": deletions,
        "forward_rebuild": False,
        "season_year": int(season_year),
    }
