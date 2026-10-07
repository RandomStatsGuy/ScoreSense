"""Host and process numbers for the admin Server tab. Read-only; never shows secrets."""
from __future__ import annotations

import json
import os
import platform
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src import config

_DIR_SIZE_TTL_S = 600
_dir_size_lock = threading.Lock()
_dir_size_cache: dict[str, tuple[float, int]] = {}


def _file_size(path: Path) -> int | None:
    total = 0
    found = False
    for candidate in (path, path.with_name(path.name + "-wal")):
        try:
            total += candidate.stat().st_size
            found = True
        except OSError:
            continue
    return total if found else None


def _dir_size(path: Path) -> int | None:
    key = str(path)
    now = time.monotonic()
    with _dir_size_lock:
        cached = _dir_size_cache.get(key)
        if cached and now - cached[0] < _DIR_SIZE_TTL_S:
            return cached[1]
    if not path.exists():
        return None
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.stat(os.path.join(root, name)).st_size
            except OSError:
                continue
    with _dir_size_lock:
        _dir_size_cache[key] = (now, total)
    return total


def build_info() -> dict[str, Any]:
    """Written by deploy-on-server.sh before the image build; absent in local dev."""
    try:
        data = json.loads(Path(config.BUILD_INFO_PATH).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    commit = str(data.get("commit") or os.getenv("SCORESENSE_COMMIT") or "").strip()
    return {
        "commit": commit[:12] or None,
        "subject": str(data.get("subject") or "")[:120] or None,
        "branch": str(data.get("branch") or "")[:60] or None,
        "deployed_at": data.get("deployed_at"),
    }


def resources() -> dict[str, Any]:
    import psutil

    memory = psutil.virtual_memory()
    try:
        disk = psutil.disk_usage(str(config.DATA_DIR))
        disk_info = {"used": disk.used, "total": disk.total, "percent": disk.percent}
    except OSError:
        disk_info = None
    process = psutil.Process()
    try:
        load = os.getloadavg()
    except (AttributeError, OSError):
        load = None
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "cpu_count": psutil.cpu_count() or 1,
        "load_average": [round(value, 2) for value in load] if load else None,
        "memory": {"used": memory.total - memory.available, "total": memory.total, "percent": memory.percent},
        "disk": disk_info,
        "process": {
            "started_at": datetime.fromtimestamp(process.create_time(), timezone.utc).isoformat(),
            "rss": process.memory_info().rss,
            "threads": process.num_threads(),
        },
    }


def storage_sizes() -> list[dict[str, Any]]:
    rows = [
        ("Fantasy database", _file_size(Path(config.DRAFT_HUB_DB))),
        ("Accounts database", _file_size(Path(config.AUTH_DB))),
        ("Job history", _file_size(Path(config.JOB_DIAGNOSTICS_PATH))),
        ("Artifacts folder", _dir_size(Path(config.PROJECT_ROOT) / "artifacts")),
    ]
    return [{"label": label, "bytes": size} for label, size in rows]


def runtime() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "platform": platform.system(),
        "workers": 1,
    }
