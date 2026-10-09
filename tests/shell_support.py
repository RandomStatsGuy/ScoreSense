"""Run POSIX integration scripts on Unix or Git for Windows."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


class PosixShell:
    def __init__(self) -> None:
        if os.name == "nt":
            # PATH's bash.exe may be the WSL launcher, which cannot use these
            # native temp directories or executable stubs.
            roots = [Path(os.environ.get(name, "C:/Program Files")) / "Git"
                     for name in ("ProgramFiles", "ProgramFiles(x86)")]
            git = shutil.which("git")
            if git:
                roots.insert(0, Path(git).resolve().parent.parent)
            candidates = [root / folder / "bash.exe"
                          for root in roots for folder in ("bin", "usr/bin")]
            self.executable = next((str(p) for p in candidates if p.is_file()), None)
        else:
            self.executable = shutil.which("bash")
        if not self.executable:
            pytest.skip("POSIX script tests require Bash (Git for Windows on Windows)")

    @staticmethod
    def path(path: Path | str) -> str:
        value = Path(path).as_posix()
        if os.name == "nt" and len(value) > 2 and value[1:3] == ":/":
            return f"/{value[0].lower()}/{value[3:]}"
        return value

    def run(self, command, *, env=None, path=None, **kwargs):
        run_env = dict(os.environ if env is None else env)
        paths = path if path is not None else ["/usr/bin", "/bin", *os.get_exec_path(run_env)]
        run_env["SCORESENSE_TEST_SHELL_PATH"] = ":".join(self.path(p) for p in paths)
        if os.name == "nt":
            # MSYS symlinks preserve POSIX semantics without requiring Windows
            # administrator privileges. Inspect links through the same shell.
            run_env["MSYS"] = "winsymlinks:sys"
        return subprocess.run(
            [self.executable, "--noprofile", "--norc", "-c",
             'export PATH="$SCORESENSE_TEST_SHELL_PATH"; exec "$@"', "shell-test",
             *(self.path(arg) if isinstance(arg, Path) else str(arg) for arg in command)],
            env=run_env, capture_output=True, text=True,
            timeout=kwargs.pop("timeout", 20), **kwargs,
        )

    def script(self, script: Path, *args, shell="bash", **kwargs):
        return self.run([shell, script, *args], **kwargs)
