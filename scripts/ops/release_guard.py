#!/usr/bin/env python3
"""Fail closed before an older source tree can replace approved production fixes.

The host policy lives outside the checkout. Incoming code cannot lower it by
shipping its own policy. Hashes identify an inspected release, not test coverage;
changing a protected file requires regression checks and explicit re-approval.
This module uses only the stdlib and never imports the app or reads league data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile


class ReleaseBlocked(ValueError):
    pass


def digest(data: bytes) -> str:
    # Git and Windows use different line endings for identical source.
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def load_policy(path: Path) -> dict[str, str]:
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReleaseBlocked(f"Approved release policy missing or invalid: {path}") from exc
    sources = policy.get("protected_sources")
    if policy.get("schema") != 1 or not isinstance(sources, dict) or not sources:
        raise ReleaseBlocked("Release policy must contain protected source hashes")
    for name, expected in sources.items():
        part = PurePosixPath(name)
        if (part.is_absolute() or ".." in part.parts or "\\" in name
                or ":" in name or part.as_posix() != name
                or not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected)):
            raise ReleaseBlocked(f"Unsafe policy entry: {name}")
    return sources


def check_source(read, policy: dict[str, str]) -> None:
    failed = []
    for name, expected in policy.items():
        try:
            actual = digest(read(name))
        except (OSError, KeyError, subprocess.CalledProcessError):
            actual = None
        if actual != expected:
            failed.append(name)
    if failed:
        raise ReleaseBlocked(
            "Release blocked: source differs from the approved spacing/mapping/Bye baseline:\n  "
            + "\n  ".join(failed)
            + "\nUse the reconciled branch. Intentional changes require regression checks and a reviewed baseline update."
        )


def check_tree(root: Path, policy: dict[str, str]) -> None:
    root = root.resolve()
    def read(name):
        path = root / name
        if not path.resolve().is_relative_to(root) or any(
            parent.is_symlink() for parent in [path, *path.parents] if parent != root
        ):
            raise ReleaseBlocked(f"Symlink in protected source: {name}")
        return path.read_bytes()
    check_source(read, policy)


def check_archive(archive: Path, policy: dict[str, str]) -> None:
    with tarfile.open(archive, "r:*") as tar:
        files = {}
        for member in tar.getmembers():
            name = member.name
            part = PurePosixPath(name)
            if (part.is_absolute() or ".." in part.parts or "\\" in name or ":" in name
                    or part.as_posix() != name.rstrip("/")
                    or member.issym() or member.islnk() or not (member.isfile() or member.isdir())):
                raise ReleaseBlocked(f"Unsafe archive member: {name}")
            if member.isfile():
                if name in files:
                    raise ReleaseBlocked(f"Duplicate archive member: {name}")
                files[name] = member
        def read(name):
            stream = tar.extractfile(files[name])
            if stream is None:
                raise KeyError(name)
            return stream.read()
        check_source(read, policy)


def check_git(root: Path, revision: str, policy: dict[str, str]) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ReleaseBlocked("The release revision must be a full commit SHA")
    check_source(lambda name: subprocess.check_output(
        ["git", "-C", str(root), "show", f"{revision}:{name}"], stderr=subprocess.DEVNULL
    ), policy)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["tree", "archive", "git"])
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--revision")
    args = parser.parse_args(argv)
    try:
        policy = load_policy(args.policy)
        if args.mode == "tree":
            check_tree(args.root, policy)
        elif args.mode == "archive":
            if args.archive is None:
                parser.error("--archive is required")
            check_archive(args.archive, policy)
        else:
            check_git(args.root, args.revision or "", policy)
    except (ReleaseBlocked, OSError, tarfile.TarError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Approved release sources: PASS ({len(policy)} protected files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
