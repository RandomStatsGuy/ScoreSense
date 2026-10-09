"""API start uses .venv when present, otherwise PATH Python with uvicorn."""

from __future__ import annotations

import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "dev" / "resolve_python.sh"


def _run(posix_shell, root: Path, *, path=None):
    return posix_shell.script(SCRIPT, root, path=path)


def _stub_python(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/env bash\n[[ \"$1\" == \"-c\" ]] && exit 0\nexit 0\n", encoding="utf-8", newline="\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def test_resolve_python_prefers_venv(tmp_path: Path, posix_shell) -> None:
    venv_py = tmp_path / ".venv" / "bin" / "python"
    _stub_python(venv_py)
    result = _run(posix_shell, tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == posix_shell.path(venv_py)


def test_resolve_python_falls_back_to_path(tmp_path: Path, posix_shell) -> None:
    bin_dir = tmp_path / "bin"
    fake = bin_dir / "python3"
    _stub_python(fake)
    result = _run(posix_shell, tmp_path / "app", path=[bin_dir, "/usr/bin", "/bin"])
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == posix_shell.path(fake)


def test_resolve_python_errors_when_nothing_has_uvicorn(tmp_path: Path, posix_shell) -> None:
    bin_dir = tmp_path / "bin"
    for name in ("python3", "python"):
        stub = bin_dir / name
        _stub_python(stub)
        stub.write_text("#!/usr/bin/env bash\nexit 1\n", encoding="utf-8", newline="\n")
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    result = _run(posix_shell, tmp_path / "app", path=[bin_dir, "/usr/bin", "/bin"])
    assert result.returncode == 1
    assert "no Python with uvicorn" in result.stderr


def test_run_api_uses_resolver() -> None:
    text = (ROOT / "scripts" / "dev" / "run_api.sh").read_text(encoding="utf-8")
    assert "resolve_python.sh" in text
    assert ".venv/bin/python -m uvicorn" not in text
