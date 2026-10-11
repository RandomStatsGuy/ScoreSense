"""Synthetic storage retry regressions for the DFS entry-export workflow (T28/T29)."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.auth import require_patron
from app.dfs_results_routes import Build, Entry, EntryImport, export_access, import_results, owner, router, save_build
from src.products import dfs_results


@pytest.fixture(autouse=True)
def results_db(tmp_path, monkeypatch):
    monkeypatch.setattr(dfs_results, "RESULTS_DB", tmp_path / "results.db")


def request(**overrides):
    return Build(**{ "site": "draftkings", "slate_id": "synthetic-main", "slate_name": "Synthetic",
                    "lineups": [{"lineup": []}], "settings": {"snapshot_at": "2026-10-11T12:00:00Z"},
                    "idempotency_key": "synthetic-export-version-1", **overrides })


def test_lost_response_retry_returns_original_build_without_duplicate_rows():
    original = save_build(request(), "account-a")
    retry = save_build(request(), "account-a")
    assert retry == original
    assert len(dfs_results.read_results("account-a")["builds"]) == 1


def test_key_never_authorizes_other_accounts_or_rewrites_a_build():
    original = save_build(request(), "account-a")
    other = save_build(request(), "account-b")
    assert original["id"] != other["id"]
    with pytest.raises(HTTPException) as caught:
        save_build(request(note="Changed input reusing an immutable export version"), "account-a")
    assert caught.value.status_code == 409
    assert dfs_results.read_results("account-a")["builds"] == [original]


def test_concurrent_retry_is_atomic_and_legacy_unkeyed_saves_remain_separate():
    # Initialize the tables before parallel requests, like the running API.
    dfs_results.read_results("account-a")
    with ThreadPoolExecutor(max_workers=4) as pool:
        saved = list(pool.map(lambda _: save_build(request(), "account-a"), range(4)))
    assert len({build["id"] for build in saved}) == 1
    for _ in range(2):
        save_build(request(idempotency_key=None), "account-a")
    assert len(dfs_results.read_results("account-a")["builds"]) == 3


def test_delayed_retry_can_link_its_owned_build_beyond_the_recent_list_window():
    original = save_build(request(), "account-a")
    for i in range(101):
        save_build(request(idempotency_key=f"synthetic-newer-{i}"), "account-a")
    retry = save_build(request(), "account-a")
    assert retry == original
    record = EntryImport(entries=[Entry(entry_id="0001", contest_id="0002", build_id=retry["id"], lineup_index=0)])
    import_results(record, "account-a", compact=True)
    assert dfs_results.read_results("account-a")["entries"][0]["build_id"] == original["id"]
    with pytest.raises(HTTPException):
        import_results(record, "account-b", compact=True)


def test_export_access_requires_current_auth_but_never_reads_optional_ledger(monkeypatch):
    route = next(route for route in router.routes if route.path == "/api/lineup/export-access")
    account_dependency = route.dependant.dependencies[0]
    assert account_dependency.call is owner
    assert account_dependency.dependencies[0].call is require_patron
    with pytest.raises(HTTPException) as caught:
        owner(None)
    assert caught.value.status_code == 401
    def ledger_unavailable(*_args, **_kwargs):
        raise AssertionError("Export authorization must not open the history ledger")
    monkeypatch.setattr(dfs_results, "connect", ledger_unavailable)
    assert export_access(owner({"sub": "synthetic-account"})) == {"allowed": True}
