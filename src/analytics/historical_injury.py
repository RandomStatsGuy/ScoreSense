"""Historical injury flags and vacated-usage features for backtesting."""

from __future__ import annotations

import pandas as pd

STATUS_WEIGHT = {
    "Out": 1.0,
    "IR": 1.0,
    "PUP": 0.9,
    "Doubtful": 0.75,
    "Questionable": 0.35,
    "Inactive": 1.0,
}


def _injury_weight(status: str | None) -> float:
    if not status or pd.isna(status):
        return 0.0
    text = str(status).lower()
    for key, weight in STATUS_WEIGHT.items():
        if key.lower() in text:
            return weight
    return 0.0


def safe_div_series(num: pd.Series, denom: pd.Series) -> pd.Series:
    return (num / denom.replace(0, pd.NA)).fillna(0.0)


def add_historical_injury_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add pre-game injury opportunity signals from nflverse weekly status fields."""
    out = df.copy()
    status_col = next(
        (c for c in ("report_status", "report_primary_injury", "practice_status") if c in out.columns),
        None,
    )
    if status_col is None:
        out["player_injury_weight"] = 0.0
        out["team_vacated_usage"] = 0.0
        out["injury_opportunity_boost_hist"] = 0.0
        out["injury_opportunity_boost_hist_avg"] = 0.0
        return out

    out["player_injury_weight"] = out[status_col].map(_injury_weight)

    share_col = next(
        (c for c in ("target_share_avg", "carry_share_avg", "targets_avg") if c in out.columns),
        None,
    )
    if share_col is None or "team" not in out.columns:
        out["team_vacated_usage"] = 0.0
        out["injury_opportunity_boost_hist"] = 0.0
        out["injury_opportunity_boost_hist_avg"] = 0.0
        return out

    out["weighted_share"] = out[share_col] * out["player_injury_weight"]
    team_vac = (
        out.groupby(["team", "season", "week"], as_index=False)["weighted_share"]
        .sum()
        .rename(columns={"weighted_share": "team_vacated_usage"})
    )
    out = out.merge(team_vac, on=["team", "season", "week"], how="left")
    out["team_vacated_usage"] = out["team_vacated_usage"].fillna(0.0)

    healthy_share = out[share_col].where(out["player_injury_weight"] == 0, 0.0).clip(lower=0.01)
    team_healthy = out.assign(_hs=healthy_share).groupby(["team", "season", "week"])["_hs"].transform("sum")
    out["injury_opportunity_boost_hist"] = (
        out["team_vacated_usage"] * safe_div_series(out[share_col], team_healthy)
    ).where(out["player_injury_weight"] == 0, 0.0).clip(0, 0.35)

    out = out.sort_values(["player_id", "season", "week"])
    out["injury_opportunity_boost_hist_avg"] = (
        out.groupby("player_id")["injury_opportunity_boost_hist"]
        .apply(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
        .reset_index(level=0, drop=True)
        .fillna(0.0)
    )

    out = out.drop(columns=["weighted_share"], errors="ignore")
    return out


def merge_injury_into_weekly(weekly: pd.DataFrame) -> pd.DataFrame:
    return add_historical_injury_features(weekly)
