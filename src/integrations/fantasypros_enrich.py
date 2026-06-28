"""Join cached FantasyPros projections and ECR onto mlready training frames."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.integrations.external_projections import _normalize_name
from src.integrations.fantasypros import build_fp_enrichment_frame

POSITIONS = ("qb", "rb", "wr")


def enrich_position_mlready(
    position: str,
    seasons: list[int] | None = None,
    data_dir: Path | None = None,
) -> pd.DataFrame:
    """Add fp_consensus_ppr and fp_ecr columns to a position mlready parquet."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing mlready file: {path}")

    df = pd.read_parquet(path)
    name_col = "player_display_name" if "player_display_name" in df.columns else "player_name"
    df["name_key"] = df[name_col].map(_normalize_name)
    df["team_upper"] = df["team"].astype(str).str.upper()

    season_list = seasons or sorted(df["season"].dropna().unique().astype(int).tolist())
    fp_frames = []
    for season in season_list:
        frame = build_fp_enrichment_frame(season, position)
        if not frame.empty:
            fp_frames.append(frame)

    if not fp_frames:
        df["fp_consensus_ppr"] = float("nan")
        df["fp_ecr"] = float("nan")
        df = df.drop(columns=["name_key", "team_upper"], errors="ignore")
        df.to_parquet(path, index=False)
        return df

    fp = pd.concat(fp_frames, ignore_index=True)
    fp["team_upper"] = fp["team"].astype(str).str.upper()
    fp = fp.drop_duplicates(subset=["season", "week", "name_key", "team_upper"], keep="last")

    out = df.merge(
        fp[["season", "week", "name_key", "team_upper", "fp_consensus_ppr", "fp_ecr"]],
        on=["season", "week", "name_key", "team_upper"],
        how="left",
    )

    name_only = fp.drop_duplicates(subset=["season", "week", "name_key"])[
        ["season", "week", "name_key", "fp_consensus_ppr", "fp_ecr"]
    ].rename(
        columns={
            "fp_consensus_ppr": "fp_consensus_ppr_name",
            "fp_ecr": "fp_ecr_name",
        }
    )
    out = out.merge(name_only, on=["season", "week", "name_key"], how="left")
    out["fp_consensus_ppr"] = out["fp_consensus_ppr"].fillna(out["fp_consensus_ppr_name"])
    out["fp_ecr"] = out["fp_ecr"].fillna(out["fp_ecr_name"])
    out = out.drop(
        columns=[
            "fp_consensus_ppr_name",
            "fp_ecr_name",
            "name_key",
            "team_upper",
        ],
        errors="ignore",
    )
    out.to_parquet(path, index=False)
    matched = out["fp_consensus_ppr"].notna().sum()
    print(f"  {position}: {matched:,}/{len(out):,} rows with FP consensus")
    return out


def enrich_all_mlready(
    seasons: list[int] | None = None,
    data_dir: Path | None = None,
) -> dict[str, int]:
    stats = {}
    for position in POSITIONS:
        df = enrich_position_mlready(position, seasons=seasons, data_dir=data_dir)
        stats[position] = int(df["fp_consensus_ppr"].notna().sum())
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich mlready with FantasyPros columns")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="*")
    parser.add_argument("--all", action="store_true", help="Enrich all positions (default)")
    args = parser.parse_args()

    positions = POSITIONS if args.position == "all" or args.all else (args.position,)
    for pos in positions:
        print(f"Enriching {pos} mlready...")
        enrich_position_mlready(pos, seasons=args.seasons or None)


if __name__ == "__main__":
    main()
