"""Import league roster grid from Google Sheets CSV export."""

from __future__ import annotations

import io
import re
from typing import Any, BinaryIO

import pandas as pd

from src.integrations.external_projections import _normalize_name
from src.projections.draft_projections import predict_draft_season

_SALARY_RE = re.compile(r"\$?\s*(\d+(?:\.\d+)?)")
_POS_HEADERS = {
    "qb": "QB", "quarterback": "QB",
    "rb": "RB", "running back": "RB",
    "wr": "WR", "wide receiver": "WR",
    "te": "TE", "tight end": "TE",
    "flex": "FLEX",
}


def _load_name_index(season: int) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for pos in ("qb", "rb", "wr"):
        df = predict_draft_season(pos, season=season)
        if df.empty:
            continue
        for _, row in df.iterrows():
            pid = str(row.get("player_id") or "")
            if not pid.startswith("00-"):
                continue
            name = str(row.get("Player") or "")
            team = str(row.get("Team") or "").upper()
            key = (_normalize_name(name), team)
            index[key] = {
                "player_id": pid,
                "player_name": name,
                "team": team,
                "position": "WR" if pos == "wr" else pos.upper(),
            }
            index.setdefault((_normalize_name(name), ""), index[key])
    return index


def _parse_player_cell(cell: str, position: str) -> dict[str, Any] | None:
    text = str(cell or "").strip()
    if not text or text.lower() in ("-", "—", "empty", "fa", "free agent"):
        return None
    salary = 1.0
    m = _SALARY_RE.search(text)
    if m:
        salary = float(m.group(1))
        text = _SALARY_RE.sub("", text).strip(" -–|,")
    # Optional: "Name (TEAM) 2yr rookie"
    contract_type = "veteran"
    years = 1
    lower = text.lower()
    if "rookie" in lower:
        contract_type = "rookie"
        years = 2
        text = re.sub(r"rookie", "", text, flags=re.I).strip(" -–,")
    ym = re.search(r"(\d+)\s*yr", lower)
    if ym:
        years = int(ym.group(1))
        text = re.sub(r"\d+\s*yr\w*", "", text, flags=re.I).strip(" -–,")

    team = ""
    tm = re.search(r"\(([A-Z]{2,3})\)", text)
    if tm:
        team = tm.group(1)
        text = text.replace(tm.group(0), "").strip()

    return {
        "player_name": text.strip(),
        "team": team,
        "position": position,
        "salary": salary,
        "contract_type": contract_type,
        "years": years,
    }


def _detect_position(header: str) -> str | None:
    h = str(header or "").strip().lower()
    h = re.sub(r"\d+$", "", h).strip()
    if h in _POS_HEADERS:
        return _POS_HEADERS[h]
    for key, pos in _POS_HEADERS.items():
        if key in h:
            return pos
    return None


def parse_league_sheet_csv(
    file: BinaryIO | bytes | str,
    *,
    season: int = 2025,
    manager_team_name: str | None = None,
) -> dict[str, Any]:
    """
    Parse a Google Sheets roster grid export.

    Supported layouts:
    1) Wide: first column = manager/team name, other columns = position slots (QB1, RB1, …)
    2) Long: columns manager_team, position, player_name, team, salary, contract_type, years
    """
    if isinstance(file, bytes):
        buf = io.BytesIO(file)
    elif isinstance(file, str):
        buf = io.StringIO(file)
    else:
        buf = file

    raw = pd.read_csv(buf)
    if raw.empty:
        return {"rows": [], "teams_found": [], "stats": {"matched": 0, "unmatched": 0}}

    name_index = _load_name_index(season)
    cols = {c.lower().strip(): c for c in raw.columns}
    rows_out: list[dict[str, Any]] = []
    teams_found: set[str] = set()
    unmatched: list[str] = []

    # Long format
    if "player_name" in cols or "player" in cols:
        name_col = cols.get("player_name") or cols.get("player")
        mgr_col = cols.get("manager_team") or cols.get("team_name") or cols.get("manager")
        pos_col = cols.get("position") or cols.get("pos")
        sal_col = cols.get("salary") or cols.get("cap_hit")
        type_col = cols.get("contract_type") or cols.get("type")
        yrs_col = cols.get("years") or cols.get("contract_years")
        nfl_col = cols.get("nfl_team") or cols.get("team") or cols.get("nfl")

        for _, r in raw.iterrows():
            mgr = str(r.get(mgr_col) or "").strip() if mgr_col else ""
            if manager_team_name and mgr and mgr.lower() != manager_team_name.lower():
                continue
            if mgr:
                teams_found.add(mgr)
            pname = str(r.get(name_col) or "").strip()
            if not pname:
                continue
            pos = str(r.get(pos_col) or "WR").upper() if pos_col else "WR"
            team = str(r.get(nfl_col) or "").upper() if nfl_col else ""
            sal = float(r.get(sal_col) or 1) if sal_col else 1.0
            ctype = str(r.get(type_col) or "veteran").lower() if type_col else "veteran"
            yrs = int(r.get(yrs_col) or 1) if yrs_col else 1
            hit = name_index.get((_normalize_name(pname), team)) or name_index.get((_normalize_name(pname), ""))
            if not hit:
                unmatched.append(pname)
                continue
            rows_out.append({**hit, "salary": sal, "contract_type": ctype, "years": yrs, "manager_team": mgr})
        return {
            "rows": rows_out,
            "teams_found": sorted(teams_found),
            "unmatched": unmatched,
            "stats": {"matched": len(rows_out), "unmatched": len(unmatched)},
        }

    # Wide format — first column is manager/team
    team_col = raw.columns[0]
    for _, r in raw.iterrows():
        mgr = str(r.get(team_col) or "").strip()
        if not mgr:
            continue
        if manager_team_name and mgr.lower() != manager_team_name.lower():
            continue
        teams_found.add(mgr)
        for col in raw.columns[1:]:
            pos = _detect_position(col)
            if not pos:
                continue
            parsed = _parse_player_cell(r.get(col), pos)
            if not parsed:
                continue
            hit = name_index.get((_normalize_name(parsed["player_name"]), parsed["team"])) or name_index.get(
                (_normalize_name(parsed["player_name"]), "")
            )
            if not hit:
                unmatched.append(parsed["player_name"])
                continue
            rows_out.append(
                {
                    **hit,
                    "salary": parsed["salary"],
                    "contract_type": parsed["contract_type"],
                    "years": parsed["years"],
                    "manager_team": mgr,
                }
            )

    return {
        "rows": rows_out,
        "teams_found": sorted(teams_found),
        "unmatched": unmatched,
        "stats": {"matched": len(rows_out), "unmatched": len(unmatched)},
    }
