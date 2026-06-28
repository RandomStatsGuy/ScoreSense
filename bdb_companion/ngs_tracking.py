"""
Big Data Bowl / NGS tracking feature extraction.

Loads Next Gen Stats tracking CSVs from data/raw/ngs/ when available (BDB 2026
format). Falls back to nflverse play-by-play proxies otherwise.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import BDB_DIR, DEFAULT_TRAIN_SEASONS, NGS_RAW_DIR
from src.core.features import add_rolling_averages


def discover_ngs_files(data_dir: Path | None = None) -> list[Path]:
    data_dir = data_dir or NGS_RAW_DIR
    if not data_dir.exists():
        return []
    patterns = ("*.csv", "*.parquet", "*.csv.gz")
    files: list[Path] = []
    for pattern in patterns:
        files.extend(data_dir.glob(pattern))
        files.extend(data_dir.glob(f"**/{pattern}"))
    return sorted(set(files))


def load_ngs_tracking(data_dir: Path | None = None) -> pd.DataFrame:
    """Load and concatenate NGS tracking files from data/raw/ngs/."""
    files = discover_ngs_files(data_dir)
    if not files:
        return pd.DataFrame()

    frames = []
    for path in files:
        if path.suffix == ".parquet":
            frames.append(pd.read_parquet(path))
        else:
            frames.append(pd.read_csv(path))
    combined = pd.concat(frames, ignore_index=True)
    combined.columns = [c.strip().lower() for c in combined.columns]
    return combined


def _distance(x1, y1, x2, y2) -> float:
    return float(np.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2))


def compute_ngs_pass_metrics(tracking: pd.DataFrame) -> pd.DataFrame:
    """
    Compute separation at throw and defender closing speed from NGS frames.

    Expected columns (BDB-style):
    - game_id, play_id, frame_id, nfl_id, team, player_position / official_position
    - x, y, s (speed), player_to_predict (optional)
    - num_frames_output / frame_type to identify throw frame
    """
    if tracking.empty:
        return pd.DataFrame()

    df = tracking.copy()
    required = {"game_id", "play_id", "nfl_id", "x", "y"}
    if not required.issubset(df.columns):
        raise ValueError(
            f"NGS tracking missing required columns. Need {required}, got {set(df.columns)}"
        )

    pos_col = "player_position" if "player_position" in df.columns else "position"
    if pos_col not in df.columns:
        df[pos_col] = ""

    if "frame_type" in df.columns:
        throw_frames = df[df["frame_type"].astype(str).str.contains("throw|pass", case=False, na=False)]
        if throw_frames.empty:
            throw_frames = df.groupby(["game_id", "play_id"])["frame_id"].transform("min")
            df = df[df["frame_id"] == throw_frames]
        else:
            df = throw_frames
    else:
        df = df.sort_values(["game_id", "play_id", "frame_id"]).groupby(
            ["game_id", "play_id"], as_index=False
        ).first()

    rows = []
    for (game_id, play_id), play_df in df.groupby(["game_id", "play_id"]):
        offense = play_df[play_df[pos_col].astype(str).isin(["WR", "TE", "RB"])]
        defense = play_df[play_df[pos_col].astype(str).isin(["CB", "S", "FS", "SS", "DB"])]
        if offense.empty or defense.empty:
            continue

        if "player_to_predict" in play_df.columns:
            target_ids = play_df[play_df["player_to_predict"] == 1]["nfl_id"].unique()
            receivers = offense[offense["nfl_id"].isin(target_ids)]
            if receivers.empty:
                receivers = offense
        else:
            receivers = offense

        for _, rec in receivers.iterrows():
            rec_dist = defense.apply(
                lambda d: _distance(rec["x"], rec["y"], d["x"], d["y"]),
                axis=1,
            )
            if rec_dist.empty:
                continue
            nearest_idx = rec_dist.idxmin()
            defender = defense.loc[nearest_idx]
            separation = float(rec_dist.min())

            closing_speed = 0.0
            if "s" in defender.index and pd.notna(defender["s"]):
                closing_speed = float(defender["s"])

            rows.append(
                {
                    "game_id": game_id,
                    "play_id": play_id,
                    "player_id": rec["nfl_id"],
                    "separation_at_throw": separation,
                    "defender_closing_speed": closing_speed,
                }
            )

    if not rows:
        return pd.DataFrame()

    out = pd.DataFrame(rows)
    if "season" not in out.columns and "game_id" in out.columns:
        out["season"] = out["game_id"].astype(str).str[:4].astype(int, errors="ignore")
    if "week" not in out.columns:
        out["week"] = 0
    return out


def aggregate_ngs_weekly(metrics: pd.DataFrame) -> pd.DataFrame:
    if metrics.empty:
        return metrics
    group_cols = ["player_id", "season", "week"]
    present = [c for c in group_cols if c in metrics.columns]
    agg = (
        metrics.groupby(present, as_index=False)
        .agg(
            separation_at_throw=("separation_at_throw", "mean"),
            defender_closing_speed=("defender_closing_speed", "mean"),
            ngs_plays=("separation_at_throw", "count"),
        )
    )
    agg["target_quality_score"] = (
        agg["separation_at_throw"] * 0.08 - agg["defender_closing_speed"] * 0.04
    )
    std = agg["target_quality_score"].std()
    if std and std > 0:
        agg["target_quality_score"] = (agg["target_quality_score"] - agg["target_quality_score"].mean()) / std
    return agg.fillna(0)


def merge_ngs_into_wr_dataset(wr_df: pd.DataFrame, ngs_weekly: pd.DataFrame) -> pd.DataFrame:
    if ngs_weekly.empty:
        return wr_df

    merged = wr_df.merge(
        ngs_weekly,
        on=[c for c in ["player_id", "season", "week"] if c in wr_df.columns and c in ngs_weekly.columns],
        how="left",
    )
    for col in ("separation_at_throw", "defender_closing_speed", "target_quality_score"):
        if col in merged.columns:
            merged[f"{col}_lead"] = merged[col].fillna(0)
            merged = add_rolling_averages(merged, "player_id", [col])
            merged = merged.rename(columns={f"{col}_avg": f"{col}_avg"})
    return merged.fillna(0)


def build_ngs_features(data_dir: Path | None = None) -> pd.DataFrame:
    """Build weekly NGS features; returns empty DataFrame if no raw tracking files."""
    tracking = load_ngs_tracking(data_dir)
    if tracking.empty:
        return pd.DataFrame()
    metrics = compute_ngs_pass_metrics(tracking)
    return aggregate_ngs_weekly(metrics)


def save_ngs_features(output_dir: Path | None = None, data_dir: Path | None = None) -> Path | None:
    output_dir = output_dir or BDB_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    features = build_ngs_features(data_dir)
    if features.empty:
        print("No NGS tracking files found in data/raw/ngs/. Using pbp fallback.")
        return None
    out_path = output_dir / "ngs_tracking_features.csv"
    features.to_csv(out_path, index=False)
    print(f"Wrote NGS features: {len(features):,} rows -> {out_path}")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract BDB/NGS tracking features")
    parser.add_argument("--data-dir", type=Path, default=NGS_RAW_DIR)
    parser.add_argument("--output-dir", type=Path, default=BDB_DIR)
    args = parser.parse_args()
    save_ngs_features(args.output_dir, args.data_dir)


if __name__ == "__main__":
    main()
