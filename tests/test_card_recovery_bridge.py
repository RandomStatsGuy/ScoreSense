"""The card adapts current shared recovery without a second inference registry."""
import time
from unittest.mock import Mock
import pytest
from fastapi import BackgroundTasks
from app import projection_recovery as recovery

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    monkeypatch.setattr("src.jobs.season_refresh.target_due", lambda *a: True)

def meta(**updates):
    return {"season": 2026, "week": 7, "identity": {"status": "resolved"}, "model_position": "wr",
            "artifacts": {"weekly": {"status": "missing"}, "ros": {"status": "player_missing"}},
            "rebuild_kinds": ["weekly"], **updates}

@pytest.mark.parametrize("identity,position,reason", [({"status":"unresolved"},"wr","unresolved_identity"), ({"status":"resolved"},None,"unsupported_position")])
def test_identity_or_position_cannot_enqueue(monkeypatch,identity,position,reason):
    tasks=Mock()
    result=recovery.card_projection_recovery(tasks,meta(identity=identity,model_position=position))
    assert result == {"status":"unsupported","reason":reason}
    tasks.add_task.assert_not_called()

def test_player_miss_is_not_a_rebuild_trigger():
    tasks=Mock()
    data=meta(artifacts={"weekly":{"status":"player_missing"},"ros":{"status":"ready"}})
    assert recovery.card_projection_recovery(tasks,data) == {"status":"idle"}
    assert "rebuild_kinds" not in data
    tasks.add_task.assert_not_called()

def test_active_job_is_shared_and_poll_delay_is_bounded():
    tasks=BackgroundTasks()
    assert recovery.card_projection_recovery(tasks,meta()) == {"status":"queued","retry_after_seconds":2}
    assert recovery.card_projection_recovery(tasks,meta()) == {"status":"running","retry_after_seconds":2}
    assert len(tasks.tasks) == 1

def test_successful_worker_requires_publication_reread(monkeypatch):
    key=(2026,7,("weekly",))
    recovery._RESULTS[key]=(time.monotonic(),{"status":"ok","failed":[]})
    assert recovery.card_projection_recovery(BackgroundTasks(),meta())["status"] == "running"
    recovery._RESULTS[key]=(time.monotonic()-recovery.PUBLICATION_GRACE_SECONDS-1,{"status":"ok","failed":[]})
    assert recovery.card_projection_recovery(BackgroundTasks(),meta()) == {"status":"failed","reason":"artifact_unavailable_after_recovery"}
    assert recovery.card_projection_recovery(BackgroundTasks(),meta(artifacts={"weekly":{"status":"ready"}})) == {"status":"idle"}

def test_failed_recovery_is_terminal_and_cooldown_prevents_resubmit():
    tasks=Mock()
    recovery._RESULTS[(2026,7,("weekly",))]=(time.monotonic(),{"status":"error"})
    assert recovery.card_projection_recovery(tasks,meta())["status"] == "failed"
    tasks.add_task.assert_not_called()

def test_shared_queue_has_a_fixed_active_limit(monkeypatch):
    monkeypatch.setattr(recovery,"MAX_ACTIVE_TARGETS",1)
    tasks=BackgroundTasks()
    recovery.queue_projection_recovery(tasks,2026,7,["weekly"])
    result=recovery.card_projection_recovery(tasks,meta(week=8))
    assert result == {"status":"failed","reason":"recovery_queue_full"}
    assert len(tasks.tasks) == 1


def test_diagnostic_snapshot_never_enqueues_and_preserves_scope():
    recovery._ACTIVE.add((2026,7,("weekly",),"anonymous"))
    recovery._RESULTS[(2026,7,("ros",))]=(time.monotonic(),{"status":"error","failed":["ros:qb"]})
    rows=recovery.projection_recovery_snapshot()
    assert rows == [
        {"kind":"weekly","season":2026,"week":7,"status":"running","anonymous":True},
        {"kind":"ros","season":2026,"week":7,"status":"failed","failed":["ros:qb"],"anonymous":False},
    ]
    assert len(recovery._ACTIVE) == 1 and len(recovery._RESULTS) == 1
