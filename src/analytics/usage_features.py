"""Pre-game usage / script features merged into production training."""

from __future__ import annotations

# Always-on usage bundle (Vegas script, snaps, routes, injury context).
USAGE_BUNDLE: dict[str, list[str]] = {
    "qb": [
        "implied_team_total_avg",
        "total_line_avg",
        "team_pass_rate_avg",
        "offense_pct_avg",
        "injury_opportunity_boost_hist_avg",
    ],
    "rb": [
        "implied_team_total_avg",
        "offense_pct_avg",
        "offense_snaps_avg",
        "rz_carries_avg",
        "team_pass_rate_avg",
        "injury_opportunity_boost_hist_avg",
    ],
    "wr": [
        "implied_team_total_avg",
        "offense_pct_avg",
        "routes_avg",
        "rz_targets_avg",
        "explosive_plays_avg",
        "injury_opportunity_boost_hist_avg",
    ],
}

MAX_GATE_PROMOTED = 5
RELAXED_MIN_SEASONS_IMPROVED = 2
# LOO ablation: composite score increase when feature removed (removal hurt model).
MIN_LOO_COMPOSITE_DELTA = 0.02
# Forward add on skeleton: composite decrease when feature added.
MIN_FORWARD_COMPOSITE_DELTA = -0.02


def normalize_position(position: str) -> str:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        return "wr"
    return key


def select_promoted_from_screen(
    screen_df,
    max_features: int = MAX_GATE_PROMOTED,
    ablation_mode: str = "loo",
) -> list[str]:
    """
    Promote features passing the screening gate.

    LOO mode (default): avg_composite_delta > MIN_LOO_COMPOSITE_DELTA means removal
    hurt the full model. Forward mode: avg_composite_delta < MIN_FORWARD_COMPOSITE_DELTA.
    """
    if screen_df is None or screen_df.empty:
        return []

    delta_col = "avg_composite_delta"
    scored = screen_df[screen_df[delta_col].notna()].copy()
    if scored.empty:
        return []

    if ablation_mode == "forward":
        gate_mask = scored["passes_gate"] == True  # noqa: E712
        improver_mask = scored[delta_col] < MIN_FORWARD_COMPOSITE_DELTA
        sort_ascending = True
    else:
        gate_mask = scored["passes_gate"] == True  # noqa: E712
        improver_mask = scored[delta_col] > MIN_LOO_COMPOSITE_DELTA
        sort_ascending = False

    promoted: list[str] = []
    for feat in scored.loc[gate_mask, "feature"]:
        if feat not in promoted:
            promoted.append(feat)

    direction = scored[improver_mask & ~scored["feature"].isin(promoted)].sort_values(
        delta_col, ascending=sort_ascending
    )

    for _, row in direction.iterrows():
        if len(promoted) >= max_features:
            break
        improved = int(row.get("seasons_improved") or 0)
        if improved >= RELAXED_MIN_SEASONS_IMPROVED:
            promoted.append(str(row["feature"]))

    return promoted[:max_features]
