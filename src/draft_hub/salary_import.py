"""Parse salary range CSV (player, min, max) and match to projection pool."""

from __future__ import annotations

import io
import re
from typing import Any, BinaryIO

import pandas as pd

from src.integrations.external_projections import _normalize_name

_MIN_COLS = ("min", "min_sal", "min_salary", "floor", "Min")
_MAX_COLS = ("max", "max_sal", "max_salary", "ceiling", "Max")
_NAME_COLS = ("Name", "Nickname", "name", "player_name", "Player")
_POS_COLS = ("Position", "position", "Pos")
_TEAM_COLS = ("TeamAbbrev", "Team", "team", "team_abbrev")
_ID_COLS = ("player_id", "ID", "Id", "id")


def _pick_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    lower = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def parse_salary_range_csv(file: BinaryIO | bytes | str) -> pd.DataFrame:
    if isinstance(file, bytes):
        buf = io.BytesIO(file)
    elif isinstance(file, str):
        buf = io.StringIO(file)
    else:
        buf = file
    raw = pd.read_csv(buf)
    if raw.empty:
        return pd.DataFrame(columns=["player_name", "name_key", "position", "team", "min_sal", "max_sal", "player_id"])

    cols = list(raw.columns)
    min_col = _pick_column(cols, _MIN_COLS)
    max_col = _pick_column(cols, _MAX_COLS)
    name_col = _pick_column(cols, _NAME_COLS)
    pos_col = _pick_column(cols, _POS_COLS)
    team_col = _pick_column(cols, _TEAM_COLS)
    id_col = _pick_column(cols, _ID_COLS)

    if not min_col or not max_col:
        raise ValueError("CSV must include min and max salary columns.")
    if not name_col and not id_col:
        raise ValueError("CSV must include player name or player_id.")

    rows: list[dict[str, Any]] = []
    for _, row in raw.iterrows():
        try:
            min_sal = float(row[min_col])
            max_sal = float(row[max_col])
        except (TypeError, ValueError):
            continue
        if min_sal <= 0 or max_sal <= 0:
            continue
        if max_sal < min_sal:
            min_sal, max_sal = max_sal, min_sal
        name = str(row.get(name_col) or "").strip() if name_col else ""
        pid = str(row.get(id_col) or "").strip() if id_col else ""
        pos = str(row.get(pos_col) or "").upper() if pos_col else ""
        team = str(row.get(team_col) or "").strip().upper() if team_col else ""
        rows.append(
            {
                "player_id": pid,
                "player_name": name,
                "name_key": _normalize_name(name),
                "position": pos,
                "team": team,
                "min_sal": min_sal,
                "max_sal": max_sal,
            }
        )
    return pd.DataFrame(rows)


def match_ranges_to_pool(pool: pd.DataFrame, ranges: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if ranges.empty:
        return [], {"matched": 0, "unmatched": 0}

    pool = pool.copy()
    pool["name_key"] = pool["Player"].map(_normalize_name)
    pool["team_upper"] = pool["Team"].astype(str).str.upper()

    out: list[dict[str, Any]] = []
    matched = 0
    for _, r in ranges.iterrows():
        pid = str(r.get("player_id") or "")
        hit = None
        if pid:
            hits = pool[pool["player_id"].astype(str) == pid]
            if not hits.empty:
                hit = hits.iloc[0]
        if hit is None and r.get("name_key"):
            team = str(r.get("team") or "").upper()
            hits = pool[(pool["name_key"] == r["name_key"]) & (pool["team_upper"] == team)]
            if hits.empty:
                hits = pool[pool["name_key"] == r["name_key"]]
            if not hits.empty:
                hit = hits.iloc[0]
        if hit is None:
            continue
        matched += 1
        out.append(
            {
                "player_id": str(hit.get("player_id") or ""),
                "player_name": str(hit.get("Player") or r.get("player_name") or ""),
                "team": str(hit.get("Team") or r.get("team") or ""),
                "position": str(hit.get("Position") or r.get("position") or ""),
                "min_sal": float(r["min_sal"]),
                "max_sal": float(r["max_sal"]),
                "source": "import",
            }
        )
    return out, {"matched": matched, "unmatched": len(ranges) - matched}
