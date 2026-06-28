"""Fast LOO validation for WR candidate features on a short season window."""

from __future__ import annotations

import argparse

from src.analytics.feature_screen import (
    _candidate_columns,
    _load_enriched,
    core_feature_cols,
    evaluate_forward_add,
    evaluate_leave_one_out,
    run_metrics_for_feature_set,
    screen_full_feature_cols,
)
from src.config import CANDIDATE_DATA_DIR, PROCESSED_DATA_DIR


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", type=int, nargs="+", default=[2022, 2023, 2024])
    parser.add_argument(
        "--features",
        nargs="+",
        default=[
            "ngs_avg_separation_avg",
            "ngs_yac_above_expectation_avg",
        ],
    )
    args = parser.parse_args()

    pos = "wr"
    enriched = _load_enriched(pos, PROCESSED_DATA_DIR, CANDIDATE_DATA_DIR)
    cands = _candidate_columns(pos, CANDIDATE_DATA_DIR)
    full = screen_full_feature_cols(pos, cands, enriched)
    core = core_feature_cols(pos)

    print(f"seasons={args.seasons} full_cols={len(full)} core_cols={len(core)}")
    for feat in args.features:
        print(f"  {feat}: enriched={feat in enriched.columns} full_suite={feat in full}")

    print("Full-suite baseline...")
    full_m = run_metrics_for_feature_set(pos, args.seasons, enriched, full)
    print("Skeleton baseline...")
    sk_m = run_metrics_for_feature_set(pos, args.seasons, enriched, core)

    for feat in args.features:
        loo = evaluate_leave_one_out(pos, feat, args.seasons, enriched, full, full_m)
        fwd = evaluate_forward_add(pos, feat, args.seasons, enriched, sk_m)
        print(f"\n=== {feat} ===")
        print(f"  LOO avg_composite_delta: {loo.get('avg_composite_delta')}")
        print(f"  LOO seasons_improved:    {loo.get('seasons_improved')} / {loo.get('seasons_tested')}")
        print(f"  LOO passes_gate (+0.02): {loo.get('passes_gate')}")
        print(f"  LOO avg_mae:             {loo.get('avg_mae')}")
        print(f"  LOO avg_boom_recall:     {loo.get('avg_boom_recall')}")
        for s in loo.get("season_detail") or []:
            print(
                f"    {s['season']}: delta={s['composite_delta']:+.4f} "
                f"mae={s['mae']:.3f} boom_recall={s['boom_recall']:.3f}"
            )
        print(f"  Forward avg_composite_delta: {fwd.get('avg_composite_delta')}")
        print(f"  Forward seasons_improved:    {fwd.get('seasons_improved')}")
        if fwd.get("note"):
            print(f"  Forward note: {fwd['note']}")


if __name__ == "__main__":
    main()
