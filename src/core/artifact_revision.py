"""Cheap on-disk revision for caches shared by API and refresh processes."""
from pathlib import Path


def artifact_revision(*paths: Path) -> tuple:
    stamps = []
    for path in paths:
        try:
            stat = path.stat()
            stamps.append((stat.st_mtime_ns, stat.st_size))
        except FileNotFoundError:
            stamps.append(None)
    return tuple(stamps)
