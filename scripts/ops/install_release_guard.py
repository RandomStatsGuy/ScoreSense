#!/usr/bin/env python3
"""Install an approved release floor outside the source checkout, without restarting the app."""
from pathlib import Path
import argparse
import json
import os
import shutil
import tempfile

from release_guard import ReleaseBlocked, check_tree, load_policy


def install(root: Path, destination: Path, *, replace_policy: bool = False) -> None:
    policy = root / "deploy/approved-release.json"
    check_tree(root, load_policy(policy))
    current = destination / "approved-release.json"
    if current.exists() and json.loads(current.read_text(encoding="utf-8")) != json.loads(policy.read_text(encoding="utf-8")):
        if not replace_policy:
            raise ReleaseBlocked("Installed policy differs. Run regressions, review the baseline diff, then explicitly approve with --replace-policy.")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Preserve the last policy when approving a changed protected source.
    if current.exists():
        shutil.copy2(current, destination / "approved-release.previous.json")
    for source, name in [(root / "scripts/ops/release_guard.py", "release_guard.py"), (policy, "approved-release.json")]:
        fd, staged = tempfile.mkstemp(prefix=".install-", dir=destination)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(source.read_bytes())
            os.chmod(staged, 0o600)
            os.replace(staged, destination / name)
        finally:
            Path(staged).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--destination", type=Path, default=Path.home() / ".local/share/scoresense-release-guard")
    parser.add_argument("--replace-policy", action="store_true", help="Explicitly approve a reviewed change after regression checks")
    args = parser.parse_args()
    install(args.root.resolve(), args.destination.resolve(), replace_policy=args.replace_policy)
    print(f"Installed release guard: {args.destination}")


if __name__ == "__main__":
    main()
