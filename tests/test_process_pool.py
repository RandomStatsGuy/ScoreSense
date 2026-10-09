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


def test_live_jobs_do_not_wait_behind_a_long_inference_job():
    import time
    async def exercise():
        process_pool.shutdown_process_executor()
        try:
            long_job = process_pool.submit_cpu_job(time.sleep, 10)
            started = time.monotonic()
            assert await asyncio.wait_for(process_pool.submit_live_job(abs, -4), timeout=8) == 4
            assert time.monotonic() - started < 8 and not long_job.done()
            await asyncio.wait_for(long_job, timeout=20)
        finally:
            process_pool.shutdown_process_executor(wait=False)
    asyncio.run(exercise())


def test_live_worker_exit_leaves_the_inference_worker_running():
    async def exercise():
        process_pool.shutdown_process_executor()
        try:
            inference = process_pool.get_process_executor()
            with pytest.raises(BrokenProcessPool):
                await asyncio.wait_for(process_pool.submit_live_job(_exit_worker), timeout=20)
            await asyncio.sleep(0)
            assert process_pool._live_executor is None and process_pool._executor is inference
            assert await asyncio.wait_for(process_pool.submit_live_job(abs, -5), timeout=20) == 5
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


def test_cancelled_observer_does_not_make_busy_worker_look_idle():
    import time
    async def exercise():
        process_pool.shutdown_process_executor()
        try:
            job = process_pool.submit_cpu_job(time.sleep, 1)
            assert process_pool.cpu_jobs_busy()
            # Wait until the process owns the job, so cancelling its observer
            # cannot cancel the underlying work.
            while not any(future.running() for future in process_pool._CPU_FUTURES):
                await asyncio.sleep(.01)
            job.cancel()
            await asyncio.sleep(0)
            assert process_pool.cpu_jobs_busy()
            while process_pool.cpu_jobs_busy():
                await asyncio.sleep(.05)
        finally:
            process_pool.shutdown_process_executor(wait=True)
    asyncio.run(exercise())
