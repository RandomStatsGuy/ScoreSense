"""SCORE-44: 2021–2025 sourced checkpoints + quarantine rules.

Commissioner workbooks are observed snapshots with provenance — not a fabricated
transaction ledger. Ambiguous blocks (unlabeled 2025 League lower grid, NA year
statuses, salary-sharing notes, ambiguous names) stay quarantined until a human
resolves them.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

# Keep in sync with legacy_contract_import.TEAM_OWNERS (avoid circular import).
TEAM_OWNERS = [
    "Aaron D",
    "Andrew M",
    "Caleb K",
    "Chris G",
    "Colby L",
    "Dawson O",
    "Josh C",
    "Justin P",
    "Nick F",
    "Stephen P",
]

# Stable franchise IDs keyed by commissioner owner label (order is fixed).
FRANCHISE_IDS: dict[str, str] = {
    owner: f"franchise_{idx:02d}_{owner.split()[0].lower()}"
    for idx, owner in enumerate(TEAM_OWNERS, start=1)
}


def _cell_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    return str(val).strip()


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", _cell_str(name))

# Season-specific ruleset / provenance for sourced checkpoints.
CHECKPOINT_SPECS: dict[int, dict[str, Any]] = {
    2021: {
        "phase": "post_draft",
        "as_of": "2021-09-01",
        "ruleset_version": "inaugural_cap_200",
        "salary_cap": 200.0,
        "source_file": "2021 Fantasy Draft Results.pdf",
        "source_role": "post_draft_roster_cap_snapshot",
        "notes": "Ownership + salary only; not a draft transaction log.",
    },
    2022: {
        "phase": "midseason",
        "as_of": "2022-season",
        "ruleset_version": "dynasty_cap_250",
        "salary_cap": 250.0,
        "source_file": "2022 Dynasty League Rosters.xlsx",
        "source_role": "roster_status_draft_year_cuts",
        "notes": "Historical cap $250 — do not apply $200 retroactively.",
    },
    2023: {
        "phase": "pre_draft",
        "as_of": "2023-offseason",
        "ruleset_version": "dynasty_cap_200",
        "salary_cap": 200.0,
        "source_file": "2023 Dynasty League Rosters - Free Agency.xlsx",
        "source_role": "offseason_extension_release",
        "skip_sheets": ("Master", "Example"),
        "notes": "Master sheet is not a final 2023 roster.",
    },
    2024: {
        "phase": "pre_draft",
        "as_of": "2024-planning",
        "ruleset_version": "dynasty_cap_200",
        "salary_cap": 200.0,
        "source_file": "2024 Dynasty League Rosters - Season.xlsx",
        "source_role": "multi_phase_workbook",
        "skip_sheets": ("Draft", "2023", "2024"),
        "notes": "TRADE IN PROGRESS on the 2024 sheet must never auto-import.",
    },
    2025: {
        "phase": "pre_draft",
        "as_of": "2025-offseason",
        "ruleset_version": "dynasty_cap_200",
        "salary_cap": 200.0,
        "source_file": "2025 Dynasty League Free Agency Decisions.xlsx",
        "source_role": "free_agency_decisions",
        "skip_sheets": ("League", "Draft Results"),
        "notes": "League sheet has two unlabeled roster blocks for five teams.",
    },
}

_NA_STATUS_RE = re.compile(r"^NA\s+20\d{2}$", re.IGNORECASE)
_SALARY_SHARE_RE = re.compile(
    r"(being\s+paid\s+by|paid\s+by|salary\s*shar|pays?\s+for|retaining|retained\s+salary|"
    r"\$\d+\s+being\s+paid|split\s+salary|half\s+salary)",
    re.IGNORECASE,
)
_PAREN_NOTE_RE = re.compile(r"\(([^)]+)\)")

VALID_OBLIGATION_KINDS = frozenset(
    {
        "ownership",
        "cut_dead_cap",
        "retained_salary",
        "salary_share",
        "quarantined",
    }
)


@dataclass(frozen=True)
class QuarantineHit:
    reason_code: str
    message: str
    season_year: int | None = None
    owner_label: str | None = None
    player_name: str | None = None
    source_ref: str | None = None
    detail: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "reason_code": self.reason_code,
            "message": self.message,
            "season_year": self.season_year,
            "owner_label": self.owner_label,
            "player_name": self.player_name,
            "source_ref": self.source_ref,
            "detail": self.detail or {},
        }


def franchise_id_for_owner(owner_label: str) -> str | None:
    owner = _cell_str(owner_label)
    if owner in FRANCHISE_IDS:
        return FRANCHISE_IDS[owner]
    return None


def stable_player_key(player_name: str, *, position: str | None = None) -> str:
    """Deterministic player key from normalized name (+ optional position)."""
    base = _norm_name(player_name).lower()
    pos = (_cell_str(position) or "").upper()
    raw = f"{base}|{pos}" if pos else base
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"sp_{digest}"


def checkpoint_for_season(season_year: int) -> dict[str, Any] | None:
    spec = CHECKPOINT_SPECS.get(int(season_year))
    if not spec:
        return None
    return {
        "season_year": int(season_year),
        "phase": spec["phase"],
        "as_of": spec["as_of"],
        "ruleset_version": spec["ruleset_version"],
        "salary_cap": spec["salary_cap"],
        "source_file": spec["source_file"],
        "source_role": spec["source_role"],
        "notes": spec.get("notes"),
        "skip_sheets": list(spec.get("skip_sheets") or ()),
    }


def list_checkpoint_specs() -> list[dict[str, Any]]:
    return [checkpoint_for_season(yr) for yr in sorted(CHECKPOINT_SPECS)]


def sheets_skipped_for_season(season_year: int) -> frozenset[str]:
    spec = CHECKPOINT_SPECS.get(int(season_year)) or {}
    return frozenset(spec.get("skip_sheets") or ())


def is_na_year_status(status: str | None) -> bool:
    return bool(_NA_STATUS_RE.match(_cell_str(status)))


def salary_share_note(text: str | None) -> str | None:
    raw = _cell_str(text)
    if not raw:
        return None
    if _SALARY_SHARE_RE.search(raw):
        return raw
    return None


def strip_embedded_salary_share_name(player_name: str) -> tuple[str, str | None]:
    """Split 'A Jones ($12 being paid by Dawson...)' into name + share note."""
    name = _norm_name(player_name)
    m = _PAREN_NOTE_RE.search(name)
    if not m:
        return name, salary_share_note(name)
    note = m.group(1).strip()
    share = salary_share_note(note) or salary_share_note(name)
    cleaned = _PAREN_NOTE_RE.sub("", name).strip()
    return cleaned or name, share


def quarantine_reason_for_row(
    *,
    player_name: str,
    status_note: str | None = None,
    roster_status: str | None = None,
) -> QuarantineHit | None:
    cleaned, share = strip_embedded_salary_share_name(player_name)
    if share:
        return QuarantineHit(
            reason_code="ambiguous_salary_share",
            message="Ambiguous salary-sharing / retained-salary note — do not guess.",
            player_name=cleaned,
            detail={"note": share},
        )
    if is_na_year_status(status_note):
        return QuarantineHit(
            reason_code="na_year_status",
            message=f"Unlabeled NA year status ({_cell_str(status_note)}) — quarantine until confirmed.",
            player_name=cleaned,
            detail={"status_note": _cell_str(status_note)},
        )
    # Explicit cut rows are obligations, not quarantines.
    _ = roster_status
    return None


def obligation_kind_for_row(
    *,
    roster_status: str | None,
    quarantined: bool = False,
    salary_share: bool = False,
) -> str:
    if quarantined and salary_share:
        return "salary_share"
    if quarantined:
        return "quarantined"
    if str(roster_status or "").lower() == "cut":
        return "cut_dead_cap"
    return "ownership"


def apply_row_identity_and_quarantine(row: dict[str, Any]) -> dict[str, Any]:
    """Stamp franchise/player IDs, obligation kind, and quarantine flags onto a row."""
    out = dict(row)
    owner = _cell_str(out.get("owner_label"))
    fid = franchise_id_for_owner(owner)
    if fid:
        out["franchise_id"] = fid

    raw_name = _cell_str(out.get("player_name"))
    cleaned, share = strip_embedded_salary_share_name(raw_name)
    if cleaned != raw_name:
        out["player_name"] = cleaned
        if share and not out.get("status_note"):
            out["status_note"] = share

    hit = quarantine_reason_for_row(
        player_name=out.get("player_name") or "",
        status_note=out.get("status_note"),
        roster_status=out.get("roster_status"),
    )
    if share and hit is None:
        hit = QuarantineHit(
            reason_code="ambiguous_salary_share",
            message="Ambiguous salary-sharing / retained-salary note — do not guess.",
            player_name=cleaned,
            detail={"note": share},
        )

    season = out.get("season_year")
    if hit:
        out["needs_review"] = True
        out["confidence"] = "quarantined"
        out["review_reason"] = hit.reason_code
        if hit.message and not out.get("status_note"):
            out["status_note"] = hit.message
        out["quarantine"] = hit.to_dict()
        out["obligation_kind"] = obligation_kind_for_row(
            roster_status=out.get("roster_status"),
            quarantined=True,
            salary_share=hit.reason_code == "ambiguous_salary_share",
        )
        # Quarantined rows are not trusted ownership for live merge.
        if hit.reason_code == "ambiguous_salary_share":
            out["roster_status"] = "quarantined"
    else:
        out["obligation_kind"] = obligation_kind_for_row(
            roster_status=out.get("roster_status"),
            quarantined=False,
        )

    # Stable player key only when not garbage / blank; never invent Sleeper IDs.
    pname = _cell_str(out.get("player_name"))
    if pname:
        from src.draft_hub.player_name_match import is_garbage_player_name

        if is_garbage_player_name(pname):
            out["needs_review"] = True
            out["confidence"] = "quarantined"
            out["review_reason"] = out.get("review_reason") or "ambiguous_player_name"
            out["obligation_kind"] = "quarantined"
            out["roster_status"] = "quarantined"
            out["quarantine"] = {
                "reason_code": "ambiguous_player_name",
                "message": "Ambiguous / unparseable player name — quarantine instead of fuzzy-merge.",
                "season_year": season,
                "owner_label": owner,
                "player_name": pname,
                "source_ref": None,
                "detail": {},
            }
        elif not out.get("player_id"):
            out["player_id"] = stable_player_key(pname, position=out.get("position"))

    # Attach checkpoint provenance on each row for parquet / API consumers.
    ck = checkpoint_for_season(int(season)) if season is not None else None
    if ck:
        out.setdefault("snapshot_phase", ck["phase"])
        out.setdefault("as_of", ck["as_of"])
        out.setdefault("ruleset_version", ck["ruleset_version"])

    return out


def _owner_header_row(df: pd.DataFrame, start: int = 0) -> int | None:
    for i in range(start, min(start + 40, len(df))):
        vals = [_cell_str(v) for v in df.iloc[i].tolist()]
        owners_found = [v for v in vals if v in TEAM_OWNERS]
        if len(owners_found) >= 4:
            return i
    return None


def detect_2025_league_blocks(filepath: Path) -> dict[str, Any]:
    """Detect upper (trusted grid) vs lower (quarantine) blocks on the 2025 League sheet."""
    if not filepath.exists():
        return {
            "available": False,
            "upper_block": None,
            "lower_block": None,
            "quarantine": [],
        }
    xls = pd.ExcelFile(filepath)
    if "League" not in xls.sheet_names:
        return {
            "available": False,
            "upper_block": None,
            "lower_block": None,
            "quarantine": [],
        }
    df = pd.read_excel(xls, sheet_name="League", header=None)
    first = _owner_header_row(df, 0)
    second = _owner_header_row(df, (first + 5) if first is not None else 0)
    quarantine: list[QuarantineHit] = []
    upper = None
    lower = None
    if first is not None:
        owners = [_cell_str(v) for v in df.iloc[first].tolist() if _cell_str(v) in TEAM_OWNERS]
        upper = {
            "header_row": int(first),
            "owners": owners,
            "owner_count": len(owners),
            "import_policy": "ignored_grid_use_owner_sheets",
        }
    if second is not None and first is not None and second > first:
        owners = [_cell_str(v) for v in df.iloc[second].tolist() if _cell_str(v) in TEAM_OWNERS]
        lower = {
            "header_row": int(second),
            "owners": owners,
            "owner_count": len(owners),
            "import_policy": "quarantine_never_auto_import",
        }
        quarantine.append(
            QuarantineHit(
                reason_code="unlabeled_2025_league_lower_block",
                message=(
                    "2025 League sheet lower roster block is unlabeled for five teams "
                    "and cannot be resolved algorithmically."
                ),
                season_year=2025,
                source_ref=f"{filepath.name}#League",
                detail=lower,
            )
        )
    return {
        "available": True,
        "upper_block": upper,
        "lower_block": lower,
        "quarantine": [q.to_dict() for q in quarantine],
    }


def collect_workbook_quarantines(data_dir: Path) -> list[dict[str, Any]]:
    """Scan source workbooks for block-level quarantine inventory (not row imports)."""
    hits: list[dict[str, Any]] = []
    # 2025 League lower block
    path_2025 = data_dir / str(CHECKPOINT_SPECS[2025]["source_file"])
    league_blocks = detect_2025_league_blocks(path_2025)
    hits.extend(league_blocks.get("quarantine") or [])

    # Explicit TRADE IN PROGRESS sheet marker (2024 workbook)
    path_2024 = data_dir / str(CHECKPOINT_SPECS[2024]["source_file"])
    if path_2024.exists():
        xls = pd.ExcelFile(path_2024)
        if "2024" in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name="2024", header=None)
            trade_cells = []
            for i, row in df.iloc[:5].iterrows():
                for v in row.tolist():
                    text = _cell_str(v)
                    if "TRADE IN PROGRESS" in text.upper():
                        trade_cells.append({"row": int(i), "text": text})
            if trade_cells:
                hits.append(
                    QuarantineHit(
                        reason_code="trade_in_progress_sheet",
                        message="TRADE IN PROGRESS block must never auto-import.",
                        season_year=2024,
                        source_ref=f"{path_2024.name}#2024",
                        detail={"cells": trade_cells},
                    ).to_dict()
                )
        if "Master" in xls.sheet_names:
            # Master not used for 2024; still note for 2023
            pass

    path_2023 = data_dir / str(CHECKPOINT_SPECS[2023]["source_file"])
    if path_2023.exists():
        xls = pd.ExcelFile(path_2023)
        if "Master" in xls.sheet_names:
            hits.append(
                QuarantineHit(
                    reason_code="master_not_final_roster",
                    message="2023 Master sheet is not a final roster — skipped.",
                    season_year=2023,
                    source_ref=f"{path_2023.name}#Master",
                    detail={"import_policy": "skip"},
                ).to_dict()
            )

    return hits


def summarize_row_quarantines(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_reason: dict[str, int] = {}
    items: list[dict[str, Any]] = []
    for row in rows:
        q = row.get("quarantine")
        if not q and row.get("review_reason") in {
            "na_year_status",
            "ambiguous_salary_share",
            "ambiguous_player_name",
        }:
            q = {
                "reason_code": row.get("review_reason"),
                "message": row.get("status_note") or row.get("review_reason"),
                "season_year": row.get("season_year"),
                "owner_label": row.get("owner_label"),
                "player_name": row.get("player_name"),
                "source_ref": None,
                "detail": {},
            }
        if not q:
            continue
        code = str(q.get("reason_code") or "unknown")
        by_reason[code] = by_reason.get(code, 0) + 1
        items.append(
            {
                **q,
                "season_year": q.get("season_year") or row.get("season_year"),
                "owner_label": q.get("owner_label") or row.get("owner_label"),
                "player_name": q.get("player_name") or row.get("player_name"),
                "franchise_id": row.get("franchise_id"),
                "obligation_kind": row.get("obligation_kind"),
            }
        )
    return {
        "count": len(items),
        "by_reason": by_reason,
        "items": items,
    }


def is_trusted_ownership_row(row: dict[str, Any]) -> bool:
    """Rows safe to treat as player ownership (excludes cuts, quarantines, obligations)."""
    if row.get("needs_review") and str(row.get("confidence") or "") == "quarantined":
        return False
    if str(row.get("roster_status") or "").lower() in {"cut", "quarantined"}:
        return False
    kind = str(row.get("obligation_kind") or "ownership")
    return kind == "ownership"


def is_cap_obligation_row(row: dict[str, Any]) -> bool:
    kind = str(row.get("obligation_kind") or "")
    if kind in {"cut_dead_cap", "retained_salary", "salary_share"}:
        return True
    return str(row.get("roster_status") or "").lower() == "cut"
