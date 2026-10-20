"""One fresh lobby revision per discovery, shared only while fetching."""
from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
import threading

import pytest
import requests

from src.integrations import dfs_slates as dfs


@pytest.fixture
def lobby():
    return {
        "GameTypes": [{"GameTypeId": 1, "Name": "Classic"},
                      {"GameTypeId": 96, "Name": "Showdown Captain Mode"}],
        "DraftGroups": [
            {"DraftGroupId": 11, "GameTypeId": 1, "GameCount": 12},
            {"DraftGroupId": 22, "GameTypeId": 96, "GameCount": 1},
        ],
        "Contests": [{"dg": 11, "n": "Sunday Classic"},
                     {"dg": 22, "n": "Showdown"}],
    }


@pytest.mark.parametrize("category", dfs.SLATE_CATEGORIES)
@pytest.mark.parametrize("groups", [None, [], [0], [1]])
def test_discovery_preserves_filter_order_and_default(monkeypatch, lobby, category, groups):
    if groups is not None:
        lobby["DraftGroups"] = [lobby["DraftGroups"][i] for i in groups]
        ids = {g["DraftGroupId"] for g in lobby["DraftGroups"]}
        lobby["Contests"] = [c for c in lobby["Contests"] if c["dg"] in ids]
    calls = []
    def fetch(url, params):
        calls.append((url, params))
        return lobby
    monkeypatch.setattr(dfs, "_dk_get", fetch)
    expected = dfs.list_slates("draftkings", category)
    default = dfs.pick_default_slate("draftkings", "main" if category == "all" else category)
    calls.clear()
    original = deepcopy(lobby)
    assert dfs.list_slates_with_default("draftkings", category) == (expected, default)
    assert calls == [(dfs.DK_LOBBY_URL, {"sport": "NFL"})]
    assert lobby == original


def test_next_request_observes_provider_transition_and_independent_rows(monkeypatch, lobby):
    monkeypatch.setattr(dfs, "_dk_get", lambda *a, **k: lobby)
    before, _ = dfs.list_slates_with_default("draftkings")
    before[0]["name"] = "caller mutation"
    unchanged, _ = dfs.list_slates_with_default("draftkings")
    assert unchanged[0]["name"] != "caller mutation"
    # No TTL delays a kickoff removal, changed contest count, or new group.
    lobby["DraftGroups"].pop(0)
    lobby["Contests"].pop(0)
    after, default = dfs.list_slates_with_default("draftkings")
    assert [s["slate_id"] for s in after] == ["22"]
    assert default["slate_id"] == "22"
    assert not dfs._DK_LOBBY_INFLIGHT


@pytest.mark.parametrize("fail", [False, True])
def test_concurrent_categories_share_fetch_and_failure_is_retryable(monkeypatch, lobby, fail):
    joined = threading.Event()
    lock = threading.Lock()
    waits = 0
    class ObservedFuture(Future):
        def result(self, timeout=None):
            nonlocal waits
            with lock:
                waits += 1
                if waits == 5:
                    joined.set()
            return super().result(timeout=5)
    monkeypatch.setattr(dfs, "Future", ObservedFuture)
    calls = []
    def fetch(*args, **kwargs):
        calls.append(kwargs)
        assert joined.wait(5), "identical requests failed to join the fetch"
        if fail:
            raise requests.Timeout("provider unavailable")
        return lobby
    monkeypatch.setattr(dfs, "_dk_get", fetch)
    with ThreadPoolExecutor(max_workers=6) as executor:
        jobs = [executor.submit(dfs.list_dk_slates, category=category)
                for category in ["all", "main", "showdown"] * 2]
        if fail:
            for job in jobs:
                with pytest.raises(requests.Timeout, match="provider unavailable"):
                    job.result(timeout=6)
        else:
            rows = [job.result(timeout=6) for job in jobs]
            assert len(rows[0]) == 2
            assert rows[1][0]["slate_id"] == "11"
            assert rows[2][0]["slate_id"] == "22"
            rows[0][0]["name"] = "changed"
            assert rows[3][0]["name"] != "changed"
    assert len(calls) == 1
    assert not dfs._DK_LOBBY_INFLIGHT
    monkeypatch.setattr(dfs, "_dk_get", lambda *a, **k: lobby)
    assert dfs.list_dk_slates()


def test_sports_do_not_share_fetch_or_hold_global_lock(monkeypatch, lobby):
    both_entered = threading.Barrier(2)
    calls = []
    def fetch(url, params):
        calls.append(params["sport"])
        both_entered.wait(timeout=5)
        return lobby
    monkeypatch.setattr(dfs, "_dk_get", fetch)
    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = [executor.submit(dfs.list_slates_with_default, "draftkings", sport=s)
                for s in ["NFL", "NBA"]]
        for job in jobs:
            assert job.result(timeout=6)[0]
    assert sorted(calls) == ["NBA", "NFL"]


def test_salary_metadata_and_slate_discovery_share_inflight_lobby(monkeypatch, lobby):
    joined = threading.Event()
    class ObservedFuture(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout=5)
    monkeypatch.setattr(dfs, "Future", ObservedFuture)
    calls = []
    def fetch(*a, **k):
        calls.append(1)
        assert joined.wait(5)
        return lobby
    monkeypatch.setattr(dfs, "_dk_get", fetch)
    with ThreadPoolExecutor(max_workers=2) as executor:
        # Salary loading uses list_slates to resolve a requested slate's metadata.
        salary_metadata = executor.submit(dfs.list_slates, "draftkings")
        discovery = executor.submit(dfs.list_slates_with_default, "draftkings")
        assert salary_metadata.result(timeout=6) == discovery.result(timeout=6)[0]
    assert len(calls) == 1


def test_route_uses_one_lobby_and_retains_provider_error_mapping(monkeypatch, lobby):
    import app.api as api
    calls = []
    def fetch(*a, **k):
        calls.append(1)
        return lobby
    monkeypatch.setattr(dfs, "_dk_get", fetch)
    response = api.lineup_slates("draftkings", "all", "NFL")
    assert response["count"] == 2
    assert response["default_slate_id"] == "11"
    assert len(calls) == 1
    def fail(*a, **k):
        raise requests.Timeout("provider unavailable")
    monkeypatch.setattr(dfs, "_dk_get", fail)
    with pytest.raises(api.HTTPException) as exc:
        api.lineup_slates("draftkings", "all", "NFL")
    assert exc.value.status_code == 502


def test_fanduel_still_uses_its_account_scoped_path(monkeypatch):
    calls = []
    def listing(site, category="all", sport="NFL"):
        calls.append((site, category))
        return [{"slate_id": "fd", "category": "main"}]
    monkeypatch.setattr(dfs, "list_slates", listing)
    monkeypatch.setattr(dfs, "_dk_lobby", lambda *a: pytest.fail("public sharing used for FanDuel"))
    rows, default = dfs.list_slates_with_default("fanduel")
    assert default == rows[0]
    assert calls == [("fanduel", "all"), ("fanduel", "main")]
