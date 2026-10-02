"""Cheap on-disk revision for caches shared by API and refresh processes."""
from pathlib import Path
from functools import lru_cache
import hashlib


def artifact_revision(*paths: Path) -> tuple:
    stamps = []
    for path in paths:
        try:
            stat = path.stat()
            stamps.append((stat.st_mtime_ns, stat.st_size))
        except FileNotFoundError:
            stamps.append(None)
    return tuple(stamps)


@lru_cache(maxsize=64)
def _content_digest(path: str, mtime_ns: int, size: int, ctime_ns: int) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_content_revision(path: Path) -> str | None:
    """A polling rewrite invalidates forecasts only when its contents change.

    Cache hashes by file revision so hot readers only stat unchanged sources.
    Do not cache a digest read across an in-place write or atomic replacement.
    """
    for _ in range(3):
        try:
            before = path.stat()
            revision = (before.st_mtime_ns, before.st_size, before.st_ctime_ns)
            digest = _content_digest(str(path), *revision)
            after = path.stat()
        except FileNotFoundError:
            return None
        if revision == (after.st_mtime_ns, after.st_size, after.st_ctime_ns):
            return digest
    raise RuntimeError(f"Projection input keeps changing: {path.name}")
