"""Memory helpers for long-running training / backtest pipelines."""

from __future__ import annotations

import gc


def release_memory() -> None:
    """Force a full garbage-collection sweep after large frames go out of scope."""
    gc.collect()
