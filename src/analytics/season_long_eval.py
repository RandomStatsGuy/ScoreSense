"""Evaluate draft and rest-of-season totals against actual regular-season points."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.fp_preseason_benchmark import (
    attach_fp_week1_preseason_totals,
    fp_preseason_metrics,
    tune_fp_preseason_blend,
)
from src.integrations.fantasypros import fantasypros_is_fair_benchmark, prefetch_missing_fp_weeks
from src.products.accuracy_report import _load_position_df
from src.pipeline.backtest import compute_metrics
from src.pipeline.backtest_checkpoint import predict_walk_forward_season, walk_forward_split
from src.config import (
    ANALYTICS_DIR,
    DEFAULT_ACCURACY_SEASONS,
    GAMES_PER_SEASON,
    PRESEASON_USE_EXPECTED_GAMES,
    PROCESSED_DATA_DIR,
)
from src.core.memory_utils import release_memory
from src.core.projection_context import (
    REGULAR_SEASON_MAX_WEEK,
    build_projection_roster,
    feature_season_for_inference,
)
from src.core.depth_chart import filter_depth_chart_starters
from src.projections.season_blend import (
    PRESEASON_BLEND_ALPHA,
    QB_PRESEASON_BLEND_ALPHA,
    ROS_ROLLING_WEEKS,
    ROS_ROLLING_WEEK_CANDIDATES,
    blend_preseason_totals,
    expected_preseason_games,
    games_remaining_in_season,
    preseason_blend_alpha,
    prior_year_games_map,
    prior_year_ppg_map,
    rolling_model_rate,
)

SEASON_LONG_ACCURACY_PATH = ANALYTICS_DIR / "season_long_accuracy.json"
ROS_CHECKPOINT_WEEKS = (4, 8, 12)
MIN_GAMES_PLAYED = 8
FP_BENCHMARK_MIN_COVERAGE = 0.30
FP_PRESEASON_LABEL = f"FantasyPros Week 1 consensus × {GAMES_PER_SEASON}"
DEFAULT_ALPHA_TRAIN_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024]
DEFAULT_ALPHA_HOLDOUT_SEASONS = [2025]
DEFAULT_QB_ALPHA_TRAIN_SEASONS = DEFAULT_ALPHA_TRAIN_SEASONS
DEFAULT_QB_ALPHA_HOLDOUT_SEASONS = DEFAULT_ALPHA_HOLDOUT_SEASONS


def _actual_season_totals(df: pd.DataFrame, season: int) -> pd.DataFrame:
    reg = df[(df["season"] == season) & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))]
    return (
        reg.groupby("player_id", as_index=False)
        .agg(actual_total=("Fpts", "sum"), games_played=("week", "nunique"))
        .assign(season=season)
    )


def _prior_year_baseline(df: pd.DataFrame, season: int, games: int = GAMES_PER_SEASON) -> pd.DataFrame:
    prior_season = season - 1
    reg = df[(df["season"] == prior_season) & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))]
    if reg.empty:
        return pd.DataFrame(columns=["player_id", "baseline_proj"])
    prior = reg.groupby("player_id", as_index=False).agg(
        fpts=("Fpts", "sum"),
        games=("week", "nunique"),
    )
    prior["baseline_proj"] = (prior["fpts"] / prior["games"].clip(lower=1)) * games
    return prior[["player_id", "baseline_proj"]]


def _ytd_through_week(df: pd.DataFrame, season: int, target_week: int) -> pd.DataFrame:
    reg = df[(df["season"] == season) & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))]
    if target_week <= REGULAR_SEASON_MAX_WEEK:
        reg = reg[reg["week"] < target_week]
    return reg.groupby("player_id", as_index=False).agg(fpts_ytd=("Fpts", "sum"))


def _draft_cohort_player_ids(df: pd.DataFrame, position: str, season: int) -> set[str]:
    """Depth-filtered preseason roster (matches draft board cohort, no Sleeper overlay)."""
    roster = build_projection_roster(df, season, 1)
    if roster.empty or "player_id" not in roster.columns:
        return set()
    feature_season = feature_season_for_inference(df, season, 1)
    roster, _ = filter_depth_chart_starters(
        roster, position, df, feature_season, depth_mode="draft"
    )
    return set(roster["player_id"].astype(str))


def _classify_player_segments(df: pd.DataFrame, season: int, player_ids: pd.Series) -> dict[str, str]:
    prior = df[(df["season"] == season - 1) & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))]
    prior_games = prior.groupby("player_id")["week"].nunique() if not prior.empty else pd.Series(dtype=int)
    segments: dict[str, str] = {}
    for pid in player_ids.astype(str):
        games = int(prior_games.get(pid, 0)) if pid in prior_games.index else 0
        if games == 0:
            segments[pid] = "rookie"
        elif games >= 8:
            segments[pid] = "returning_starter"
        else:
            segments[pid] = "backup"
    return segments


def _segment_preseason_metrics(frame: pd.DataFrame, df: pd.DataFrame, season: int) -> dict:
    if frame.empty:
        return {}
    segments = _classify_player_segments(df, season, frame["player_id"])
    tagged = frame.copy()
    tagged["segment"] = tagged["player_id"].astype(str).map(segments)
    out: dict = {}
    for seg in ("rookie", "returning_starter", "backup"):
        sub = tagged[tagged["segment"] == seg]
        if len(sub) < 2:
            continue
        m = compute_metrics(sub["actual_total"], sub["scoresense_proj"])
        out[seg] = {
            "mae": round(m["mae"], 2) if m["mae"] == m["mae"] else None,
            "n": int(m["n"]),
        }
    return out


def _preseason_games_series(
    df: pd.DataFrame,
    season: int,
    player_ids: pd.Series,
    *,
    use_expected_games: bool = PRESEASON_USE_EXPECTED_GAMES,
) -> int | pd.Series:
    if not use_expected_games:
        return GAMES_PER_SEASON
    prior_games = prior_year_games_map(df, season)
    if prior_games.empty:
        return GAMES_PER_SEASON
    return expected_preseason_games(player_ids, prior_games)


def _preseason_scoresense_proj(
    position: str,
    df: pd.DataFrame,
    season: int,
    week1: pd.DataFrame,
    *,
    alpha: float | None = None,
    use_expected_games: bool = PRESEASON_USE_EXPECTED_GAMES,
) -> pd.Series:
    pos = position.lower()
    alpha = preseason_blend_alpha(pos) if alpha is None else alpha
    games = _preseason_games_series(df, season, week1["player_id"], use_expected_games=use_expected_games)
    prior_ppg = prior_year_ppg_map(df, season)

    if alpha < 1.0 and not prior_ppg.empty:
        return blend_preseason_totals(
            week1["player_id"],
            week1["model_pred"],
            prior_ppg,
            games=games,
            alpha=alpha,
        )
    if isinstance(games, pd.Series):
        return (week1["model_pred"].astype(float) * games).round(1)
    return week1["model_pred"] * GAMES_PER_SEASON


def _preseason_mae(
    df: pd.DataFrame,
    position: str,
    season: int,
    *,
    alpha: float | None = None,
    ros_rolling_weeks: int = ROS_ROLLING_WEEKS,
    data_dir: Path | None = None,
) -> float | None:
    """Mean absolute error for preseason totals at a given blend α."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    train_df, test_df = walk_forward_split(df, season)
    if train_df.empty or test_df.empty:
        return None
    qpreds, _ = predict_walk_forward_season(train_df, test_df, position, season)
    test_df = test_df.copy()
    test_df["model_pred"] = qpreds["q50"]
    actual = _actual_season_totals(df, season)
    baseline = _prior_year_baseline(df, season)
    week1 = test_df[test_df["week"] == 1][["player_id", "model_pred"]].copy()
    week1["scoresense_proj"] = _preseason_scoresense_proj(
        position, df, season, week1, alpha=alpha
    )
    frame = _merge_eval_frame(actual, week1[["player_id", "scoresense_proj"]], baseline)
    if frame.empty:
        return None
    _ = ros_rolling_weeks  # reserved for ros tuning callers
    err = (frame["scoresense_proj"] - frame["actual_total"]).abs()
    return float(err.mean())


def _ros_mae(
    df: pd.DataFrame,
    position: str,
    season: int,
    *,
    rolling_weeks: int,
    data_dir: Path | None = None,
) -> float | None:
    """Average ROS checkpoint MAE for a rolling window size."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    train_df, test_df = walk_forward_split(df, season)
    if train_df.empty or test_df.empty:
        return None
    qpreds, _ = predict_walk_forward_season(train_df, test_df, position, season)
    test_df = test_df.copy()
    test_df["model_pred"] = qpreds["q50"]
    actual = _actual_season_totals(df, season)
    baseline = _prior_year_baseline(df, season)
    maes: list[float] = []
    for checkpoint_week in ROS_CHECKPOINT_WEEKS:
        if checkpoint_week > REGULAR_SEASON_MAX_WEEK:
            continue
        ytd = _ytd_through_week(df, season, checkpoint_week)
        ytd_games = df[
            (df["season"] == season)
            & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))
            & (df["week"] < checkpoint_week)
        ].groupby("player_id", as_index=False).agg(games_played=("week", "nunique"))
        rate_weeks = list(range(max(1, checkpoint_week - rolling_weeks + 1), checkpoint_week + 1))
        rate_frames = [
            test_df[test_df["week"] == w][["player_id", "model_pred"]]
            for w in rate_weeks
        ]
        week_pred = rolling_model_rate(rate_frames)
        ros_frame = week_pred.merge(ytd, on="player_id", how="left")
        ros_frame = ros_frame.merge(ytd_games, on="player_id", how="left")
        ros_frame["fpts_ytd"] = ros_frame["fpts_ytd"].fillna(0.0)
        ros_frame["games_played"] = ros_frame["games_played"].fillna(0).astype(int)
        ros_frame["games_left"] = ros_frame["games_played"].map(
            lambda gp: games_remaining_in_season(gp, GAMES_PER_SEASON)
        )
        ros_frame["scoresense_proj"] = (
            ros_frame["fpts_ytd"] + ros_frame["model_pred"] * ros_frame["games_left"]
        )
        merged = _merge_eval_frame(
            actual,
            ros_frame[["player_id", "scoresense_proj"]],
            baseline,
        )
        if merged.empty:
            continue
        maes.append(float((merged["scoresense_proj"] - merged["actual_total"]).abs().mean()))
    return float(np.mean(maes)) if maes else None


def tune_preseason_alpha(
    position: str,
    df: pd.DataFrame | None = None,
    train_seasons: list[int] | None = None,
    holdout_seasons: list[int] | None = None,
    *,
    step: float = 0.05,
    data_dir: Path | None = None,
) -> dict:
    """Sweep blend α on train seasons; report holdout MAE for chosen vs current constant."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    train_seasons = train_seasons or DEFAULT_ALPHA_TRAIN_SEASONS
    holdout_seasons = holdout_seasons or DEFAULT_ALPHA_HOLDOUT_SEASONS
    if df is None:
        df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    current_alpha = preseason_blend_alpha(position)
    alphas = [round(float(a), 2) for a in np.arange(0.0, 1.0 + step / 2, step)]
    train_mae_by_alpha: dict[str, float | None] = {}
    for alpha in alphas:
        maes = [
            m
            for season in train_seasons
            if (m := _preseason_mae(df, position, season, alpha=alpha, data_dir=data_dir)) is not None
        ]
        train_mae_by_alpha[str(alpha)] = round(float(np.mean(maes)), 2) if maes else None

    valid = {k: v for k, v in train_mae_by_alpha.items() if v is not None}
    chosen_alpha = float(min(valid, key=valid.get)) if valid else current_alpha

    holdout_mae: dict[str, float | None] = {}
    holdout_vals = [
        _preseason_mae(df, position, season, alpha=chosen_alpha, data_dir=data_dir)
        for season in holdout_seasons
    ]
    holdout_vals = [v for v in holdout_vals if v is not None]
    holdout_mae["chosen"] = round(float(np.mean(holdout_vals)), 2) if holdout_vals else None

    current_vals = [
        _preseason_mae(df, position, season, alpha=current_alpha, data_dir=data_dir)
        for season in holdout_seasons
    ]
    current_vals = [v for v in current_vals if v is not None]
    holdout_mae["current_constant"] = (
        round(float(np.mean(current_vals)), 2) if current_vals else None
    )

    return {
        "position": position,
        "chosen_alpha": chosen_alpha,
        "current_constant_alpha": current_alpha,
        "train_seasons": train_seasons,
        "holdout_seasons": holdout_seasons,
        "train_mae_by_alpha": train_mae_by_alpha,
        "holdout_mae": holdout_mae,
    }


def tune_qb_preseason_alpha(
    df: pd.DataFrame | None = None,
    train_seasons: list[int] | None = None,
    holdout_seasons: list[int] | None = None,
    *,
    step: float = 0.05,
    data_dir: Path | None = None,
) -> dict:
    return tune_preseason_alpha(
        "qb",
        df=df,
        train_seasons=train_seasons,
        holdout_seasons=holdout_seasons,
        step=step,
        data_dir=data_dir,
    )


def tune_ros_rolling_weeks(
    position: str,
    df: pd.DataFrame | None = None,
    train_seasons: list[int] | None = None,
    holdout_seasons: list[int] | None = None,
    *,
    candidates: tuple[int, ...] = ROS_ROLLING_WEEK_CANDIDATES,
    data_dir: Path | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    train_seasons = train_seasons or DEFAULT_ALPHA_TRAIN_SEASONS
    holdout_seasons = holdout_seasons or DEFAULT_ALPHA_HOLDOUT_SEASONS
    if df is None:
        df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    train_mae_by_weeks: dict[str, float | None] = {}
    for window in candidates:
        maes = [
            m
            for season in train_seasons
            if (m := _ros_mae(df, position, season, rolling_weeks=window, data_dir=data_dir))
            is not None
        ]
        train_mae_by_weeks[str(window)] = round(float(np.mean(maes)), 2) if maes else None

    valid = {k: v for k, v in train_mae_by_weeks.items() if v is not None}
    chosen = int(min(valid, key=valid.get)) if valid else ROS_ROLLING_WEEKS

    holdout_vals = [
        _ros_mae(df, position, season, rolling_weeks=chosen, data_dir=data_dir)
        for season in holdout_seasons
    ]
    holdout_vals = [v for v in holdout_vals if v is not None]
    current_vals = [
        _ros_mae(df, position, season, rolling_weeks=ROS_ROLLING_WEEKS, data_dir=data_dir)
        for season in holdout_seasons
    ]
    current_vals = [v for v in current_vals if v is not None]

    return {
        "position": position,
        "chosen_weeks": chosen,
        "current_constant_weeks": ROS_ROLLING_WEEKS,
        "train_seasons": train_seasons,
        "holdout_seasons": holdout_seasons,
        "train_mae_by_weeks": train_mae_by_weeks,
        "holdout_mae": {
            "chosen": round(float(np.mean(holdout_vals)), 2) if holdout_vals else None,
            "current_constant": round(float(np.mean(current_vals)), 2) if current_vals else None,
        },
    }


def _preseason_eval_frame(
    df: pd.DataFrame,
    position: str,
    season: int,
    test_df: pd.DataFrame,
) -> pd.DataFrame:
    actual = _actual_season_totals(df, season)
    baseline = _prior_year_baseline(df, season)
    week1 = test_df[test_df["week"] == 1][["player_id", "model_pred"]].copy()
    week1["scoresense_proj"] = _preseason_scoresense_proj(position, df, season, week1)
    frame = _merge_eval_frame(actual, week1[["player_id", "scoresense_proj"]], baseline)
    fp_cols, _ = attach_fp_week1_preseason_totals(test_df, season, position)
    if not fp_cols.empty:
        frame = frame.merge(fp_cols, on="player_id", how="left")
    return frame


def tune_fp_blend_for_position(
    position: str,
    df: pd.DataFrame | None = None,
    train_seasons: list[int] | None = None,
    holdout_seasons: list[int] | None = None,
    *,
    data_dir: Path | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    train_seasons = train_seasons or DEFAULT_ALPHA_TRAIN_SEASONS
    holdout_seasons = holdout_seasons or DEFAULT_ALPHA_HOLDOUT_SEASONS
    if df is None:
        df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    train_frames: list[pd.DataFrame] = []
    holdout_frames: list[pd.DataFrame] = []
    for season in train_seasons + holdout_seasons:
        train_df, test_df = walk_forward_split(df, season)
        if train_df.empty or test_df.empty:
            continue
        qpreds, _ = predict_walk_forward_season(train_df, test_df, position, season)
        test_df = test_df.copy()
        test_df["model_pred"] = qpreds["q50"]
        frame = _preseason_eval_frame(df, position, season, test_df)
        if frame.empty or "fantasypros_preseason" not in frame.columns:
            continue
        if season in train_seasons:
            train_frames.append(frame)
        else:
            holdout_frames.append(frame)

    tuning = tune_fp_preseason_blend(train_frames)
    tuning["position"] = position
    tuning["train_seasons"] = train_seasons
    tuning["holdout_seasons"] = holdout_seasons
    beta = tuning["chosen_beta"]
    from src.analytics.fp_preseason_benchmark import fp_blend_preseason_metrics

    holdout_blend = [
        fp_blend_preseason_metrics(frame, beta)["mae"]
        for frame in holdout_frames
        if fp_blend_preseason_metrics(frame, beta)["mae"] is not None
    ]
    holdout_pure = [
        fp_blend_preseason_metrics(frame, 1.0)["mae"]
        for frame in holdout_frames
        if fp_blend_preseason_metrics(frame, 1.0)["mae"] is not None
    ]
    tuning["holdout_mae"] = {
        "chosen": round(float(np.mean(holdout_blend)), 2) if holdout_blend else None,
        "scoresense_only": round(float(np.mean(holdout_pure)), 2) if holdout_pure else None,
    }
    return tuning


def prefetch_fp_preseason_weeks(seasons: list[int]) -> list[dict]:
    """Ensure week-1 FP projection cache exists for season-long eval seasons."""
    stats = []
    for season in seasons:
        stats.append(prefetch_missing_fp_weeks(season, weeks=range(1, 2), include_rankings=False))
    return stats


def _merge_eval_frame(
    actual: pd.DataFrame,
    predicted: pd.DataFrame,
    baseline: pd.DataFrame,
    *,
    min_games: int = MIN_GAMES_PLAYED,
    player_ids: set[str] | None = None,
) -> pd.DataFrame:
    out = actual.merge(predicted, on="player_id", how="inner")
    out = out.merge(baseline, on="player_id", how="left")
    out = out[out["games_played"] >= min_games]
    if player_ids is not None:
        out = out[out["player_id"].astype(str).isin(player_ids)]
    return out


def _metrics_row(frame: pd.DataFrame, pred_col: str, label: str) -> dict:
    if frame.empty:
        return {
            "label": label,
            "pred_col": pred_col,
            "mae": None,
            "spearman": None,
            "n": 0,
        }
    model = compute_metrics(frame["actual_total"], frame[pred_col])
    base = compute_metrics(
        frame["actual_total"],
        frame["baseline_proj"].fillna(frame["baseline_proj"].median()),
    )
    return {
        "label": label,
        "pred_col": pred_col,
        "mae": round(model["mae"], 2) if model["mae"] == model["mae"] else None,
        "spearman": round(model["spearman"], 3) if model["spearman"] == model["spearman"] else None,
        "n": int(model["n"]),
        "baseline_mae": round(base["mae"], 2) if base["mae"] == base["mae"] else None,
        "baseline_spearman": round(base["spearman"], 3) if base["spearman"] == base["spearman"] else None,
        "beats_baseline_mae": bool(model["mae"] < base["mae"])
        if model["mae"] == model["mae"] and base["mae"] == base["mae"]
        else None,
    }


def eval_season_walkforward(
    position: str,
    season: int,
    df: pd.DataFrame | None = None,
    data_dir: Path | None = None,
    ros_weeks: tuple[int, ...] = ROS_CHECKPOINT_WEEKS,
    *,
    rolling_weeks: int = ROS_ROLLING_WEEKS,
) -> dict:
    """Walk-forward season totals: preseason draft-style + mid-season ROS checkpoints."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    if df is None:
        df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    train_df, test_df = walk_forward_split(df, season)
    if train_df.empty or test_df.empty:
        return {"season": season, "n": 0, "preseason": {}, "ros": {}}

    qpreds, _ = predict_walk_forward_season(train_df, test_df, position, season)
    test_df = test_df.copy()
    test_df["model_pred"] = qpreds["q50"]

    actual = _actual_season_totals(df, season)
    baseline = _prior_year_baseline(df, season)
    draft_ids = _draft_cohort_player_ids(df, position, season)

    week1 = test_df[test_df["week"] == 1][["player_id", "model_pred"]].copy()
    week1["scoresense_proj"] = _preseason_scoresense_proj(position, df, season, week1)
    preseason_frame = _merge_eval_frame(actual, week1[["player_id", "scoresense_proj"]], baseline)

    fp_cols, _fp_cov = attach_fp_week1_preseason_totals(test_df, season, position)
    if not fp_cols.empty:
        preseason_frame = preseason_frame.merge(fp_cols, on="player_id", how="left")

    preseason = _metrics_row(preseason_frame, "scoresense_proj", f"Preseason (Week 1 × {GAMES_PER_SEASON})")
    preseason.update(fp_preseason_metrics(preseason_frame))
    preseason["segments"] = _segment_preseason_metrics(preseason_frame, df, season)

    draft_frame = _merge_eval_frame(
        actual,
        week1[["player_id", "scoresense_proj"]],
        baseline,
        player_ids=draft_ids if draft_ids else None,
    )
    if not fp_cols.empty and not draft_frame.empty:
        draft_frame = draft_frame.merge(fp_cols, on="player_id", how="left")
    preseason_draft = _metrics_row(
        draft_frame,
        "scoresense_proj",
        f"Preseason draft cohort (depth-filtered)",
    )
    preseason_draft.update(fp_preseason_metrics(draft_frame))

    ros: dict[str, dict] = {}
    for checkpoint_week in ros_weeks:
        if checkpoint_week > REGULAR_SEASON_MAX_WEEK:
            continue
        ytd = _ytd_through_week(df, season, checkpoint_week)
        ytd_games = df[
            (df["season"] == season)
            & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))
            & (df["week"] < checkpoint_week)
        ].groupby("player_id", as_index=False).agg(games_played=("week", "nunique"))
        rate_weeks = list(range(max(1, checkpoint_week - rolling_weeks + 1), checkpoint_week + 1))
        rate_frames = [
            test_df[test_df["week"] == w][["player_id", "model_pred"]]
            for w in rate_weeks
        ]
        week_pred = rolling_model_rate(rate_frames)
        ros_frame = week_pred.merge(ytd, on="player_id", how="left")
        ros_frame = ros_frame.merge(ytd_games, on="player_id", how="left")
        ros_frame["fpts_ytd"] = ros_frame["fpts_ytd"].fillna(0.0)
        ros_frame["games_played"] = ros_frame["games_played"].fillna(0).astype(int)
        ros_frame["games_left"] = ros_frame["games_played"].map(
            lambda gp: games_remaining_in_season(gp, GAMES_PER_SEASON)
        )
        ros_frame["scoresense_proj"] = ros_frame["fpts_ytd"] + ros_frame["model_pred"] * ros_frame["games_left"]
        merged = _merge_eval_frame(
            actual,
            ros_frame[["player_id", "scoresense_proj"]],
            baseline,
        )
        ros[str(checkpoint_week)] = _metrics_row(
            merged,
            "scoresense_proj",
            f"ROS from week {checkpoint_week}",
        )

    return {
        "season": season,
        "n": preseason.get("n", 0),
        "preseason": preseason,
        "preseason_draft_cohort": preseason_draft,
        "ros": ros,
    }


def build_season_long_report(
    position: str,
    test_seasons: list[int] | None = None,
    data_dir: Path | None = None,
    *,
    rolling_weeks: int = ROS_ROLLING_WEEKS,
) -> dict:
    test_seasons = test_seasons or DEFAULT_ACCURACY_SEASONS
    data_dir = data_dir or PROCESSED_DATA_DIR
    base_df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    preseason_series: dict[str, list] = {
        "scoresense_mae": [],
        "scoresense_spearman": [],
        "baseline_mae": [],
        "fantasypros_mae": [],
        "fantasypros_coverage": [],
        "n": [],
    }
    draft_series: dict[str, list] = {
        "scoresense_mae": [],
        "baseline_mae": [],
        "fantasypros_mae": [],
        "n": [],
    }
    ros_series: dict[str, dict[str, list]] = {
        str(w): {"scoresense_mae": [], "scoresense_spearman": [], "baseline_mae": [], "n": []}
        for w in ROS_CHECKPOINT_WEEKS
    }
    seasons_out: list[int] = []
    by_season: list[dict] = []

    for season in test_seasons:
        result = eval_season_walkforward(
            position, season, df=base_df, data_dir=data_dir, rolling_weeks=rolling_weeks
        )
        if result.get("n", 0) == 0:
            continue
        seasons_out.append(season)
        by_season.append(result)

        pre = result["preseason"]
        preseason_series["scoresense_mae"].append(pre.get("mae"))
        preseason_series["scoresense_spearman"].append(pre.get("spearman"))
        preseason_series["baseline_mae"].append(pre.get("baseline_mae"))
        preseason_series["fantasypros_mae"].append(pre.get("fantasypros_mae"))
        preseason_series["fantasypros_coverage"].append(pre.get("fantasypros_coverage"))
        preseason_series["n"].append(pre.get("n"))

        draft_pre = result.get("preseason_draft_cohort", {})
        draft_series["scoresense_mae"].append(draft_pre.get("mae"))
        draft_series["baseline_mae"].append(draft_pre.get("baseline_mae"))
        draft_series["fantasypros_mae"].append(draft_pre.get("fantasypros_mae"))
        draft_series["n"].append(draft_pre.get("n"))

        for week_key, metrics in result.get("ros", {}).items():
            if week_key not in ros_series:
                continue
            ros_series[week_key]["scoresense_mae"].append(metrics.get("mae"))
            ros_series[week_key]["scoresense_spearman"].append(metrics.get("spearman"))
            ros_series[week_key]["baseline_mae"].append(metrics.get("baseline_mae"))
            ros_series[week_key]["n"].append(metrics.get("n"))

        release_memory()

    def _avg(vals: list) -> float | None:
        nums = [v for v in vals if v is not None and v == v]
        return round(float(np.mean(nums)), 3) if nums else None

    fp_fair_seasons = [
        row
        for row in by_season
        if (row.get("preseason", {}).get("fantasypros_coverage") or 0) >= FP_BENCHMARK_MIN_COVERAGE
        and row.get("preseason", {}).get("fantasypros_mae") is not None
    ]
    avg_fp_coverage = _avg(preseason_series["fantasypros_coverage"])
    avg_fp_mae = _avg(preseason_series["fantasypros_mae"])

    preseason_summary = {
        "avg_mae": _avg(preseason_series["scoresense_mae"]),
        "avg_spearman": _avg(preseason_series["scoresense_spearman"]),
        "avg_baseline_mae": _avg(preseason_series["baseline_mae"]),
        "avg_fantasypros_mae": avg_fp_mae,
        "avg_fantasypros_coverage": avg_fp_coverage,
        "beats_baseline_seasons": int(
            sum(
                1
                for row in by_season
                if row.get("preseason", {}).get("beats_baseline_mae")
            )
        ),
        "beats_fantasypros_seasons": int(
            sum(
                1
                for row in fp_fair_seasons
                if row.get("preseason", {}).get("beats_fantasypros_mae")
            )
        ),
        "total_fp_benchmark_seasons": len(fp_fair_seasons),
        "total_seasons": len(seasons_out),
    }

    draft_preseason_summary = {
        "avg_mae": _avg(draft_series["scoresense_mae"]),
        "avg_baseline_mae": _avg(draft_series["baseline_mae"]),
        "avg_fantasypros_mae": _avg(draft_series["fantasypros_mae"]),
        "total_seasons": len(seasons_out),
    }

    ros_summary = {
        week: {
            "avg_mae": _avg(ros_series[week]["scoresense_mae"]),
            "avg_spearman": _avg(ros_series[week]["scoresense_spearman"]),
            "avg_baseline_mae": _avg(ros_series[week]["baseline_mae"]),
        }
        for week in ros_series
    }

    report = {
        "position": position,
        "seasons": seasons_out,
        "ros_checkpoint_weeks": list(ROS_CHECKPOINT_WEEKS),
        "ros_rolling_weeks": rolling_weeks,
        "preseason_blend_alpha": preseason_blend_alpha(position),
        "min_games_played": MIN_GAMES_PLAYED,
        "baseline_label": f"Prior-year PPG × {GAMES_PER_SEASON}",
        "fantasypros_label": FP_PRESEASON_LABEL,
        "fantasypros_is_benchmark": fantasypros_is_fair_benchmark(
            avg_fp_mae,
            float(avg_fp_coverage or 0.0),
            min_coverage=FP_BENCHMARK_MIN_COVERAGE,
        ),
        "preseason_series": preseason_series,
        "preseason_draft_series": draft_series,
        "ros_series": ros_series,
        "by_season": by_season,
        "summary": {
            "preseason": preseason_summary,
            "preseason_draft_cohort": draft_preseason_summary,
            "ros": ros_summary,
        },
        "notes": (
            f"Preseason = walk-forward Week 1 median × expected games "
            f"(prior-year games played or {GAMES_PER_SEASON}; rookies capped). "
            "QB/RB/WR blend with prior-year PPG when α<1. "
            f"Draft cohort = depth-filtered preseason roster (no Sleeper overlay). "
            f"FantasyPros benchmark = week-1 consensus PPR × {GAMES_PER_SEASON} (proxy); "
            f"requires ≥{int(FP_BENCHMARK_MIN_COVERAGE * 100)}% FP coverage per season. "
            f"ROS = YTD + rolling P50 × games remaining ({rolling_weeks}-week window). "
            f"Players with fewer than {MIN_GAMES_PLAYED} games played are excluded."
        ),
    }
    return report


def _apply_tuning_constants(tuning_reports: dict) -> None:
    """Update season_blend constants when holdout improves vs current."""
    import src.projections.season_blend as sb

    for key in ("qb", "rb", "wr"):
        block = tuning_reports.get(f"{key}_blend_tuning")
        if not block:
            continue
        chosen = block.get("chosen_alpha")
        holdout = (block.get("holdout_mae") or {}).get("chosen")
        current = (block.get("holdout_mae") or {}).get("current_constant")
        if chosen is None or holdout is None or current is None:
            continue
        if holdout < current:
            sb.PRESEASON_BLEND_ALPHA[key] = float(chosen)
            if key == "qb":
                sb.QB_PRESEASON_BLEND_ALPHA = float(chosen)
            elif key == "rb":
                sb.RB_PRESEASON_BLEND_ALPHA = float(chosen)
            elif key == "wr":
                sb.WR_PRESEASON_BLEND_ALPHA = float(chosen)

    ros_block = tuning_reports.get("ros_rolling_weeks_tuning")
    if ros_block:
        chosen_w = ros_block.get("chosen_weeks")
        holdout = (ros_block.get("holdout_mae") or {}).get("chosen")
        current = (ros_block.get("holdout_mae") or {}).get("current_constant")
        if chosen_w is not None and holdout is not None and current is not None and holdout < current:
            sb.ROS_ROLLING_WEEKS = int(chosen_w)

    fp_block = tuning_reports.get("fp_blend_tuning") or {}
    for position, block in fp_block.items():
        beta = block.get("chosen_beta")
        if beta is not None:
            sb.PRESEASON_FP_BLEND_BETA[position] = float(beta)


def build_all_season_long_reports(
    test_seasons: list[int] | None = None,
    output_path: Path | None = None,
    *,
    prefetch_fp: bool = False,
    tune_alpha: bool = True,
    tune_ros: bool = True,
    tune_fp_blend: bool = True,
) -> dict:
    output_path = output_path or SEASON_LONG_ACCURACY_PATH
    test_seasons = test_seasons or DEFAULT_ACCURACY_SEASONS
    if prefetch_fp:
        prefetch_fp_preseason_weeks(test_seasons)

    tuning_reports: dict = {}
    if tune_alpha:
        for position in ("qb", "rb", "wr"):
            print(f"Tuning preseason alpha for {position}...")
            df = _load_position_df(position, PROCESSED_DATA_DIR).sort_values(["season", "week"])
            tuning_reports[f"{position}_blend_tuning"] = tune_preseason_alpha(position, df=df)
            release_memory()
        _apply_tuning_constants(tuning_reports)

    if tune_ros:
        print("Tuning ROS rolling window (QB representative)...")
        qb_df = _load_position_df("qb", PROCESSED_DATA_DIR).sort_values(["season", "week"])
        tuning_reports["ros_rolling_weeks_tuning"] = tune_ros_rolling_weeks("qb", df=qb_df)
        _apply_tuning_constants(tuning_reports)
        release_memory()

    rolling_weeks = ROS_ROLLING_WEEKS

    if tune_fp_blend:
        fp_tuning: dict = {}
        for position in ("qb", "rb", "wr"):
            print(f"Tuning FP preseason blend beta for {position}...")
            df = _load_position_df(position, PROCESSED_DATA_DIR).sort_values(["season", "week"])
            fp_tuning[position] = tune_fp_blend_for_position(position, df=df)
            release_memory()
        tuning_reports["fp_blend_tuning"] = fp_tuning

    reports = dict(tuning_reports)
    for position in ("qb", "rb", "wr"):
        print(f"Building season-long accuracy for {position}...")
        reports[position] = build_season_long_report(
            position, test_seasons=test_seasons, rolling_weeks=rolling_weeks
        )
        release_memory()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(reports, indent=2))
    return reports


def load_season_long_report() -> dict:
    if SEASON_LONG_ACCURACY_PATH.exists():
        return json.loads(SEASON_LONG_ACCURACY_PATH.read_text(encoding="utf-8"))
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate season-long projection accuracy")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_ACCURACY_SEASONS)
    parser.add_argument("--output", type=Path, default=SEASON_LONG_ACCURACY_PATH)
    parser.add_argument(
        "--prefetch-fp",
        action="store_true",
        help="Fetch/cache FantasyPros week-1 projections before eval",
    )
    parser.add_argument(
        "--tune-qb-alpha",
        action="store_true",
        help="Sweep QB preseason blend α (alias for --tune-alpha qb only)",
    )
    parser.add_argument(
        "--tune-alpha",
        action="store_true",
        help="Sweep preseason blend α for all positions",
    )
    parser.add_argument(
        "--no-tune-ros",
        action="store_true",
        help="Skip ROS rolling window sweep",
    )
    parser.add_argument(
        "--no-tune-fp-blend",
        action="store_true",
        help="Skip eval-only FP preseason blend sweep",
    )
    args = parser.parse_args()

    tune_alpha = args.tune_alpha or args.tune_qb_alpha or args.position == "all"
    if args.tune_qb_alpha and args.position != "all":
        tune_alpha = True

    if args.position == "all":
        build_all_season_long_reports(
            args.seasons,
            output_path=args.output,
            prefetch_fp=args.prefetch_fp,
            tune_alpha=tune_alpha,
            tune_ros=not args.no_tune_ros,
            tune_fp_blend=not args.no_tune_fp_blend,
        )
    else:
        if args.prefetch_fp:
            prefetch_fp_preseason_weeks(args.seasons)
        existing = load_season_long_report() if args.output.exists() else {}
        if tune_alpha:
            df = _load_position_df(args.position, PROCESSED_DATA_DIR).sort_values(["season", "week"])
            existing[f"{args.position}_blend_tuning"] = tune_preseason_alpha(args.position, df=df)
            _apply_tuning_constants(existing)
        report = build_season_long_report(args.position, test_seasons=args.seasons)
        existing[args.position] = report
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(existing, indent=2))
        print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
