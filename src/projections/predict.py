"""Unified prediction interface with quantile intervals and injury adjustments."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import pandas as pd

from src.config import (
    MODEL_DIR,
    PREDICTIONS_DIR,
    PROCESSED_DATA_DIR,
    RB_CALIBRATED_MODEL_BUNDLE,
    WR_CALIBRATED_MODEL_BUNDLE,
)
from src.core.features import prepare_feature_matrix
from src.ml.quantile import predict_quantiles
from src.integrations.sleeper import injured_players
from src.core.opportunity import compute_vacated_usage
from src.core.projection_context import (
    build_inference_roster,
    resolve_projection_context,
)
from src.core.schedule_utils import attach_schedule_context

_MODEL_CACHE: dict[str, tuple[float, dict]] = {}


def _normalize_position(position: str) -> str:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        return "wr"
    return key


def load_model(position: str, model_dir: Path | None = None) -> dict:
    """
    Load production quantile model bundle.

    WR uses the P90-calibrated artifact; RB uses rb_model_calibrated.joblib; QB baseline.
    Rollback by reverting bundle paths in this router.
    """
    model_dir = model_dir or MODEL_DIR
    pos = _normalize_position(position)

    calibrated_bundles = {
        "wr": WR_CALIBRATED_MODEL_BUNDLE,
        "rb": RB_CALIBRATED_MODEL_BUNDLE,
    }
    if pos in calibrated_bundles:
        path = model_dir / calibrated_bundles[pos]
    else:
        path = model_dir / f"{pos}_model.joblib"

    if not path.exists():
        if pos in calibrated_bundles:
            raise FileNotFoundError(
                f"Calibrated {pos.upper()} model not found at {path}. "
                f"Run: python -m src.pipeline.train --position {pos} --calibrated"
            )
        raise FileNotFoundError(
            f"Model not found for {position}. Run: python -m src.pipeline.train --position {position}"
        )
    cache_key = str(path.resolve())
    mtime = path.stat().st_mtime
    cached = _MODEL_CACHE.get(cache_key)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    bundle = joblib.load(path)
    _MODEL_CACHE[cache_key] = (mtime, bundle)
    return bundle


def _player_name_col(df: pd.DataFrame) -> str:
    for col in ("player_display_name", "player_name", "player"):
        if col in df.columns:
            return col
    return "player_name"


def _attach_sleeper_injury_status(result: pd.DataFrame) -> pd.DataFrame:
    """Map Sleeper injury_status onto projection rows (name + team)."""
    injured = injured_players()
    lookup = {
        (str(row["full_name"]).lower(), str(row["team"]).upper()): row["injury_status"]
        for _, row in injured.iterrows()
    }
    statuses = []
    for _, row in result.iterrows():
        team = str(row.get("Team", "") or "").upper()
        name = str(row["Player"]).lower()
        statuses.append(lookup.get((name, team), ""))
    result["Injury Status"] = statuses
    return result


def predict_from_features(
    df: pd.DataFrame,
    position: str,
    model_dir: Path | None = None,
    apply_injury_adjustments: bool = True,
) -> pd.DataFrame:
    bundle = load_model(position, model_dir)
    quantile_models = bundle.get("quantile_models") or {0.5: bundle.get("model")}
    feature_cols = bundle.get("feature_cols")
    X = prepare_feature_matrix(
        df,
        position,
        feature_cols_override=list(feature_cols) if feature_cols else None,
    )
    qpreds = predict_quantiles(quantile_models, X)

    name_col = _player_name_col(df)
    result = pd.DataFrame(
        {
            "Player": df[name_col].values,
            "Projected Points": qpreds["q50"].values,
            "Low (P10)": qpreds["q10"].values,
            "High (P90)": qpreds["q90"].values,
        }
    )
    if "team" in df.columns:
        result["Team"] = df["team"].values
    if "opponent" in df.columns:
        result["Opponent"] = df["opponent"].values
    if "week" in df.columns:
        result["Week"] = df["week"].values
    if "season" in df.columns:
        result["Season"] = df["season"].values
    if "player_id" in df.columns:
        result["player_id"] = df["player_id"].values
    if "position" in df.columns:
        result["Position"] = df["position"].astype(str).str.upper().values

    if apply_injury_adjustments:
        roster = compute_vacated_usage(df)
        name_col = _player_name_col(roster)
        boost_map = roster.set_index(name_col)["injury_opportunity_boost"].to_dict()
        note_map = roster.set_index(name_col)["injury_note"].to_dict()
        result["Injury Boost"] = result["Player"].map(boost_map).fillna(0.0)
        result["Injury Note"] = result["Player"].map(note_map).fillna("")
        multiplier = 1.0 + result["Injury Boost"].clip(0, 0.35)
        for col in ("Projected Points", "Low (P10)", "High (P90)"):
            result[col] = result[col] * multiplier
        result = _attach_sleeper_injury_status(result)

    return result.sort_values("Projected Points", ascending=False).reset_index(drop=True)


def predict_upcoming_week(
    position: str,
    season: int | None = None,
    week: int | None = None,
    data_dir: Path | None = None,
    model_dir: Path | None = None,
    apply_injury_adjustments: bool = True,
) -> pd.DataFrame:
    """Predict fantasy points for the next week using latest processed data."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)

    season, week = resolve_projection_context(df, season, week)
    subset, inference_meta = build_inference_roster(df, position, season, week)
    subset = attach_schedule_context(subset, season, week)
    subset["season"] = season

    result = predict_from_features(
        subset,
        position,
        model_dir,
        apply_injury_adjustments=apply_injury_adjustments,
    )

    feature_season = int(inference_meta.get("feature_season") or season)
    if inference_meta.get("preseason_mode"):
        overlay = inference_meta.get("roster_overlay") or {}
        note = (
            f"Week {week} {season} slate with schedule opponents. "
            f"Projections use {feature_season} player profiles (preseason estimate)."
        )
        if overlay.get("applied"):
            note += (
                f" Roster refreshed from Sleeper ({int(overlay.get('teams_updated', 0))} team moves, "
                f"{int(overlay.get('rookies_added', 0))} rookies added)."
            )
        from src.core.depth_chart import depth_chart_note_suffix

        depth = inference_meta.get("depth_chart") or {}
        note += depth_chart_note_suffix(position, depth)
        if position == "qb" and depth.get("sole_rookie_teams"):
            note += (
                f" Sole-rookie QB estimate for {len(depth['sole_rookie_teams'])} team(s) "
                f"with no prior-season starter."
            )
    else:
        note = ""

    result.attrs["inference_meta"] = inference_meta
    result.attrs["projection_note"] = note
    result.attrs["preseason_mode"] = bool(inference_meta.get("preseason_mode"))
    return result


def save_predictions(
    predictions: pd.DataFrame,
    position: str,
    output_dir: Path | None = None,
) -> Path:
    output_dir = output_dir or PREDICTIONS_DIR
    label = {"qb": "QB", "rb": "RB", "wr": "REC"}.get(position, position.upper())
    out_subdir = output_dir / label
    out_subdir.mkdir(parents=True, exist_ok=True)

    date = datetime.now()
    d_string = f"{date.month}{date.day}{date.year}_"
    out_path = out_subdir / f"{d_string}{label}DataPreds.csv"
    predictions.to_csv(out_path, index=False)
    return out_path


def predict_all_positions(
    season: int | None = None,
    week: int | None = None,
) -> dict[str, pd.DataFrame]:
    from src.projections.weekly_cache import save_weekly_artifact

    results = {}
    for position in ("qb", "rb", "wr"):
        preds_inj = predict_upcoming_week(
            position, season=season, week=week, apply_injury_adjustments=True
        )
        preds_no_inj = predict_upcoming_week(
            position, season=season, week=week, apply_injury_adjustments=False
        )
        save_predictions(preds_inj, position)
        if season is not None and week is not None:
            save_weekly_artifact(position, int(season), int(week), True, preds_inj)
            save_weekly_artifact(position, int(season), int(week), False, preds_no_inj)
        results[position] = preds_inj
    return results


def get_model_metrics(model_dir: Path | None = None) -> dict:
    model_dir = model_dir or MODEL_DIR
    summary = {}
    for path in model_dir.glob("*_metrics.json"):
        summary[path.stem.replace("_metrics", "")] = json.loads(path.read_text())
    return summary
