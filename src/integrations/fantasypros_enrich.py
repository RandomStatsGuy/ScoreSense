"""Join cached, exact-week PPR consensus without erasing existing observations."""

from __future__ import annotations

import argparse
from pathlib import Path
from uuid import uuid4

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.integrations.external_projections import _normalize_name
from src.integrations.fantasypros import build_fp_enrichment_frame

POSITIONS = ("qb", "rb", "wr")
FP_COLS = ("fp_consensus_ppr", "fp_ecr")
TEAM_ALIASES = {"JAC": "JAX", "LA": "LAR", "STL": "LAR", "OAK": "LV", "SD": "LAC", "WSH": "WAS"}


def join_fp_frame(rows: pd.DataFrame, fp: pd.DataFrame, *, preserve_existing: bool = True) -> pd.DataFrame:
    """Prefer exact name/team; permit name-only fallback only when unambiguous.

    A retry with an empty/partial source retains prior training observations.
    Inference explicitly clears stale carried-over consensus before joining.
    """
    out = rows.copy()
    existing = {c: pd.to_numeric(out[c], errors="coerce") if c in out and preserve_existing
                else pd.Series(float("nan"), index=out.index) for c in FP_COLS}
    if fp.empty:
        for col in FP_COLS:
            out[col] = existing[col]
        return out
    name_col = "player_display_name" if "player_display_name" in out else "player_name"
    keys = ["season", "week", "name_key"]
    out["name_key"] = out[name_col].map(_normalize_name)
    out["team_upper"] = out["team"].fillna("").astype(str).str.upper().replace(TEAM_ALIASES)
    source = fp.copy()
    source["team_upper"] = source["team"].fillna("").astype(str).str.upper().replace(TEAM_ALIASES)
    source = source[keys + ["team_upper", *FP_COLS]].drop_duplicates()
    exact_keys = keys + ["team_upper"]
    exact = source[~source.duplicated(exact_keys, keep=False)].set_index(exact_keys)
    names = source[~source.duplicated(keys, keep=False)].set_index(keys)
    for col in FP_COLS:
        values = pd.Series(pd.MultiIndex.from_frame(out[exact_keys]).map(exact[col]), index=out.index, dtype=float)
        fallback = pd.Series(pd.MultiIndex.from_frame(out[keys]).map(names[col]), index=out.index, dtype=float)
        out[col] = values.fillna(fallback).fillna(existing[col])
    return out.drop(columns=["name_key", "team_upper"])


def attach_target_week_consensus(rows: pd.DataFrame, position: str) -> pd.DataFrame:
    """Cache-only inference: a prior game's consensus is never this week's input."""
    frames = []
    for season, week in rows[["season", "week"]].drop_duplicates().itertuples(index=False, name=None):
        frame = build_fp_enrichment_frame(int(season), position, cache_only=True, weeks=range(int(week), int(week)+1))
        if not frame.empty:
            frames.append(frame)
    fp = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return join_fp_frame(rows, fp, preserve_existing=False)


def enrich_position_mlready(position: str, seasons: list[int] | None = None, data_dir: Path | None = None) -> pd.DataFrame:
    data_dir = data_dir or PROCESSED_DATA_DIR
    path = data_dir / f"{position}_mlready.parquet"
    df = pd.read_parquet(path)
    season_list = seasons or sorted(df["season"].dropna().unique().astype(int).tolist())
    frames = [build_fp_enrichment_frame(season, position) for season in season_list]
    fp = pd.concat([f for f in frames if not f.empty], ignore_index=True) if any(not f.empty for f in frames) else pd.DataFrame()
    out = join_fp_frame(df, fp)
    temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        out.to_parquet(temporary, index=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"  {position}: {out['fp_consensus_ppr'].notna().sum():,}/{len(out):,} rows with FP consensus")
    return out


def enrich_all_mlready(seasons: list[int] | None = None, data_dir: Path | None = None) -> dict[str, int]:
    return {pos: int(enrich_position_mlready(pos, seasons, data_dir)["fp_consensus_ppr"].notna().sum()) for pos in POSITIONS}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=[*POSITIONS, "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="*")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    for pos in POSITIONS if args.position == "all" or args.all else (args.position,):
        enrich_position_mlready(pos, args.seasons or None)


if __name__ == "__main__":
    main()
