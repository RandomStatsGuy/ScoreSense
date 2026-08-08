"""League acquisition-type semantics for Historic sheets / pre-draft planning."""

from __future__ import annotations

from typing import Any

# Post-draft FA lottery win — real contract, retained on the year sheet.
POST_DRAFT_FA = "post_draft_fa"
# $1 FA deal that expires before the next draft (not a keeper).
FA_CONTRACT = "fa_contract"
FA_CONTRACT_SALARY = 1.0


def acquisition_type_of(row: dict[str, Any] | None) -> str:
    if not row:
        return ""
    direct = str(row.get("acquisition_type") or "").strip().lower()
    if direct:
        return direct
    contract = row.get("contract") or {}
    if isinstance(contract, dict):
        return str(contract.get("acquisition_type") or "").strip().lower()
    return ""


def is_fa_contract(row: dict[str, Any] | None) -> bool:
    return acquisition_type_of(row) == FA_CONTRACT


def is_post_draft_fa_lottery(row: dict[str, Any] | None) -> bool:
    return acquisition_type_of(row) == POST_DRAFT_FA


def fa_contract_fields(*, status_note: str | None = None) -> dict[str, Any]:
    """Canonical sheet fields when tagging FA contract."""
    note = status_note
    if note is None:
        note = "FA contract — $1, expires before draft"
    return {
        "acquisition_type": FA_CONTRACT,
        "cap_hit": FA_CONTRACT_SALARY,
        "base_salary": FA_CONTRACT_SALARY,
        "status_note": note,
    }
