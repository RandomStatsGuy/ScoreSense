"""Rules-aware audit for commissioner contract history rows."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from src.draft_hub import storage
from src.draft_hub.legacy_contract_import import _norm_name
from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import ContractRules, LeagueRules

ISSUE_CATEGORIES = {
    "renewal_step_mismatch": "salary",
    "missing_cut_row": "cuts",
    "dead_cap_wrong": "cuts",
    "player_not_reset": "cuts",
    "in_season_waiver_not_dollar": "waivers",
    "post_draft_fa_as_waiver": "post_draft_fa",
    "post_draft_fa_salary_missing": "post_draft_fa",
    "fa_contract_not_dollar": "fa_contract",
    "waiver_missing_prior_cut": "waivers",
    "cap_over_limit": "cap",
    "roster_over_max": "cap",
    "ambiguous_movement": "ambiguous",
    "duplicate_active": "salary",
}


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm_name(name).lower())


def _issue(
    code: str,
    *,
    severity: str,
    message: str,
    row_id: int | None = None,
    player_name: str = "",
    expected: Any = None,
    suggested_patch: dict[str, Any] | None = None,
    movement_id: int | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "category": ISSUE_CATEGORIES.get(code, "salary"),
        "row_id": row_id,
        "player_name": player_name,
        "message": message,
        "expected": expected,
        "suggested_patch": suggested_patch or {},
        "movement_id": movement_id,
    }


def _float(val: Any) -> float | None:
    try:
        if val is None:
            return None
        out = float(val)
        if out != out:  # NaN
            return None
        return out
    except (TypeError, ValueError):
        return None


def _int_year(val: Any) -> int | None:
    """Parse draft/season year; treat NaN/blank as missing."""
    f = _float(val)
    if f is None:
        return None
    try:
        return int(f)
    except (TypeError, ValueError, OverflowError):
        return None


def _years_in_league(season_year: int, original_draft_year: int | None) -> int | None:
    if original_draft_year is None:
        return None
    return max(0, int(season_year) - int(original_draft_year))


def _in_rookie_window(season_year: int, row: dict[str, Any], rules: ContractRules) -> bool:
    """True while the prior row is still on the flat 2-year rookie deal."""
    ctype = str(row.get("contract_type") or "").lower()
    contract = row.get("contract") if isinstance(row.get("contract"), dict) else {}
    if not ctype and contract:
        ctype = str(contract.get("contract_type") or "").lower()
    if ctype == "rookie":
        return True
    draft_yr = _int_year(row.get("original_draft_year"))
    if draft_yr is not None:
        yrs = _years_in_league(season_year, draft_yr)
        if yrs is not None and yrs < int(rules.rookie_years):
            return True
    phase = str(row.get("contract_phase") or "").lower()
    return phase == "initial"


def _expected_active_cap(
    prev_row: dict[str, Any],
    season_year: int,
    rules: ContractRules,
) -> float | None:
    """YoY expected salary: rookies stay flat for 2 years; otherwise + extension_step_up."""
    prev_cap = _float(prev_row.get("cap_hit"))
    if prev_cap is None:
        return None
    if _in_rookie_window(season_year, prev_row, rules):
        return round(prev_cap, 2)
    return round(prev_cap + float(rules.extension_step_up), 2)


def _dead_cap_amount(prior_cap: float, rules: ContractRules) -> float:
    return round(prior_cap * (1.0 - float(rules.cut_refund_pct)), 2)


def cut_looks_like_full_salary_dead(
    cap_hit: float | None,
    prior_salary: float | None,
    *,
    tol: float = 0.051,
) -> bool:
    """True when cut cap_hit equals prior (100% dead instead of refund %)."""
    hit = _float(cap_hit)
    prior = _float(prior_salary)
    if hit is None or prior is None or prior <= 0:
        return False
    return abs(hit - prior) <= tol


def normalize_cut_cap_hit(
    *,
    cap_hit: float | None,
    prior_salary: float | None,
    cut_refund_pct: float = 0.5,
) -> float | None:
    """Historic cut dead $ for a year-sheet row.

    - Blank / None → $0 (Excel Available math does not invent dead).
    - Explicit $0 → keep $0 (no-dead pre-draft drop).
    - cap_hit == prior → apply (1 - refund%) (sheet mistakenly left full salary).
    - Otherwise keep the sheet amount (already adjusted dead money).
    """
    hit = _float(cap_hit)
    prior = _float(prior_salary)
    pct = float(cut_refund_pct)
    if hit is None:
        return 0.0
    if abs(hit) <= 0.051:
        return 0.0
    if cut_looks_like_full_salary_dead(hit, prior):
        return round(float(prior) * (1.0 - pct), 2)
    return hit


def apply_cut_dead_cap_to_row_updates(
    existing: dict[str, Any],
    updates: dict[str, Any],
    *,
    cut_refund_pct: float = 0.5,
) -> dict[str, Any]:
    """When flipping a row to cut, ensure prior_salary + dead cap_hit are set."""
    out = dict(updates)
    new_status = str(out.get("roster_status") or existing.get("roster_status") or "active")
    if new_status != "cut":
        return out
    prior = out.get("prior_salary")
    if prior is None:
        prior = existing.get("prior_salary")
    if prior is None and str(existing.get("roster_status") or "active") != "cut":
        # Becoming a cut: prior basis is current active salary.
        prior = existing.get("cap_hit") or existing.get("base_salary")
        if prior is not None and "prior_salary" not in out:
            out["prior_salary"] = prior
    # Only auto-set dead $ when caller did not send an explicit new cap_hit,
    # or when existing/new hit looks like full prior.
    explicit_hit = "cap_hit" in out
    hit = out.get("cap_hit") if explicit_hit else existing.get("cap_hit")
    if not explicit_hit or cut_looks_like_full_salary_dead(hit, prior or out.get("prior_salary")):
        dead = normalize_cut_cap_hit(
            cap_hit=hit,
            prior_salary=prior if prior is not None else out.get("prior_salary"),
            cut_refund_pct=cut_refund_pct,
        )
        if dead is not None:
            out["cap_hit"] = dead
            out["base_salary"] = dead
    return out


def normalize_league_cut_dead_caps(
    league_id: str,
    *,
    cut_refund_pct: float | None = None,
    edited_by_sub: str = "system:dead_cap",
) -> dict[str, Any]:
    """Fix cut rows that store 100% of prior as dead money."""
    league = storage.get_league(league_id) or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    pct = float(cut_refund_pct if cut_refund_pct is not None else rules.contracts.cut_refund_pct)
    fixed = 0
    scanned = 0
    details: list[dict[str, Any]] = []
    for yr in storage.list_league_contract_seasons(league_id):
        for row in storage.list_league_contract_rows(league_id, season_year=yr):
            if str(row.get("roster_status") or "") != "cut":
                continue
            scanned += 1
            prior = _float(row.get("prior_salary"))
            hit = _float(row.get("cap_hit"))
            if not cut_looks_like_full_salary_dead(hit, prior):
                continue
            dead = normalize_cut_cap_hit(
                cap_hit=hit,
                prior_salary=prior,
                cut_refund_pct=pct,
            )
            if dead is None or hit is None or abs(dead - hit) < 0.01:
                continue
            storage.update_league_contract_row(
                int(row["id"]),
                {"cap_hit": dead, "base_salary": dead},
                edited_by_sub=edited_by_sub,
                note=f"Normalize cut dead cap to {(1 - pct) * 100:.0f}% of prior ${prior:.0f}",
            )
            fixed += 1
            details.append(
                {
                    "row_id": row["id"],
                    "season_year": yr,
                    "owner_label": row.get("owner_label"),
                    "player_name": row.get("player_name"),
                    "from": hit,
                    "to": dead,
                    "prior_salary": prior,
                }
            )
    return {"scanned": scanned, "fixed": fixed, "details": details}


def _is_in_season_waiver(row: dict[str, Any]) -> bool:
    acq = str(row.get("acquisition_type") or "").lower()
    cap = _float(row.get("cap_hit"))
    if acq in {"post_draft_fa", "fa_contract"}:
        return False
    if cap is not None and cap == 1:
        return acq == "waiver" or str(row.get("contract_phase") or "") == "waiver_rental"
    return False


def _is_fa_contract(row: dict[str, Any]) -> bool:
    from src.draft_hub.acquisition_semantics import is_fa_contract

    return is_fa_contract(row)


def _is_post_draft_fa(row: dict[str, Any]) -> bool:
    """Post-draft FA lottery (real salary). Not $1 FA contracts."""
    acq = str(row.get("acquisition_type") or "").lower()
    if acq == "fa_contract":
        return False
    if acq == "post_draft_fa":
        return True
    cap = _float(row.get("cap_hit"))
    return cap is not None and cap > 1 and acq not in {"waiver", "trade", "draft", "fa_contract"}


def _index_rows(rows: list[dict[str, Any]], *, active_only: bool = False) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if active_only and str(row.get("roster_status") or "active") != "active":
            continue
        out[_name_key(row.get("player_name") or "")].append(row)
    return out


def audit_contract_history(
    league_id: str,
    *,
    season_year: int,
    rules: LeagueRules | None = None,
) -> dict[str, Any]:
    """Return audit issues for one season snapshot vs prior year and league rules."""
    league = storage.get_league(league_id) or {}
    league_rules = rules or LeagueRules.model_validate(league.get("rules") or {})
    cr = league_rules.contracts
    salary_cap = float(league_rules.salary_cap)

    curr_rows = storage.list_league_contract_rows(league_id, season_year=season_year)
    prev_rows = storage.list_league_contract_rows(league_id, season_year=season_year - 1)
    movements = storage.list_league_movements(league_id, season_year=season_year)

    issues: list[dict[str, Any]] = []
    curr_all = _index_rows(curr_rows)
    prev_active = _index_rows(prev_rows, active_only=True)
    prev_all = _index_rows(prev_rows)

    for key, rows in _index_rows(curr_rows, active_only=True).items():
        if not key:
            continue
        by_owner: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            by_owner[str(row.get("owner_label") or "")].append(row)
        for owner, owner_rows in by_owner.items():
            if len(owner_rows) <= 1:
                continue
            pname = owner_rows[0].get("player_name") or ""
            for row in owner_rows:
                issues.append(
                    _issue(
                        "duplicate_active",
                        severity="error",
                        row_id=row.get("id"),
                        player_name=pname,
                        message=f"{pname} has {len(owner_rows)} duplicate active rows on {owner}'s roster.",
                    )
                )
        if len(rows) <= 1:
            continue
        owners_seen = {r.get("owner_label") for r in rows}
        if len(owners_seen) <= 1:
            continue
        for row in rows:
            issues.append(
                _issue(
                    "duplicate_active",
                    severity="error",
                    row_id=row.get("id"),
                    player_name=row.get("player_name") or "",
                    message=f"{row.get('player_name')} appears on multiple active rosters this season.",
                )
            )

    for key, prev_list in prev_active.items():
        if not key:
            continue
        prev = prev_list[0]
        prev_owner = prev.get("owner_label")
        prev_cap = _float(prev.get("cap_hit"))
        pname = prev.get("player_name") or ""

        curr_same_owner = [
            r for r in curr_all.get(key, [])
            if r.get("owner_label") == prev_owner and str(r.get("roster_status") or "active") == "active"
        ]
        curr_any_active = [r for r in curr_all.get(key, []) if str(r.get("roster_status") or "active") == "active"]
        cut_rows = [
            r for r in curr_all.get(key, [])
            if r.get("owner_label") == prev_owner and str(r.get("roster_status") or "") == "cut"
        ]

        if not curr_same_owner and not curr_any_active:
            if not cut_rows and prev_cap is not None:
                dead = _dead_cap_amount(prev_cap, cr)
                issues.append(
                    _issue(
                        "missing_cut_row",
                        severity="error",
                        player_name=pname,
                        message=f"{pname} left {prev_owner}'s roster but no cut/dead-cap row exists.",
                        expected={"cap_hit": dead, "roster_status": "cut", "prior_salary": prev_cap},
                        suggested_patch={
                            "owner_label": prev_owner,
                            "player_name": pname,
                            "position": prev.get("position"),
                            "cap_hit": dead,
                            "base_salary": dead,
                            "prior_salary": prev_cap,
                            "roster_status": "cut",
                            "contract_phase": prev.get("contract_phase"),
                        },
                    )
                )

        if curr_same_owner:
            curr = curr_same_owner[0]
            expected = _expected_active_cap(prev, season_year, cr)
            actual = _float(curr.get("cap_hit"))
            if expected is not None and actual is not None and abs(actual - expected) > 0.01:
                issues.append(
                    _issue(
                        "renewal_step_mismatch",
                        severity="warn",
                        row_id=curr.get("id"),
                        player_name=pname,
                        message=f"Expected cap ${expected:.0f} (renewal from ${prev_cap:.0f}); got ${actual:.0f}.",
                        expected=expected,
                        suggested_patch={
                            "cap_hit": expected,
                            "base_salary": expected,
                            "contract_phase": "extended",
                        },
                    )
                )

        for cut in cut_rows:
            prior_basis = _float(cut.get("prior_salary")) or prev_cap
            actual_dead = _float(cut.get("cap_hit"))
            if prior_basis is not None and actual_dead is not None:
                expected_dead = _dead_cap_amount(prior_basis, cr)
                if abs(actual_dead - expected_dead) > 0.01:
                    issues.append(
                        _issue(
                            "dead_cap_wrong",
                            severity="warn",
                            row_id=cut.get("id"),
                            player_name=pname,
                            message=f"Dead cap should be ${expected_dead:.0f} (50% of ${prior_basis:.0f}); got ${actual_dead:.0f}.",
                            expected=expected_dead,
                            suggested_patch={"cap_hit": expected_dead, "base_salary": expected_dead},
                        )
                    )
            if curr_any_active:
                issues.append(
                    _issue(
                        "player_not_reset",
                        severity="error",
                        row_id=cut.get("id"),
                        player_name=pname,
                        message=f"{pname} has a cut row and an active row same season — contract should reset after cut.",
                    )
                )

    for key, curr_list in _index_rows(curr_rows, active_only=True).items():
        if not key or key in prev_active:
            continue
        for row in curr_list:
            pname = row.get("player_name") or ""
            cap = _float(row.get("cap_hit"))
            acq = str(row.get("acquisition_type") or "").lower()
            phase = str(row.get("contract_phase") or "")
            tagged_waiver = acq == "waiver" or phase == "waiver_rental"

            if tagged_waiver and cap is not None and cap > 1:
                issues.append(
                    _issue(
                        "post_draft_fa_as_waiver",
                        severity="warn",
                        row_id=row.get("id"),
                        player_name=pname,
                        message=f"Post-draft FA at ${cap:.0f} should not be tagged as waiver rental.",
                        suggested_patch={
                            "acquisition_type": "post_draft_fa",
                            "contract_phase": "post_2024_base" if season_year >= 2024 else "initial",
                        },
                    )
                )
            elif _is_fa_contract(row):
                if cap is None or abs(float(cap) - 1.0) > 0.051:
                    issues.append(
                        _issue(
                            "fa_contract_not_dollar",
                            severity="error",
                            row_id=row.get("id"),
                            player_name=pname,
                            message=(
                                f"FA contract should be $1 and expires before draft; "
                                f"got ${cap or 0:.0f}."
                            ),
                            expected=1,
                            suggested_patch={
                                "cap_hit": 1,
                                "base_salary": 1,
                                "acquisition_type": "fa_contract",
                            },
                        )
                    )
            elif _is_in_season_waiver(row) or tagged_waiver:
                if cap != 1 or phase != "waiver_rental":
                    issues.append(
                        _issue(
                            "in_season_waiver_not_dollar",
                            severity="error",
                            row_id=row.get("id"),
                            player_name=pname,
                            message=f"In-season waiver should be $1 waiver_rental; got ${cap or 0:.0f}.",
                            expected=1,
                            suggested_patch={
                                "cap_hit": 1,
                                "base_salary": 1,
                                "contract_phase": "waiver_rental",
                                "acquisition_type": "waiver",
                            },
                        )
                    )
                if key not in prev_all:
                    issues.append(
                        _issue(
                            "waiver_missing_prior_cut",
                            severity="info",
                            row_id=row.get("id"),
                            player_name=pname,
                            message=f"{pname} waiver add with no prior-season roster row (may be external).",
                        )
                    )

            elif _is_post_draft_fa(row) or (
                cap is not None and cap > 1 and acq not in {"trade", "draft", "waiver", "fa_contract"}
            ):
                if cap is None or cap <= 1:
                    issues.append(
                        _issue(
                            "post_draft_fa_salary_missing",
                            severity="warn",
                            row_id=row.get("id"),
                            player_name=pname,
                            message="Post-draft FA add needs a real contract salary (> $1).",
                        )
                    )

    limits = roster_limits(league_rules)
    by_owner: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in curr_rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        by_owner[str(row.get("owner_label") or "")].append(row)

    for owner, owner_rows in by_owner.items():
        committed = sum(_float(r.get("cap_hit")) or 0 for r in owner_rows)
        if committed > salary_cap + 0.01:
            issues.append(
                _issue(
                    "cap_over_limit",
                    severity="error",
                    player_name=owner,
                    message=f"{owner} active cap ${committed:.0f} exceeds ${salary_cap:.0f} limit.",
                    expected=salary_cap,
                )
            )
        pos_counts: dict[str, int] = defaultdict(int)
        for row in owner_rows:
            pos = normalize_position(row.get("position") or "")
            if pos:
                pos_counts[pos.lower()] += 1
        for pos, lim in limits.items():
            cnt = pos_counts.get(pos, 0)
            if cnt > int(lim.get("max") or 99):
                issues.append(
                    _issue(
                        "roster_over_max",
                        severity="warn",
                        player_name=owner,
                        message=f"{owner} has {cnt} {pos.upper()} (max {lim.get('max')}).",
                    )
                )

    for mov in movements:
        if str(mov.get("confidence") or "") != "ambiguous":
            continue
        issues.append(
            _issue(
                "ambiguous_movement",
                severity="warn",
                player_name=mov.get("player_name") or "",
                message=(
                    f"Ambiguous {mov.get('event_type')}: {mov.get('player_name')} "
                    f"({mov.get('from_owner')} → {mov.get('to_owner')})."
                ),
                movement_id=mov.get("id"),
            )
        )

    by_code: dict[str, int] = defaultdict(int)
    by_category: dict[str, int] = defaultdict(int)
    for iss in issues:
        by_code[iss["code"]] += 1
        by_category[iss["category"]] += 1

    row_issues: dict[str, list[dict[str, Any]]] = {}
    for iss in issues:
        rid = iss.get("row_id")
        if rid is not None:
            key = str(rid)
            row_issues.setdefault(key, []).append(iss)

    return {
        "season_year": season_year,
        "issues": issues,
        "summary": {
            "total": len(issues),
            "by_code": dict(by_code),
            "by_category": dict(by_category),
        },
        "row_issues": row_issues,
    }


def apply_audit_patches(
    league_id: str,
    patches: list[dict[str, Any]],
    *,
    edited_by_sub: str,
) -> dict[str, Any]:
    """Apply suggested audit patches (update existing rows or create cut rows)."""
    applied = 0
    created = 0
    errors: list[dict[str, Any]] = []
    for item in patches:
        row_id = item.get("row_id")
        patch = dict(item.get("patch") or {})
        if not patch:
            continue
        try:
            if row_id is not None:
                row = storage.get_league_contract_row(int(row_id))
                if not row or row.get("league_id") != league_id:
                    errors.append({"row_id": row_id, "error": "row not found"})
                    continue
                storage.update_league_contract_row(
                    int(row_id), patch, edited_by_sub=edited_by_sub, note="audit fix"
                )
                applied += 1
            else:
                season_year = item.get("season_year")
                if season_year is None:
                    errors.append({"patch": patch, "error": "season_year required for new rows"})
                    continue
                if not patch.get("owner_label") or not patch.get("player_name"):
                    errors.append({"patch": patch, "error": "owner_label and player_name required"})
                    continue
                if not patch.get("hub_team_name"):
                    patch["hub_team_name"] = storage.resolve_hub_team_name(
                        league_id, int(season_year), patch["owner_label"].strip()
                    )
                storage.insert_league_contract_row(league_id, int(season_year), patch)
                created += 1
        except (ValueError, TypeError) as exc:
            errors.append({"row_id": row_id, "error": str(exc)})
    return {"applied": applied, "created": created, "errors": errors}


def expected_for_row(
    league_id: str,
    row: dict[str, Any],
    *,
    season_year: int,
    rules: LeagueRules | None = None,
) -> float | None:
    """Return expected cap for a row when prior-season same-owner active exists."""
    league = storage.get_league(league_id) or {}
    league_rules = rules or LeagueRules.model_validate(league.get("rules") or {})
    cr = league_rules.contracts
    key = _name_key(row.get("player_name") or "")
    if not key:
        return None
    prev_rows = storage.list_league_contract_rows(league_id, season_year=season_year - 1)
    prev = next(
        (
            r for r in prev_rows
            if _name_key(r.get("player_name") or "") == key
            and r.get("owner_label") == row.get("owner_label")
            and str(r.get("roster_status") or "active") == "active"
        ),
        None,
    )
    if not prev:
        return None
    if str(row.get("roster_status") or "active") != "active":
        return None
    return _expected_active_cap(prev, season_year, cr)
