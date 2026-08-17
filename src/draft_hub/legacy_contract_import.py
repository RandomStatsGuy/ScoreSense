"""Import dynasty cap-sheet history from commissioner spreadsheets and inaugural PDF."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd
import yaml
from pypdf import PdfReader

from src.config import MANAGER_TEAM_MAP_PATH, OLD_LEAGUE_FILES_DIR

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

YEAR_FILES = {
    2022: "2022 Dynasty League Rosters.xlsx",
    2023: "2023 Dynasty League Rosters - Free Agency.xlsx",
    2024: "2024 Dynasty League Rosters - Season.xlsx",
    2025: "2025 Dynasty League Free Agency Decisions.xlsx",
}

_PDF_PLAYER_RE = re.compile(
    r"([A-Za-z][A-Za-z0-9 .'\-]+?)(\d+)(?=(?:\s+[A-Z][a-z]|\s+[A-Z]{2,}|\s*$))"
)
# PDF grid cells: "Tagovailoa13 R Tanehill3" — salary digit, space, next initial.
_PDF_CELL_SPLIT_RE = re.compile(r"(?<=\d)\s+(?=[A-Z])")


def load_owner_team_map(path: Path | None = None) -> dict[str, str]:
    """Commissioner owner label -> hub/Sleeper team name."""
    p = path or MANAGER_TEAM_MAP_PATH
    if not p.exists():
        return {}
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return {str(k).strip(): str(v).strip().strip('"') for k, v in raw.items()}


def _num(val: Any) -> float | None:
    try:
        out = float(val)
        if pd.isna(out):
            return None
        return out
    except (TypeError, ValueError):
        return None


def _cell_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    return str(val).strip()


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", _cell_str(name))


def _is_blank_name(name: str) -> bool:
    return _norm_name(name).lower() in {"", "nan", "none", "nat", "player"}


VALID_ROSTER_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF", "DST", "D", "CUT"}

_SUMMARY_LABELS = {
    "salary",
    "budget",
    "available",
    "subtotal",
    "cap hit",
    "total",
    "remaining",
    "cap space",
    "total salary",
    "salary available",
    "team total",
}


def _is_summary_label(text: str) -> bool:
    key = _cell_str(text).lower().rstrip(":")
    if key in _SUMMARY_LABELS:
        return True
    if key.startswith("total salary") or key.startswith("salary available"):
        return True
    return False


def _attach_hub_team(row: dict[str, Any], owner_map: dict[str, str]) -> dict[str, Any]:
    owner = row["owner_label"]
    row["hub_team_name"] = owner_map.get(owner) or row.get("hub_team_name")
    return row


def _base_row(
    *,
    season_year: int,
    owner_label: str,
    player_name: str,
    owner_map: dict[str, str],
    **extra: Any,
) -> dict[str, Any]:
    from src.draft_hub.sourced_checkpoints import apply_row_identity_and_quarantine

    cap = extra.pop("cap_hit", None)
    base = extra.pop("base_salary", cap)
    row = {
        "season_year": season_year,
        "owner_label": owner_label,
        "player_name": _norm_name(player_name),
        "base_salary": base,
        "cap_hit": cap if cap is not None else base,
        "roster_status": extra.pop("roster_status", "active"),
        "contract_phase": extra.pop("contract_phase", None),
        "acquisition_type": extra.pop("acquisition_type", None),
        "source_kind": "import",
        "confidence": "imported",
        "needs_review": False,
        **extra,
    }
    row = _attach_hub_team(row, owner_map)
    return apply_row_identity_and_quarantine(row)


def parse_2022_sheet(df: pd.DataFrame, owner: str, owner_map: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if df.empty:
        return rows
    header_idx = None
    for i in range(min(5, len(df))):
        vals = [str(v).strip().lower() for v in df.iloc[i].tolist() if pd.notna(v)]
        if "player" in vals and "position" in vals:
            header_idx = i
            break
    if header_idx is None:
        return rows
    body = df.iloc[header_idx + 1 :].copy()
    body.columns = [
        "player",
        "position",
        "salary",
        "year_drafted",
        "status",
        "notes",
        "_x",
    ][: len(body.columns)]
    for _, r in body.iterrows():
        player = _norm_name(r.get("player", ""))
        if _is_blank_name(player):
            continue
        salary = _num(r.get("salary"))
        if salary is None:
            continue
        rows.append(
            _base_row(
                season_year=2022,
                owner_label=owner,
                player_name=player,
                owner_map=owner_map,
                position=str(r.get("position") or "").strip().upper() or None,
                base_salary=salary,
                cap_hit=salary,
                original_draft_year=int(r["year_drafted"]) if _num(r.get("year_drafted")) else None,
                contract_phase="initial",
                status_note=str(r.get("status") or "") or None,
            )
        )
    return rows


def parse_2023_sheet(df: pd.DataFrame, owner: str, owner_map: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if df.empty:
        return rows
    header_idx = None
    for i in range(min(5, len(df))):
        row_vals = [str(v).strip().lower() for v in df.iloc[i].tolist() if pd.notna(v)]
        if "player" in row_vals:
            header_idx = i
            break
    if header_idx is None:
        return rows
    hdr = df.iloc[header_idx].tolist()
    col_map: dict[str, int] = {}
    for idx, val in enumerate(hdr):
        key = str(val or "").strip().lower()
        if key == "player":
            col_map["player"] = idx
        elif key == "position":
            col_map["position"] = idx
        elif "salary" in key:
            col_map.setdefault("salary", idx)
        elif "year" in key and "draft" in key:
            col_map["year_drafted"] = idx
        elif "contract status" in key:
            col_map["status"] = idx
    for _, r in df.iloc[header_idx + 1 :].iterrows():
        player = _norm_name(r.iloc[col_map["player"]]) if "player" in col_map else ""
        if _is_blank_name(player):
            continue
        salary = _num(r.iloc[col_map["salary"]]) if "salary" in col_map else None
        if salary is None:
            continue
        status_text = str(r.iloc[col_map["status"]]) if "status" in col_map else ""
        phase = "extended" if "ext" in status_text.lower() else "initial"
        rows.append(
            _base_row(
                season_year=2023,
                owner_label=owner,
                player_name=player,
                owner_map=owner_map,
                position=str(r.iloc[col_map["position"]]).strip().upper() if "position" in col_map else None,
                base_salary=salary,
                cap_hit=salary,
                original_draft_year=int(r.iloc[col_map["year_drafted"]])
                if "year_drafted" in col_map and _num(r.iloc[col_map["year_drafted"]])
                else None,
                contract_phase=phase,
                status_note=status_text or None,
            )
        )
    return rows


def parse_modern_owner_sheet(
    df: pd.DataFrame,
    owner: str,
    season_year: int,
    owner_map: dict[str, str],
) -> list[dict[str, Any]]:
    """2024–2025 per-owner sheets: Player, prior salary, Status, cap hit columns."""
    rows: list[dict[str, Any]] = []
    if df.empty:
        return rows
    header_idx = None
    for i in range(min(8, len(df))):
        vals = [str(v).strip().lower() for v in df.iloc[i].tolist() if pd.notna(v)]
        if "player" in vals and any("salary" in v for v in vals):
            header_idx = i
            break
    if header_idx is None:
        return rows
    hdr = [str(v or "").strip().lower() for v in df.iloc[header_idx].tolist()]
    player_col = next((i for i, h in enumerate(hdr) if h == "player"), 2)
    prior_col = next((i for i, h in enumerate(hdr) if "salary" in h and str(season_year - 1) in h), 3)
    status_col = next((i for i, h in enumerate(hdr) if h == "status"), 4)
    cap_col = next((i for i, h in enumerate(hdr) if str(season_year) in h and "salary" in h), 5)
    pos_col = 1
    for _, r in df.iloc[header_idx + 1 :].iterrows():
        player = _norm_name(r.iloc[player_col]) if player_col < len(r) else ""
        if _is_blank_name(player) or player == owner:
            continue
        status_raw = _cell_str(r.iloc[status_col]) if status_col < len(r) else ""
        if _is_summary_label(status_raw):
            continue
        prior = _num(r.iloc[prior_col]) if prior_col < len(r) else None
        cap_hit = _num(r.iloc[cap_col]) if cap_col < len(r) else None
        position = _cell_str(r.iloc[pos_col]).upper() if pos_col < len(r) else ""
        if position not in VALID_ROSTER_POSITIONS:
            continue
        roster_status = "active"
        dead_note = status_raw
        pos_out: str | None = position if position not in {"CUT", "DST", "D"} else (
            "DEF" if position in {"DST", "D"} else None
        )
        # Pos=CUT or Status=CUT → cut/dead line.
        if position == "CUT" or "CUT" in status_raw.upper():
            roster_status = "cut"
            # Blank year-salary on a CUT = $0 toward this sheet's cap (matches Excel
            # Salary/Available). Only apply 50% when the sheet wrote full prior as $.
            if cap_hit is None:
                cap_hit = 0.0
            else:
                from src.draft_hub.contract_history_audit import normalize_cut_cap_hit

                cap_hit = normalize_cut_cap_hit(
                    cap_hit=cap_hit,
                    prior_salary=prior,
                    cut_refund_pct=0.5,
                )
        if cap_hit is None and roster_status == "active":
            continue
        if cap_hit is None:
            continue
        acquisition = "unknown"
        phase = "post_2024_base" if season_year >= 2024 else "extension"
        rows.append(
            _base_row(
                season_year=season_year,
                owner_label=owner,
                player_name=player,
                owner_map=owner_map,
                position=pos_out,
                prior_salary=prior,
                base_salary=cap_hit,
                cap_hit=cap_hit,
                roster_status=roster_status,
                contract_phase=phase,
                acquisition_type=acquisition,
                status_note=dead_note or ("CUT" if roster_status == "cut" else None),
            )
        )
    return rows


def _parse_pdf_player_chunk(chunk: str) -> tuple[str, float] | None:
    chunk = chunk.strip()
    if not chunk:
        return None
    m = re.match(r"^(.+?)(\d+)$", chunk)
    if not m:
        return None
    name, sal = m.group(1).strip(), _num(m.group(2))
    if not name or sal is None:
        return None
    return name, sal


def _split_2021_pdf_blocks(text: str) -> list[tuple[list[str], list[str]]]:
    """Split inaugural PDF text into owner-grid sections (6-team then 4-team blocks)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    block_defs = [
        ["Aaron D", "Andrew M", "Caleb K", "Chris G", "Colby L", "Dawson O"],
        ["Josh C", "Justin P", "Nick F", "Stephen P"],
    ]
    headers: list[tuple[int, list[str]]] = []
    for owners in block_defs:
        for i, line in enumerate(lines):
            if line.startswith(owners[0]) and all(owner in line for owner in owners):
                headers.append((i, owners))
                break

    sections: list[tuple[list[str], list[str]]] = []
    for idx, (start_i, owners) in enumerate(headers):
        end_i = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        body: list[str] = []
        for line in lines[start_i + 2 : end_i]:
            if (
                line.startswith("Subtotal")
                or line.startswith("Cap Hit")
                or line.startswith("Total")
                or line.startswith("To Spend")
            ):
                break
            body.append(line)
        sections.append((owners, body))
    return sections


def _parse_2021_pdf_line(
    line: str,
    owners: list[str],
    owner_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Parse one position row from the 2021 auction grid."""
    positions = {"QB", "RB", "WR", "TE", "K", "D"}
    parts = line.split()
    if not parts or parts[0] not in positions:
        return []
    pos = parts[0]
    rest = " ".join(parts[1:])
    if rest.endswith(pos):
        rest = rest[: -len(pos)].strip()
    chunks = _PDF_CELL_SPLIT_RE.split(rest)
    rows: list[dict[str, Any]] = []
    for owner, chunk in zip(owners, chunks):
        parsed = _parse_pdf_player_chunk(chunk)
        if not parsed:
            continue
        name, salary = parsed
        rows.append(
            _base_row(
                season_year=2021,
                owner_label=owner,
                player_name=name,
                owner_map=owner_map,
                position=pos if pos != "D" else "DEF",
                base_salary=salary,
                cap_hit=salary,
                original_draft_year=2021,
                contract_phase="initial",
                acquisition_type="draft",
            )
        )
    return rows


def parse_2021_pdf(filepath: Path, owner_map: dict[str, str]) -> list[dict[str, Any]]:
    """Parse inaugural auction grid from commissioner PDF."""
    reader = PdfReader(str(filepath))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    rows: list[dict[str, Any]] = []
    for owners, body_lines in _split_2021_pdf_blocks(text):
        for line in body_lines:
            rows.extend(_parse_2021_pdf_line(line, owners, owner_map))
    return rows


def parse_year_workbook(
    filepath: Path,
    season_year: int,
    owner_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Parse per-owner sheets only. League/Master/TRADE sheets are never auto-imported."""
    from src.draft_hub.sourced_checkpoints import sheets_skipped_for_season

    rows: list[dict[str, Any]] = []
    xls = pd.ExcelFile(filepath)
    skip = sheets_skipped_for_season(season_year)
    for owner in TEAM_OWNERS:
        if owner not in xls.sheet_names:
            continue
        if owner in skip:
            continue
        df = pd.read_excel(xls, sheet_name=owner, header=None)
        if season_year == 2022:
            rows.extend(parse_2022_sheet(df, owner, owner_map))
        elif season_year == 2023:
            rows.extend(parse_2023_sheet(df, owner, owner_map))
        elif season_year in (2024, 2025):
            rows.extend(parse_modern_owner_sheet(df, owner, season_year, owner_map))
    return rows


def process_league_history(data_dir: Path | None = None) -> pd.DataFrame:
    """Flatten commissioner files into sourced checkpoint rows (not a transaction ledger)."""
    from src.draft_hub.draft_results_import import apply_draft_tags_to_dataframe, load_draft_wins_by_season
    from src.draft_hub.sourced_checkpoints import apply_row_identity_and_quarantine

    base = data_dir or OLD_LEAGUE_FILES_DIR
    owner_map = load_owner_team_map()
    all_rows: list[dict[str, Any]] = []

    pdf_2021 = base / "2021 Fantasy Draft Results.pdf"
    if pdf_2021.exists():
        all_rows.extend(parse_2021_pdf(pdf_2021, owner_map))

    for year, fname in YEAR_FILES.items():
        path = base / fname
        if path.exists():
            all_rows.extend(parse_year_workbook(path, year, owner_map))

    if not all_rows:
        return pd.DataFrame()
    # Re-stamp identity/quarantine after draft tags may rewrite acquisition fields.
    all_rows = [apply_row_identity_and_quarantine(r) for r in all_rows]
    df = pd.DataFrame(all_rows)
    # Year-sheet acquisition is set by draft tags + owner-change reconcile
    # (trade → draft → FA lottery). Do not guess waiver/FA from dollar amount.

    wins_by_season, _draft_meta = load_draft_wins_by_season(base)
    if wins_by_season:
        df, _tagged = apply_draft_tags_to_dataframe(df, wins_by_season)
        # Draft tagging can leave quarantine flags intact; re-apply identity only.
        records = df.to_dict(orient="records")
        df = pd.DataFrame([apply_row_identity_and_quarantine(r) for r in records])
    return df


def rows_for_storage(df: pd.DataFrame) -> dict[int, list[dict[str, Any]]]:
    """Group parsed rows by season for SQLite upsert."""
    if df.empty:
        return {}
    out: dict[int, list[dict[str, Any]]] = {}
    for season, grp in df.groupby("season_year"):
        out[int(season)] = grp.drop(columns=["season_year"], errors="ignore").to_dict(orient="records")
    return out
