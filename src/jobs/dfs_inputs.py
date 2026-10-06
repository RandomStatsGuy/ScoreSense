"""DFS-only reuse proof; shared forecast readers keep their existing contract.

Hash the actual local inference sources, not diagnostic same-input counters.
Feeds which are refreshed by inference are resolved before taking this snapshot.
Special-teams feeds are deliberately refreshed on every due DFS pass.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import math
from pathlib import Path
import sys

from src.core.artifact_revision import file_content_revision

VERSION = 2
POSITIONS = ("qb", "rb", "wr")


def prepare_sources(season: int) -> None:
    from src.core.schedule_utils import _load_schedules
    from src.integrations.nflverse_roster import load_seasonal_roster
    _load_schedules([season])
    load_seasonal_roster(season)


def source_paths(season: int, week: int) -> list[Path]:
    from src import config
    from src.core.schedule_utils import SCHEDULE_CACHE
    from src.integrations.sleeper import PLAYERS_CACHE
    from src.integrations.nflverse_roster import roster_cache_path
    from src.integrations.fantasypros import FP_CACHE_DIR
    from src.projections import predict, weekly_cache
    paths = [PLAYERS_CACHE, roster_cache_path(season), SCHEDULE_CACHE,
             config.ROOKIE_ROLE_OVERRIDES_PATH, config.SENTIMENT_FEATURES_PATH]
    for pos in POSITIONS:
        paths.extend(predict.PROCESSED_DATA_DIR / f"{pos}_mlready.{suffix}" for suffix in ("parquet", "csv"))
    paths.extend(predict.MODEL_DIR / name for name in
                 ("qb_model.joblib", predict.RB_CALIBRATED_MODEL_BUNDLE, predict.WR_CALIBRATED_MODEL_BUNDLE))
    # Exact-week consensus is cache-only during inference. Include the data,
    # not just revision.txt (which an external writer need not update).
    paths.append(FP_CACHE_DIR / f"{season}_week{week:02d}_proj.parquet")
    paths.append(FP_CACHE_DIR / f"{season}_week{week:02d}_ecr_ALL.parquet")
    paths.append(FP_CACHE_DIR / "revision.txt")  # preserve the existing reader's invalidation contract
    # Code/config/model routing and numerical dependency changes invalidate a
    # receipt across deployments. Never read .env or serialize secret values.
    paths.extend(sorted((config.PROJECT_ROOT / "src").rglob("*.py")))
    paths.extend(config.PROJECT_ROOT / name for name in ("requirements.txt", "requirements-ci.txt"))
    return sorted(set(paths), key=str)


@lru_cache(maxsize=1024)
def _digest(path: str, mtime_ns: int, size: int, ctime_ns: int) -> str | None:
    # Retain cheap stat-keyed digests for the source registry, without thrashing
    # the smaller shared content-revision cache with code and output files.
    return file_content_revision(Path(path))


def revisions(paths: list[Path]) -> dict[str, str | None]:
    result = {}
    for path in paths:
        for _ in range(3):
            try:
                stat = path.stat()
            except FileNotFoundError:
                result[str(path)] = None
                break
            stamp = (stat.st_mtime_ns, stat.st_size, stat.st_ctime_ns)
            digest = _digest(str(path), *stamp)
            try:
                after = path.stat()
            except FileNotFoundError:
                continue
            if stamp == (after.st_mtime_ns, after.st_size, after.st_ctime_ns):
                result[str(path)] = digest
                break
        else:
            raise RuntimeError("DFS inputs changed while being checked")
    return result


@lru_cache(maxsize=1)
def runtime_revision() -> tuple:
    packages = []
    for name in ("numpy", "pandas", "scikit-learn", "scipy", "joblib", "pyarrow", "lightgbm", "xgboost"):
        try:
            packages.append((name, version(name)))
        except PackageNotFoundError:
            packages.append((name, None))
    return (tuple(sys.version_info[:3]), tuple(packages))


def input_revision(season: int, week: int) -> str:
    from src.projections.weekly_cache import weekly_fingerprint
    from src.projections.ros_cache import ros_fingerprint
    payload = [VERSION, int(season), int(week), runtime_revision(), weekly_fingerprint(), ros_fingerprint(),
               revisions(source_paths(season, week))]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def output_revisions(season: int, week: int) -> dict[str, str] | None:
    from src.projections import weekly_cache
    paths = []
    for pos in POSITIONS:
        for injury in (True, False):
            paths.extend(weekly_cache._artifact_paths(pos, season, week, injury))
    observed = revisions(paths)
    if any(value is None for value in observed.values()):
        return None
    # Persist digests only; absolute deployment paths and raw content stay local.
    return {hashlib.sha256(path.encode()).hexdigest(): value for path, value in observed.items()}


def can_reuse(previous: dict, revision: str, season: int, week: int, *, now: float, max_age: float) -> bool:
    if previous.get("forecast_status", previous.get("status")) != "ok":
        return False
    receipt = previous.get("forecast_reuse")
    if not isinstance(receipt, dict) or receipt.get("version") != VERSION or receipt.get("revision") != revision:
        return False
    epoch = receipt.get("computed_epoch")
    if type(epoch) not in (float, int) or not math.isfinite(epoch) or not 0 <= now - epoch < max_age:
        return False
    outputs = output_revisions(season, week)
    return outputs is not None and outputs == receipt.get("outputs")


def invalidate_forecast_memory(season: int) -> None:
    """Changed bytes must reach inference even when a writer preserves mtime."""
    from src.projections import predict, weekly_cache, ros_cache, rookie_role
    from src.integrations import nflverse_roster, sleeper
    from src.core.schedule_utils import _schedule_snapshot
    weekly_cache.invalidate_weekly_cache()
    ros_cache.invalidate_ros_cache()
    predict._MODEL_CACHE.clear()
    rookie_role._load_overrides_file.cache_clear()
    _schedule_snapshot.cache_clear()
    nflverse_roster.invalidate_roster_cache(season)
    sleeper._PLAYERS_RAW_CACHE = None
    sleeper._PLAYERS_DF_CACHE = None
