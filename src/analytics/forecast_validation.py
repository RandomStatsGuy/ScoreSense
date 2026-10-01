"""Paired forecast checks that penalize false alarms and broad intervals.

Research only. Cohorts are selected from the reference's pregame predictions,
never from the candidate's ranks or the target game's realized score.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.special import ndtr
from sklearn.metrics import mean_absolute_error, mean_squared_error, mean_pinball_loss

from src.analytics.upside_eval import boom_threshold
from src.core.game_market import MARKET_COLS, attach_game_market

ACTIONABLE_LIMITS = {"QB": 24, "RB": 48, "WR": 60, "TE": 24}
INDUSTRY_SIZED_LIMITS = {"QB": 20, "RB": 40, "WR": 40, "TE": 20}
BUST_THRESHOLDS = {"qb": 10., "rb": 5., "wr": 5.}


def _validate(rows: pd.DataFrame, predictions: pd.DataFrame) -> None:
    if len(rows) != len(predictions) or not rows.index.equals(predictions.index):
        raise ValueError("Forecasts must match evaluation rows in index and order")
    values = predictions[["q10", "q50", "q90"]].to_numpy(dtype=float)
    if not np.isfinite(values).all() or not np.isfinite(rows.Fpts.to_numpy(dtype=float)).all():
        raise ValueError("Every evaluation row requires finite actuals and quantile forecasts")
    if (values[:, 0] > values[:, 1]).any() or (values[:, 1] > values[:, 2]).any():
        raise ValueError("Evaluation quantiles must be ordered")


def _selection(rows: pd.DataFrame, mask: pd.Series | None) -> np.ndarray:
    if mask is not None and (not rows.index.equals(mask.index) or mask.isna().any()):
        raise ValueError("Cohort mask must match evaluation rows without missing values")
    return np.ones(len(rows), dtype=bool) if mask is None else mask.to_numpy(dtype=bool)


def actionable_mask(rows: pd.DataFrame, reference: pd.DataFrame,
                    limits: dict[str, int] | None = None) -> pd.Series:
    _validate(rows, reference)
    limits = ACTIONABLE_LIMITS if limits is None else limits
    grouped = rows.assign(_reference=reference.q50.to_numpy(), _order=np.arange(len(rows)))
    grouped["_position"] = grouped.position.str.upper().replace({"FB": "RB", "REC": "WR"})
    picked = []
    for (_, _, position), group in grouped.groupby(["season", "week", "_position"]):
        picked.extend(group.nlargest(limits[position], "_reference")._order.tolist())
    return pd.Series(np.isin(np.arange(len(rows)), picked), index=rows.index)


def _classification(actual: np.ndarray, flag: np.ndarray) -> dict:
    tp, fp = int((actual & flag).sum()), int((~actual & flag).sum())
    fn, tn = int((actual & ~flag).sum()), int((~actual & ~flag).sum())
    divide = lambda num, den: float(num / den) if den else None
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": divide(tp, tp+fp), "recall": divide(tp, tp+fn),
        "false_positive_rate": divide(fp, fp+tn), "alert_rate": float(flag.mean()),
        "f1": divide(2*tp, 2*tp+fp+fn)}


def boom_flags(rows: pd.DataFrame, predictions: pd.DataFrame, position: str) -> np.ndarray:
    _validate(rows, predictions)
    grouped = rows.assign(_median=predictions.q50.to_numpy(), _order=np.arange(len(rows)))
    flagged = predictions.q90.to_numpy() >= boom_threshold(position)
    for _, group in grouped.groupby(["season", "week"]):
        selected = group.nlargest(max(1, int(len(group)*.15)), "_median")._order.to_numpy()
        flagged[selected] = True
    return flagged


def quantile_event_probability(predictions: pd.DataFrame, threshold: float) -> np.ndarray:
    """CDF proxy from a quantile-matched piecewise-normal law, not a fitted risk head."""
    median = predictions.q50.to_numpy()
    sigma_low = np.maximum((median-predictions.q10.to_numpy()) / 1.2815515655446004, 1e-3)
    sigma_high = np.maximum((predictions.q90.to_numpy()-median) / 1.2815515655446004, 1e-3)
    sigma = np.where(threshold <= median, sigma_low, sigma_high)
    return ndtr((threshold-median)/sigma)


def forecast_metrics(rows: pd.DataFrame, predictions: pd.DataFrame, position: str,
                     *, mask: pd.Series | None = None, flags: np.ndarray | None = None) -> dict:
    _validate(rows, predictions)
    flags = boom_flags(rows, predictions, position) if flags is None else flags
    if len(flags) != len(rows):
        raise ValueError("Boom flags must match evaluation rows")
    selected = _selection(rows, mask)
    actual = rows.Fpts.to_numpy()[selected]
    pred = predictions.loc[selected]
    if not len(actual):
        raise ValueError("Evaluation cohort is empty")
    low, median, high = (pred[c].to_numpy() for c in ("q10", "q50", "q90"))
    interval_score = high-low + 10.*np.maximum(low-actual, 0.) + 10.*np.maximum(actual-high, 0.)
    boom = actual >= boom_threshold(position)
    bust = actual <= BUST_THRESHOLDS[position]
    boom_prob = 1.-quantile_event_probability(pred, boom_threshold(position))
    bust_prob = quantile_event_probability(pred, BUST_THRESHOLDS[position])
    quantile_calibration = {}
    for q in (.1, .5, .9):
        values = pred[f"q{int(q*100)}"].to_numpy()
        below, at_or_below = float((actual < values).mean()), float((actual <= values).mean())
        # Ties at zero make an exactly nominal CDF impossible; bracket the mass.
        quantile_calibration[str(q)] = {"below": below, "at_or_below": at_or_below,
            "distance_from_nominal": max(below-q, q-at_or_below, 0.)}
    return {"rows": len(actual), "mae": float(mean_absolute_error(actual, median)),
        "rmse": float(np.sqrt(mean_squared_error(actual, median))), "mean_bias": float((median-actual).mean()),
        "pinball": {str(q): float(mean_pinball_loss(actual, pred[f"q{int(q*100)}"], alpha=q)) for q in (.1,.5,.9)},
        "coverage_p10_p90": float(((actual >= low) & (actual <= high)).mean()),
        "mean_width": float((high-low).mean()), "interval_score_80": float(interval_score.mean()),
        # Bracher et al. (2021), K=1, alpha=.2, w0=.5 and w1=alpha/2.
        "weighted_interval_score": float((.5*np.abs(actual-median)+.1*interval_score).mean()/1.5),
        "quantile_calibration": quantile_calibration,
        "boom": _classification(boom, flags[selected]),
        "bust": _classification(bust, low <= BUST_THRESHOLDS[position]),
        "quantile_probability_proxy": {"assumption": "Quantile-matched piecewise normal; not a validated probability head.",
            "boom_brier": float(np.square(boom_prob-boom).mean()), "bust_brier": float(np.square(bust_prob-bust).mean()),
            "mean_boom_probability": float(boom_prob.mean()), "actual_boom_rate": float(boom.mean()),
            "mean_bust_probability": float(bust_prob.mean()), "actual_bust_rate": float(bust.mean())}}


def paired_week_bootstrap(rows: pd.DataFrame, reference: pd.DataFrame, candidate: pd.DataFrame,
                          *, mask: pd.Series | None = None, repeats: int = 2000) -> dict:
    """Paired week-block MAE difference; preserve correlated outcomes within a week."""
    _validate(rows, reference)
    _validate(rows, candidate)
    if repeats < 1:
        raise ValueError("Bootstrap requires at least one repeat")
    selected = _selection(rows, mask)
    frame = rows.loc[selected, ["season", "week"]].copy()
    actual = rows.Fpts.to_numpy()[selected]
    frame["delta"] = np.abs(candidate.q50.to_numpy()[selected]-actual)-np.abs(reference.q50.to_numpy()[selected]-actual)
    groups = frame.groupby(["season", "week"]).delta.agg(["sum", "count"]).to_numpy()
    if not len(groups):
        raise ValueError("Bootstrap cohort is empty")
    rng = np.random.default_rng(20261001)
    samples = groups[rng.integers(0, len(groups), size=(repeats, len(groups)))]
    deltas = samples[:,:,0].sum(axis=1)/samples[:,:,1].sum(axis=1)
    return {"mean_mae_delta": float(frame.delta.mean()), "week_blocks": len(groups), "repeats": repeats,
        "ci95": np.quantile(deltas, [.025,.975]).tolist(), "fraction_delta_below_zero": float((deltas < 0).mean())}
