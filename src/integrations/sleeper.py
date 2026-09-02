"""Sleeper API integration for injuries and roster context."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests

from src.config import CACHE_DIR

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
SLEEPER_STATE_URL = "https://api.sleeper.app/v1/state/nfl"
STATE_CACHE = CACHE_DIR / "sleeper_nfl_state.json"
STATE_CACHE_TTL_SECONDS = 300
PLAYERS_CACHE = CACHE_DIR / "sleeper_players.json"
PLAYERS_CACHE_TTL_SECONDS = 86400
_PLAYERS_RAW_CACHE: dict[str, Any] | None = None
_PLAYERS_RAW_MTIME: float = -1.0
_PLAYERS_DF_CACHE: pd.DataFrame | None = None
_PLAYERS_DF_MTIME: float = -1.0
_PLAYERS_SEARCH_ROWS: list[dict[str, Any]] | None = None
_PLAYERS_SEARCH_BY_LAST: dict[str, list[int]] | None = None
_PLAYERS_SEARCH_MTIME: float = -1.0

INJURY_STATUSES = {"Out", "Doubtful", "Questionable", "IR", "PUP"}
EXCLUDED_SLEEPER_STATUSES = {"Inactive", "Retired"}

# Prior-season starters who are now clear backups still carry starter feature rows.
# Scale those features down using Sleeper depth so draft/weekly boards don't treat
# QB2/QB3 volume as starting jobs (e.g. Spencer Rattler, Anthony Richardson).
# Blank depth is *not* a starter — practice-squad vets (Nick Mullens) have no
# slot. Unlisted vets on a team that already has a listed starter use the
# deepest backup tier. Missing depth alone stays 1.0 so an injured star whose
# Sleeper DC dropped is not crushed when they still outrank the listed backup.
_VET_BACKUP_MULT: dict[str, dict[int, float]] = {
    "qb": {2: 0.32, 3: 0.15},
    "rb": {2: 0.70, 3: 0.40},
    "wr": {2: 0.75, 3: 0.55, 4: 0.32},
    "te": {2: 0.70, 3: 0.40},
}


def _optional_int(val: Any) -> int | None:
    try:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        return int(val)
    except (TypeError, ValueError):
        return None


def _optional_positive_int(val: Any) -> int | None:
    parsed = _optional_int(val)
    return parsed if parsed is not None and parsed > 0 else None


def _skill_pos(position: Any) -> str:
    pos = str(position or "").lower()
    if pos == "fb":
        return "rb"
    return pos


def sleeper_vet_backup_mult(position: str, depth_order: Any) -> tuple[float, str]:
    """Feature multiplier for veterans who are not QB1/RB1/WR1 on Sleeper.

    Missing / non-positive depth stays 1.0. Call ``unlisted_vet_backup_mult``
    when a teammate already holds the listed starter slot.
    """
    dc = _optional_positive_int(depth_order)
    if dc is None or dc <= 1:
        return 1.0, ""
    pos = _skill_pos(position)
    table = _VET_BACKUP_MULT.get(pos) or _VET_BACKUP_MULT.get("wr", {})
    # Use exact tier or the deepest defined tier for dc >= max key
    if dc in table:
        mult = table[dc]
    else:
        deepest = max(table) if table else None
        mult = table[deepest] if deepest is not None and dc >= deepest else 1.0
    if mult >= 0.999:
        return 1.0, ""
    label = f"{pos}{dc}-backup" if pos == "qb" else f"{pos}-depth{dc}"
    return mult, label


def unlisted_vet_backup_mult(position: str) -> tuple[float, str]:
    """Deepest backup tier for a vet with no Sleeper depth slot."""
    pos = _skill_pos(position)
    table = _VET_BACKUP_MULT.get(pos) or _VET_BACKUP_MULT.get("wr", {})
    if not table:
        return 1.0, ""
    mult, _ = sleeper_vet_backup_mult(pos, max(table))
    if mult >= 0.999:
        return 1.0, ""
    return mult, f"{pos}-unlisted"


def apply_unlisted_vet_backup_scale(
    roster: pd.DataFrame,
    position: str,
) -> tuple[pd.DataFrame, int]:
    """Scale unlisted vets when a teammate is already the listed starter.

    Practice-squad / blank-depth vets (high or missing search_rank) get the
    deepest backup multiplier. A more-searched unlisted vet than the listed
    starter is left alone — typical injured-star missing-DC case.
    """
    if roster.empty or "_sleeper_unlisted" not in roster.columns:
        return roster, 0

    out = roster.copy()
    out["_sleeper_unlisted"] = out["_sleeper_unlisted"].fillna(False).astype(bool)
    if "_vet_backup_mult" not in out.columns:
        out["_vet_backup_mult"] = 1.0
    if "_vet_backup_label" not in out.columns:
        out["_vet_backup_label"] = ""

    scaled = 0
    default_pos = _skill_pos(position) or "qb"

    def _row_pos(row: pd.Series) -> str:
        raw = row.get("position")
        try:
            if raw is None or pd.isna(raw):
                return default_pos
        except (TypeError, ValueError):
            return default_pos
        return _skill_pos(raw) or default_pos

    teams = out.get("team")
    if teams is None:
        return out, 0

    for team, group in out.groupby(teams.astype(str).str.upper(), sort=False):
        if not str(team).strip():
            continue
        for skill_pos, pos_group in group.groupby(group.apply(_row_pos, axis=1), sort=False):
            starter_ranks: list[int] = []
            has_listed_starter = False
            for _, row in pos_group.iterrows():
                dc = _optional_positive_int(row.get("_sleeper_depth_order"))
                if dc == 1:
                    has_listed_starter = True
                    rank = _optional_int(row.get("_sleeper_search_rank"))
                    if rank is not None:
                        starter_ranks.append(rank)
            if not has_listed_starter:
                continue
            starter_rank = min(starter_ranks) if starter_ranks else None
            for idx, row in pos_group.iterrows():
                if not bool(row.get("_sleeper_unlisted", False)):
                    continue
                if bool(row.get("_rookie_estimate", False)):
                    continue
                try:
                    current_mult = float(row.get("_vet_backup_mult") or 1.0)
                except (TypeError, ValueError):
                    current_mult = 1.0
                if current_mult < 0.999:
                    continue
                their_rank = _optional_int(row.get("_sleeper_search_rank"))
                if (
                    their_rank is not None
                    and starter_rank is not None
                    and their_rank <= starter_rank
                ):
                    continue
                mult, label = unlisted_vet_backup_mult(skill_pos)
                if mult >= 0.999:
                    continue
                out.at[idx, "_vet_backup_mult"] = mult
                out.at[idx, "_vet_backup_label"] = label
                scaled += 1
    return out, scaled


def _scale_numeric_features(row: pd.Series, mult: float) -> pd.Series:
    """Multiply numeric feature columns on a roster row (identity / meta cols skipped)."""
    if mult == 1.0:
        return row
    out = row.copy()
    skip = {
        "season",
        "week",
        "years_exp",
        "age",
        "_rookie_role_mult",
        "_sleeper_depth_order",
        "_sleeper_search_rank",
        "_sleeper_unlisted",
        "_vet_backup_mult",
    }
    for col in out.index:
        if col in skip or str(col).startswith("_"):
            continue
        val = out[col]
        if isinstance(val, (int, float)) and not pd.isna(val):
            out[col] = float(val) * mult
    return out


_PROJ_SCALE_COLS = (
    "Projected Points",
    "Low (P10)",
    "High (P90)",
    "Floor",
    "Ceiling",
    "Season Proj",
    "Season Floor",
    "Season Ceiling",
    "Season P10",
    "Season P50",
    "Season P90",
    "Season Spread",
    "Per-Game Proj",
    "Per-Game Floor",
    "Per-Game Ceiling",
)


def apply_vet_backup_projection_scale(result: pd.DataFrame, roster: pd.DataFrame) -> pd.DataFrame:
    """Discount projection columns for Sleeper-listed backups (QB2+, etc.)."""
    if result.empty or roster.empty or "_vet_backup_mult" not in roster.columns:
        return result

    name_col = next(
        (c for c in ("player_display_name", "player_name", "Player") if c in roster.columns),
        None,
    )
    if name_col is None:
        return result

    mult_map: dict[tuple[str, str], float] = {}
    for _, row in roster.iterrows():
        try:
            mult = float(row.get("_vet_backup_mult") or 1.0)
        except (TypeError, ValueError):
            mult = 1.0
        if mult >= 0.999:
            continue
        key = (str(row[name_col]), str(row.get("team") or "").upper())
        mult_map[key] = mult
    if not mult_map:
        return result

    out = result.copy()
    player_col = "Player" if "Player" in out.columns else name_col
    team_col = "Team" if "Team" in out.columns else "team"
    proj_cols = [c for c in _PROJ_SCALE_COLS if c in out.columns]
    if not proj_cols or player_col not in out.columns:
        return result

    for idx, row in out.iterrows():
        key = (str(row[player_col]), str(row.get(team_col) or "").upper())
        mult = mult_map.get(key)
        if mult is None:
            continue
        for col in proj_cols:
            val = row[col]
            if isinstance(val, (int, float)) and not pd.isna(val):
                out.at[idx, col] = round(float(val) * mult, 3)

    # SCORE-50: scale Low/High with P50; still re-assert order after rounding.
    from src.ml.quantile import repair_projection_quantiles

    return repair_projection_quantiles(out)


SLEEPER_POSITIONS: dict[str, frozenset[str]] = {
    "qb": frozenset({"QB"}),
    "rb": frozenset({"RB", "FB"}),
    "wr": frozenset({"WR", "TE"}),
}


def _fetch_json(url: str) -> dict | list:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.json()


def get_nfl_state(use_cache: bool = True) -> dict:
    """Sleeper NFL calendar state — cached locally to avoid blocking every meta request."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if use_cache and STATE_CACHE.exists():
        age = time.time() - STATE_CACHE.stat().st_mtime
        if age < STATE_CACHE_TTL_SECONDS:
            try:
                return json.loads(STATE_CACHE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
    state = _fetch_json(SLEEPER_STATE_URL)
    STATE_CACHE.write_text(json.dumps(state), encoding="utf-8")
    return state


def load_sleeper_players(force_refresh: bool = False) -> dict:
    """Load Sleeper player dictionary, cached on disk (24h) and in-process by mtime."""
    global _PLAYERS_RAW_CACHE, _PLAYERS_RAW_MTIME
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if not force_refresh and PLAYERS_CACHE.exists():
        mtime = PLAYERS_CACHE.stat().st_mtime
        fresh_on_disk = (time.time() - mtime) < PLAYERS_CACHE_TTL_SECONDS
        if (
            fresh_on_disk
            and _PLAYERS_RAW_CACHE is not None
            and mtime == _PLAYERS_RAW_MTIME
        ):
            return _PLAYERS_RAW_CACHE
        if fresh_on_disk:
            players = json.loads(PLAYERS_CACHE.read_text(encoding="utf-8"))
            _PLAYERS_RAW_CACHE = players
            _PLAYERS_RAW_MTIME = mtime
            return players

    players = _fetch_json(SLEEPER_PLAYERS_URL)
    PLAYERS_CACHE.write_text(json.dumps(players), encoding="utf-8")
    _PLAYERS_RAW_CACHE = players
    _PLAYERS_RAW_MTIME = PLAYERS_CACHE.stat().st_mtime if PLAYERS_CACHE.exists() else time.time()
    return players


def players_dataframe(force_refresh: bool = False) -> pd.DataFrame:
    global _PLAYERS_DF_CACHE, _PLAYERS_DF_MTIME
    cache_mtime = PLAYERS_CACHE.stat().st_mtime if PLAYERS_CACHE.exists() else 0.0
    if (
        not force_refresh
        and _PLAYERS_DF_CACHE is not None
        and cache_mtime == _PLAYERS_DF_MTIME
    ):
        return _PLAYERS_DF_CACHE

    raw = load_sleeper_players(force_refresh=force_refresh)
    rows = []
    for player_id, info in raw.items():
        if not info:
            continue
        rows.append(
            {
                "sleeper_id": player_id,
                "full_name": info.get("full_name") or "",
                "first_name": info.get("first_name") or "",
                "last_name": info.get("last_name") or "",
                "team": info.get("team") or "",
                "position": info.get("position") or "",
                "injury_status": info.get("injury_status") or "",
                "injury_body_part": info.get("injury_body_part") or "",
                "injury_notes": info.get("injury_notes") or "",
                "injury_start_date": info.get("injury_start_date"),
                "practice_participation": info.get("practice_participation") or "",
                "practice_description": info.get("practice_description") or "",
                "news_updated": info.get("news_updated"),
                "status": info.get("status") or "",
                "gsis_id": info.get("gsis_id") or "",
                "espn_id": info.get("espn_id") or "",
                "years_exp": info.get("years_exp"),
                "number": info.get("number"),
                "depth_chart_order": info.get("depth_chart_order"),
                "depth_chart_position": info.get("depth_chart_position") or "",
                "search_rank": info.get("search_rank"),
                "college": info.get("college") or "",
                "high_school": info.get("high_school") or "",
                "age": info.get("age"),
                "birth_date": info.get("birth_date") or "",
                "birth_city": info.get("birth_city") or "",
                "birth_state": info.get("birth_state") or "",
                "height": info.get("height"),
                "weight": info.get("weight"),
            }
        )
    df = pd.DataFrame(rows)
    _PLAYERS_DF_CACHE = df
    _PLAYERS_DF_MTIME = cache_mtime if PLAYERS_CACHE.exists() else time.time()
    return df


def _def_display_name(info: dict[str, Any]) -> str:
    """Sleeper DEF entries use first/last team names, not full_name."""
    last = str(info.get("last_name") or "").strip()
    first = str(info.get("first_name") or "").strip()
    team = str(info.get("team") or "").strip()
    if last:
        return last
    if first and last:
        return f"{first} {last}"
    return team or "Defense"


def _def_search_blob(info: dict[str, Any], display: str) -> str:
    first = str(info.get("first_name") or "").strip()
    last = str(info.get("last_name") or "").strip()
    team = str(info.get("team") or "").strip()
    parts = [display.lower(), team.lower(), last.lower(), first.lower()]
    if first and last:
        parts.append(f"{first} {last}".lower())
    return " ".join(p for p in parts if p)


def _normalize_def_query(query: str) -> str:
    q = re.sub(r"\s*\b(dst|def|defense)\b\s*", " ", str(query or ""), flags=re.I)
    return re.sub(r"\s+", " ", q).strip()


def player_by_sleeper_id(sleeper_player_id: str, force_refresh: bool = False) -> dict[str, Any] | None:
    """Look up one Sleeper NFL player by id."""
    sid = str(sleeper_player_id or "").strip()
    if not sid:
        return None
    info = load_sleeper_players(force_refresh=force_refresh).get(sid)
    if not info:
        return None
    pos = str(info.get("position") or "").upper()
    if pos in {"DST", "D"}:
        pos = "DEF"
    full = str(info.get("full_name") or "").strip()
    if not full and pos == "DEF":
        full = _def_display_name(info)
    if not full:
        return None
    return {
        "sleeper_player_id": sid,
        "player_name": full,
        "position": pos or None,
        "team": str(info.get("team") or "") or None,
    }


def _player_search_index(
    force_refresh: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, list[int]]]:
    """Cached active Sleeper players indexed by normalized last name."""
    global _PLAYERS_SEARCH_ROWS, _PLAYERS_SEARCH_BY_LAST, _PLAYERS_SEARCH_MTIME
    cache_mtime = PLAYERS_CACHE.stat().st_mtime if PLAYERS_CACHE.exists() else 0.0
    if (
        not force_refresh
        and _PLAYERS_SEARCH_ROWS is not None
        and _PLAYERS_SEARCH_BY_LAST is not None
        and cache_mtime == _PLAYERS_SEARCH_MTIME
    ):
        return _PLAYERS_SEARCH_ROWS, _PLAYERS_SEARCH_BY_LAST

    from src.draft_hub.player_name_match import last_name_key

    rows: list[dict[str, Any]] = []
    by_last: dict[str, list[int]] = {}
    for player_id, info in load_sleeper_players(force_refresh=force_refresh).items():
        if not info:
            continue
        if str(info.get("status") or "") in EXCLUDED_SLEEPER_STATUSES:
            continue
        row_pos = str(info.get("position") or "").upper() or None
        if row_pos in {"DST", "D"}:
            row_pos = "DEF"
        full = str(info.get("full_name") or "").strip()
        if not full and row_pos == "DEF":
            full = _def_display_name(info)
        if not full:
            continue
        last = str(info.get("last_name") or "").strip()
        ln = last_name_key(last or full)
        team_abbr = str(info.get("team") or "").upper()
        full_lower = full.lower()
        if row_pos == "DEF":
            full_lower = _def_search_blob(info, full)
        row = {
            "player_name": full,
            "position": row_pos,
            "team": str(info.get("team") or "") or None,
            "team_abbr": team_abbr or None,
            "sleeper_player_id": str(player_id),
            "search_rank": info.get("search_rank"),
            "last_name_key": ln,
            "full_lower": full_lower,
        }
        idx = len(rows)
        rows.append(row)
        if ln:
            by_last.setdefault(ln, []).append(idx)

    _PLAYERS_SEARCH_ROWS = rows
    _PLAYERS_SEARCH_BY_LAST = by_last
    _PLAYERS_SEARCH_MTIME = cache_mtime if PLAYERS_CACHE.exists() else time.time()
    return rows, by_last


def search_players(
    query: str,
    *,
    position: str | None = None,
    limit: int = 12,
    boost_ids: set[str] | frozenset[str] | None = None,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Search Sleeper NFL players by name (cached player dictionary)."""
    from src.draft_hub.player_name_match import last_name_key, name_key, names_likely_same, norm_name

    q = norm_name(query)
    if len(q) < 2:
        return []

    pos = str(position or "").upper() or None
    if pos in {"DST", "D"}:
        pos = "DEF"

    rows, by_last = _player_search_index(force_refresh=force_refresh)
    if not rows:
        return []

    search_q = _normalize_def_query(q) if pos == "DEF" else q
    ln_q = last_name_key(search_q or q)
    q_lower = (search_q or q).lower()
    boost = {str(x) for x in (boost_ids or [])}
    candidate_idx: list[int] = []
    seen_idx: set[int] = set()

    def add_candidates(indices: list[int]) -> None:
        for idx in indices:
            if idx not in seen_idx:
                seen_idx.add(idx)
                candidate_idx.append(idx)

    if pos == "DEF":
        norm_upper = (search_q or q).upper()
        for idx, row in enumerate(rows):
            if row.get("position") != "DEF":
                continue
            if norm_upper and norm_upper == str(row.get("team_abbr") or "").upper():
                add_candidates([idx])
            elif q_lower and q_lower in row.get("full_lower", ""):
                add_candidates([idx])
            elif ln_q and row.get("last_name_key") == ln_q:
                add_candidates([idx])
    else:
        if ln_q:
            add_candidates(by_last.get(ln_q, []))
        if len(candidate_idx) < limit:
            for idx, row in enumerate(rows):
                if q_lower in row["full_lower"]:
                    add_candidates([idx])
                if len(candidate_idx) >= limit * 4:
                    break

    ranked: list[tuple[int, str, dict[str, Any]]] = []
    for idx in candidate_idx:
        row = rows[idx]
        row_pos = row.get("position")
        if pos == "DEF":
            if row_pos != "DEF":
                continue
        elif pos:
            allowed = {pos}
            if pos == "RB":
                allowed.add("FB")
            if row_pos not in allowed:
                continue

        full = row["player_name"]
        if ln_q and row.get("last_name_key") != ln_q:
            if not names_likely_same(q, full, position=pos, pos_b=row_pos):
                if q_lower not in row["full_lower"]:
                    continue
        elif not names_likely_same(q, full, position=pos, pos_b=row_pos):
            if q_lower not in row["full_lower"]:
                continue

        score = len(full.split()) * 5
        if ln_q and row.get("last_name_key") == ln_q:
            score += 50
        if q_lower in row["full_lower"]:
            score += 25
        if name_key(q) == name_key(full):
            score += 100
        sid = str(row.get("sleeper_player_id") or "")
        if sid in boost:
            score += 40
        sr = row.get("search_rank")
        if sr is not None:
            try:
                score += max(0, 150 - int(sr) // 50)
            except (TypeError, ValueError):
                pass

        ranked.append(
            (
                score,
                row["full_lower"],
                {
                    "player_name": full,
                    "position": row_pos,
                    "team": row.get("team"),
                    "sleeper_player_id": sid or None,
                    "source": "sleeper",
                },
            )
        )

    ranked.sort(key=lambda item: (-item[0], item[1]))
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, _, item in ranked:
        key = item.get("sleeper_player_id") or name_key(item.get("player_name") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def injured_players(force_refresh: bool = False) -> pd.DataFrame:
    df = players_dataframe(force_refresh=force_refresh)
    df = df[df["injury_status"].isin(INJURY_STATUSES)].copy()
    df = df[df["team"].astype(bool)]
    return df.sort_values(["team", "position", "full_name"]).reset_index(drop=True)


def _player_name_from_row(row: pd.Series) -> str:
    for col in ("player_display_name", "player_name", "Player"):
        if col in row.index and pd.notna(row[col]) and str(row[col]).strip():
            return str(row[col]).strip()
    return ""


def _sleeper_positions_for(position: str) -> frozenset[str]:
    key = position.lower()
    if key not in SLEEPER_POSITIONS:
        raise ValueError(f"Unsupported position for Sleeper overlay: {position}")
    return SLEEPER_POSITIONS[key]


def _build_sleeper_lookups(sleeper_df: pd.DataFrame, position: str) -> tuple[dict[str, pd.Series], dict[str, pd.Series]]:
    """Map gsis_id and lowercased full_name to Sleeper rows for one fantasy position."""
    allowed = _sleeper_positions_for(position)
    scoped = sleeper_df[sleeper_df["position"].isin(allowed)].copy()
    by_gsis: dict[str, pd.Series] = {}
    by_name: dict[str, pd.Series] = {}
    for _, row in scoped.iterrows():
        gsis = str(row.get("gsis_id") or "").strip()
        if gsis:
            by_gsis[gsis] = row
        name = str(row.get("full_name") or "").strip().lower()
        if name and name not in by_name:
            by_name[name] = row
    return by_gsis, by_name


def _lookup_sleeper_row(
    row: pd.Series,
    by_gsis: dict[str, pd.Series],
    by_name: dict[str, pd.Series],
) -> Optional[pd.Series]:
    player_id = str(row.get("player_id") or "").strip()
    if player_id and player_id in by_gsis:
        return by_gsis[player_id]
    name = _player_name_from_row(row).lower()
    if name and name in by_name:
        return by_name[name]
    return None


def _usage_column_for_position(position: str) -> str | None:
    pos = str(position or "").lower()
    if pos == "qb":
        return "pass_attmpt_avg"
    if pos == "rb":
        return "carry_share_avg"
    if pos in {"wr", "te", "rec"}:
        return "target_share_avg"
    return None


def _backup_feature_template(
    roster: pd.DataFrame,
    position: str,
) -> tuple[pd.Series, pd.Series]:
    """Build stub features from low-usage veterans, not the full-roster median.

    Using all-player medians inflated rookie usage before the role multiplier.
    Prefer the bottom ~40% by position usage share / attempts when available.
    """
    work = roster.copy()
    if "_rookie_estimate" in work.columns:
        work = work.loc[~work["_rookie_estimate"].fillna(False).astype(bool)]
    work = work.drop(columns=["_rookie_estimate", "_rookie_role_mult", "_rookie_role_label"], errors="ignore")
    if work.empty:
        work = roster.drop(
            columns=["_rookie_estimate", "_rookie_role_mult", "_rookie_role_label"],
            errors="ignore",
        )

    usage_col = _usage_column_for_position(position)
    pool = work
    if usage_col and usage_col in work.columns and len(work) >= 4:
        usage = pd.to_numeric(work[usage_col], errors="coerce")
        ranked = work.assign(_usage=usage).dropna(subset=["_usage"]).sort_values("_usage")
        if len(ranked) >= 3:
            keep_n = max(3, int(round(len(ranked) * 0.4)))
            pool = ranked.head(keep_n).drop(columns=["_usage"])

    numeric = pool.select_dtypes(include="number").columns
    medians = pool[numeric].median(numeric_only=True)
    template = pool.iloc[0].copy()
    for col in numeric:
        template[col] = medians[col]
    return template, medians


def _rookie_stub_from_template(
    template: pd.Series,
    sleeper_row: pd.Series,
    *,
    season: int,
    target_week: int,
    position: str,
    medians: pd.Series | None = None,
) -> pd.Series:
    from src.projections.rookie_role import (
        compute_rookie_role,
        resolve_rookie_skill_position,
        scale_rookie_stub_features,
    )

    skill_pos = resolve_rookie_skill_position(position, sleeper_row)
    stub = template.copy()
    stub["player_display_name"] = sleeper_row["full_name"]
    if "player_name" in stub.index:
        stub["player_name"] = sleeper_row["full_name"]
    stub["team"] = sleeper_row["team"]
    stub["position"] = skill_pos.upper()
    gsis = str(sleeper_row.get("gsis_id") or "").strip()
    stub["player_id"] = gsis or f"sleeper-{sleeper_row['sleeper_id']}"
    stub["season"] = season
    stub["week"] = target_week
    stub["_rookie_estimate"] = True
    dc_raw = sleeper_row.get("depth_chart_order")
    try:
        dc_val = int(dc_raw) if dc_raw is not None and not (isinstance(dc_raw, float) and pd.isna(dc_raw)) else None
    except (TypeError, ValueError):
        dc_val = None
    if dc_val is not None and dc_val > 0:
        stub["_sleeper_depth_order"] = dc_val

    mult, role_label = compute_rookie_role(skill_pos, sleeper_row, season=season)
    stub["_rookie_role_mult"] = mult
    stub["_rookie_role_label"] = role_label
    if medians is not None and mult != 1.0:
        stub = scale_rookie_stub_features(stub, medians, mult)
    return stub


def apply_sleeper_roster_overlay(
    roster_df: pd.DataFrame,
    position: str,
    *,
    season: int | None = None,
    target_week: int = 1,
    sleeper_df: Optional[pd.DataFrame] = None,
    add_rookies: bool = True,
    add_emerging: bool = False,
) -> tuple[pd.DataFrame, dict]:
    """
    Refresh team assignments from Sleeper for upcoming-season draft rosters.

    Updates team when a player changed teams since the feature season.
    Drops players Sleeper marks as free agents or inactive/retired.
    Optionally appends rookie rows (years_exp == 0) using a low-usage backup feature template.
    When ``add_emerging`` is True, also adds 1st–2nd year players missing from the pool.
    """
    if roster_df.empty:
        return roster_df.copy(), {"applied": False, "teams_updated": 0, "removed_unrostered": 0, "rookies_added": 0}

    sleeper_df = sleeper_df if sleeper_df is not None else players_dataframe()
    by_gsis, by_name = _build_sleeper_lookups(sleeper_df, position)

    out = roster_df.copy()
    if "_rookie_estimate" not in out.columns:
        out["_rookie_estimate"] = False
    if "_sleeper_depth_order" not in out.columns:
        out["_sleeper_depth_order"] = pd.NA
    if "_sleeper_search_rank" not in out.columns:
        out["_sleeper_search_rank"] = pd.NA
    if "_sleeper_unlisted" not in out.columns:
        out["_sleeper_unlisted"] = False
    if "_vet_backup_mult" not in out.columns:
        out["_vet_backup_mult"] = 1.0
    if "_vet_backup_label" not in out.columns:
        out["_vet_backup_label"] = ""

    keep_mask: list[bool] = []
    teams_updated = 0
    removed_unrostered = 0
    backups_scaled = 0
    matched_names: set[str] = set()
    matched_ids: set[str] = set()

    for idx, row in out.iterrows():
        sleeper_row = _lookup_sleeper_row(row, by_gsis, by_name)
        if sleeper_row is None:
            keep_mask.append(True)
            continue

        matched_names.add(str(sleeper_row["full_name"]).strip().lower())
        player_id = str(row.get("player_id") or "").strip()
        if player_id:
            matched_ids.add(player_id)

        sleeper_team = str(sleeper_row.get("team") or "").strip().upper()
        sleeper_status = str(sleeper_row.get("status") or "").strip()
        if not sleeper_team or sleeper_status in EXCLUDED_SLEEPER_STATUSES:
            keep_mask.append(False)
            removed_unrostered += 1
            continue

        from src.core.team_codes import normalize_team_to_mlready

        sleeper_team = normalize_team_to_mlready(sleeper_team)
        current_team = normalize_team_to_mlready(str(row.get("team") or "").strip().upper())
        if current_team != sleeper_team:
            out.at[idx, "team"] = sleeper_team
            teams_updated += 1

        dc_val = _optional_positive_int(sleeper_row.get("depth_chart_order"))
        if dc_val is not None:
            out.at[idx, "_sleeper_depth_order"] = dc_val
        elif not bool(row.get("_rookie_estimate", False)):
            out.at[idx, "_sleeper_unlisted"] = True
        search_rank = _optional_int(sleeper_row.get("search_rank"))
        if search_rank is not None:
            out.at[idx, "_sleeper_search_rank"] = search_rank

        # Tag backup role for post-hoc projection scaling. Do not mutate prior-season
        # feature rows here — the GBM is non-linear and under-reacts to feature shrinks.
        if not bool(row.get("_rookie_estimate", False)):
            sleeper_pos = str(sleeper_row.get("position") or position).lower()
            mult, label = sleeper_vet_backup_mult(sleeper_pos, dc_val)
            if mult < 0.999:
                out.at[idx, "_vet_backup_mult"] = mult
                out.at[idx, "_vet_backup_label"] = label
                backups_scaled += 1

        keep_mask.append(True)

    out = out.loc[keep_mask].reset_index(drop=True)

    rookies_added = 0
    emerging_added = 0
    if (add_rookies or add_emerging) and not out.empty:
        allowed = _sleeper_positions_for(position)
        season_val = int(season or out["season"].iloc[0])
        week_val = int(target_week)
        template, medians = _backup_feature_template(out, position)

        extra_rows: list[pd.Series] = []
        if "years_exp" in sleeper_df.columns:
            exp = pd.to_numeric(sleeper_df["years_exp"], errors="coerce").fillna(-1)
            rookie_mask = exp == 0
            emerging_mask = exp.between(1, 2, inclusive="both")
        else:
            rookie_mask = pd.Series(False, index=sleeper_df.index)
            emerging_mask = pd.Series(False, index=sleeper_df.index)

        def _append_candidates(mask: pd.Series, *, mark_rookie: bool) -> None:
            nonlocal rookies_added, emerging_added
            candidates = sleeper_df[
                sleeper_df["position"].isin(allowed)
                & sleeper_df["team"].astype(str).str.strip().astype(bool)
                & (~sleeper_df["status"].fillna("").isin(EXCLUDED_SLEEPER_STATUSES))
                & mask
            ]
            for _, sleeper_row in candidates.iterrows():
                name_key = str(sleeper_row["full_name"]).strip().lower()
                gsis = str(sleeper_row.get("gsis_id") or "").strip()
                if name_key in matched_names:
                    continue
                if gsis and gsis in matched_ids:
                    continue
                stub = _rookie_stub_from_template(
                    template,
                    sleeper_row,
                    season=season_val,
                    target_week=week_val,
                    position=position,
                    medians=medians,
                )
                if not mark_rookie:
                    stub["_rookie_estimate"] = False
                extra_rows.append(stub)
                matched_names.add(name_key)
                if mark_rookie:
                    rookies_added += 1
                else:
                    emerging_added += 1

        if add_rookies:
            _append_candidates(rookie_mask, mark_rookie=True)
        if add_emerging:
            _append_candidates(emerging_mask, mark_rookie=False)

        if extra_rows:
            out = pd.concat([out, pd.DataFrame(extra_rows)], ignore_index=True)
            if "_sleeper_unlisted" in out.columns:
                out["_sleeper_unlisted"] = out["_sleeper_unlisted"].fillna(False)

    out, unlisted_scaled = apply_unlisted_vet_backup_scale(out, position)
    backups_scaled += unlisted_scaled

    stats = {
        "applied": True,
        "teams_updated": teams_updated,
        "removed_unrostered": removed_unrostered,
        "rookies_added": rookies_added,
        "emerging_added": emerging_added,
        "backups_scaled": backups_scaled,
    }
    return out, stats


def match_player_to_sleeper(
    name: str,
    team: str,
    position: str,
    sleeper_df: Optional[pd.DataFrame] = None,
) -> Optional[pd.Series]:
    sleeper_df = sleeper_df if sleeper_df is not None else players_dataframe()
    if not name:
        return None

    pos_map = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
    pos = pos_map.get(position.upper(), position.upper())

    candidates = sleeper_df[
        (sleeper_df["team"] == team) & (sleeper_df["position"] == pos)
    ]
    exact = candidates[candidates["full_name"].str.lower() == name.lower()]
    if not exact.empty:
        return exact.iloc[0]

    last = name.split()[-1].lower() if " " in name else name.lower()
    fuzzy = candidates[candidates["last_name"].str.lower() == last]
    if len(fuzzy) == 1:
        return fuzzy.iloc[0]
    return None


SLEEPER_DRAFT_API = "https://api.sleeper.app/v1/draft"


def fetch_sleeper_draft(draft_id: str) -> dict:
    return _fetch_json(f"{SLEEPER_DRAFT_API}/{draft_id}")


def _sleeper_roster_owner_map(league_id: str, owner_map: dict[str, str]) -> dict[int, str]:
    """Map Sleeper roster_id -> commissioner owner_label via hub team names."""
    rosters = _fetch_json(f"https://api.sleeper.app/v1/league/{league_id}/rosters")
    users = _fetch_json(f"https://api.sleeper.app/v1/league/{league_id}/users")
    user_by_id = {u["user_id"]: u for u in users}
    hub_to_owner = {v.lower(): k for k, v in owner_map.items()}
    roster_owner: dict[int, str] = {}
    for roster in rosters:
        rid = int(roster.get("roster_id") or 0)
        user = user_by_id.get(roster.get("owner_id")) or {}
        team = str(user.get("metadata", {}).get("team_name") or user.get("display_name") or "")
        owner = hub_to_owner.get(team.lower())
        if not owner:
            for hub_name, owner_label in owner_map.items():
                if team and (team.lower() in hub_name.lower() or hub_name.lower() in team.lower()):
                    owner = owner_label
                    break
        if owner:
            roster_owner[rid] = owner
    return roster_owner


def fetch_sleeper_draft_picks(draft_id: str) -> list[dict[str, Any]]:
    """Auction picks with commissioner owner_label and cap_hit."""
    draft = fetch_sleeper_draft(draft_id)
    picks_raw = _fetch_json(f"{SLEEPER_DRAFT_API}/{draft_id}/picks")
    from src.draft_hub.legacy_contract_import import load_owner_team_map

    owner_map = load_owner_team_map()
    league_id = str(draft.get("league_id") or "")
    roster_map = _sleeper_roster_owner_map(league_id, owner_map) if league_id else {}
    season = int(draft.get("season") or 2021)
    out: list[dict[str, Any]] = []
    for pick in picks_raw:
        meta = pick.get("metadata") or {}
        first = str(meta.get("first_name") or "").strip()
        last = str(meta.get("last_name") or "").strip()
        player_name = f"{first} {last}".strip()
        if not player_name:
            continue
        try:
            cap = float(meta.get("amount") or 0)
        except (TypeError, ValueError):
            cap = None
        roster_id = int(pick.get("roster_id") or 0)
        owner = roster_map.get(roster_id)
        if not owner:
            continue
        pos = str(meta.get("position") or "").upper()
        if pos == "D":
            pos = "DEF"
        out.append(
            {
                "season_year": season,
                "player_name": player_name,
                "owner_label": owner,
                "cap_hit": cap,
                "position": pos or None,
                "source": "sleeper",
            }
        )
    return out
