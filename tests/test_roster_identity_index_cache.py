"""Content revisions and concurrent rebuilding of the shared identity lookup."""
from concurrent.futures import Future, ThreadPoolExecutor
import threading

import pandas as pd
import pytest

from src.integrations import roster_identity as identity


@pytest.fixture(autouse=True)
def isolated_index_cache():
    identity._SLEEPER_INDEX_CACHE.clear()
    yield
    assert not identity._SLEEPER_INDEX_PENDING
    identity._SLEEPER_INDEX_CACHE.clear()


@pytest.fixture
def players():
    return pd.DataFrame([
        {"gsis_id": "00-0000001", "full_name": "A. Player", "team": "KC",
         "position": "WR", "status": "Active", "injury_status": "Questionable"},
        {"gsis_id": "00-0000002", "full_name": "A. Player", "team": "SEA",
         "position": "WR", "status": "Active", "injury_status": ""},
    ])


def test_identical_inputs_reuse_index_across_frames_and_ignore_unused_fields(monkeypatch, players):
    calls = []
    build = identity._build_sleeper_index
    def counted(frame):
        calls.append(1)
        assert set(frame.columns) == set(identity._SLEEPER_INDEX_COLUMNS)
        return build(frame)
    monkeypatch.setattr(identity, "_build_sleeper_index", counted)
    first = identity._index_sleeper(players)
    changed = players.copy()
    changed["injury_status"] = "Out"
    assert identity._index_sleeper(changed) == first
    assert len(calls) == 1
    assert "injury_status" not in first[0]["00-0000001"]


@pytest.mark.parametrize("field,value", [
    ("gsis_id", "00-0000003"), ("full_name", "Changed Name"),
    ("team", "BUF"), ("position", "RB"), ("status", "Inactive"),
])
def test_each_identity_revision_rebuilds(monkeypatch, players, field, value):
    original = identity._index_sleeper(players)
    players.loc[0, field] = value
    revised = identity._index_sleeper(players)
    assert revised != original
    assert len(identity._SLEEPER_INDEX_CACHE) == 2


def test_duplicate_name_order_and_deletions_are_inputs(players):
    original = identity._index_sleeper(players)
    reordered = identity._index_sleeper(players.iloc[::-1])
    assert list(original[1].values())[0][0]["team"] == "KC"
    assert list(reordered[1].values())[0][0]["team"] == "SEA"
    deleted = identity._index_sleeper(players.iloc[1:])
    assert "00-0000001" not in deleted[0]


@pytest.mark.parametrize("fail", [False, True])
def test_concurrent_identical_rebuilds_share_work_and_retry(monkeypatch, players, fail):
    joined = threading.Event()
    counter_lock = threading.Lock()
    waiting = 0
    class ObservedFuture(Future):
        def result(self, timeout=None):
            nonlocal waiting
            with counter_lock:
                waiting += 1
                if waiting == 5:
                    joined.set()
            return super().result(timeout=5)
    monkeypatch.setattr(identity, "Future", ObservedFuture)
    build = identity._build_sleeper_index
    calls = []
    def rebuilding(frame):
        calls.append(1)
        assert joined.wait(5)
        if fail:
            raise RuntimeError("failed rebuild")
        return build(frame)
    monkeypatch.setattr(identity, "_build_sleeper_index", rebuilding)
    with ThreadPoolExecutor(max_workers=6) as executor:
        jobs = [executor.submit(identity._index_sleeper, players.copy()) for _ in range(6)]
        if fail:
            for job in jobs:
                with pytest.raises(RuntimeError, match="failed rebuild"):
                    job.result(timeout=6)
        else:
            rows = [job.result(timeout=6) for job in jobs]
            assert all(row == rows[0] for row in rows)
    assert len(calls) == 1
    assert not identity._SLEEPER_INDEX_PENDING
    monkeypatch.setattr(identity, "_build_sleeper_index", build)
    assert identity._index_sleeper(players)


def test_different_revisions_build_without_global_wait(monkeypatch, players):
    both_building = threading.Barrier(2)
    build = identity._build_sleeper_index
    def rebuilding(frame):
        both_building.wait(timeout=5)
        return build(frame)
    monkeypatch.setattr(identity, "_build_sleeper_index", rebuilding)
    changed = players.copy()
    changed.loc[0, "team"] = "BUF"
    with ThreadPoolExecutor(max_workers=2) as executor:
        a = executor.submit(identity._index_sleeper, players)
        b = executor.submit(identity._index_sleeper, changed)
        assert a.result(timeout=6) != b.result(timeout=6)


def test_cache_is_bounded_and_old_output_survives_eviction(players):
    first = identity._index_sleeper(players)
    for i in range(identity._SLEEPER_INDEX_CACHE_SIZE + 2):
        changed = players.copy()
        changed.loc[0, "full_name"] = f"New player {i}"
        identity._index_sleeper(changed)
    assert len(identity._SLEEPER_INDEX_CACHE) == identity._SLEEPER_INDEX_CACHE_SIZE
    assert first[0]["00-0000001"]["full_name"] == "A. Player"


def test_missing_columns_and_empty_input():
    assert identity._index_sleeper(pd.DataFrame()) == ({}, {})
    assert identity._index_sleeper(pd.DataFrame([{"unused": 1}])) == ({}, {})
    result = identity._index_sleeper(pd.DataFrame([{"full_name": "A. Player"}]))
    assert result[0] == {}
    assert list(result[1].values())[0] == [{"full_name": "A. Player"}]
