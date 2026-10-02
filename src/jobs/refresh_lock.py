"""OS-owned refresh lock: released automatically if a worker exits."""
from contextlib import contextmanager
import math
import os
import time


class RefreshBusy(Exception):
    pass


def _try_acquire(handle):
    if os.name == "nt":
        import msvcrt
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise RefreshBusy() from exc
    else:
        import fcntl
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RefreshBusy() from exc


@contextmanager
def refresh_lock(path, *, timeout=0, on_wait=None):
    """Wait only when requested; background jobs and status reads stay nonblocking."""
    if not math.isfinite(timeout) or timeout < 0:
        raise ValueError("Refresh lock timeout must be finite and nonnegative")
    started = time.monotonic()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            if path.stat().st_size == 0:
                handle.write(b"0")
                handle.flush()
        while True:
            try:
                _try_acquire(handle)
                break
            except RefreshBusy:
                elapsed = time.monotonic() - started
                remaining = timeout - elapsed
                if remaining <= 0:
                    raise
                if on_wait is not None:
                    on_wait(elapsed)
                time.sleep(min(0.25, remaining))
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_UN)
