"""Shared process pools for CPU-bound jobs — keeps the FastAPI event loop responsive.

The main worker runs inference and rebuilds, which can take minutes. A second
small worker runs live scoring and Fantasy context so they never queue behind it.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from functools import partial
from typing import Callable, TypeVar

from src.ops.job_diagnostics import execute_job, future_observed, queue_job

logger = logging.getLogger(__name__)

T = TypeVar("T")

_executor: ProcessPoolExecutor | None = None
_live_executor: ProcessPoolExecutor | None = None


def init_process_executor(max_workers: int = 1) -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=max_workers)
    return _executor


def shutdown_process_executor(wait: bool = False) -> None:
    global _executor, _live_executor
    for executor in (_executor, _live_executor):
        if executor is not None:
            executor.shutdown(wait=wait, cancel_futures=not wait)
    _executor = _live_executor = None


def get_process_executor() -> ProcessPoolExecutor:
    if _executor is None:
        return init_process_executor()
    return _executor


def get_live_executor() -> ProcessPoolExecutor:
    global _live_executor
    if _live_executor is None:
        _live_executor = ProcessPoolExecutor(max_workers=1)
    return _live_executor


def _log_future_error(future, executor=None) -> None:
    global _executor, _live_executor
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
        elif executor is not None and _live_executor is executor:
            _live_executor = None
            executor.shutdown(wait=False, cancel_futures=True)
        logger.exception("Background process worker exited unexpectedly")
    except Exception as exc:
        logger.exception("Background process job failed: %s", exc)


def _submit(executor: ProcessPoolExecutor, func: Callable[..., T], args, kwargs) -> asyncio.Future:
    loop = asyncio.get_running_loop()
    ticket = queue_job(func)
    bound = partial(execute_job, func, args, kwargs, ticket, "process")
    try:
        future = loop.run_in_executor(executor, bound)
    except Exception as error:
        from concurrent.futures import Future
        failed = Future()
        failed.set_exception(error)
        future_observed(failed, ticket)
        raise
    future.add_done_callback(partial(future_observed, ticket=ticket))
    future.add_done_callback(partial(_log_future_error, executor=executor))
    return future


def submit_cpu_job(func: Callable[..., T], *args, **kwargs) -> asyncio.Future:
    """Fire-and-forget CPU work on a separate OS process."""
    return _submit(get_process_executor(), func, args, kwargs)


def submit_live_job(func: Callable[..., T], *args, **kwargs) -> asyncio.Future:
    """Short, latency-sensitive work that must not wait behind inference."""
    return _submit(get_live_executor(), func, args, kwargs)
