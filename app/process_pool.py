"""Shared process pool for CPU-bound jobs — keeps the FastAPI event loop responsive."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from functools import partial
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_executor: ProcessPoolExecutor | None = None


def init_process_executor(max_workers: int = 1) -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=max_workers)
    return _executor


def shutdown_process_executor(wait: bool = False) -> None:
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=wait, cancel_futures=not wait)
        _executor = None


def get_process_executor() -> ProcessPoolExecutor:
    if _executor is None:
        return init_process_executor()
    return _executor


def _log_future_error(future, executor=None) -> None:
    global _executor
    try:
        future.result()
    except asyncio.CancelledError:
        logger.warning("Background process job cancelled")
    except BrokenProcessPool:
        # A killed worker poisons its executor. Let the next request start a
        # fresh pool, without automatically replaying a failed expensive job.
        if executor is not None and _executor is executor:
            _executor = None
            executor.shutdown(wait=False, cancel_futures=True)
        logger.exception("Background process worker exited unexpectedly")
    except Exception as exc:
        logger.exception("Background process job failed: %s", exc)


def submit_cpu_job(func: Callable[..., T], *args, **kwargs) -> asyncio.Future:
    """Fire-and-forget CPU work on a separate OS process."""
    loop = asyncio.get_running_loop()
    executor = get_process_executor()
    bound = partial(func, *args, **kwargs)
    future = loop.run_in_executor(executor, bound)
    future.add_done_callback(partial(_log_future_error, executor=executor))
    return future
