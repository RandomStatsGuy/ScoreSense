import asyncio
import os
from concurrent.futures.process import BrokenProcessPool

import pytest

from app import process_pool


def _exit_worker():
    os._exit(7)


def test_worker_exit_allows_a_later_job_to_start():
    async def exercise():
        process_pool.shutdown_process_executor()
        try:
            failed = process_pool.submit_cpu_job(_exit_worker)
            with pytest.raises(BrokenProcessPool):
                await asyncio.wait_for(failed, timeout=20)
            await asyncio.sleep(0)  # deliver the executor's failure callback
            assert process_pool._executor is None
            assert await asyncio.wait_for(process_pool.submit_cpu_job(abs, -3), timeout=20) == 3
        finally:
            process_pool.shutdown_process_executor(wait=True)
    asyncio.run(exercise())


def test_old_failure_does_not_remove_replacement_executor(monkeypatch):
    from concurrent.futures import Future
    from unittest.mock import Mock
    old, current = Mock(), Mock()
    monkeypatch.setattr(process_pool, "_executor", current)
    failed = Future()
    failed.set_exception(BrokenProcessPool("worker exited"))
    process_pool._log_future_error(failed, executor=old)
    assert process_pool._executor is current
    current.shutdown.assert_not_called()
