#!/usr/bin/env python3
"""Upload ScoreSense to a VPS and restart the production Docker stack.

Reads connection settings from environment (no secrets in this file):

  SCORESENSE_VPS_HOST     required, e.g. 104.207.158.4
  SCORESENSE_VPS_USER     default root
  SCORESENSE_VPS_PATH     default /root/scoresense
  SCORESENSE_SSH_KEY      optional path to private key
  SCORESENSE_SSH_PORT     default 22

Usage (from repo root, PowerShell):

  $env:SCORESENSE_VPS_HOST="104.207.158.4"
  $env:SCORESENSE_SSH_KEY="C:\\Users\\You\\.ssh\\id_rsa"
  python scripts/ops/deploy_to_vps.py

Requires OpenSSH client (ssh/scp) on your machine. .env is NOT uploaded — create it on the server once.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".cursor",
    "terminals",
    "data/raw",
    "data/cache",
    "draft_hub",
    "auth",
    "league_contract_history",
    "artifacts/analytics",
    "artifacts/backtest",
}
EXCLUDE_FILES = {".env"}
# Keep models + draft pool; skip heavy research/backtest blobs on first deploy.


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _default_ssh_key() -> str:
    explicit = _env("SCORESENSE_SSH_KEY")
    if explicit:
        return explicit
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""
    candidate = Path(home) / ".ssh" / "id_rsa"
    return str(candidate) if candidate.exists() else ""


def _ssh_base(user: str, host: str, port: str, key: str) -> list[str]:
    cmd = ["ssh", "-p", port, "-o", "StrictHostKeyChecking=accept-new"]
    if key:
        cmd.extend(["-i", key])
    cmd.append(f"{user}@{host}")
    return cmd


def _scp_base(user: str, host: str, port: str, key: str) -> list[str]:
    cmd = ["scp", "-P", port, "-o", "StrictHostKeyChecking=accept-new"]
    if key:
        cmd.extend(["-i", key])
    return cmd


def _should_skip(rel: Path) -> bool:
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if rel.name in EXCLUDE_FILES:
        return True
    if rel.suffix in {".pyc", ".log"}:
        return True
    return False


def build_tarball(dest: Path) -> None:
    with tarfile.open(dest, "w:gz") as tar:
        for path in PROJECT_ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(PROJECT_ROOT)
            if _should_skip(rel):
                continue
            tar.add(path, arcname=str(rel).replace("\\", "/"))


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd))
    return subprocess.run(cmd, check=check)


def verify_ssh(user: str, host: str, port: str, key: str) -> None:
    probe = _ssh_base(user, host, port, key) + [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "echo ok",
    ]
    result = subprocess.run(probe, capture_output=True, text=True)
    if result.returncode != 0:
        print(
            "SSH failed — Cursor cannot enter your VPS password interactively.\n"
            "Run this script from your own PowerShell/terminal (where `ssh root@104.207.158.4` works),\n"
            "or set SCORESENSE_SSH_KEY to a private key authorized on the server.\n"
            f"stderr: {result.stderr.strip()}",
            file=sys.stderr,
        )
        raise SystemExit(1)


def main() -> int:
    host = _env("SCORESENSE_VPS_HOST")
    if not host:
        print("Set SCORESENSE_VPS_HOST (e.g. 104.207.158.4)", file=sys.stderr)
        return 1

    user = _env("SCORESENSE_VPS_USER", "root")
    remote_path = _env("SCORESENSE_VPS_PATH", "/root/scoresense")
    port = _env("SCORESENSE_SSH_PORT", "22")
    key = _default_ssh_key()

    if shutil.which("ssh") is None or shutil.which("scp") is None:
        print("OpenSSH (ssh/scp) not found on PATH.", file=sys.stderr)
        return 1

    print(f"==> SSH preflight to {user}@{host} ...")
    verify_ssh(user, host, port, key)

    with tempfile.TemporaryDirectory() as tmp:
        tarball = Path(tmp) / "scoresense-deploy.tar.gz"
        print(f"==> Packaging {PROJECT_ROOT} ...")
        build_tarball(tarball)
        remote_tar = f"/tmp/scoresense-deploy-{os.getpid()}.tar.gz"

        scp_cmd = _scp_base(user, host, port, key) + [str(tarball), f"{user}@{host}:{remote_tar}"]
        run(scp_cmd)

        remote_script = f"""
set -euo pipefail
mkdir -p {remote_path}
tar -xzf {remote_tar} -C {remote_path}
rm -f {remote_tar}
if [ -d /root/pricebot ]; then
  (cd /root/pricebot && docker compose down) || true
fi
cd {remote_path}
bash deploy/server/deploy-on-server.sh
"""
        ssh_cmd = _ssh_base(user, host, port, key) + [remote_script]
        run(ssh_cmd)

    print("==> Deploy finished. Test: https://app.fourthdownlabs.com/api/health")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
