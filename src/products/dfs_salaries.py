"""Parse DraftKings / FanDuel salary CSV exports and join to ScoreSense pool."""

from __future__ import annotations

import io
import re
from typing import BinaryIO

import numpy as np
import pandas as pd

from src.integrations.external_projections import _normalize_name

_SALARY_COLS = ("salary", "Salary")
_NAME_COLS = ("Name", "Nickname", "name", "player_name")
_POS_COLS = ("Position", "position", "Roster Position")
_TEAM_COLS = ("TeamAbbrev", "Team", "team", "team_abbrev")
_ID_COLS = ("ID", "Id", "id", "player_id")
_NAME_ID_COLS = ("Name + ID",)
_ROSTER_POS_COLS = ("Roster Position", "roster_position", "roster position")

_SALARY_FRAME_COLUMNS = [
    "dfs_id",
    "player_name",
    "name_key",
    "position",
    "team",
    "salary",
    "site",
    "roster_position",
]

# DK Showdown CPT rows and FanDuel Single game MVP rows cost 1.5× base salary.
CAPTAIN_SALARY_RATIO = 1.5


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


def _normalize_roster_position(raw: str) -> str:
    text = str(raw or "").upper()
    if "CPT" in text or "CAPTAIN" in text or "MVP" in text:
        return "CPT"
    return ""


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
        return pd.DataFrame(columns=_SALARY_FRAME_COLUMNS)

    cols = list(raw.columns)
    salary_col = _pick_column(cols, _SALARY_COLS)
    if not salary_col:
        raise ValueError("CSV missing a Salary column (DraftKings / FanDuel export expected).")

    name_id_col = _pick_column(cols, _NAME_ID_COLS)
    name_col = _pick_column(cols, _NAME_COLS)
    pos_col = _pick_column(cols, _POS_COLS)
    team_col = _pick_column(cols, _TEAM_COLS)
    id_col = _pick_column(cols, _ID_COLS)
    roster_pos_col = _pick_column(cols, _ROSTER_POS_COLS)

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
        roster_position = (
            _normalize_roster_position(row.get(roster_pos_col)) if roster_pos_col else ""
        )

        rows.append(
            {
                "dfs_id": dfs_id,
                "player_name": name,
                "name_key": _normalize_name(name),
                "position": pos,
                "team": team,
                "salary": salary,
                "site": site.lower(),
                "roster_position": roster_position,
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
    # Single-game roster slots are not NFL positions.
    if text in ("CPT", "CAPTAIN", "MVP", "FLEX", "UTIL"):
        return ""
    return text[:2] if text else ""


def collapse_captain_rows(salaries: pd.DataFrame) -> pd.DataFrame:
    """Fold single-game CPT/MVP rows into one row per player with `cpt_salary` / `cpt_dfs_id`.

    Handles both explicit `Roster Position` exports (DK showdown CSVs) and live
    draftables where each player appears twice at a 1.5× salary ratio. Idempotent.
    """
    if salaries.empty:
        out = salaries.copy()
        for col, default in (("cpt_salary", np.nan), ("cpt_dfs_id", "")):
            if col not in out.columns:
                out[col] = default
        return out

    out = salaries.copy()
    if "cpt_salary" not in out.columns:
        out["cpt_salary"] = np.nan
    if "cpt_dfs_id" not in out.columns:
        out["cpt_dfs_id"] = ""
    # Live lobbies list one draftable per roster slot (RB + FLEX, …) at the
    # same salary — keep one row per player so the pool join stays 1:1.
    out = out.drop_duplicates(subset=["name_key", "team", "position", "salary"], keep="first")
    roster_pos = (
        out["roster_position"].fillna("").astype(str)
        if "roster_position" in out.columns
        else pd.Series("", index=out.index)
    )

    if (roster_pos == "CPT").any():
        cpt = out[roster_pos == "CPT"].copy()
        base = out[roster_pos != "CPT"].copy()
        cpt_map = cpt.drop_duplicates(subset=["name_key", "team"], keep="first").set_index(
            ["name_key", "team"]
        )
        keys = list(zip(base["name_key"], base["team"]))
        base["cpt_salary"] = [
            float(cpt_map.at[k, "salary"]) if k in cpt_map.index else np.nan for k in keys
        ]
        base["cpt_dfs_id"] = [
            str(cpt_map.at[k, "dfs_id"]) if k in cpt_map.index else "" for k in keys
        ]

        # Players that only exist as CPT rows: derive base salary from the ratio.
        base_keys = set(keys)
        orphans = cpt[[k not in base_keys for k in zip(cpt["name_key"], cpt["team"])]].copy()
        if not orphans.empty:
            orphans["cpt_salary"] = orphans["salary"]
            orphans["cpt_dfs_id"] = orphans["dfs_id"]
            orphans["salary"] = (
                orphans["salary"].astype(float) / CAPTAIN_SALARY_RATIO
            ).round().astype(int)
            base = pd.concat([base, orphans], ignore_index=True)
        if "roster_position" in base.columns:
            base = base.drop(columns=["roster_position"])
        return base.reset_index(drop=True)

    # Live draftables path: one CPT row + one FLEX row per player at ~1.5× salary.
    dup_mask = out.duplicated(subset=["name_key", "team"], keep=False)
    if not dup_mask.any():
        return out.drop(columns=["roster_position"], errors="ignore")

    keep_rows: list[dict] = []
    for (_, _), group in out.groupby(["name_key", "team"], sort=False):
        if len(group) < 2:
            keep_rows.append(group.iloc[0].to_dict())
            continue
        lo = group.loc[group["salary"].idxmin()]
        hi = group.loc[group["salary"].idxmax()]
        ratio = float(hi["salary"]) / float(lo["salary"]) if lo["salary"] else 0.0
        if len(group) == 2 and 1.45 <= ratio <= 1.55:
            row = lo.to_dict()
            row["cpt_salary"] = int(hi["salary"])
            row["cpt_dfs_id"] = str(hi["dfs_id"])
            keep_rows.append(row)
        else:
            keep_rows.extend(r.to_dict() for _, r in group.iterrows())

    collapsed = pd.DataFrame(keep_rows)
    return collapsed.drop(columns=["roster_position"], errors="ignore").reset_index(drop=True)


def attach_salaries_to_pool(
    pool: pd.DataFrame,
    salaries: pd.DataFrame,
) -> tuple[pd.DataFrame, dict]:
    """Join salary export onto projection pool; append DST-only salary rows."""
    if salaries.empty:
        out = pool.copy()
        out["salary"] = np.nan
        out["dfs_id"] = ""
        out["cpt_salary"] = np.nan
        out["cpt_dfs_id"] = ""
        out["value"] = np.nan
        return out, {"matched": 0, "unmatched_slate": 0, "dst_added": 0, "pool_without_salary": len(out)}

    pool = pool.copy()
    pool["name_key"] = pool["Player"].map(_normalize_name)
    pool["team_upper"] = pool["Team"].astype(str).str.upper()

    sal = collapse_captain_rows(salaries)
    sal["team_upper"] = sal["team"].astype(str).str.upper()
    skill_positions = sal[sal["position"] != "DST"].copy()

    merged = pool.merge(
        skill_positions[["name_key", "team_upper", "salary", "dfs_id", "cpt_salary", "cpt_dfs_id"]],
        on=["name_key", "team_upper"],
        how="left",
    )
    missing = merged["salary"].isna()
    if missing.any():
        name_only = skill_positions.drop_duplicates(subset=["name_key"], keep="last")
        fill = merged.loc[missing, ["name_key"]].merge(
            name_only[["name_key", "salary", "dfs_id", "cpt_salary", "cpt_dfs_id"]],
            on="name_key",
            how="left",
        )
        for idx in merged.index[missing]:
            fill_row = fill.loc[fill.index[fill["name_key"] == merged.at[idx, "name_key"]]]
            if not fill_row.empty and pd.notna(fill_row.iloc[0]["salary"]):
                merged.at[idx, "salary"] = fill_row.iloc[0]["salary"]
                if not merged.at[idx, "dfs_id"]:
                    merged.at[idx, "dfs_id"] = fill_row.iloc[0].get("dfs_id", "")
                if pd.isna(merged.at[idx, "cpt_salary"]):
                    merged.at[idx, "cpt_salary"] = fill_row.iloc[0].get("cpt_salary")
                if not merged.at[idx, "cpt_dfs_id"]:
                    merged.at[idx, "cpt_dfs_id"] = fill_row.iloc[0].get("cpt_dfs_id", "")

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
                    "cpt_salary": row.get("cpt_salary"),
                    "cpt_dfs_id": row.get("cpt_dfs_id", ""),
                    "name_key": row["name_key"],
                    "team_upper": team,
                    # A slate only lists teams that play, so DSTs are never on bye.
                    "on_bye": False,
                }
            )
        dst_added = len(dst_frames)
        skill = pd.concat([skill, pd.DataFrame(dst_frames)], ignore_index=True)

    skill["salary"] = pd.to_numeric(skill["salary"], errors="coerce")
    skill["cpt_salary"] = pd.to_numeric(skill["cpt_salary"], errors="coerce")
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
