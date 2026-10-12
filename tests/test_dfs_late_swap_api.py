"""Independent bounded HTTP checks for declaration-only late-swap research.

No provider, account entry, live lineup, production database or network source
is accessed. Successful cases execute the actual pure planner inline.
"""
from copy import deepcopy

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.auth import require_patron
from app import dfs_late_swap_routes as routes
from app.dfs_shared_outcomes_routes import MAX_BODY_BYTES
from scripts.dev.verify_dfs_late_swap import late_swap_fixture, template_fixture
from test_dfs_shared_outcomes_api import asgi_post


PREFIX = "/api/lineup/late-swap"
CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic",
           "season": 2099, "week": 3, "slate_id": "synthetic-late-swap"}


@pytest.fixture
def research_app():
    value = FastAPI()
    value.include_router(routes.router)
    value.dependency_overrides[require_patron] = lambda: {"sub": "isolated-late-swap-research"}
    return value


@pytest.fixture
def client(research_app):
    with TestClient(research_app) as value:
        yield value


@pytest.fixture
def inline_jobs(monkeypatch):
    calls = []
    async def submit(func, values):
        calls.append((func, deepcopy(values)))
        return func(values)
    monkeypatch.setattr(routes, "submit_cpu_job", submit)
    return calls


@pytest.mark.parametrize("endpoint", ["preview", "plan"])
@pytest.mark.parametrize("denial", [401, 403])
def test_denied_account_is_rejected_before_body_or_cpu(research_app, monkeypatch, endpoint, denial):
    def deny():
        raise HTTPException(denial, "Synthetic account check denied")
    research_app.dependency_overrides[require_patron] = deny
    async def forbid(*args, **kwargs):
        pytest.fail("Denied requests cannot schedule late-swap work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    status, _, consumed = asgi_post(research_app, PREFIX + "/" + endpoint,
        [b"x" * (MAX_BODY_BYTES + 1)], content_length=MAX_BODY_BYTES + 1)
    assert status == denial
    assert consumed == []


@pytest.mark.parametrize("endpoint", ["preview", "plan"])
@pytest.mark.parametrize("declared_length", [None, 1, MAX_BODY_BYTES + 100])
def test_streamed_limit_does_not_trust_content_length(research_app, monkeypatch, endpoint, declared_length):
    async def forbid(*args, **kwargs):
        pytest.fail("Oversize sources cannot reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    quarter = MAX_BODY_BYTES // 4
    status, body, consumed = asgi_post(research_app, PREFIX + "/" + endpoint,
        [b" " * quarter] * 4 + [b"x", b"unused"], content_length=declared_length)
    assert status == 413
    assert consumed == [quarter] * 4 + [1]
    assert "8 MiB" in body["detail"]


@pytest.mark.parametrize("endpoint", ["preview", "plan"])
@pytest.mark.parametrize("raw", [b'{"package":{},"package":{}}',
    b'{"package":{"as_of":"one","as_of":"two"}}', b'{"package":NaN}',
    b'{"package":Infinity}', b'{"package":1e999}', b'[]', b'\xff',
    b'{"package":' + b'[' * 26 + b'0' + b']' * 26 + b'}'],
    ids=["duplicate-root", "duplicate-source", "nan", "infinity", "overflow", "list", "utf8", "depth"])
def test_malformed_source_does_not_echo_or_schedule(client, monkeypatch, endpoint, raw):
    async def forbid(*args, **kwargs):
        pytest.fail("Malformed sources cannot reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    response = client.post(PREFIX + "/" + endpoint, content=raw,
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert set(response.json()) == {"detail"}
    assert "Invalid research package or controls" in response.json()["detail"]


@pytest.mark.parametrize("mutation", ["context-bool", "context-float", "context-extra",
    "wrong-site", "wrong-format", "missing-package", "list-package", "write-field",
    "account-field", "missing-hash", "hash-padding", "hash-short", "hash-nonhex"])
def test_strict_envelope_rejects_before_cpu(client, monkeypatch, mutation):
    request = {"context": deepcopy(CONTEXT), "package": {}, "package_id": "a" * 64}
    if mutation == "context-bool": request["context"]["season"] = True
    elif mutation == "context-float": request["context"]["week"] = 3.0
    elif mutation == "context-extra": request["context"]["user_id"] = "other"
    elif mutation == "wrong-site": request["context"]["site"] = "draftkings_showdown"
    elif mutation == "wrong-format": request["context"]["format"] = "showdown"
    elif mutation == "missing-package": del request["package"]
    elif mutation == "list-package": request["package"] = []
    elif mutation == "write-field": request["submit_entries"] = True
    elif mutation == "account-field": request["account_id"] = "claimed-account"
    elif mutation == "missing-hash": del request["package_id"]
    elif mutation == "hash-padding": request["package_id"] = " " + "a" * 63
    elif mutation == "hash-short": request["package_id"] = "a" * 63
    elif mutation == "hash-nonhex": request["package_id"] = "g" * 64
    async def forbid(*args, **kwargs):
        pytest.fail("Invalid envelope must not schedule late-swap work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    response = client.post(PREFIX + "/plan", json=request)
    assert response.status_code == 422, response.text


def test_preview_does_not_accept_a_supplied_server_identity(client, monkeypatch):
    async def forbid(*args, **kwargs):
        pytest.fail("Invalid envelope must not schedule late-swap work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    response = client.post(PREFIX + "/preview", json={"context": CONTEXT,
        "package": {}, "package_id": "a" * 64})
    assert response.status_code == 422


@pytest.fixture
def payload():
    return {"context": deepcopy(CONTEXT), "package": late_swap_fixture()}


def planned_request(client, payload):
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 200, response.text
    return {**payload, "package_id": response.json()["content_id"]}


@pytest.mark.parametrize("mutation", ["context", "unknown-field", "unknown-lock", "unknown-kickoff",
    "naive-time", "impossible-date", "lock-contradiction", "future-source", "old-lock-snapshot",
    "readback-hash", "readback-time", "missing-source", "missing-rights", "denied-rights",
    "coerced-rights", "numeric-entry", "duplicate-entry", "wrong-contest", "numeric-dfs-id",
    "duplicate-dfs-id", "missing-slot", "extra-slot", "duplicate-athlete", "locked-slot-move",
    "new-started-player", "salary-bool", "salary-fraction", "unknown-control", "too-many-entries",
    "too-many-candidates", "unsupported-forecast-mode"])
def test_malformed_or_unproved_declarations_reject_atomically(client, payload, inline_jobs, mutation):
    package = payload["package"]
    if mutation == "context": package["context"]["slate_id"] = "other-slate"
    elif mutation == "unknown-field": package["account_id"] = "claimed-other-account"
    elif mutation == "unknown-lock": package["catalog"][1]["lock_state"] = "unknown"
    elif mutation == "unknown-kickoff": package["catalog"][1]["kickoff_at"] = None
    elif mutation == "naive-time": package["decision_at"] = "2026-10-11T20:00:00"
    elif mutation == "impossible-date": package["decision_at"] = "2026-02-31T20:00:00Z"
    elif mutation == "lock-contradiction": package["catalog"][1]["lock_state"] = "locked"
    elif mutation == "future-source": package["sources"][1]["as_of"] = "2026-10-11T20:01:00Z"
    elif mutation == "old-lock-snapshot": package["sources"][3]["as_of"] = "2026-10-11T19:59:00Z"
    elif mutation == "readback-hash": package["accepted_state"]["readback_sha256"] = "f" * 64
    elif mutation == "readback-time": package["accepted_state"]["as_of"] = "2026-10-11T19:59:00Z"
    elif mutation == "missing-source": package["sources"].pop()
    elif mutation == "missing-rights": del package["sources"][0]["rights"]
    elif mutation == "denied-rights": package["sources"][0]["rights"]["hosted_ingestion"] = False
    elif mutation == "coerced-rights": package["sources"][0]["rights"]["display"] = "true"
    elif mutation == "numeric-entry": package["accepted_state"]["entries"][0]["entry_id"] = 1
    elif mutation == "duplicate-entry": package["accepted_state"]["entries"][1]["entry_id"] = "000001"
    elif mutation == "wrong-contest": package["accepted_state"]["entries"][0]["contest_id"] = "999"
    elif mutation == "numeric-dfs-id": package["catalog"][0]["dfs_id"] = 1000
    elif mutation == "duplicate-dfs-id": package["catalog"][1]["dfs_id"] = "1000"
    elif mutation == "missing-slot": del package["accepted_state"]["entries"][0]["slots"]["FLEX"]
    elif mutation == "extra-slot": package["accepted_state"]["entries"][0]["slots"]["WR4"] = "w4"
    elif mutation == "duplicate-athlete": package["accepted_state"]["entries"][0]["slots"]["WR2"] = "w0"
    elif mutation == "locked-slot-move":
        slots = package["candidates"][0]["slots"]
        slots["WR1"], slots["FLEX"] = slots["FLEX"], slots["WR1"]
    elif mutation == "new-started-player":
        package["catalog"].append({**package["catalog"][3], "player_id": "new-locked", "dfs_id": "09999"})
        package["candidates"][0]["slots"]["WR2"] = "new-locked"
    elif mutation == "salary-bool": package["catalog"][0]["salary"] = True
    elif mutation == "salary-fraction": package["catalog"][0]["salary"] = 4000.5
    elif mutation == "unknown-control": package["controls"]["ignore_locked_slots"] = True
    elif mutation == "too-many-entries": package["accepted_state"]["entries"] *= 76
    elif mutation == "too-many-candidates": package["candidates"] *= 151
    elif mutation == "unsupported-forecast-mode": package["objective"] = "expected_remaining_payout"
    before = deepcopy(payload)
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 400, response.text
    assert set(response.json()) == {"detail"}
    assert response.json()["detail"]
    assert payload == before
    assert inline_jobs[-1][0] is routes._preview


@pytest.mark.parametrize("mutation", ["hash", "projection", "slots", "receipt", "controls"])
def test_stale_preview_never_reuses_a_different_snapshot(client, payload, inline_jobs, mutation):
    request = planned_request(client, payload)
    if mutation == "hash": request["package_id"] = "a" * 64
    elif mutation == "projection": request["package"]["catalog"][1]["projection"] = "4.5"
    elif mutation == "slots": request["package"]["candidates"][0]["slots"]["RB1"] = "rb4"
    elif mutation == "receipt": request["package"]["sources"][1]["content_sha256"] = "f" * 64
    elif mutation == "controls": request["package"]["controls"]["max_overlap"] = 9
    response = client.post(PREFIX + "/plan", json=request)
    assert response.status_code == 400, response.text
    assert "changed" in response.json()["detail"].lower()
    assert inline_jobs[-1][0] is routes._plan


def test_success_preserves_exact_entries_and_is_read_only(client, payload, inline_jobs, monkeypatch):
    from src.products import dfs_results
    def forbid(*args, **kwargs):
        pytest.fail("Late-swap snapshot research must not access account storage")
    monkeypatch.setattr(dfs_results, "connect", forbid)
    request = planned_request(client, payload)
    original = deepcopy(request)
    response = client.post(PREFIX + "/plan", json=request)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["package_id"] == request["package_id"]
    assert result["complete"] is True
    assert [row["entry_id"] for row in result["entries"]] == ["000001", "000002"]
    for row in result["entries"]:
        assert row["contest_id"] == "00042"
        assert row["after_slots"]["QB"] == "q0"
        assert row["after_slots"]["WR1"] == "w0"
        assert row["salary_after"] == 36000
    assert result["audit"]["ok"] is True
    assert request == original
    assert inline_jobs[-1][0] is routes._plan
    repeat = client.post(PREFIX + "/plan", json=request)
    assert repeat.status_code == 200
    assert repeat.json()["plan_id"] == result["plan_id"]
    # The HTTP contract returns research, never provider-submittable bytes.
    assert "csv" not in result and "template" not in result


def test_api_to_internal_csv_dry_run_preserves_locked_columns_and_metadata(client, payload, inline_jobs):
    import csv
    import io
    from src.products.dfs_late_swap import prepare_late_swap_package, build_late_swap_csv_preview
    request = planned_request(client, payload)
    response = client.post(PREFIX + "/plan", json=request)
    assert response.status_code == 200, response.text
    prepared = prepare_late_swap_package(payload["package"], context=payload["context"])
    template = template_fixture(payload["package"])
    output = build_late_swap_csv_preview(template, prepared, response.json())
    before = list(csv.reader(io.StringIO(template)))
    after = list(csv.reader(io.StringIO(output["csv"])))
    assert len(after) == len(before)
    assert after[0] == before[0]
    assert after[1] == before[1]
    assert after[-1] == before[-1]
    for old, new in zip(before[2:-1], after[2:-1]):
        assert new[:4] == old[:4]
        assert new[4] == old[4]  # exact locked QB column
        assert new[7] == old[7]  # exact locked WR1 column
        assert new[13:] == old[13:]
    assert after != before
