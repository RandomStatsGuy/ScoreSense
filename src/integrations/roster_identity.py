"""Refresh projection team / position from the current nflverse roster.

Sleeper overlay updates teams when names and GSIS line up, but Sleeper
``full_name`` often drops Jr/III and leaves ``gsis_id`` blank. Weekly artifacts
also freeze June labels. nflverse seasonal roster is the identity source the
boards should match: team, position, and drop leftover names that are no
longer on the season roster.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from src.core.team_codes import normalize_team_to_mlready
from src.draft_hub.player_name_match import roster_name_key

GSIS_RE = re.compile(r"^00-\d{7}$")

BOARD_ALLOWED: dict[str, frozenset[str]] = {
    "qb": frozenset({"QB"}),
    "rb": frozenset({"RB", "FB"}),
    "wr": frozenset({"WR", "TE"}),
    "te": frozenset({"TE"}),
}

SKILL_POSITIONS = frozenset({"QB", "RB", "FB", "WR", "TE"})
DROP_STATUSES = frozenset({"CUT"})
SLEEPER_EXCLUDED = frozenset({"Inactive", "Retired"})


def _board_for_position(position: str | None) -> str | None:
    key = str(position or "").strip().lower()
    if key in {"rec", "wr_te"}:
        return "wr"
    if key in BOARD_ALLOWED:
        return key
    return None


def _row_board(position: Any) -> str | None:
    pos = str(position or "").strip().upper()
    if pos == "QB":
        return "qb"
    if pos in {"RB", "FB"}:
        return "rb"
    if pos in {"WR", "TE"}:
        return "wr"
    return None


def _allowed_for(board: str | None, row_position: Any) -> frozenset[str]:
    if board and board in BOARD_ALLOWED:
        return BOARD_ALLOWED[board]
    row_board = _row_board(row_position)
    if row_board:
        return BOARD_ALLOWED[row_board]
    pos = str(row_position or "").strip().upper()
    if pos and pos not in SKILL_POSITIONS:
        return frozenset({pos})
    return SKILL_POSITIONS


def _is_gsis(player_id: str) -> bool:
    return bool(GSIS_RE.match(str(player_id or "").strip()))


def _is_rookie_row(row: pd.Series) -> bool:
    flag = row.get("_rookie_estimate")
    try:
        if flag is not None and not (isinstance(flag, float) and pd.isna(flag)) and bool(flag):
            return True
    except (TypeError, ValueError):
        pass
    pid = str(row.get("player_id") or "").strip()
    return pid.startswith("sleeper-")


def _schema(frame: pd.DataFrame) -> tuple[str, str, str, str]:
    team_col = "Team" if "Team" in frame.columns else "team"
    if "Position" in frame.columns:
        pos_col = "Position"
    elif "position" in frame.columns:
        pos_col = "position"
    else:
        pos_col = ""
    name_col = ""
    for col in ("Player", "player_display_name", "player_name"):
        if col in frame.columns:
            name_col = col
            break
    id_col = "player_id" if "player_id" in frame.columns else ""
    return team_col, pos_col, name_col, id_col


def _index_nflverse(roster: pd.DataFrame) -> dict[str, pd.Series]:
    by_id: dict[str, pd.Series] = {}
    if roster is None or roster.empty or "player_id" not in roster.columns:
        return by_id
    for _, row in roster.iterrows():
        pid = str(row.get("player_id") or "").strip()
        if pid:
            by_id[pid] = row
    return by_id


def _index_sleeper(sleeper_df: pd.DataFrame) -> tuple[dict[str, pd.Series], dict[str, pd.Series]]:
    by_gsis: dict[str, pd.Series] = {}
    by_name: dict[str, list[pd.Series]] = {}
    if sleeper_df is None or sleeper_df.empty:
        return {}, {}
    for _, row in sleeper_df.iterrows():
        gsis = str(row.get("gsis_id") or "").strip()
        if gsis:
            by_gsis[gsis] = row
        key = roster_name_key(str(row.get("full_name") or ""))
        if key:
            by_name.setdefault(key, []).append(row)
    return by_gsis, by_name


def _pick_sleeper_row(candidates: list[pd.Series], allowed: frozenset[str]) -> pd.Series | None:
    if not candidates:
        return None

    def score(row: pd.Series) -> tuple[int, int, int]:
        team = str(row.get("team") or "").strip()
        pos = str(row.get("position") or "").strip().upper()
        status = str(row.get("status") or "").strip()
        return (
            1 if pos in allowed else 0,
            1 if team else 0,
            0 if status in SLEEPER_EXCLUDED else 1,
        )

    ranked = sorted(candidates, key=score, reverse=True)
    return ranked[0]


def _lookup_sleeper(
    row: pd.Series,
    *,
    name: str,
    player_id: str,
    allowed: frozenset[str],
    by_gsis: dict[str, pd.Series],
    by_name: dict[str, list[pd.Series]],
) -> pd.Series | None:
    if player_id and player_id in by_gsis:
        return by_gsis[player_id]
    key = roster_name_key(name)
    if key and key in by_name:
        return _pick_sleeper_row(by_name[key], allowed)
    return None


def _refresh_opponents(frame: pd.DataFrame, season: int | None, week: int | None) -> pd.DataFrame:
    if season is None or week is None or frame.empty:
        return frame
    team_col = "Team" if "Team" in frame.columns else "team" if "team" in frame.columns else ""
    if not team_col:
        return frame
    try:
        from src.core.schedule_utils import attach_schedule_context

        tmp = pd.DataFrame({"team": frame[team_col].map(normalize_team_to_mlready)})
        tmp = attach_schedule_context(tmp, int(season), int(week))
        if "Opponent" in frame.columns:
            frame["Opponent"] = tmp["opponent"].values
        if "opponent" in frame.columns:
            frame["opponent"] = tmp["opponent"].values
        elif "Opponent" not in frame.columns:
            frame["opponent"] = tmp["opponent"].values
    except Exception:
        return frame
    return frame


def apply_roster_identity_overlay(
    frame: pd.DataFrame,
    position: str | None,
    *,
    season: int | None = None,
    week: int | None = None,
    nflverse_df: pd.DataFrame | None = None,
    sleeper_df: pd.DataFrame | None = None,
    load_defaults: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Update team/position and drop wrong-board or leftover roster rows."""
    empty_stats = {
        "applied": False,
        "teams_updated": 0,
        "positions_updated": 0,
        "dropped_wrong_position": 0,
        "dropped_stale": 0,
        "dropped_cut": 0,
    }
    if frame is None or frame.empty:
        return frame.copy() if frame is not None else pd.DataFrame(), empty_stats

    board = _board_for_position(position)
    nflverse = nflverse_df
    if nflverse is None and load_defaults and season is not None:
        try:
            from src.integrations.nflverse_roster import load_seasonal_roster

            nflverse = load_seasonal_roster(int(season))
        except Exception:
            nflverse = pd.DataFrame()
    if nflverse is None:
        nflverse = pd.DataFrame()

    sleeper = sleeper_df
    if sleeper is None and load_defaults:
        try:
            from src.integrations.sleeper import players_dataframe

            sleeper = players_dataframe()
        except Exception:
            sleeper = pd.DataFrame()
    if sleeper is None:
        sleeper = pd.DataFrame()

    nflverse_ready = not nflverse.empty
    if not nflverse_ready and sleeper.empty:
        return frame.copy(), empty_stats

    by_nfl = _index_nflverse(nflverse)
    by_gsis, by_name = _index_sleeper(sleeper)
    team_col, pos_col, name_col, id_col = _schema(frame)
    if not team_col:
        return frame.copy(), empty_stats

    out = frame.copy()
    keep: list[bool] = []
    teams_updated = 0
    positions_updated = 0
    dropped_wrong = 0
    dropped_stale = 0
    dropped_cut = 0

    for idx, row in out.iterrows():
        player_id = str(row[id_col] or "").strip() if id_col else ""
        name = str(row[name_col] or "").strip() if name_col else ""
        row_pos = row[pos_col] if pos_col else ""
        allowed = _allowed_for(board, row_pos)
        current_team = normalize_team_to_mlready(str(row.get(team_col) or "").strip())

        nfl_row = by_nfl.get(player_id) if player_id else None
        if nfl_row is not None:
            nfl_status = str(nfl_row.get("status") or "").strip().upper()
            nfl_pos = str(nfl_row.get("position") or "").strip().upper()
            nfl_team = normalize_team_to_mlready(str(nfl_row.get("team") or "").strip())
            if nfl_status in DROP_STATUSES:
                keep.append(False)
                dropped_cut += 1
                continue
            if nfl_pos and nfl_pos not in allowed:
                keep.append(False)
                dropped_wrong += 1
                continue
            if nfl_team and nfl_team != current_team:
                out.at[idx, team_col] = nfl_team
                teams_updated += 1
            if pos_col and nfl_pos and str(row_pos or "").strip().upper() != nfl_pos:
                out.at[idx, pos_col] = nfl_pos
                positions_updated += 1
            keep.append(True)
            continue

        if nflverse_ready and _is_gsis(player_id) and not _is_rookie_row(row):
            keep.append(False)
            dropped_stale += 1
            continue

        sleeper_row = _lookup_sleeper(
            row,
            name=name,
            player_id=player_id,
            allowed=allowed,
            by_gsis=by_gsis,
            by_name=by_name,
        )
        if sleeper_row is None:
            keep.append(True)
            continue

        sl_status = str(sleeper_row.get("status") or "").strip()
        sl_pos = str(sleeper_row.get("position") or "").strip().upper()
        sl_team = normalize_team_to_mlready(str(sleeper_row.get("team") or "").strip())
        if sl_status in SLEEPER_EXCLUDED or not sl_team:
            keep.append(False)
            dropped_stale += 1
            continue
        if sl_pos and sl_pos not in allowed:
            keep.append(False)
            dropped_wrong += 1
            continue
        if sl_team != current_team:
            out.at[idx, team_col] = sl_team
            teams_updated += 1
        if pos_col and sl_pos and str(row_pos or "").strip().upper() != sl_pos:
            out.at[idx, pos_col] = sl_pos
            positions_updated += 1
        keep.append(True)

    out = out.loc[keep].reset_index(drop=True)
    if teams_updated:
        season_val = season
        week_val = week
        if season_val is None and "Season" in out.columns and not out.empty:
            try:
                season_val = int(out["Season"].iloc[0])
            except (TypeError, ValueError):
                season_val = None
        if week_val is None and "Week" in out.columns and not out.empty:
            try:
                week_val = int(out["Week"].iloc[0])
            except (TypeError, ValueError):
                week_val = None
        out = _refresh_opponents(out, season_val, week_val)

    stats = {
        "applied": True,
        "source": "nflverse" if nflverse_ready else "sleeper",
        "teams_updated": teams_updated,
        "positions_updated": positions_updated,
        "dropped_wrong_position": dropped_wrong,
        "dropped_stale": dropped_stale,
        "dropped_cut": dropped_cut,
    }
    return out, stats
