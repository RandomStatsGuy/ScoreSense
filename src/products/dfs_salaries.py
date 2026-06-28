"""Parse DraftKings / FanDuel salary CSV exports and join to ScoreSense pool."""

from __future__ import annotations

import io
import re
from typing import BinaryIO

import pandas as pd

from src.integrations.external_projections import _normalize_name

_SALARY_COLS = ("salary", "Salary")
_NAME_COLS = ("Name", "Nickname", "name", "player_name")
_POS_COLS = ("Position", "position", "Roster Position")
_TEAM_COLS = ("TeamAbbrev", "Team", "team", "team_abbrev")
_ID_COLS = ("ID", "Id", "id", "player_id")
_NAME_ID_COLS = ("Name + ID",)


def _pick_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    lower = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def _parse_name_id_cell(value: str) -> tuple[str, str]:
    text = str(value or "").strip()
    match = re.match(r"^(.+?)\s*\((\d+)\)\s*$", text)
    if match:
        return match.group(1).strip(), match.group(2)
    return text, ""


def parse_salary_csv(
    file: BinaryIO | bytes | str,
    site: str = "draftkings",
) -> pd.DataFrame:
    """Parse a DK or FD salary export into a normalized salary frame."""
    if isinstance(file, bytes):
        buf = io.BytesIO(file)
    elif isinstance(file, str):
        buf = io.StringIO(file)
    else:
        buf = file

    raw = pd.read_csv(buf)
    if raw.empty:
        return pd.DataFrame(
            columns=["dfs_id", "player_name", "name_key", "position", "team", "salary", "site"]
        )

    cols = list(raw.columns)
    salary_col = _pick_column(cols, _SALARY_COLS)
    if not salary_col:
        raise ValueError("CSV missing a Salary column (DraftKings / FanDuel export expected).")

    name_id_col = _pick_column(cols, _NAME_ID_COLS)
    name_col = _pick_column(cols, _NAME_COLS)
    pos_col = _pick_column(cols, _POS_COLS)
    team_col = _pick_column(cols, _TEAM_COLS)
    id_col = _pick_column(cols, _ID_COLS)

    rows: list[dict] = []
    for _, row in raw.iterrows():
        dfs_id = ""
        if name_id_col:
            name, dfs_id = _parse_name_id_cell(row.get(name_id_col, ""))
        elif name_col:
            name = str(row.get(name_col) or "").strip()
        else:
            continue

        if id_col and not dfs_id:
            dfs_id = str(row.get(id_col) or "").strip()

        try:
            salary = int(float(row[salary_col]))
        except (TypeError, ValueError):
            continue
        if salary <= 0:
            continue

        pos_raw = str(row.get(pos_col) or "") if pos_col else ""
        pos = _normalize_dfs_position(pos_raw)

        team = str(row.get(team_col) or "").strip().upper() if team_col else ""

        rows.append(
            {
                "dfs_id": dfs_id,
                "player_name": name,
                "name_key": _normalize_name(name),
                "position": pos,
                "team": team,
                "salary": salary,
                "site": site.lower(),
            }
        )

    return pd.DataFrame(rows)


def _normalize_dfs_position(raw: str) -> str:
    text = str(raw or "").upper()
    for token in re.split(r"[/,\s]+", text):
        token = token.strip()
        if token in ("QB", "RB", "WR", "TE", "DST", "DEF", "D"):
            return "DST" if token in ("DST", "DEF", "D") else token
    if "DST" in text or "DEF" in text:
        return "DST"
    return text[:2] if text else ""


def attach_salaries_to_pool(
    pool: pd.DataFrame,
    salaries: pd.DataFrame,
) -> tuple[pd.DataFrame, dict]:
    """Join salary export onto projection pool; append DST-only salary rows."""
    if salaries.empty:
        out = pool.copy()
        out["salary"] = pd.NA
        out["dfs_id"] = ""
        out["value"] = pd.NA
        return out, {"matched": 0, "unmatched_slate": 0, "dst_added": 0, "pool_without_salary": len(out)}

    pool = pool.copy()
    pool["name_key"] = pool["Player"].map(_normalize_name)
    pool["team_upper"] = pool["Team"].astype(str).str.upper()

    sal = salaries.copy()
    sal["team_upper"] = sal["team"].astype(str).str.upper()
    skill_positions = sal[sal["position"] != "DST"].copy()

    merged = pool.merge(
        skill_positions[["name_key", "team_upper", "salary", "dfs_id"]],
        on=["name_key", "team_upper"],
        how="left",
    )
    missing = merged["salary"].isna()
    if missing.any():
        name_only = skill_positions.drop_duplicates(subset=["name_key"], keep="last")
        fill = merged.loc[missing, ["name_key"]].merge(
            name_only[["name_key", "salary", "dfs_id"]],
            on="name_key",
            how="left",
        )
        for idx in merged.index[missing]:
            fill_row = fill.loc[fill.index[fill["name_key"] == merged.at[idx, "name_key"]]]
            if not fill_row.empty and pd.notna(fill_row.iloc[0]["salary"]):
                merged.at[idx, "salary"] = fill_row.iloc[0]["salary"]
                if not merged.at[idx, "dfs_id"]:
                    merged.at[idx, "dfs_id"] = fill_row.iloc[0].get("dfs_id", "")

    skill = merged

    dst_rows = sal[sal["position"] == "DST"].copy()
    dst_added = 0
    if not dst_rows.empty:
        dst_frames = []
        for _, row in dst_rows.iterrows():
            team = row["team_upper"] or "DST"
            dst_frames.append(
                {
                    "player_id": f"dst:{team}",
                    "Player": row["player_name"] or f"{team} DST",
                    "Team": team,
                    "Position": "DST",
                    "Projected Points": 7.0,
                    "Low (P10)": 4.0,
                    "High (P90)": 11.0,
                    "Injury Status": "",
                    "salary": row["salary"],
                    "dfs_id": row.get("dfs_id", ""),
                    "name_key": row["name_key"],
                    "team_upper": team,
                }
            )
        dst_added = len(dst_frames)
        skill = pd.concat([skill, pd.DataFrame(dst_frames)], ignore_index=True)

    skill["salary"] = pd.to_numeric(skill["salary"], errors="coerce")
    proj = pd.to_numeric(skill["Projected Points"], errors="coerce").fillna(0)
    skill["value"] = np_where_salary_value(proj, skill["salary"])

    skill_matched = skill[skill["Position"] != "DST"]
    matched = int(skill_matched["salary"].notna().sum())
    slate_skill = sal[sal["position"] != "DST"]
    unmatched_slate = int(max(0, len(slate_skill) - matched))
    without = int((skill_matched["salary"].isna()).sum())

    stats = {
        "matched": max(matched, 0),
        "unmatched_slate": max(unmatched_slate, 0),
        "dst_added": dst_added,
        "pool_without_salary": without,
        "slate_players": len(sal),
    }
    return skill.drop(columns=["name_key", "team_upper"], errors="ignore"), stats


def np_where_salary_value(proj: pd.Series, salary: pd.Series) -> pd.Series:
    sal = pd.to_numeric(salary, errors="coerce")
    pts = pd.to_numeric(proj, errors="coerce").fillna(0)
    value = pts / sal * 1000
    return value.where(sal > 0)
