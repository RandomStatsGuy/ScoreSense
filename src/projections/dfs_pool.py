"""Materialized, deep DFS-only pool; requests never fit models or fetch feeds."""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd

from src.config import DFS_PREDICTIONS_DIR, MODEL_DIR
from src.core.opportunity import OPPORTUNITY_ADJUSTMENT_COL, OPPORTUNITY_ADJUSTMENT_LEGACY_COL
from src.core.team_codes import normalize_team_for_match
from src.projections.dfs_special_teams import VERSION, QUANTILES, features_before, predict_heads

POOL_VERSION = "dfs-deep-pool-v1"
BUNDLE_PATH = MODEL_DIR / "dfs_special_teams.joblib"


def pool_fingerprint():
    from src.projections.weekly_cache import weekly_fingerprint
    revision = BUNDLE_PATH.stat().st_mtime_ns if BUNDLE_PATH.exists() else None
    return f"{POOL_VERSION}:{weekly_fingerprint()}:{revision}"


def artifact_path(season, week, injury=True):
    return DFS_PREDICTIONS_DIR / f"{season}_w{week}_{'inj' if injury else 'raw'}.parquet"


def load_dfs_pool(season, week, injury=True):
    path = artifact_path(season, week, injury)
    if not path.exists():
        return pd.DataFrame()
    try:
        frame = pd.read_parquet(path)
    except (OSError, ValueError):
        return pd.DataFrame()
    if frame.attrs.get("pool_version") != POOL_VERSION:
        return pd.DataFrame()
    if frame.attrs.get("season") != season or frame.attrs.get("week") != week:
        return pd.DataFrame()
    frame.attrs["projection_stale"] = (
        frame.attrs.get("fingerprint") != pool_fingerprint()
        or bool(frame.attrs.get("special_history_refresh_failed"))
        or (week > 1 and frame.attrs.get("special_history_current_season_available") is False)
    )
    return frame


def starting_kickers(roster):
    kickers = roster[roster.position.eq("K") & roster.team.fillna("").ne("") & roster.status.eq("Active")].copy()
    kickers = kickers[~kickers.injury_status.fillna("").str.lower().isin(["out", "ir", "pup", "inactive", "suspended"])]
    selected = []
    for _, group in kickers.groupby("team"):
        first = group[pd.to_numeric(group.depth_chart_order, errors="coerce").eq(1)]
        if len(first) == 1:
            selected.append(first.iloc[0])
        elif len(first) == 0 and len(group) == 1:
            selected.append(group.iloc[0])
    return pd.DataFrame(selected, columns=roster.columns)


def special_team_predictions(history, matchups, roster, season, week, bundle):
    if bundle.get("version") != VERSION or not bundle.get("gate", {}).get("positions", {}).get("DST", {}).get("passed"):
        raise ValueError("Defense model has not passed its walk-forward gate")
    if season <= bundle["trained_through_season"]:
        # Never use a fitted future model for a historical slate.
        return pd.DataFrame()
    prior = history[(history.season < season) | ((history.season == season) & (history.week < week))]
    recent = prior[prior.season >= season - 3]
    if len(recent) < 400:
        raise ValueError("Insufficient prior special-teams history")
    kicker_quantiles = recent.K.quantile(QUANTILES).to_numpy()
    kickers = starting_kickers(roster)
    matchups = {normalize_team_for_match(k): normalize_team_for_match(v) for k, v in matchups.items()}
    rows = []
    for team, opponent in matchups.items():
        x = np.asarray([features_before(prior, team, opponent, season, week, "DST")])
        if not np.isfinite(x).all():
            continue
        q = predict_heads(bundle["heads"], x)[0]
        rows.append({"player_id": f"dst:{team}", "Player": f"{team} DST", "Team": team, "Position": "DST",
                     "Opponent": opponent, "Low (P10)": q[0], "Projected Points": q[1], "High (P90)": q[2],
                     "projection_source": "ScoreSense", "projection_model": VERSION, "projection_site": "draftkings",
                     "Injury Status": "", "on_bye": False})
    for r in kickers.to_dict("records"):
        team = normalize_team_for_match(r["team"])
        if team not in matchups:
            continue
        gsis = r.get("gsis_id")
        pid = (str(gsis).strip() if pd.notna(gsis) else "") or f"sleeper-{r['sleeper_id']}"
        rows.append({"player_id": pid, "Player": r["full_name"], "Team": team, "Position": "K",
                     "Opponent": matchups[team], "Low (P10)": kicker_quantiles[0], "Projected Points": kicker_quantiles[1],
                     "High (P90)": kicker_quantiles[2], "projection_source": "Historical estimate",
                     "projection_model": "kicker-empirical-v1", "projection_site": "dk_fd_kicking",
                     "Injury Status": r.get("injury_status") or "", "on_bye": False})
    return pd.DataFrame(rows)


def refresh_dfs_pool(season, week, *, skill_predictions: Mapping[bool, Mapping[str, pd.DataFrame]] | None = None):
    """Publish both variants, optionally reusing this refresh's weekly inference.

    Weekly coverage and DFS use the same full inference roster. Supplied frames
    must be fresh, complete and for this context; never fill gaps with an old
    artifact or repeat inference after a failed weekly refresh.
    """
    from src.projections.predict import predict_upcoming_week
    from src.integrations.sleeper import players_dataframe
    from src.core.schedule_utils import week_matchups
    from src.jobs.dfs_special_history import refresh_special_history

    if skill_predictions is not None:
        for injury in (True, False):
            for pos in ("qb", "rb", "wr"):
                frame = skill_predictions.get(injury, {}).get(pos)
                if frame is None or frame.empty:
                    raise ValueError("Incomplete DFS skill-position output")
                if (frame.attrs.get("projection_stale")
                    or frame.attrs.get("inference_meta", {}).get("depth_mode") not in {"coverage", "dfs"}
                    or any(col not in frame or not frame[col].eq(value).all()
                           for col, value in (("Season", int(season)), ("Week", int(week))))):
                    raise ValueError("DFS skill predictions must be fresh full-roster forecasts for this context")

    bundle = joblib.load(BUNDLE_PATH)
    history = refresh_special_history(season, bundle["history"])
    roster = players_dataframe()
    special = special_team_predictions(history, week_matchups(season, week), roster, season, week, bundle)
    if special.empty:
        raise ValueError("No special-teams predictions for requested context")
    outputs = []
    for injury in (True, False):
        frames = ([skill_predictions[injury][pos] for pos in ("qb", "rb", "wr")]
                  if skill_predictions is not None else
                  [predict_upcoming_week(pos, season=season, week=week, apply_injury_adjustments=injury, depth_mode="dfs")
                   for pos in ("qb", "rb", "wr")])
        if skill_predictions is not None and not injury:
            # The weekly reader adds zero-valued compatibility columns; keep
            # the existing DFS raw schema, which has no opportunity adjustment.
            frames = [frame.drop(columns=[OPPORTUNITY_ADJUSTMENT_COL, OPPORTUNITY_ADJUSTMENT_LEGACY_COL],
                                 errors="ignore") for frame in frames]
        if any(f.empty for f in frames):
            raise ValueError("Incomplete DFS skill-position output")
        out = pd.concat([*frames, special], ignore_index=True)
        out = pd.concat([out, unavailable_roster_rows(roster, out)], ignore_index=True)
        out.attrs = {"pool_version": POOL_VERSION, "season": int(season), "week": int(week),
                     "built_at": datetime.now(timezone.utc).isoformat(), "special_history_last_season": int(history.season.max()),
                     "special_history_last_week": int(history.loc[history.season.eq(history.season.max()), "week"].max()) if "week" in history else None,
                     "special_history_current_season_available": bool(history.attrs.get("current_season_available", False))}
        out.attrs['special_history_refresh_failed'] = bool(history.attrs.get('input_refresh_failed', False))
        out.attrs["fingerprint"] = pool_fingerprint()
        if out.player_id.duplicated().any():
            raise ValueError("Duplicate identities in DFS projection pool")
        outputs.append((injury, out))
    DFS_PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    for injury, out in outputs:
        path = artifact_path(season, week, injury)
        temp = path.with_name(path.name + f".{uuid4().hex}.tmp")
        try:
            out.to_parquet(temp, index=False)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)
    return {"rows": len(outputs[0][1]), **outputs[0][1].attrs,
            "historical_inputs_only": week > 1 and not history.attrs.get("current_season_available", False)}


def unavailable_roster_rows(roster, existing):
    from src.draft_hub.player_name_match import roster_name_key
    keys = {(roster_name_key(r.Player), normalize_team_for_match(r.Team)) for r in existing.itertuples()}
    rows = []
    for r in roster.to_dict("records"):
        team = normalize_team_for_match(r.get("team") or "")
        pos = r.get("position")
        if not team or pos not in {"QB", "RB", "FB", "WR", "TE"}:
            continue
        injury = str(r.get("injury_status") or "")
        if r.get("status") != "Inactive" and injury.lower() not in {"out", "ir", "pup", "inactive", "suspended"}:
            continue
        key = (roster_name_key(r["full_name"]), team)
        if key in keys:
            continue
        keys.add(key)
        rows.append({"player_id": str(r.get("gsis_id") or "") or f"sleeper-{r['sleeper_id']}",
                     "Player": r["full_name"], "Team": team, "Position": pos,
                     "Projected Points": np.nan, "Low (P10)": np.nan, "High (P90)": np.nan,
                     "projection_source": "Unavailable", "Injury Status": injury or "Inactive"})
    return pd.DataFrame(rows)
