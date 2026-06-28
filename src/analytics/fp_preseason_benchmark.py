"""FantasyPros week-1 consensus scaled to preseason season totals."""

from __future__ import annotations

import pandas as pd

from src.config import GAMES_PER_SEASON
from src.integrations.external_projections import _normalize_name
from src.integrations.fantasypros import (
    attach_fantasypros_projections,
    fantasypros_api_key_configured,
    fetch_fp_weekly_projections,
    load_fp_season_projections,
)


def _week1_rows_for_fp(test_df: pd.DataFrame, season: int, position: str) -> pd.DataFrame:
    w1 = test_df[test_df["week"] == 1].copy()
    if w1.empty:
        return w1
    w1["season"] = int(season)
    w1["week"] = 1
    if "position" not in w1.columns:
        w1["position"] = position.upper()
    name_col = next(
        (c for c in ("player_display_name", "player_name", "Player") if c in w1.columns),
        None,
    )
    if name_col and "name_key" not in w1.columns:
        w1["name_key"] = w1[name_col].map(_normalize_name)
    if "team" in w1.columns:
        w1["team"] = w1["team"].astype(str).str.upper()
    return w1


def attach_fp_week1_preseason_totals(
    test_df: pd.DataFrame,
    season: int,
    position: str,
    *,
    games: int = GAMES_PER_SEASON,
    auto_fetch: bool = True,
) -> tuple[pd.DataFrame, float]:
    """
    Return week-1 rows with fantasypros_preseason = FP week-1 PPR × games.

    Coverage = share of week-1 rows with a non-null FP projection.
    """
    w1 = _week1_rows_for_fp(test_df, season, position)
    if w1.empty:
        return w1, 0.0

    fp = load_fp_season_projections(season, weeks=range(1, 2), cache_only=True)
    if fp.empty and auto_fetch and fantasypros_api_key_configured():
        try:
            fetch_fp_weekly_projections(season, 1)
        except Exception:
            pass
        fp = load_fp_season_projections(season, weeks=range(1, 2), cache_only=True)

    if fp.empty:
        w1["fantasypros_preseason"] = float("nan")
        return w1[["player_id", "fantasypros_preseason"]], 0.0

    attached = attach_fantasypros_projections(w1, season, position, cache_only=True)
    attached["fantasypros_preseason"] = attached["fantasypros_proj"] * games
    coverage = float(attached["fantasypros_preseason"].notna().mean()) if len(attached) else 0.0
    return attached[["player_id", "fantasypros_preseason"]], coverage


def fp_preseason_metrics(
    frame: pd.DataFrame,
    *,
    scoresense_col: str = "scoresense_proj",
    fp_col: str = "fantasypros_preseason",
) -> dict:
    """MAE/Spearman for FP preseason vs ScoreSense on players with FP data."""
    if frame.empty or fp_col not in frame.columns:
        return {
            "fantasypros_mae": None,
            "fantasypros_spearman": None,
            "fantasypros_coverage": 0.0,
            "beats_fantasypros_mae": None,
        }
    fp_frame = frame[frame[fp_col].notna()].copy()
    coverage = float(len(fp_frame) / len(frame)) if len(frame) else 0.0
    if fp_frame.empty:
        return {
            "fantasypros_mae": None,
            "fantasypros_spearman": None,
            "fantasypros_coverage": coverage,
            "beats_fantasypros_mae": None,
        }
    from src.pipeline.backtest import compute_metrics

    ss = compute_metrics(fp_frame["actual_total"], fp_frame[scoresense_col])
    fp = compute_metrics(fp_frame["actual_total"], fp_frame[fp_col])
    beats = None
    if ss["mae"] == ss["mae"] and fp["mae"] == fp["mae"]:
        beats = bool(ss["mae"] < fp["mae"])
    return {
        "fantasypros_mae": round(fp["mae"], 2) if fp["mae"] == fp["mae"] else None,
        "fantasypros_spearman": round(fp["spearman"], 3) if fp["spearman"] == fp["spearman"] else None,
        "fantasypros_coverage": round(coverage, 3),
        "beats_fantasypros_mae": beats,
    }


def fp_blend_preseason_metrics(
    frame: pd.DataFrame,
    beta: float,
    *,
    blend_col: str = "blended_preseason",
    scoresense_col: str = "scoresense_proj",
    fp_col: str = "fantasypros_preseason",
) -> dict:
    """MAE for β-blended preseason projection on rows with FP data."""
    from src.projections.season_blend import blend_with_fp_preseason

    if frame.empty or fp_col not in frame.columns:
        return {"mae": None, "n": 0}
    fp_frame = frame[frame[fp_col].notna()].copy()
    if fp_frame.empty:
        return {"mae": None, "n": 0}
    fp_frame[blend_col] = blend_with_fp_preseason(
        fp_frame[scoresense_col], fp_frame[fp_col], beta=beta
    )
    from src.pipeline.backtest import compute_metrics

    m = compute_metrics(fp_frame["actual_total"], fp_frame[blend_col])
    return {
        "mae": round(m["mae"], 2) if m["mae"] == m["mae"] else None,
        "n": int(m["n"]),
    }


def tune_fp_preseason_blend(
    frames: list[pd.DataFrame],
    *,
    step: float = 0.05,
    scoresense_col: str = "scoresense_proj",
    fp_col: str = "fantasypros_preseason",
) -> dict:
    """Sweep β on preseason frames that include FP totals; pick lowest train MAE."""
    import numpy as np

    betas = [round(float(b), 2) for b in np.arange(0.0, 1.0 + step / 2, step)]
    train_mae_by_beta: dict[str, float | None] = {}
    for beta in betas:
        maes = [
            r["mae"]
            for frame in frames
            if (r := fp_blend_preseason_metrics(frame, beta, scoresense_col=scoresense_col, fp_col=fp_col))[
                "mae"
            ]
            is not None
        ]
        train_mae_by_beta[str(beta)] = round(float(np.mean(maes)), 2) if maes else None

    valid = {k: v for k, v in train_mae_by_beta.items() if v is not None}
    chosen_beta = float(min(valid, key=valid.get)) if valid else 1.0
    return {
        "chosen_beta": chosen_beta,
        "train_mae_by_beta": train_mae_by_beta,
    }
