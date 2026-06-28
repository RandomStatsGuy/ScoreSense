"""Best ball draft board — model season ranks vs ADP proxy."""

from __future__ import annotations

import pandas as pd

from src.config import MODEL_DIR, PROCESSED_DATA_DIR
from src.projections.draft_projections import predict_draft_season
from src.integrations.external_projections import _normalize_name
from src.integrations.fantasypros import (
    build_fp_enrichment_frame,
    fantasypros_api_key_configured,
    prefetch_draft_season_ecr,
)


POSITION_LABELS = {"qb": "QB", "rb": "RB", "wr": "WR/TE"}


def _load_adp_proxy(season: int, position: str) -> pd.DataFrame:
    """FantasyPros week-1 ECR as preseason ADP proxy when cached."""
    fp = build_fp_enrichment_frame(season, position, cache_only=True)
    if fp.empty:
        return pd.DataFrame(columns=["name_key", "team", "adp_rank"])
    wk = fp[fp["week"] == 1] if (fp["week"] == 1).any() else fp
    wk = wk.dropna(subset=["fp_ecr"])
    if wk.empty:
        return pd.DataFrame(columns=["name_key", "team", "adp_rank"])
    out = wk.groupby(["name_key", "team"], as_index=False)["fp_ecr"].min()
    out = out.rename(columns={"fp_ecr": "adp_rank"})
    return out


def build_bestball_board(
    season: int,
    data_dir=None,
    model_dir=None,
    prefetch_adp: bool = True,
) -> tuple[pd.DataFrame, dict]:
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR

    fp_prefetch = None
    if prefetch_adp and fantasypros_api_key_configured():
        fp_prefetch = prefetch_draft_season_ecr(season)

    frames: list[pd.DataFrame] = []
    for position in ("qb", "rb", "wr"):
        draft = predict_draft_season(position, season=season, data_dir=data_dir, model_dir=model_dir)
        if draft.empty:
            continue
        draft = draft.copy()
        draft["Position"] = POSITION_LABELS[position]
        draft["name_key"] = draft["Player"].map(_normalize_name)
        draft["team_upper"] = draft["Team"].astype(str).str.upper()

        adp = _load_adp_proxy(season, position)
        if not adp.empty:
            adp = adp.copy()
            adp["team_upper"] = adp["team"].astype(str).str.upper()
            draft = draft.merge(
                adp[["name_key", "team_upper", "adp_rank"]],
                on=["name_key", "team_upper"],
                how="left",
            )
            name_adp = adp.drop_duplicates("name_key")[["name_key", "adp_rank"]].rename(
                columns={"adp_rank": "adp_rank_name"}
            )
            draft = draft.merge(name_adp, on="name_key", how="left")
            draft["adp_rank"] = draft["adp_rank"].fillna(draft["adp_rank_name"])
            draft = draft.drop(columns=["adp_rank_name"], errors="ignore")
        else:
            draft["adp_rank"] = float("nan")

        draft["model_rank"] = draft["Season Proj"].rank(ascending=False, method="min")
        draft["value_vs_adp"] = draft["adp_rank"] - draft["model_rank"]
        frames.append(draft)

    if not frames:
        return pd.DataFrame(), {"season": season, "count": 0}

    board = pd.concat(frames, ignore_index=True)
    board = board.sort_values(["value_vs_adp", "Season Proj"], ascending=[False, False], na_position="last")
    board["bye_note"] = "Bye clustering not modeled in v1."

    meta = {
        "season": season,
        "count": len(board),
        "with_adp": int(board["adp_rank"].notna().sum()),
        "adp_source": "FantasyPros week-1 ECR (cached) when available",
        "fp_prefetch": fp_prefetch,
    }
    return board, meta
