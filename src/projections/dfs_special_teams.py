"""DraftKings kicker/team-defense quantile candidates and walk-forward gate.

Kicker targets are team kicking opportunity totals: application requires a
uniquely identified current starting kicker. No inactive/backup allocation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_pinball_loss

VERSION = "dk-special-teams-v1"
QUANTILES = (0.1, 0.5, 0.9)
FEATURES = ("own_mean", "own_std", "own_recent", "opponent_mean", "opponent_recent")


def score_history(teams: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    required = ["season", "week", "team", "opponent_team", "game_id", "season_type",
                "fg_made_0_19", "fg_made_20_29", "fg_made_30_39", "fg_made_40_49",
                "fg_made_50_59", "fg_made_60_", "pat_made", "def_sacks", "def_interceptions",
                "fumble_recovery_opp", "def_tds", "special_teams_tds", "def_safeties",
                "def_punt_blocks", "def_fg_blocks", "def_pat_blocks", "def_2pt_made"]
    missing = set(required) - set(teams.columns)
    if missing:
        raise ValueError(f"Special-teams history lacks fields: {sorted(missing)}")
    frame = teams.loc[teams.season_type.eq("REG"), required].copy()
    if frame.duplicated(["game_id", "team"]).any():
        raise ValueError("Duplicate team game history")
    for col in required[6:]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    if not np.isfinite(frame[required[6:]].to_numpy()).all():
        raise ValueError("Incomplete scoring inputs in special-teams history")
    scores = pd.concat([
        games[["game_id", "home_team", "home_score"]].rename(columns={"home_team": "team", "home_score": "final_score"}),
        games[["game_id", "away_team", "away_score"]].rename(columns={"away_team": "team", "away_score": "final_score"}),
    ])
    frame = frame.merge(scores, on=["game_id", "team"], validate="one_to_one")
    frame = frame[frame.final_score.notna()].copy()
    opponent = frame[["game_id", "team", "final_score", "def_tds", "def_safeties"]].rename(
        columns={"team": "opponent_team", "final_score": "opp_score", "def_tds": "opp_def_tds", "def_safeties": "opp_safeties"})
    frame = frame.merge(opponent, on=["game_id", "opponent_team"], validate="one_to_one")
    allowed = frame.opp_score - 6 * frame.opp_def_tds - 2 * frame.opp_safeties
    if (allowed < 0).any():
        raise ValueError("Invalid defensive points allowed")
    pa = np.select([allowed.eq(0), allowed.le(6), allowed.le(13), allowed.le(20), allowed.le(27), allowed.le(34)],
                   [10, 7, 4, 1, 0, -1], default=-4)
    frame["K"] = (3 * (frame.fg_made_0_19 + frame.fg_made_20_29 + frame.fg_made_30_39)
                  + 4 * frame.fg_made_40_49 + 5 * (frame.fg_made_50_59 + frame.fg_made_60_) + frame.pat_made)
    frame["DST"] = (frame.def_sacks + 2 * (frame.def_interceptions + frame.fumble_recovery_opp)
                    + 6 * (frame.def_tds + frame.special_teams_tds) + 2 * (frame.def_safeties
                    + frame.def_punt_blocks + frame.def_fg_blocks + frame.def_pat_blocks + frame.def_2pt_made) + pa)
    from src.core.team_codes import normalize_team_for_match
    for column in ("team", "opponent_team"):
        frame[column] = frame[column].map(normalize_team_for_match)
    return frame[["season", "week", "game_id", "team", "opponent_team", "K", "DST"]].sort_values(["season", "week", "game_id", "team"]).reset_index(drop=True)


def features_before(history, team, opponent, season, week, position):
    prior = history[(history.season < season) | ((history.season == season) & (history.week < week))]
    prior = prior[prior.season >= season - 3]
    own = prior.loc[prior.team.eq(team), position].tail(16)
    # Opponent's prior conceded fantasy scores, never its current game result.
    conceded = prior.loc[prior.opponent_team.eq(opponent), position].tail(16)
    league = prior[position].tail(1024)
    base = float(league.mean()) if len(league) else np.nan
    return [float(own.mean()) if len(own) else base,
            float(own.std(ddof=0)) if len(own) else float(league.std(ddof=0)),
            float(own.tail(4).mean()) if len(own) else base,
            float(conceded.mean()) if len(conceded) else base,
            float(conceded.tail(4).mean()) if len(conceded) else base]


def training_matrix(history, position):
    rows = [features_before(history, r.team, r.opponent_team, r.season, r.week, position)
            for r in history.itertuples()]
    return np.asarray(rows, dtype=float)


def fit_heads(x, y):
    return [GradientBoostingRegressor(loss="quantile", alpha=q, n_estimators=80,
            max_depth=2, min_samples_leaf=60, learning_rate=0.03, random_state=17).fit(x, y) for q in QUANTILES]


def predict_heads(heads, x):
    return np.sort(np.column_stack([h.predict(x) for h in heads]), axis=1)


def evaluate_gate(history, test_seasons=(2023, 2024)):
    report = {"version": VERSION, "test_seasons": list(test_seasons), "positions": {}}
    for position in ("K", "DST"):
        x = training_matrix(history, position)
        y = history[position].to_numpy()
        valid = np.isfinite(x).all(axis=1) & np.isfinite(y)
        folds = []
        for year in test_seasons:
            train = valid & (history.season.to_numpy() < year)
            test = valid & (history.season.to_numpy() == year)
            if train.sum() < 1000 or test.sum() < 400:
                raise ValueError("Insufficient walk-forward sample")
            prediction = predict_heads(fit_heads(x[train], y[train]), x[test])
            baseline = np.quantile(y[train], QUANTILES)
            pinball = [mean_pinball_loss(y[test], prediction[:, i], alpha=q) for i, q in enumerate(QUANTILES)]
            base_pinball = [mean_pinball_loss(y[test], np.full(test.sum(), baseline[i]), alpha=q) for i, q in enumerate(QUANTILES)]
            folds.append({"season": int(year), "rows": int(test.sum()), "mae": float(mean_absolute_error(y[test], prediction[:, 1])),
                          "baseline_mae": float(mean_absolute_error(y[test], np.full(test.sum(), baseline[1]))),
                          "pinball": [float(v) for v in pinball], "baseline_pinball": [float(v) for v in base_pinball],
                          "coverage": float(np.mean((y[test] >= prediction[:, 0]) & (y[test] <= prediction[:, 2])))})
        # Both held-out seasons must beat unconditional median and average
        # quantile loss; interval coverage must remain in a declared range.
        passed = all(f["mae"] <= f["baseline_mae"] and np.mean(f["pinball"]) <= np.mean(f["baseline_pinball"])
                     and 0.70 <= f["coverage"] <= 0.90 for f in folds)
        report["positions"][position] = {"passed": bool(passed), "folds": folds}
    return report
