"""Retain exact previous-release assets for open clients, with bounded retention."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import tempfile
import time


def archive_assets(source: Path, archive: Path, *, now: float | None = None, days: int = 7) -> None:
    source, archive = source.resolve(), archive.resolve()
    if not source.is_dir() or source == archive or source in archive.parents or archive in source.parents:
        raise ValueError("Source and archive must be separate directories")
    now = time.time() if now is None else now
    archive.mkdir(parents=True, exist_ok=True)
    for path in source.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if source not in path.resolve().parents:
            raise ValueError("Asset escapes source directory")
        target = archive / path.relative_to(source)
        if archive not in target.resolve().parents:
            raise ValueError("Asset escapes archive directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != path.read_bytes():
                raise ValueError(f"Refusing to replace immutable asset: {target.name}")
        else:
            fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=".asset-")
            try:
                with os.fdopen(fd, "wb") as out, path.open("rb") as src:
                    shutil.copyfileobj(src, out)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        # Retention starts when a release is retired, not when it was built.
        os.utime(target, (now, now))
    for path in archive.rglob("*"):
        if path.is_file() and not path.is_symlink() and path.stat().st_mtime < now - days * 86400:
            path.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    archive_assets(args.source, args.archive)
