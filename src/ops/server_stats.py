"""Host and process numbers for the admin Server tab. Read-only; never shows secrets."""
from __future__ import annotations

import json
import logging
import os
import platform
import sqlite3
import threading
import time
from collections import deque
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src import config

LOG = logging.getLogger(__name__)
_DIR_SIZE_TTL_S = 600
_dir_size_lock = threading.Lock()
_dir_size_cache: dict[str, tuple[float, int]] = {}

# A single instant of CPU reads whatever request is answering it; average a minute instead.
CPU_SAMPLE_S = 5
CPU_WINDOW_S = 60
_cpu_lock = threading.Lock()
_cpu_samples: deque[dict[str, Any]] = deque(maxlen=CPU_WINDOW_S // CPU_SAMPLE_S + 1)
_cpu_thread: threading.Thread | None = None


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


def running_runs() -> list[dict[str, Any]]:
    """Top-level job runs the diagnostics table says are running now, with their process id."""
    path = Path(config.JOB_DIAGNOSTICS_PATH)
    if not path.exists():
        return []
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)) as conn:
            rows = conn.execute(
                """SELECT id, job, pid, scope, started FROM runs
                   WHERE parent IS NULL AND state = 'running' AND started > ?""",
                (time.time() - 86400,),
            ).fetchall()
    except sqlite3.Error:
        return []
    return [{"id": r[0], "job": r[1], "pid": r[2], "scope": r[3], "started": r[4]} for r in rows]


def _process_role(proc, root_pid: int) -> str:
    if proc.pid == root_pid:
        return "api"
    try:
        if any("multiprocessing" in part for part in proc.cmdline()):
            return "cpu_worker"
    except Exception:
        pass
    return "child"


def _cpu_snapshot() -> dict[str, Any]:
    import psutil

    times = psutil.cpu_times()
    total = sum(times)
    idle = times.idle + getattr(times, "iowait", 0.0)
    me = psutil.Process()
    procs: dict[int, dict[str, Any]] = {}
    for proc in [me, *me.children(recursive=True)]:
        try:
            with proc.oneshot():
                cpu = proc.cpu_times()
                procs[proc.pid] = {
                    "pid": proc.pid,
                    "name": proc.name(),
                    "role": _process_role(proc, me.pid),
                    "created": proc.create_time(),
                    "cpu_s": cpu.user + cpu.system,
                    "rss": proc.memory_info().rss,
                    "threads": proc.num_threads(),
                }
        except psutil.Error:
            continue
    return {"at": time.monotonic(), "busy": total - idle, "total": total, "procs": procs}


def _record_job_peaks(snapshot: dict[str, Any]) -> None:
    """Peak memory only means something for jobs that own a process (the CPU worker)."""
    peaks = {}
    for run in running_runs():
        proc = snapshot["procs"].get(run["pid"])
        if proc and run["scope"] == "process" and proc["role"] != "api":
            peaks[run["id"]] = (run["job"], proc["rss"])
    if peaks:
        from src.ops import admin_store

        admin_store.record_job_peaks(peaks)


def sample_cpu() -> None:
    snapshot = _cpu_snapshot()
    with _cpu_lock:
        _cpu_samples.append(snapshot)
    try:
        _record_job_peaks(snapshot)
    except Exception:
        LOG.debug("Could not record job memory peaks", exc_info=True)


def _cpu_loop() -> None:
    while True:
        try:
            sample_cpu()
        except Exception:
            LOG.debug("CPU sample failed", exc_info=True)
        time.sleep(CPU_SAMPLE_S)


def start_cpu_sampler() -> None:
    global _cpu_thread
    with _cpu_lock:
        if _cpu_thread is not None and _cpu_thread.is_alive():
            return
        _cpu_thread = threading.Thread(target=_cpu_loop, name="admin-cpu-sampler", daemon=True)
        _cpu_thread.start()


def window_usage(samples: list[dict[str, Any]], cores: int) -> dict[str, Any]:
    """Machine CPU and per-process share of the whole machine between the oldest and newest sample."""
    if len(samples) < 2:
        return {"machine_percent": None, "window_s": 0, "procs": []}
    first, last = samples[0], samples[-1]
    elapsed = max(last["at"] - first["at"], 1e-6)
    total = last["total"] - first["total"]
    machine = 100 * (last["busy"] - first["busy"]) / total if total > 0 else None
    procs = []
    for pid, proc in last["procs"].items():
        start_at, start = next(((s["at"], s["procs"][pid]) for s in samples
                                if s["procs"].get(pid, {}).get("created") == proc["created"]), (last["at"], proc))
        span = last["at"] - start_at
        share = 100 * max(0.0, proc["cpu_s"] - start["cpu_s"]) / (span * cores) if span > 0 else 0.0
        procs.append({**proc, "cpu_percent": round(min(share, 100.0), 1)})
    return {
        "machine_percent": round(min(max(machine, 0.0), 100.0), 1) if machine is not None else None,
        "window_s": round(elapsed),
        "procs": procs,
    }


def cpu_usage() -> dict[str, Any]:
    import psutil

    start_cpu_sampler()
    with _cpu_lock:
        samples = list(_cpu_samples)
    return window_usage(samples, psutil.cpu_count() or 1)


def processes() -> dict[str, Any]:
    """ScoreSense's own processes, task-manager style. Never includes command lines."""
    import psutil

    usage = cpu_usage()
    running: dict[int, list[str]] = {}
    for run in running_runs():
        if run["pid"] is not None:
            running.setdefault(int(run["pid"]), []).append(run["job"])
    rows = [{
        "pid": proc["pid"],
        "role": proc["role"],
        "name": proc["name"],
        "cpu_percent": proc["cpu_percent"],
        "rss": proc["rss"],
        "threads": proc["threads"],
        "running": running.get(proc["pid"], []),
    } for proc in usage["procs"]]
    rows.sort(key=lambda row: (row["role"] != "api", -(row["cpu_percent"] or 0)))
    memory = psutil.virtual_memory()
    ours_cpu = sum(row["cpu_percent"] or 0 for row in rows)
    ours_rss = sum(row["rss"] or 0 for row in rows)
    machine = usage["machine_percent"]
    return {
        "window_s": usage["window_s"],
        "machine_cpu_percent": machine,
        "rows": rows,
        "other": {
            "cpu_percent": round(max(0.0, machine - ours_cpu), 1) if machine is not None else None,
            "rss": max(0, (memory.total - memory.available) - ours_rss),
        },
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
    usage = cpu_usage()
    return {
        "cpu_percent": usage["machine_percent"],
        "cpu_window_s": usage["window_s"],
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
