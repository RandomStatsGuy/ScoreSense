"""FantasyPros API client for weekly consensus projections and rankings."""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import pandas as pd
import requests

from src.config import CACHE_DIR, DEFAULT_FP_ARCHIVE_SEASONS
from src.integrations.external_projections import _normalize_name

FP_BASE_URL = "https://api.fantasypros.com/public/v2/json/nfl"
FP_CACHE_DIR = CACHE_DIR / "fantasypros"
FP_PLAYERS_CACHE = FP_CACHE_DIR / "players_catalog.parquet"

REGULAR_WEEKS = range(1, 19)
DEFAULT_POSITIONS = ("QB", "RB", "WR", "TE")
RANKING_POSITIONS = {
    "qb": "QB",
    "rb": "RB",
    "wr": "WR",
    "te": "TE",
}

REQUEST_SLEEP_SEC = 2.5
MAX_FP_RETRIES = 6


def fantasypros_api_key_configured() -> bool:
    return bool(os.getenv("FANTASYPROS_API_KEY", "").strip())


def get_fantasypros_api_key() -> str:
    key = os.getenv("FANTASYPROS_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "FANTASYPROS_API_KEY is not set. Add it to .env (never commit the key)."
        )
    return key


def _fp_headers() -> dict[str, str]:
    return {"x-api-key": get_fantasypros_api_key()}


def _extract_points_ppr(stats: dict) -> float | None:
    if not isinstance(stats, dict):
        return None
    for key in ("points_ppr", "points", "points_half"):
        val = stats.get(key)
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                continue
    return None


def parse_fp_projections(payload: dict, season: int, week: int) -> pd.DataFrame:
    """Parse FantasyPros weekly projections JSON into a flat dataframe."""
    players = payload.get("players") or payload.get("player") or []
    if isinstance(players, dict):
        players = list(players.values())

    rows: list[dict] = []
    for entry in players:
        if not isinstance(entry, dict):
            continue
        stats = entry.get("stats") or {}
        proj = _extract_points_ppr(stats)
        if proj is None:
            continue
        fpid = entry.get("fpid") or entry.get("player_id")
        name = entry.get("name") or entry.get("player_name")
        team = entry.get("team_id") or entry.get("team") or ""
        pos = str(entry.get("position_id") or entry.get("position") or "").upper()
        rows.append(
            {
                "season": season,
                "week": week,
                "fpid": str(fpid) if fpid is not None else "",
                "player_name": name,
                "team": str(team).upper(),
                "fp_position": pos,
                "fantasypros_proj": float(proj),
                "name_key": _normalize_name(name or ""),
            }
        )
    return pd.DataFrame(rows)


def parse_fp_rankings(payload: dict, season: int, week: int) -> pd.DataFrame:
    """Parse consensus rankings JSON into fp_ecr rows."""
    players = payload.get("players") or []
    rows: list[dict] = []
    for entry in players:
        if not isinstance(entry, dict):
            continue
        fpid = entry.get("player_id") or entry.get("fpid")
        name = entry.get("player_name") or entry.get("name")
        team = entry.get("player_team_id") or entry.get("team_id") or ""
        pos = str(
            entry.get("player_position_id") or entry.get("position_id") or ""
        ).upper()
        rank = entry.get("rank_ecr") or entry.get("rank_ave")
        if rank is None:
            continue
        try:
            ecr = float(rank)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "season": season,
                "week": week,
                "fpid": str(fpid) if fpid is not None else "",
                "player_name": name,
                "team": str(team).upper(),
                "fp_position": pos,
                "fp_ecr": ecr,
                "name_key": _normalize_name(name or ""),
            }
        )
    return pd.DataFrame(rows)


def _fp_get(path: str, params: dict | None = None) -> dict:
    url = f"{FP_BASE_URL}/{path.lstrip('/')}"
    last_response: requests.Response | None = None
    for attempt in range(MAX_FP_RETRIES):
        response = requests.get(url, headers=_fp_headers(), params=params or {}, timeout=90)
        last_response = response
        if response.status_code == 429:
            wait = min(60, 5 * (2 ** attempt))
            time.sleep(wait)
            continue
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Unexpected FantasyPros payload type: {type(payload)}")
        return payload
    if last_response is not None:
        last_response.raise_for_status()
    raise RuntimeError("FantasyPros request failed")


def load_fp_players_catalog(force_refresh: bool = False) -> pd.DataFrame:
    """Cache NFL player catalog from FantasyPros."""
    FP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if FP_PLAYERS_CACHE.exists() and not force_refresh:
        return pd.read_parquet(FP_PLAYERS_CACHE)

    payload = _fp_get("players")
    players = payload.get("players") or []
    rows = []
    for entry in players:
        if not isinstance(entry, dict):
            continue
        rows.append(
            {
                "fpid": str(entry.get("player_id") or ""),
                "player_name": entry.get("player_name") or entry.get("full_name"),
                "team": str(entry.get("team_id") or "").upper(),
                "fp_position": str(entry.get("position_id") or "").upper(),
                "name_key": _normalize_name(entry.get("player_name") or ""),
            }
        )
    df = pd.DataFrame(rows)
    df.to_parquet(FP_PLAYERS_CACHE, index=False)
    time.sleep(REQUEST_SLEEP_SEC)
    return df


def fetch_fp_weekly_projections(
    season: int,
    week: int,
    positions: tuple[str, ...] = DEFAULT_POSITIONS,
    force_refresh: bool = False,
) -> pd.DataFrame:
    FP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = FP_CACHE_DIR / f"{season}_week{week:02d}_proj.parquet"
    if cache.exists() and not force_refresh:
        return pd.read_parquet(cache)

    pos_param = ":".join(positions)
    payload = _fp_get(
        f"{season}/projections",
        {
            "week": week,
            "scoring": "PPR",
            "positions": pos_param,
        },
    )
    df = parse_fp_projections(payload, season, week)
    df.to_parquet(cache, index=False)
    time.sleep(REQUEST_SLEEP_SEC)
    return df


def fetch_fp_weekly_rankings(
    season: int,
    week: int,
    position: str = "ALL",
    force_refresh: bool = False,
) -> pd.DataFrame:
    FP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pos_key = position.upper()
    cache = FP_CACHE_DIR / f"{season}_week{week:02d}_ecr_{pos_key}.parquet"
    if cache.exists() and not force_refresh:
        return pd.read_parquet(cache)

    payload = _fp_get(
        f"{season}/consensus-rankings",
        {
            "week": week,
            "scoring": "PPR",
            "position": pos_key,
            "type": "Weekly",
        },
    )
    df = parse_fp_rankings(payload, season, week)
    df.to_parquet(cache, index=False)
    time.sleep(REQUEST_SLEEP_SEC)
    return df


def _load_cached_week_frames(pattern: str, season: int, weeks: range | None = None) -> list[pd.DataFrame]:
    weeks = weeks or REGULAR_WEEKS
    frames: list[pd.DataFrame] = []
    for week in weeks:
        path = FP_CACHE_DIR / pattern.format(season=season, week=week)
        if path.exists():
            frame = pd.read_parquet(path)
            if not frame.empty:
                frames.append(frame)
    return frames


def load_fp_season_projections(
    season: int,
    weeks: range | None = None,
    force_refresh: bool = False,
    cache_only: bool = False,
) -> pd.DataFrame:
    if cache_only and not force_refresh:
        frames = _load_cached_week_frames("{season}_week{week:02d}_proj.parquet", season, weeks)
        if not frames:
            return pd.DataFrame()
        out = pd.concat(frames, ignore_index=True)
        out["season"] = pd.to_numeric(out["season"], errors="coerce").astype("Int64")
        out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
        return out.drop_duplicates(subset=["season", "week", "name_key", "team"], keep="last")

    weeks = weeks or REGULAR_WEEKS
    frames: list[pd.DataFrame] = []
    for week in weeks:
        try:
            frame = fetch_fp_weekly_projections(season, week, force_refresh=force_refresh)
            if not frame.empty:
                frames.append(frame)
        except requests.HTTPError as exc:
            print(f"  FP projections {season} wk{week}: HTTP {exc.response.status_code}")
        except Exception as exc:
            print(f"  FP projections {season} wk{week}: {exc}")
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["season"] = pd.to_numeric(out["season"], errors="coerce").astype("Int64")
    out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
    return out.drop_duplicates(subset=["season", "week", "name_key", "team"], keep="last")


def load_fp_season_rankings(
    season: int,
    weeks: range | None = None,
    force_refresh: bool = False,
    cache_only: bool = False,
) -> pd.DataFrame:
    if cache_only and not force_refresh:
        frames = _load_cached_week_frames("{season}_week{week:02d}_ecr_ALL.parquet", season, weeks)
        if not frames:
            return pd.DataFrame()
        out = pd.concat(frames, ignore_index=True)
        out["season"] = pd.to_numeric(out["season"], errors="coerce").astype("Int64")
        out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
        return out.drop_duplicates(subset=["season", "week", "name_key", "team"], keep="last")

    weeks = weeks or REGULAR_WEEKS
    frames: list[pd.DataFrame] = []
    for week in weeks:
        try:
            frame = fetch_fp_weekly_rankings(season, week, position="ALL", force_refresh=force_refresh)
            if not frame.empty:
                frames.append(frame)
        except requests.HTTPError as exc:
            print(f"  FP rankings {season} wk{week}: HTTP {exc.response.status_code}")
        except Exception as exc:
            print(f"  FP rankings {season} wk{week}: {exc}")
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["season"] = pd.to_numeric(out["season"], errors="coerce").astype("Int64")
    out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
    return out.drop_duplicates(subset=["season", "week", "name_key", "team"], keep="last")


def _position_filter(fp_df: pd.DataFrame, position: str) -> pd.DataFrame:
    pos = position.lower()
    if pos == "qb":
        return fp_df[fp_df["fp_position"] == "QB"]
    if pos == "rb":
        return fp_df[fp_df["fp_position"].isin(["RB", "FB"])]
    if pos == "wr":
        return fp_df[fp_df["fp_position"].isin(["WR", "TE"])]
    return fp_df


def attach_fantasypros_projections(
    out: pd.DataFrame,
    season: int,
    position: str,
    cache_only: bool = True,
) -> pd.DataFrame:
    """Merge cached FantasyPros weekly projections onto backtest rows."""
    fp = load_fp_season_projections(season, cache_only=cache_only)
    if fp.empty:
        out = out.copy()
        out["fantasypros_proj"] = float("nan")
        return out

    fp = _position_filter(fp, position)
    fp = fp[["season", "week", "name_key", "team", "fantasypros_proj"]].drop_duplicates(
        subset=["season", "week", "name_key", "team"]
    )

    out = out.copy()
    name_col = "player_display_name" if "player_display_name" in out.columns else "player_name"
    if "name_key" not in out.columns:
        out["name_key"] = out[name_col].map(_normalize_name)
    if "team" in out.columns:
        out["team_upper"] = out["team"].astype(str).str.upper()
    else:
        out["team_upper"] = ""

    fp_merge = fp.rename(columns={"team": "team_upper"})
    out = out.merge(
        fp_merge,
        on=["season", "week", "name_key", "team_upper"],
        how="left",
    )
    if "fantasypros_proj" not in out.columns:
        out["fantasypros_proj"] = float("nan")

    name_only = fp.drop_duplicates(subset=["season", "week", "name_key"])[
        ["season", "week", "name_key", "fantasypros_proj"]
    ].rename(columns={"fantasypros_proj": "fantasypros_proj_name"})
    out = out.merge(name_only, on=["season", "week", "name_key"], how="left")
    out["fantasypros_proj"] = out["fantasypros_proj"].fillna(out["fantasypros_proj_name"])
    out = out.drop(columns=["fantasypros_proj_name", "team_upper"], errors="ignore")
    return out


def build_fp_enrichment_frame(season: int, position: str, cache_only: bool = True) -> pd.DataFrame:
    """Combined FP projection + ECR frame for mlready enrichment."""
    proj = load_fp_season_projections(season, cache_only=cache_only)
    ecr = load_fp_season_rankings(season, cache_only=cache_only)
    if proj.empty and ecr.empty:
        return pd.DataFrame()

    proj = _position_filter(proj, position) if not proj.empty else proj
    ecr = _position_filter(ecr, position) if not ecr.empty else ecr

    if proj.empty:
        base = ecr.copy()
        base["fp_consensus_ppr"] = float("nan")
    elif ecr.empty:
        base = proj.copy()
        base["fp_consensus_ppr"] = base["fantasypros_proj"]
        base["fp_ecr"] = float("nan")
    else:
        base = proj.merge(
            ecr[["season", "week", "name_key", "team", "fp_ecr"]],
            on=["season", "week", "name_key", "team"],
            how="left",
        )
        base["fp_consensus_ppr"] = base["fantasypros_proj"]

    return base[
        ["season", "week", "name_key", "team", "fp_consensus_ppr", "fp_ecr"]
    ].drop_duplicates(subset=["season", "week", "name_key", "team"], keep="last")


def fantasypros_is_fair_benchmark(
    fantasypros_avg_mae: float | None,
    coverage_rate: float,
    min_coverage: float = 0.30,
) -> bool:
    if fantasypros_avg_mae is None or not pd.notna(fantasypros_avg_mae):
        return False
    return float(coverage_rate) >= min_coverage


def prefetch_missing_fp_weeks(
    season: int,
    weeks: range | None = None,
    include_rankings: bool = True,
) -> dict:
    """Fetch only cache-missing FP weeks with conservative pacing."""
    weeks = weeks or REGULAR_WEEKS
    stats = {"season": season, "projections_fetched": 0, "rankings_fetched": 0, "errors": 0}
    for week in weeks:
        proj_cache = FP_CACHE_DIR / f"{season}_week{week:02d}_proj.parquet"
        if not proj_cache.exists():
            try:
                frame = fetch_fp_weekly_projections(season, week, force_refresh=True)
                if not frame.empty:
                    stats["projections_fetched"] += 1
            except Exception as exc:
                stats["errors"] += 1
                print(f"  FP projections {season} wk{week}: {exc}")
            time.sleep(REQUEST_SLEEP_SEC)
        if include_rankings:
            rank_cache = FP_CACHE_DIR / f"{season}_week{week:02d}_ecr_ALL.parquet"
            if not rank_cache.exists():
                try:
                    frame = fetch_fp_weekly_rankings(season, week, position="ALL", force_refresh=True)
                    if not frame.empty:
                        stats["rankings_fetched"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    print(f"  FP rankings {season} wk{week}: {exc}")
                time.sleep(REQUEST_SLEEP_SEC)
    return stats


def prefetch_fantasypros_archive(
    seasons: list[int],
    weeks: range | None = None,
    force_refresh: bool = False,
) -> dict:
    """Fetch and cache projections + rankings for backtest seasons."""
    if not fantasypros_api_key_configured():
        return {"status": "skipped", "reason": "FANTASYPROS_API_KEY not set"}

    weeks = weeks or REGULAR_WEEKS
    stats = {"seasons": [], "projection_rows": 0, "ranking_rows": 0}
    for season in seasons:
        print(f"Prefetching FantasyPros {season}...")
        proj = load_fp_season_projections(season, weeks=weeks, force_refresh=force_refresh, cache_only=False)
        rank = load_fp_season_rankings(season, weeks=weeks, force_refresh=force_refresh, cache_only=False)
        stats["seasons"].append(
            {
                "season": season,
                "projections": len(proj),
                "rankings": len(rank),
            }
        )
        stats["projection_rows"] += len(proj)
        stats["ranking_rows"] += len(rank)
    stats["status"] = "ok"
    return stats


def prefetch_draft_season_ecr(draft_season: int, force_refresh: bool = False) -> dict:
    """Cache week-1 consensus ECR for best-ball ADP proxy."""
    if not fantasypros_api_key_configured():
        return {"status": "skipped", "reason": "FANTASYPROS_API_KEY not set"}

    cache = FP_CACHE_DIR / f"{draft_season}_week01_ecr_ALL.parquet"
    if cache.exists() and not force_refresh:
        cached = pd.read_parquet(cache)
        return {
            "status": "cached",
            "season": draft_season,
            "week": 1,
            "rankings": len(cached),
        }

    try:
        rankings = fetch_fp_weekly_rankings(draft_season, 1, position="ALL", force_refresh=force_refresh)
    except Exception as exc:
        return {"status": "error", "season": draft_season, "week": 1, "detail": str(exc)}

    return {
        "status": "ok",
        "season": draft_season,
        "week": 1,
        "rankings": len(rankings),
    }


def archive_fantasypros_week(
    season: int,
    week: int,
    force_refresh: bool = False,
) -> dict:
    """Archive a single week (used by weekly refresh)."""
    if not fantasypros_api_key_configured():
        return {"status": "skipped"}
    proj = fetch_fp_weekly_projections(season, week, force_refresh=force_refresh)
    rank = fetch_fp_weekly_rankings(season, week, force_refresh=force_refresh)
    return {
        "status": "ok",
        "season": season,
        "week": week,
        "projections": len(proj),
        "rankings": len(rank),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Prefetch FantasyPros weekly archive")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_FP_ARCHIVE_SEASONS,
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    stats = prefetch_fantasypros_archive(args.seasons, force_refresh=args.force)
    print(stats)


if __name__ == "__main__":
    main()
