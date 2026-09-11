"""Best ball draft board — model season ranks vs ADP proxy."""

from __future__ import annotations

import pandas as pd

from src.core.schedule_utils import SCHEDULE_CACHE
from src.core.team_codes import normalize_team_to_mlready
from src.draft_hub.draft_pool_cache import load_draft_pool
from src.integrations.external_projections import _normalize_name
from src.integrations.fantasypros import (
    build_fp_enrichment_frame,
)


POSITION_LABELS = {"qb": "QB", "rb": "RB", "wr": "WR/TE"}


def _team_bye_map(season: int) -> dict[str, int]:
    """Read the local schedule once; missing schedule data must not trigger ETL."""
    try:
        if not SCHEDULE_CACHE.exists():
            return {}
        schedules = pd.read_parquet(SCHEDULE_CACHE)
        regular = schedules.loc[
            schedules["season"].eq(int(season)) & schedules["week"].between(1, 18)
        ]
        if "game_type" in regular.columns:
            regular = regular.loc[regular["game_type"].eq("REG")]
        if regular.empty:
            return {}
        all_teams = set(regular["home_team"].dropna().str.upper()) | set(
            regular["away_team"].dropna().str.upper()
        )
        byes = {}
        for week, games in regular.groupby("week", sort=True):
            playing = set(games["home_team"].dropna().str.upper()) | set(
                games["away_team"].dropna().str.upper()
            )
            for team in all_teams - playing:
                byes.setdefault(normalize_team_to_mlready(team), int(week))
        return byes
    except Exception:
        return {}


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


def build_bestball_board(season: int) -> tuple[pd.DataFrame, dict]:
    """Build from current projection/ECR artifacts, never live inference or ECR fetches.

    Preseason/weekly refresh jobs own materialization. A cold or stale pool is
    reported as unavailable so a page visit cannot start three model runs.
    """
    pool = load_draft_pool(int(season), allow_compute=False, apply_identity=False)
    if pool.empty:
        raise FileNotFoundError("Season projections are not ready yet. Please try again later.")
    positions = pool["Position"].astype(str).str.upper()

    frames: list[pd.DataFrame] = []
    for position in ("qb", "rb", "wr"):
        labels = ("WR", "TE") if position == "wr" else (POSITION_LABELS[position],)
        draft = pool.loc[positions.isin(labels)].copy()
        if draft.empty:
            continue
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
    board["bye_week"] = board["team_upper"].map(_team_bye_map(season))

    meta = {
        "season": season,
        "count": len(board),
        "with_adp": int(board["adp_rank"].notna().sum()),
        "adp_source": "FantasyPros week-1 ECR (cached) when available",
        "fp_prefetch": None,
        "projection_source": "draft_pool_cache",
    }
    return board, meta
