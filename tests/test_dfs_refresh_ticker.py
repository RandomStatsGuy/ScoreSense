import asyncio

import pytest

from app import dfs_refresh_ticker as ticker


@pytest.mark.parametrize("duration,fails", [(5, False), (700, False), (700, True)])
def test_ticker_waits_full_interval_after_worker_completion(monkeypatch, duration, fails):
    monkeypatch.setattr(ticker, "DFS_REFRESH_ENABLED", True)
    monkeypatch.setattr(ticker, "DFS_CHECK_SECONDS", 300)
    now = [0]
    starts, sleeps = [], []
    async def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds
    async def submit(job):
        assert job is ticker.run_dfs_refresh
        starts.append(now[0])
        if len(starts) == 2:
            raise asyncio.CancelledError
        now[0] += duration
        if fails:
            raise RuntimeError("worker failed")
    monkeypatch.setattr(ticker.asyncio, "sleep", sleep)
    monkeypatch.setattr(ticker, "submit_cpu_job", submit)
    async def run():
        monkeypatch.setattr(asyncio.get_running_loop(), "time", lambda: now[0])
        await ticker.dfs_refresh_ticker_loop()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run())
    assert sleeps == [30, 300]
    assert starts == [30, 30 + duration + 300]


def test_disabled_ticker_never_submits_or_sleeps(monkeypatch):
    monkeypatch.setattr(ticker, "DFS_REFRESH_ENABLED", False)
    async def unexpected(*args):
        pytest.fail("disabled ticker did work")
    monkeypatch.setattr(ticker.asyncio, "sleep", unexpected)
    monkeypatch.setattr(ticker, "submit_cpu_job", unexpected)
    asyncio.run(ticker.dfs_refresh_ticker_loop())


def test_cancelled_worker_does_not_sleep_or_resubmit(monkeypatch):
    monkeypatch.setattr(ticker, "DFS_REFRESH_ENABLED", True)
    sleeps = []
    async def sleep(seconds):
        sleeps.append(seconds)
    async def submit(job):
        raise asyncio.CancelledError
    monkeypatch.setattr(ticker.asyncio, "sleep", sleep)
    monkeypatch.setattr(ticker, "submit_cpu_job", submit)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ticker.dfs_refresh_ticker_loop())
    assert sleeps == [30]
