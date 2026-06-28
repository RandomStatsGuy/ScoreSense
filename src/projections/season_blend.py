"""Season-long projection blending helpers."""

from __future__ import annotations

import pandas as pd

from src.config import GAMES_PER_SEASON

# Tuned on 2019–2024 walk-forward; 2025 holdout (season_long_accuracy.json)
QB_PRESEASON_BLEND_ALPHA = 0.3
RB_PRESEASON_BLEND_ALPHA = 0.55
WR_PRESEASON_BLEND_ALPHA = 0.4

PRESEASON_BLEND_ALPHA: dict[str, float] = {
    "qb": QB_PRESEASON_BLEND_ALPHA,
    "rb": RB_PRESEASON_BLEND_ALPHA,
    "wr": WR_PRESEASON_BLEND_ALPHA,
}

# Eval-tuned ScoreSense weight vs FP week-1 × 17; enable via PRESEASON_FP_BLEND_ENABLED
PRESEASON_FP_BLEND_BETA: dict[str, float] = {"qb": 0.3, "rb": 0.3, "wr": 0.35}

ROS_ROLLING_WEEKS = 4
ROS_ROLLING_WEEK_CANDIDATES = (2, 3, 4, 6, 8)

DEFAULT_ROOKIE_EXPECTED_GAMES = 12


def preseason_fp_blend_beta(position: str) -> float:
    return float(PRESEASON_FP_BLEND_BETA.get(position.lower(), 1.0))


def preseason_blend_alpha(position: str) -> float:
    return float(PRESEASON_BLEND_ALPHA.get(position.lower(), 1.0))


def games_remaining_in_season(games_played: int, games_per_season: int = GAMES_PER_SEASON) -> int:
    return max(0, int(games_per_season) - int(games_played))


def prior_year_ppg_map(df: pd.DataFrame, season: int) -> pd.Series:
    """Map player_id -> prior-season PPG."""
    prior_season = season - 1
    reg = df[(df["season"] == prior_season) & (df["week"].between(1, 18))]
    if reg.empty:
        return pd.Series(dtype=float)
    grouped = reg.groupby("player_id").agg(fpts=("Fpts", "sum"), games=("week", "nunique"))
    return grouped["fpts"] / grouped["games"].clip(lower=1)


def prior_year_games_map(df: pd.DataFrame, season: int) -> pd.Series:
    """Map player_id -> prior-season regular-season games played."""
    prior_season = season - 1
    reg = df[(df["season"] == prior_season) & (df["week"].between(1, 18))]
    if reg.empty:
        return pd.Series(dtype=float)
    return reg.groupby("player_id")["week"].nunique()


def expected_preseason_games(
    player_ids: pd.Series,
    prior_games: pd.Series,
    *,
    games_per_season: int = GAMES_PER_SEASON,
    rookie_games: int = DEFAULT_ROOKIE_EXPECTED_GAMES,
) -> pd.Series:
    """
    Expected regular-season games for preseason totals.

    Veterans: prior-year games played (capped at games_per_season).
    Rookies / no prior: rookie_games default.
    """
    prior = player_ids.astype(str).map(lambda pid: prior_games.get(pid, float("nan")))
    veteran = prior.notna()
    expected = prior.clip(lower=1, upper=games_per_season)
    expected = expected.where(veteran, float(rookie_games))
    return expected.fillna(rookie_games).astype(int)


def _games_series(
    games: int | pd.Series,
    index: pd.Index,
) -> pd.Series:
    if isinstance(games, pd.Series):
        return games.reindex(index).fillna(GAMES_PER_SEASON).astype(float)
    return pd.Series(float(games), index=index)


def blend_preseason_totals(
    player_ids: pd.Series,
    model_ppg: pd.Series,
    prior_ppg: pd.Series,
    *,
    games: int | pd.Series = GAMES_PER_SEASON,
    alpha: float = 1.0,
) -> pd.Series:
    """Blend model per-game rate with prior-year PPG for preseason season totals."""
    idx = player_ids.index
    games_s = _games_series(games, idx)
    model_total = model_ppg.astype(float) * games_s
    prior = player_ids.astype(str).map(lambda pid: float(prior_ppg.get(pid, float("nan"))))
    prior_total = prior * games_s
    missing_prior = prior_total.isna()
    if alpha >= 1.0:
        return model_total.round(1)
    if alpha <= 0.0:
        return prior_total.fillna(model_total).round(1)
    blended = alpha * model_total + (1.0 - alpha) * prior_total.fillna(model_total)
    return blended.where(~missing_prior, model_total).round(1)


def blend_qb_preseason_totals(
    player_ids: pd.Series,
    model_ppg: pd.Series,
    prior_ppg: pd.Series,
    *,
    games: int | pd.Series = GAMES_PER_SEASON,
    alpha: float = QB_PRESEASON_BLEND_ALPHA,
) -> pd.Series:
    """Backward-compatible QB preseason blend."""
    return blend_preseason_totals(
        player_ids, model_ppg, prior_ppg, games=games, alpha=alpha
    )


def blend_with_fp_preseason(
    scoresense_total: pd.Series,
    fp_total: pd.Series,
    *,
    beta: float,
) -> pd.Series:
    """β × ScoreSense + (1−β) × FantasyPros; falls back to ScoreSense when FP missing."""
    fp = fp_total.astype(float)
    ss = scoresense_total.astype(float)
    if beta >= 1.0:
        return ss
    blended = beta * ss + (1.0 - beta) * fp
    return blended.where(fp.notna(), ss).round(1)


def rolling_model_rate(
    week_preds: list[pd.DataFrame],
    *,
    value_col: str = "model_pred",
) -> pd.DataFrame:
    """Average weekly model P50 across a window, keyed by player_id."""
    frames = [f[["player_id", value_col]].copy() for f in week_preds if not f.empty]
    if not frames:
        return pd.DataFrame(columns=["player_id", value_col])
    merged = pd.concat(frames, ignore_index=True)
    return merged.groupby("player_id", as_index=False)[value_col].mean()
