"""Incremental injury overlays + team-scoped recompute (SCORE-31).

Storage model (separate from final baked projections):

* baseline — weekly ``_no_inj`` P50
* availability_adjustment — own-status points delta (0 while projections
  assume active; status fields still stamped on the overlay)
* opportunity_adjustment — teammate vacancy points delta
* final_delta / multiplier — composed overlay
* driver_player_ids — injured teammates driving opportunity
* injury_snapshot_id — snapshot version stamp

Recompute only teams whose *material* injury state changed. Punctuation-only
note noise is ignored; rapid updates are debounced.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from src.config import (
    INJURY_OVERLAY_DEBOUNCE_SECONDS,
    INJURY_OVERLAYS_DIR,
    PROCESSED_DATA_DIR,
)
from src.core.opportunity import (
    STATUS_WEIGHT,
    compute_vacated_usage,
)
from src.integrations.injury_snapshot import (
    build_injury_snapshot,
    diff_injury_snapshots,
    index_availability_by_player_id,
    injured_frame_from_snapshot,
    load_injury_snapshot,
    name_to_player_ids,
    save_injury_snapshot,
)
from src.projections.player_context import parse_opportunity_drivers
from src.projections.weekly_cache import load_weekly_prediction

SCHEMA_VERSION = "injury_overlay_v1"
POSITIONS = ("qb", "rb", "wr")
_P50_KEYS = ("Projected Points", "P50", "p50")
_MAX_OPP_BOOST = 0.35

_OVERLAY_CACHE: dict[str, tuple[str, pd.DataFrame, dict[str, Any]]] = {}


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.bool_,)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _pick_num(row: dict[str, Any] | pd.Series, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        if isinstance(row, dict):
            if key not in row:
                continue
            value = row[key]
        else:
            if key not in row.index:
                continue
            value = row[key]
        num = _json_safe(value)
        if isinstance(num, (int, float)):
            return float(num)
    return None


def _artifact_paths(season: int, week: int) -> tuple[Path, Path]:
    INJURY_OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"{int(season)}_w{int(week)}"
    return (
        INJURY_OVERLAYS_DIR / f"{stem}.parquet",
        INJURY_OVERLAYS_DIR / f"{stem}.meta.json",
    )


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _within_debounce(meta: dict[str, Any] | None, *, now: datetime | None = None) -> bool:
    if not meta:
        return False
    last = _parse_iso(meta.get("last_recompute_at") or meta.get("built_at"))
    if last is None:
        return False
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    elapsed = (now - last).total_seconds()
    return elapsed < float(INJURY_OVERLAY_DEBOUNCE_SECONDS)


def invalidate_injury_overlay_cache() -> None:
    _OVERLAY_CACHE.clear()


def load_injury_overlay_artifact(
    season: int,
    week: int,
) -> tuple[pd.DataFrame, dict[str, Any]] | None:
    """Load overlay parquet + meta if present."""
    key = f"{int(season)}:w{int(week)}"
    parquet_path, meta_path = _artifact_paths(season, week)
    if not parquet_path.exists() or not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    fp = str(meta.get("injury_snapshot_id") or meta.get("fingerprint") or "")
    cached = _OVERLAY_CACHE.get(key)
    if cached and cached[0] == fp:
        return cached[1], cached[2]
    frame = pd.read_parquet(parquet_path)
    _OVERLAY_CACHE[key] = (fp, frame, meta)
    return frame, meta


def save_injury_overlay_artifact(
    season: int,
    week: int,
    frame: pd.DataFrame,
    meta: dict[str, Any],
) -> Path:
    """Persist overlay rows + meta sidecar."""
    parquet_path, meta_path = _artifact_paths(season, week)
    INJURY_OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)
    out = frame.copy()
    if "driver_player_ids" in out.columns:
        out["driver_player_ids"] = out["driver_player_ids"].map(
            lambda v: json.dumps(v, default=str) if not isinstance(v, str) else v
        )
    out.to_parquet(parquet_path, index=False)
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    fp = str(meta.get("injury_snapshot_id") or meta.get("fingerprint") or "")
    _OVERLAY_CACHE[f"{int(season)}:w{int(week)}"] = (fp, frame.copy(), meta)
    return parquet_path


def _load_baseline_frame(season: int, week: int) -> pd.DataFrame:
    """Load weekly baseline (``_no_inj``) projections — no live compute."""
    frames: list[pd.DataFrame] = []
    for pos in POSITIONS:
        base = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=False,
            allow_compute=False,
        )
        if base is not None and not base.empty:
            frames.append(base)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _load_roster_features(
    season: int,
    week: int,
    teams: set[str] | None = None,
    *,
    data_dir: Path | None = None,
) -> pd.DataFrame:
    """Load mlready feature rows for opportunity allocation (team-scoped)."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    frames: list[pd.DataFrame] = []
    teams_upper = {t.upper() for t in teams} if teams else None
    for pos in POSITIONS:
        path = data_dir / f"{pos}_mlready.parquet"
        if not path.exists():
            path = data_dir / f"{pos}_mlready.csv"
        if not path.exists():
            continue
        df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
        if "season" in df.columns:
            df = df[df["season"].astype(int) == int(season)]
        if "week" in df.columns:
            df = df[df["week"].astype(int) == int(week)]
        if teams_upper is not None and "team" in df.columns:
            df = df[df["team"].astype(str).str.upper().isin(teams_upper)]
        if df.empty:
            continue
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _availability_adjustment_points(
    *,
    baseline: float,
    status: str | None,
) -> float:
    """Own-status points delta.

    Projections currently assume active (product rule), so this stays 0.0.
    The field is stored so availability and opportunity remain separable.
    """
    _ = (baseline, status, STATUS_WEIGHT)
    return 0.0


def build_overlays_for_teams(
    season: int,
    week: int,
    teams: set[str] | list[str],
    *,
    injury_snapshot: dict[str, Any],
    baseline_df: pd.DataFrame | None = None,
    roster_df: pd.DataFrame | None = None,
) -> list[dict[str, Any]]:
    """Build overlay rows for the given teams from baseline + snapshot."""
    teams_upper = {str(t).upper() for t in teams if str(t).strip()}
    if not teams_upper:
        return []

    if baseline_df is None:
        baseline_df = _load_baseline_frame(season, week)
    if baseline_df is None or baseline_df.empty:
        raise FileNotFoundError(
            f"Baseline weekly predictions missing for {season} week {week}. "
            "Run weekly/preseason refresh before building injury overlays."
        )

    base = baseline_df.copy()
    if "Team" in base.columns and "team" not in base.columns:
        base["team"] = base["Team"]
    if "team" in base.columns:
        base = base[base["team"].astype(str).str.upper().isin(teams_upper)].copy()
    if base.empty:
        return []

    if roster_df is None:
        roster_df = _load_roster_features(season, week, teams_upper)
    injured_df = injured_frame_from_snapshot(injury_snapshot)

    # Opportunity math needs share columns; fall back to baseline-only zeros.
    boost_by_name: dict[str, float] = {}
    note_by_name: dict[str, str] = {}
    if roster_df is not None and not roster_df.empty:
        roster = roster_df.copy()
        if "team" in roster.columns:
            roster = roster[roster["team"].astype(str).str.upper().isin(teams_upper)]
        if not roster.empty:
            boosted = compute_vacated_usage(roster, injured_df=injured_df)
            name_col = (
                "player_display_name"
                if "player_display_name" in boosted.columns
                else (
                    "player_name"
                    if "player_name" in boosted.columns
                    else ("Player" if "Player" in boosted.columns else None)
                )
            )
            if name_col:
                for _, row in boosted.iterrows():
                    name = str(row.get(name_col) or "").strip()
                    if not name:
                        continue
                    boost_by_name[name.lower()] = float(
                        row.get("injury_opportunity_boost") or 0.0
                    )
                    note_by_name[name.lower()] = str(row.get("injury_note") or "")

    avail_index = index_availability_by_player_id(injury_snapshot)
    name_index = name_to_player_ids(injury_snapshot)
    snapshot_id = str(injury_snapshot["injury_snapshot_id"])
    built_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []

    for _, prow in base.iterrows():
        pid = str(prow.get("player_id") or "").strip()
        if not pid:
            continue
        player_name = str(prow.get("Player") or prow.get("player_display_name") or "")
        team = str(prow.get("team") or prow.get("Team") or "").upper() or None
        position = str(prow.get("Position") or prow.get("position") or "").upper() or None
        baseline = _pick_num(prow, _P50_KEYS)
        if baseline is None:
            continue

        boost = float(boost_by_name.get(player_name.lower(), 0.0))
        note = note_by_name.get(player_name.lower(), "")
        multiplier = 1.0 + max(0.0, min(float(boost), _MAX_OPP_BOOST))
        opportunity_points = round(float(baseline) * (multiplier - 1.0), 4)

        avail = avail_index.get(pid) or {
            "status": None,
            "practice": None,
            "updated_at": None,
        }
        status = avail.get("status")
        availability_points = _availability_adjustment_points(
            baseline=float(baseline),
            status=str(status) if status else None,
        )
        final_delta = round(float(availability_points) + float(opportunity_points), 4)
        drivers = parse_opportunity_drivers(note, name_index=name_index)

        rows.append(
            {
                "player_id": pid,
                "player_name": player_name or None,
                "position": position,
                "team": team,
                "baseline": round(float(baseline), 4),
                "availability_adjustment": round(float(availability_points), 4),
                "opportunity_adjustment": round(float(opportunity_points), 4),
                "final_delta": final_delta,
                "multiplier": round(float(multiplier), 6),
                "final": round(float(baseline) + final_delta, 4),
                "driver_player_ids": drivers,
                "injury_snapshot_id": snapshot_id,
                "availability_status": status,
                "availability_practice": avail.get("practice"),
                "availability_updated_at": avail.get("updated_at"),
                "injury_note": note or None,
                "season": int(season),
                "week": int(week),
                "overlay_built_at": built_at,
                "schema_version": SCHEMA_VERSION,
            }
        )

    return rows


def _rows_to_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(
            columns=[
                "player_id",
                "player_name",
                "position",
                "team",
                "baseline",
                "availability_adjustment",
                "opportunity_adjustment",
                "final_delta",
                "multiplier",
                "final",
                "driver_player_ids",
                "injury_snapshot_id",
                "availability_status",
                "availability_practice",
                "availability_updated_at",
                "injury_note",
                "season",
                "week",
                "overlay_built_at",
                "schema_version",
            ]
        )
    frame = pd.DataFrame(rows)
    # Keep driver_player_ids as list objects in-memory; serialize on save.
    return frame


def _merge_overlay_frames(
    existing: pd.DataFrame | None,
    updated: pd.DataFrame,
    teams: set[str],
) -> pd.DataFrame:
    teams_upper = {t.upper() for t in teams}
    if existing is None or existing.empty:
        return updated.copy()
    keep = existing.copy()
    if "team" in keep.columns:
        keep = keep[~keep["team"].astype(str).str.upper().isin(teams_upper)]
    else:
        keep = keep.iloc[0:0]
    if updated.empty:
        return keep.reset_index(drop=True)
    # Deserialize drivers on existing for consistent in-memory type.
    if "driver_player_ids" in keep.columns:
        keep = keep.copy()
        keep["driver_player_ids"] = keep["driver_player_ids"].map(_parse_drivers_cell)
    merged = pd.concat([keep, updated], ignore_index=True)
    if "player_id" in merged.columns:
        merged = merged.drop_duplicates(subset=["player_id"], keep="last")
    return merged.reset_index(drop=True)


def _parse_drivers_cell(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except json.JSONDecodeError:
            return [text]
    return []


def recompute_injury_overlays(
    season: int,
    week: int,
    *,
    force: bool = False,
    force_injury_refresh: bool = False,
    players: dict[str, Any] | None = None,
    teams: set[str] | list[str] | None = None,
    baseline_df: pd.DataFrame | None = None,
    roster_df: pd.DataFrame | None = None,
    previous_snapshot: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Diff injury snapshot → recompute overlays for changed teams only."""
    now = now or datetime.now(timezone.utc)
    previous = previous_snapshot
    if previous is None:
        previous = load_injury_snapshot(season, week)

    current = build_injury_snapshot(
        season=season,
        week=week,
        force_refresh=force_injury_refresh,
        players=players,
    )
    save_injury_snapshot(current)

    existing_art = load_injury_overlay_artifact(season, week)
    existing_frame = existing_art[0] if existing_art else None
    existing_meta = existing_art[1] if existing_art else {}

    if teams is not None:
        changed_teams = sorted({str(t).upper() for t in teams if str(t).strip()})
        diff = {
            "changed_teams": changed_teams,
            "unchanged_teams": [],
            "material_change": bool(changed_teams),
            "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
            "current_snapshot_id": current.get("injury_snapshot_id"),
            "forced_teams": True,
        }
    else:
        diff = diff_injury_snapshots(previous, current)
        # First build: no prior overlay → recompute all teams present in snapshot.
        if existing_frame is None and not diff["changed_teams"]:
            from_snap = {
                str(r.get("team")).upper()
                for r in (current.get("players") or [])
                if r.get("team")
            }
            if baseline_df is None:
                baseline_df = _load_baseline_frame(season, week)
            if baseline_df is not None and not baseline_df.empty:
                team_col = "team" if "team" in baseline_df.columns else "Team"
                if team_col in baseline_df.columns:
                    from_snap |= {
                        str(t).upper()
                        for t in baseline_df[team_col].dropna().unique()
                        if str(t).strip()
                    }
            diff = {
                **diff,
                "changed_teams": sorted(from_snap),
                "material_change": bool(from_snap),
                "full_rebuild": True,
            }

    changed = list(diff.get("changed_teams") or [])
    if not changed:
        return {
            "status": "skipped",
            "reason": "no_material_change",
            "season": int(season),
            "week": int(week),
            "injury_snapshot_id": current.get("injury_snapshot_id"),
            "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
            "changed_teams": [],
            "recomputed_players": 0,
            "debounced": False,
            "diff": diff,
        }

    if not force and _within_debounce(existing_meta, now=now):
        return {
            "status": "debounced",
            "reason": "within_debounce_window",
            "debounce_seconds": int(INJURY_OVERLAY_DEBOUNCE_SECONDS),
            "season": int(season),
            "week": int(week),
            "injury_snapshot_id": current.get("injury_snapshot_id"),
            "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
            "changed_teams": changed,
            "pending_teams": changed,
            "recomputed_players": 0,
            "debounced": True,
            "last_recompute_at": existing_meta.get("last_recompute_at"),
            "diff": diff,
        }

    rows = build_overlays_for_teams(
        season,
        week,
        changed,
        injury_snapshot=current,
        baseline_df=baseline_df,
        roster_df=roster_df,
    )
    updated = _rows_to_frame(rows)
    merged = _merge_overlay_frames(existing_frame, updated, set(changed))

    # Clear overlays for players on changed teams who no longer appear (healed).
    # merge already dropped old team rows then added updated; good.

    built_at = now.isoformat()
    meta = {
        "season": int(season),
        "week": int(week),
        "schema_version": SCHEMA_VERSION,
        "injury_snapshot_id": current.get("injury_snapshot_id"),
        "injury_snapshot_built_at": current.get("built_at"),
        "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
        "built_at": built_at,
        "last_recompute_at": built_at,
        "changed_teams": changed,
        "rows": int(len(merged)),
        "recomputed_players": int(len(updated)),
        "debounce_seconds": int(INJURY_OVERLAY_DEBOUNCE_SECONDS),
        "fingerprint": current.get("injury_snapshot_id"),
    }
    path = save_injury_overlay_artifact(season, week, merged, meta)
    return {
        "status": "ok",
        "season": int(season),
        "week": int(week),
        "path": str(path),
        "injury_snapshot_id": current.get("injury_snapshot_id"),
        "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
        "changed_teams": changed,
        "recomputed_players": int(len(updated)),
        "rows": int(len(merged)),
        "debounced": False,
        "built_at": built_at,
        "diff": diff,
    }


def prewarm_injury_overlays(
    season: int,
    week: int,
    *,
    force: bool = True,
    force_injury_refresh: bool = False,
) -> dict[str, Any]:
    """Job helper: full (or forced) overlay materialization for a slate."""
    return recompute_injury_overlays(
        season,
        week,
        force=force,
        force_injury_refresh=force_injury_refresh,
    )


def _frame_to_payloads(frame: pd.DataFrame) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        payloads.append(overlay_row_to_payload(row))
    return payloads


def overlay_row_to_payload(row: pd.Series | dict[str, Any]) -> dict[str, Any]:
    getter = row.get if hasattr(row, "get") else None

    def g(key: str, default: Any = None) -> Any:
        if getter is not None:
            return getter(key, default)
        try:
            return row[key]  # type: ignore[index]
        except Exception:
            return default

    drivers = _parse_drivers_cell(g("driver_player_ids"))
    baseline = _json_safe(g("baseline"))
    availability_adj = _json_safe(g("availability_adjustment")) or 0.0
    opportunity_adj = _json_safe(g("opportunity_adjustment")) or 0.0
    final_delta = _json_safe(g("final_delta"))
    if final_delta is None:
        final_delta = round(float(availability_adj) + float(opportunity_adj), 4)
    final = _json_safe(g("final"))
    if final is None and baseline is not None:
        final = round(float(baseline) + float(final_delta), 4)
    return {
        "player_id": str(g("player_id")),
        "player_name": g("player_name"),
        "position": g("position"),
        "team": g("team"),
        "baseline": baseline,
        "availability_adjustment": availability_adj,
        "opportunity_adjustment": opportunity_adj,
        "final_delta": final_delta,
        "multiplier": _json_safe(g("multiplier")),
        "final": final,
        "driver_player_ids": drivers,
        "injury_snapshot_id": g("injury_snapshot_id"),
        "availability": {
            "status": g("availability_status"),
            "practice": g("availability_practice"),
            "updated_at": g("availability_updated_at"),
        },
        "injury_note": g("injury_note"),
        "meta": {
            "season": _json_safe(g("season")),
            "week": _json_safe(g("week")),
            "overlay_built_at": g("overlay_built_at"),
            "schema_version": g("schema_version") or SCHEMA_VERSION,
        },
    }


def list_injury_overlays(
    season: int,
    week: int,
    *,
    teams: list[str] | None = None,
    player_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Serve-only list of injury overlays for a slate."""
    art = load_injury_overlay_artifact(season, week)
    if art is None:
        raise FileNotFoundError(
            f"Injury overlay artifact missing for {season} week {week}. "
            "Run injury overlay recompute / weekly refresh."
        )
    frame, meta = art
    view = frame
    if teams:
        teams_upper = {t.strip().upper() for t in teams if t.strip()}
        if teams_upper and "team" in view.columns:
            view = view[view["team"].astype(str).str.upper().isin(teams_upper)]
    if player_ids:
        ids = {p.strip() for p in player_ids if p.strip()}
        if ids and "player_id" in view.columns:
            view = view[view["player_id"].astype(str).isin(ids)]
    players = _frame_to_payloads(view)
    return {
        "season": int(season),
        "week": int(week),
        "count": len(players),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "built_at": meta.get("built_at"),
        "last_recompute_at": meta.get("last_recompute_at"),
        "changed_teams": meta.get("changed_teams") or [],
        "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
        "players": players,
    }


def get_injury_overlay(
    player_id: str,
    season: int,
    week: int,
) -> dict[str, Any]:
    """Serve-only single-player injury overlay."""
    payload = list_injury_overlays(season, week, player_ids=[str(player_id)])
    players = payload.get("players") or []
    if not players:
        raise ValueError(f"No injury overlay for player_id={player_id}")
    return {
        **players[0],
        "injury_snapshot_id": payload.get("injury_snapshot_id"),
        "slate": {
            "season": payload.get("season"),
            "week": payload.get("week"),
            "built_at": payload.get("built_at"),
            "schema_version": payload.get("schema_version"),
        },
    }


def apply_overlay_to_baseline_points(
    baseline: float,
    overlay: dict[str, Any] | None,
) -> float:
    """Compose final points from baseline + stored overlay (no bake-in)."""
    if not overlay:
        return float(baseline)
    if overlay.get("final") is not None:
        return float(overlay["final"])
    delta = overlay.get("final_delta")
    if delta is None:
        avail = float(overlay.get("availability_adjustment") or 0.0)
        opp = float(overlay.get("opportunity_adjustment") or 0.0)
        delta = avail + opp
    return float(baseline) + float(delta)


def apply_overlay_to_quantiles(
    p10: float,
    p50: float,
    p90: float,
    overlay: dict[str, Any] | None,
) -> tuple[float, float, float]:
    """Apply an injury overlay to a P10/P50/P90 triplet (SCORE-50).

    Moves all three by the same delta implied by the overlay's P50 shift, then
    repairs order while keeping the overlay-adjusted P50 fixed.
    """
    from src.ml.quantile import repair_quantile_arrays

    new_p50 = apply_overlay_to_baseline_points(p50, overlay)
    delta = float(new_p50) - float(p50)
    q10, q50, q90 = repair_quantile_arrays(
        np.asarray([float(p10) + delta], dtype=float),
        np.asarray([float(new_p50)], dtype=float),
        np.asarray([float(p90) + delta], dtype=float),
    )
    return float(q10[0]), float(q50[0]), float(q90[0])
