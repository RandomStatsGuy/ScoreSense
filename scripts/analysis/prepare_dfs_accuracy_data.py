"""Capture public football inputs and build an isolated, observed REG-game dataset.

The capture is retrospective. Fetch time is not a historical publication cutoff,
and stat rows do not reconstruct inactive roster weeks. No serving cache is used.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
import requests

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"
SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
PBP_COLUMNS = [
    "season", "week", "season_type", "game_id", "posteam", "defteam", "epa",
    "play_type", "pass", "rush", "pass_attempt", "rush_attempt", "complete_pass",
    "yards_gained", "air_yards", "touchdown", "yardline_100", "receiver_player_id",
    "rusher_player_id", "pass_oe", "receiver", "cpoe", "xyac_epa", "pass_touchdown",
]
KEYS = ["player_id", "season", "week"]


def normalized_teams(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    from src.core.team_codes import normalize_team_for_match
    out = frame.copy()
    for column in columns:
        if column in out:
            out[column] = out[column].map(lambda value: normalize_team_for_match(value) if pd.notna(value) else value)
    return out


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n")


def capture_source(raw_dir: Path, name: str, url: str) -> dict:
    """Reuse only a complete capture whose bytes still match its source receipt."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / name
    receipt_path = raw_dir / f"{name}.source.json"
    if target.exists() or receipt_path.exists():
        if not target.exists() or not receipt_path.exists():
            raise ValueError(f"Incomplete source capture: {name}")
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("url") != url or receipt.get("sha256") != sha256(target):
            raise ValueError(f"Source capture identity changed: {name}")
        return receipt
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=(30, 180)) as response:
            response.raise_for_status()
            with temporary.open("wb") as handle:
                for block in response.iter_content(chunk_size=1024 * 1024):
                    if block:
                        handle.write(block)
            receipt = {"path": f"raw/{name}", "url": url, "resolved_url": response.url,
                "fetched_at_utc": utc_now(), "bytes": temporary.stat().st_size,
                "sha256": sha256(temporary), "etag": response.headers.get("ETag"),
                "last_modified": response.headers.get("Last-Modified")}
        temporary.replace(target)
        write_json(receipt_path, receipt)
        print(f"Captured {name}: {receipt['bytes']:,} bytes", flush=True)
        return receipt
    finally:
        temporary.unlink(missing_ok=True)


def require_unique(frame: pd.DataFrame, keys: list[str], label: str) -> None:
    missing = set(keys) - set(frame.columns)
    if missing or frame[keys].isna().any().any() or frame.duplicated(keys).any():
        raise ValueError(f"{label} requires nonmissing unique keys {keys}; missing columns: {sorted(missing)}")


def regular_schedules(frame: pd.DataFrame, seasons: list[int]) -> pd.DataFrame:
    required = {"game_id", "season", "week", "game_type", "home_team", "away_team", "gameday"}
    if not required.issubset(frame):
        raise ValueError("Schedules lack explicit game identity/type")
    out = normalized_teams(frame[frame.season.isin(seasons) & frame.game_type.eq("REG")], ["home_team", "away_team"])
    require_unique(out, ["game_id"], "REG schedules")
    require_unique(out, ["season", "week", "home_team"], "REG home schedule")
    require_unique(out, ["season", "week", "away_team"], "REG away schedule")
    if set(out.season.unique()) != set(seasons):
        raise ValueError("Missing requested regular season")
    if out[["home_score", "away_score"]].isna().any().any():
        raise ValueError("Historical regular season contains unfinished games")
    out["gameday"] = pd.to_datetime(out.gameday)
    return out


def regular_stats(frame: pd.DataFrame, schedules: pd.DataFrame, seasons: list[int]) -> pd.DataFrame:
    from src.etl.nflverse_etl import _normalize_weekly_columns
    out = _normalize_weekly_columns(frame)
    if "season_type" not in out:
        raise ValueError("Current weekly feed lacks explicit season_type; no legacy fallback allowed")
    # The feed also contains unassigned team-stat and defensive/specialist rows.
    # Only the existing skill-model position families form this experiment.
    out = normalized_teams(out[out.season.isin(seasons) & out.season_type.eq("REG") & out.position.isin(["QB", "RB", "FB", "WR", "TE"])], ["team", "opponent"])
    require_unique(out, KEYS, "Observed REG player stats")
    teams = pd.concat([schedules[["season", "week", "home_team", "away_team"]].rename(columns={"home_team": "team", "away_team": "_scheduled_opponent"}),
        schedules[["season", "week", "away_team", "home_team"]].rename(columns={"away_team": "team", "home_team": "_scheduled_opponent"})])
    require_unique(teams, ["season", "week", "team"], "REG team games")
    checked = out.merge(teams.assign(_regular_game=True), on=["season", "week", "team"], how="left", validate="many_to_one")
    if checked._regular_game.isna().any():
        raise ValueError("Observed stat row does not match a completed REG team game")
    if "opponent" not in checked or not checked.opponent.eq(checked._scheduled_opponent).all():
        raise ValueError("Observed stat opponent does not match its completed REG game")
    if set(out.season.unique()) != set(seasons):
        raise ValueError("Weekly feed does not cover every requested season")
    return out


def regular_pbp(frame: pd.DataFrame, schedules: pd.DataFrame) -> pd.DataFrame:
    if not {"season_type", "game_id"}.issubset(frame):
        raise ValueError("PBP lacks explicit regular-season game identity")
    out = normalized_teams(frame[frame.season_type.eq("REG")], ["posteam", "defteam"])
    if out.game_id.isna().any() or not set(out.game_id).issubset(set(schedules.game_id)):
        raise ValueError("PBP contains an unknown REG game")
    return out


def mapped_snap_counts(snaps: pd.DataFrame, ids: pd.DataFrame, schedules: pd.DataFrame,
                       observed_skill_spine: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Use the production PFR→GSIS loader against captured frames only."""
    from src.analytics import candidate_etl
    teams = pd.concat([schedules[["season", "week", "home_team"]].rename(columns={"home_team": "team"}),
        schedules[["season", "week", "away_team"]].rename(columns={"away_team": "team"})])
    raw = normalized_teams(snaps, ["team"]).merge(teams.assign(_regular_game=True), on=["season", "week", "team"], how="inner", validate="many_to_one")
    crosswalk = ids[["pfr_id", "gsis_id"]].dropna().drop_duplicates()
    ambiguous = crosswalk.groupby("pfr_id").gsis_id.nunique().gt(1)
    pfr_col = next((c for c in ("pfr_player_id", "pfr_id") if c in raw), None)
    if pfr_col is None:
        raise ValueError("Snap feed lacks PFR identity")
    valid = crosswalk[~crosswalk.pfr_id.isin(ambiguous[ambiguous].index)]
    unmatched = int((~raw[pfr_col].isin(valid.pfr_id)).sum())
    class CapturedNFL:
        @staticmethod
        def import_snap_counts(years):
            return raw.copy()
        @staticmethod
        def import_ids():
            return ids.copy()
    with patch.object(candidate_etl, "_import_nfl_data_py", return_value=CapturedNFL):
        mapped = candidate_etl._load_snap_counts(sorted(schedules.season.unique().tolist()))
    all_mapped_rows = len(mapped)
    # Preserve the exact team of the observed skill-player game. Defensive and
    # special-teams records can include two teams in one week and are outside
    # this observed skill-stat experiment, not arbitrarily deduplicated.
    require_unique(observed_skill_spine, KEYS, "Observed skill spine")
    mapped = mapped.merge(observed_skill_spine[[*KEYS, "team"]], on=[*KEYS, "team"], how="inner", validate="many_to_one")
    # Candidate merge keys do not contain team. Do not multiply player games.
    require_unique(mapped, KEYS, "Mapped REG snaps")
    return mapped, {"raw_reg_rows": len(raw), "all_mapped_reg_rows": all_mapped_rows, "observed_skill_matched_rows": len(mapped),
        "unmatched_pfr_rows": unmatched, "ambiguous_pfr_ids": int(ambiguous.sum()),
        "mapping_source": IDS_URL, "unmatched_policy": "Missing observations remain missing; no zero role invented."}


def prepare_snapshot(destination: Path, seasons: list[int], workers: int = 4) -> dict:
    from src.config import DATA_DIR, MODEL_DIR
    from src.etl import nflverse_etl as etl
    from src.analytics import candidate_etl
    from bdb_companion.target_quality import build_pbp_target_quality
    from src.core.features import feature_completeness, get_position_features
    destination = destination.resolve()
    for protected in (DATA_DIR.resolve(), MODEL_DIR.parent.parent.resolve()):
        if destination == protected or protected in destination.parents or destination in protected.parents:
            raise ValueError("Use an isolated output folder outside serving data and artifacts")
    raw_dir, processed, candidates = destination / "raw", destination / "processed", destination / "candidates"
    requests_spec = [("games.csv", SCHEDULE_URL), ("db_playerids.csv", IDS_URL)]
    for season in seasons:
        requests_spec.extend([(f"stats_player_week_{season}.parquet", f"{RELEASE}/stats_player/stats_player_week_{season}.parquet"),
            (f"play_by_play_{season}.parquet", f"{RELEASE}/pbp/play_by_play_{season}.parquet"),
            (f"snap_counts_{season}.parquet", f"{RELEASE}/snap_counts/snap_counts_{season}.parquet")])
    manifest = {"schema_version": "dfs_accuracy_source_capture_v1", "status": "preparing", "started_at_utc": utc_now(),
        "seasons": seasons, "cohort": "Observed player-stat rows in completed REG games, including played zeros/negative scores; inactive weeks not reconstructed.",
        "publication_cutoff": "Retrospective source capture; no historical pregame availability cutoff established.",
        "scoring": "nflverse PPR; not complete DraftKings/FanDuel scoring or contest-return validation.",
        "target_quality_timing": "Use target_quality_raw through the versioned pregame policy. The legacy globally normalized score is retained for compatibility and is not a pregame-safe feature.",
        "legacy_fallback_used": False, "sources": [],
        "exclusions": ["NGS receiving screening columns: not used by the serving feature contract; omitted after existing candidate builder.",
            "Non-skill-model position families and anonymous team-stat rows are excluded before key validation.",
            "Private/BDB tracking absent; PBP proxy target quality retained with its explicit raw scale.",
            "Historical injury reports unavailable in this source capture; compatibility injury features are zero and audited, not observed healthy status.",
            "No provider consensus, DFS salaries, contest entries, current roster/injury overlays or live databases."]}
    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(capture_source, raw_dir, name, url) for name, url in requests_spec]
            for future in futures:
                manifest["sources"].append(future.result())
                write_json(destination / "manifest.json", manifest)
        schedules = regular_schedules(pd.read_csv(raw_dir / "games.csv"), seasons)
        weekly = regular_stats(pd.concat([pd.read_parquet(raw_dir / f"stats_player_week_{s}.parquet") for s in seasons], ignore_index=True), schedules, seasons)
        pbp = regular_pbp(pd.concat([pd.read_parquet(raw_dir / f"play_by_play_{s}.parquet", columns=PBP_COLUMNS) for s in seasons], ignore_index=True), schedules)
        snaps, snap_audit = mapped_snap_counts(pd.concat([pd.read_parquet(raw_dir / f"snap_counts_{s}.parquet") for s in seasons], ignore_index=True), pd.read_csv(raw_dir / "db_playerids.csv", low_memory=False), schedules, weekly)
        print(f"Validated REG inputs: {len(weekly):,} stat rows, {len(pbp):,} plays, {len(snaps):,} mapped snaps", flush=True)
        # Adapt only source loading. Builders and feature definitions remain the
        # real production functions; unexpected remote reads fail immediately.
        def blocked(*args, **kwargs):
            raise RuntimeError("Unexpected network/source access inside captured-data build")
        with ExitStack() as stack:
            stack.enter_context(patch.object(etl, "load_weekly_player_stats", return_value=weekly))
            stack.enter_context(patch.object(etl, "load_schedules", return_value=schedules))
            stack.enter_context(patch.object(etl, "load_play_by_play", return_value=pbp))
            stack.enter_context(patch.object(etl, "build_target_quality", side_effect=lambda seasons, pbp: build_pbp_target_quality(seasons, pbp=pbp)))
            stack.enter_context(patch.object(candidate_etl, "_load_snap_counts", return_value=snaps))
            stack.enter_context(patch.object(candidate_etl, "load_ngs_receiving_weekly", return_value=pd.DataFrame()))
            stack.enter_context(patch("requests.sessions.Session.request", side_effect=blocked))
            stack.enter_context(patch("urllib.request.urlopen", side_effect=blocked))
            paths = etl.build_all_datasets(seasons=seasons, output_dir=processed, candidate_dir=candidates)
        manifest["snap_mapping"] = snap_audit
        manifest["datasets"] = {}
        for position, path in paths.items():
            frame = pd.read_parquet(path)
            frame = frame.drop(columns=[c for c in frame if c.startswith("ngs_")], errors="ignore")
            require_unique(frame, KEYS, f"{position} output")
            if not np.isfinite(frame.Fpts.to_numpy()).all():
                raise ValueError(f"{position}: nonfinite scoring outcomes")
            frame.to_parquet(path, index=False)
            cand_path = candidates / f"candidate_features_{position}.parquet"
            cand = pd.read_parquet(cand_path)
            cand.drop(columns=[c for c in cand if c.startswith("ngs_")]).to_parquet(cand_path, index=False)
            manifest["datasets"][position] = {"path": str(path.relative_to(destination)), "sha256": sha256(path),
                "rows": len(frame), "by_season": {str(k): int(v) for k, v in frame.groupby("season").size().items()},
                "positions": frame.position.value_counts().to_dict(), "zero_scores": int(frame.Fpts.eq(0).sum()),
                "negative_scores": int(frame.Fpts.lt(0).sum()), "input_quality": feature_completeness(frame, get_position_features(position).feature_cols),
                "candidate_sha256": sha256(cand_path)}
        manifest["source_code_sha256"] = {str(p): sha256(Path(p)) for p in [
            "scripts/analysis/prepare_dfs_accuracy_data.py", "src/etl/nflverse_etl.py", "src/analytics/candidate_etl.py",
            "src/analytics/historical_injury.py", "bdb_companion/target_quality.py"]}
        manifest["status"] = "complete"
        manifest["completed_at_utc"] = utc_now()
        write_json(destination / "manifest.json", manifest)
        return manifest
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["error"] = f"{type(exc).__name__}: {exc}"
        write_json(destination / "manifest.json", manifest)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seasons", type=int, nargs="+", default=list(range(2018, 2026)))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if sorted(set(args.seasons)) != args.seasons or any(s < 2018 or s > 2025 for s in args.seasons):
        raise ValueError("Use unique, ordered completed seasons from 2018–2025")
    result = prepare_snapshot(args.output_dir, args.seasons, args.workers)
    print(json.dumps({"status": result["status"], "datasets": {p: d["rows"] for p, d in result["datasets"].items()}}), flush=True)


if __name__ == "__main__":
    main()
