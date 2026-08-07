"""Fantasy draft season-long projection aggregation."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import (
    GAMES_PER_SEASON,
    MODEL_DIR,
    PRESEASON_FP_BLEND_ENABLED,
    PRESEASON_USE_EXPECTED_GAMES,
    PROCESSED_DATA_DIR,
)
from src.projections.predict import predict_from_features
from src.projections.season_blend import (
    blend_preseason_totals,
    blend_with_fp_preseason,
    expected_preseason_games,
    preseason_blend_alpha,
    prior_year_games_map,
    prior_year_ppg_map,
)
from src.core.projection_context import build_inference_roster, feature_season_for_inference


def _feature_season_for_draft(df: pd.DataFrame, season: int, target_week: int = 1) -> int:
    """Backward-compatible alias."""
    return feature_season_for_inference(df, season, target_week)


def predict_draft_season(
    position: str,
    season: int | None = None,
    data_dir: Path | None = None,
    model_dir: Path | None = None,
    games_per_season: int = GAMES_PER_SEASON,
) -> pd.DataFrame:
    """
    Full-season draft projections from week-1 weekly quantiles.

    Season total = per-game Proj/Floor/Ceiling × games_per_season (default 17).
    Uses prior-season features when the target season has no games played yet.
    """
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)

    if season is None:
        season = int(df["season"].max()) + 1

    target_week = 1
    roster, inference_meta = build_inference_roster(
        df, position, season, target_week, depth_mode="draft"
    )
    feature_season = int(inference_meta["feature_season"])
    roster_overlay = inference_meta.get("roster_overlay") or {"applied": False}
    weekly = predict_from_features(
        roster,
        position,
        model_dir,
        apply_injury_adjustments=False,
    )

    games = (
        expected_preseason_games(weekly["player_id"], prior_year_games_map(df, season))
        if PRESEASON_USE_EXPECTED_GAMES and "player_id" in weekly.columns
        else games_per_season
    )
    if isinstance(games, pd.Series):
        season_proj = (weekly["Projected Points"].astype(float) * games).round(1)
    else:
        season_proj = (weekly["Projected Points"] * games_per_season).round(1)

    result = pd.DataFrame(
        {
            "Player": weekly["Player"],
            "Team": weekly["Team"] if "Team" in weekly.columns else None,
            "Season": season,
            "Per-Game Proj": weekly["Projected Points"].round(1),
            "Per-Game Floor": weekly["Low (P10)"].round(1),
            "Per-Game Ceiling": weekly["High (P90)"].round(1),
            "Season Proj": season_proj,
            "Season Floor": (weekly["Low (P10)"] * games_per_season).round(1),
            "Season Ceiling": (weekly["High (P90)"] * games_per_season).round(1),
        }
    )
    pos = position.lower()
    alpha = preseason_blend_alpha(pos)
    if alpha < 1.0 and "player_id" in weekly.columns:
        prior_ppg = prior_year_ppg_map(df, season)
        if not prior_ppg.empty:
            result["Season Proj"] = blend_preseason_totals(
                weekly["player_id"],
                weekly["Projected Points"],
                prior_ppg,
                games=games,
                alpha=alpha,
            )
            div = games if isinstance(games, pd.Series) else games_per_season
            if isinstance(div, pd.Series):
                result["Per-Game Proj"] = (result["Season Proj"] / div).round(1)
            else:
                result["Per-Game Proj"] = (result["Season Proj"] / games_per_season).round(1)

    if PRESEASON_FP_BLEND_ENABLED and "player_id" in weekly.columns:
        from src.integrations.fantasypros import attach_fantasypros_projections
        from src.projections.season_blend import preseason_fp_blend_beta

        fp_beta = preseason_fp_blend_beta(pos)
        if fp_beta < 1.0:
            attach_df = weekly.copy()
            attach_df["season"] = season
            attach_df["week"] = target_week
            attached = attach_fantasypros_projections(
                attach_df, season, position, cache_only=True
            )
            if "fantasypros_proj" in attached.columns and attached["fantasypros_proj"].notna().any():
                fp_total = attached["fantasypros_proj"] * games_per_season
                result["Season Proj"] = blend_with_fp_preseason(
                    result["Season Proj"], fp_total, beta=fp_beta
                )
                result["Per-Game Proj"] = (result["Season Proj"] / games_per_season).round(1)
    if "player_id" in weekly.columns:
        result["player_id"] = weekly["player_id"]
    if "position" in weekly.columns:
        result["position"] = weekly["position"]
    if "_rookie_estimate" in roster.columns:
        name_col = _rookie_index_col(roster)
        flag_map = {
            (str(row[name_col]), str(row.get("team", "")).upper()): bool(row["_rookie_estimate"])
            for _, row in roster.iterrows()
        }
        role_map = {
            (str(row[name_col]), str(row.get("team", "")).upper()): str(row.get("_rookie_role_label") or "")
            for _, row in roster.iterrows()
            if bool(row.get("_rookie_estimate"))
        }
        result["Rookie Est."] = result.apply(
            lambda row: flag_map.get((str(row["Player"]), str(row.get("Team", "")).upper()), False),
            axis=1,
        )
        result["Rookie Role"] = result.apply(
            lambda row: role_map.get((str(row["Player"]), str(row.get("Team", "")).upper()), ""),
            axis=1,
        )

    from src.integrations.sleeper import apply_vet_backup_projection_scale

    result = apply_vet_backup_projection_scale(result, roster)

    meta_cols = ["Season Proj", "Season Floor", "Season Ceiling", "Per-Game Proj"]
    for col in meta_cols:
        if col in result.columns:
            result[col] = result[col].fillna(0.0)

    result.attrs["feature_season"] = feature_season
    result.attrs["games_per_season"] = games_per_season
    result.attrs["roster_overlay"] = roster_overlay
    result.attrs["depth_chart"] = inference_meta.get("depth_chart") or {"applied": False}
    result.attrs["rookie_role_adjusted"] = bool(
        roster.get("_rookie_role_mult", pd.Series(dtype=float)).notna().any()
        if "_rookie_role_mult" in roster.columns
        else False
    )
    return result.sort_values("Season Proj", ascending=False).reset_index(drop=True)


def _rookie_index_col(df: pd.DataFrame) -> str:
    for col in ("player_display_name", "player_name", "Player"):
        if col in df.columns:
            return col
    return "player_display_name"


def draft_projection_note(
    season: int,
    feature_season: int,
    games_per_season: int,
    roster_overlay: dict | None = None,
    depth_chart: dict | None = None,
    position: str = "qb",
) -> str:
    feature_note = (
        f"using {feature_season} stats as inputs"
        if feature_season < season
        else f"using {season} in-season stats"
    )
    parts = [
        f"Season totals assume {games_per_season} games at the Week 1 per-game rate ({feature_note}).",
        "Not schedule- or bye-adjusted.",
    ]
    overlay = roster_overlay or {}
    if overlay.get("applied"):
        moves = int(overlay.get("teams_updated", 0))
        removed = int(overlay.get("removed_unrostered", 0))
        rookies = int(overlay.get("rookies_added", 0))
        emerging = int(overlay.get("emerging_added", 0))
        parts.append(
            f"Teams refreshed from Sleeper ({moves} team updates, {removed} removed without a roster, "
            f"{rookies} rookies added"
            + (f", {emerging} emerging" if emerging else "")
            + ")."
        )
        if rookies:
            parts.append(
                "Rookie totals start from a low-usage backup feature template, scale by "
                "Sleeper depth + draft-capital (search rank), "
                "optional camp overrides (data/projections/rookie_role_overrides.yaml), "
                "and YouTube role-hype when available."
            )
    elif feature_season < season:
        parts.append(
            "Team assignments still reflect the prior NFL season until Sleeper roster data is available."
        )
    from src.core.depth_chart import depth_chart_note_suffix

    depth = depth_chart or {}
    suffix = depth_chart_note_suffix(position, depth)
    if suffix:
        parts.append(f"Preseason depth chart:{suffix}")
    if position.lower() == "qb" and depth.get("sole_rookie_teams"):
        parts.append(
            f"Sole-rookie QB estimate for {len(depth['sole_rookie_teams'])} team(s) "
            f"with no prior-season starter."
        )
    return " ".join(parts)
