"""Read-only contest research routes with real bounded engines, isolated auth."""
from copy import deepcopy

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.auth import require_patron
from app import dfs_contest_research_routes as routes
from app.dfs_shared_outcomes_routes import MAX_BODY_BYTES
from test_dfs_shared_outcomes_api import asgi_post
from test_dfs_contest_research import fixture, money

PREFIX = "/api/lineup/contest-research"


@pytest.fixture
def research_app():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_patron] = lambda: {"sub": "isolated-contest-research"}
    return app


@pytest.fixture
def client(research_app):
    with TestClient(research_app) as value:
        yield value


@pytest.fixture
def payload():
    bank, pool, _, field, payout = fixture()
    return {"context": deepcopy(bank["context"]), "pool": pool, "bank": bank,
            "contest_field": field, "payout_contract": payout}


@pytest.fixture
def inline_jobs(monkeypatch):
    calls = []
    async def submit(func, values):
        calls.append((func, deepcopy(values)))
        return func(values)
    monkeypatch.setattr(routes, "submit_cpu_job", submit)
    return calls


def evaluation_payload(client, payload):
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 200, response.text
    _, _, lineups, _, _ = fixture()
    return {**payload, "lineups": lineups, "input_snapshot_id": "synthetic-contest-inputs",
            "bank_id": response.json()["bank_id"], "contest_research_id": response.json()["content_id"],
            "seed": 17, "draw_count": 32, "top_k": 3}


@pytest.mark.parametrize("endpoint", ["preview", "evaluate"])
@pytest.mark.parametrize("field", ["weight", "ownership"])
@pytest.mark.parametrize("sign", [1, -1], ids=["positive", "negative"])
def test_oversized_field_integers_return_validation_error_without_echo(client, payload, inline_jobs, endpoint, field, sign):
    request = evaluation_payload(client, payload) if endpoint == "evaluate" else payload
    scenario = request["contest_field"]["scenarios"][0]
    value = sign * 10**1000
    if field == "weight":
        scenario["templates"][0]["weight"] = value
        message = "finite positive weight"
    else:
        scenario["ownership"][0]["projected_fraction"] = value
        message = "explicit fraction"
    before = len(inline_jobs)
    response = client.post(PREFIX + "/" + endpoint, json=request)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert str(value) not in response.text
    assert len(inline_jobs) == before + 1


@pytest.mark.parametrize("endpoint", ["preview", "evaluate"])
@pytest.mark.parametrize("denial", [401, 403])
def test_auth_rejects_before_any_streamed_source_bytes_or_cpu(research_app, monkeypatch, endpoint, denial):
    def deny():
        raise HTTPException(denial, "Synthetic account check denied")
    research_app.dependency_overrides[require_patron] = deny
    async def unexpected(*args, **kwargs):
        raise AssertionError("Denied requests must never schedule jobs")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    status, _, consumed = asgi_post(research_app, PREFIX + "/" + endpoint,
        [b"x" * (MAX_BODY_BYTES + 1)], content_length=MAX_BODY_BYTES + 1)
    assert status == denial
    assert consumed == []


@pytest.mark.parametrize("endpoint", ["preview", "evaluate"])
@pytest.mark.parametrize("content_length", [None, 1, MAX_BODY_BYTES + 100])
def test_streamed_byte_bound_is_enforced_even_when_length_missing_or_false(research_app, monkeypatch, endpoint, content_length):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Oversize requests must never reach CPU jobs")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    quarter = MAX_BODY_BYTES // 4
    status, body, consumed = asgi_post(research_app, PREFIX + "/" + endpoint,
        [b" " * quarter] * 4 + [b"x", b"unused"], content_length=content_length)
    assert status == 413
    assert consumed == [quarter] * 4 + [1]
    assert "8 MiB" in body["detail"]


def test_preview_runs_actual_cpu_validation_and_exposes_conditional_capabilities_only(client, payload, inline_jobs):
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert inline_jobs == [(routes._preview, payload)]
    assert result["field"]["contest"] == {"contest_id": "synthetic-contest", "contest_type": "mini_max", "entrant_count": 101}
    assert result["capabilities"]["exact_conditional_cash_ties"] is True
    assert result["capabilities"]["expected_payout"] is False
    assert result["capabilities"]["ownership_calibrated"] is False
    assert result["payout_contract"]["entry_fee_cents"] == 50
    assert "templates" not in result["field"]["scenarios"][0]
    assert "ownership" not in result["field"]["scenarios"][0]
    assert "pool" not in result["field"]
    assert result["field"]["sources"][0]["rights"]["redistribution"] is False


def test_actual_evaluation_replays_all_own_and_opponents_and_echoes_selected_snapshot(client, payload, inline_jobs, monkeypatch):
    from src.products import dfs_results
    def forbid_write(*args, **kwargs):
        raise AssertionError("Contest research cannot modify saved builds, lineups, or entries")
    monkeypatch.setattr(dfs_results, "save_build", forbid_write)
    monkeypatch.setattr(dfs_results, "import_entries", forbid_write)
    monkeypatch.setattr(dfs_results, "save_contest", forbid_write)
    request = evaluation_payload(client, payload)
    response = client.post(PREFIX + "/evaluate", json=request)
    assert response.status_code == 200, response.text
    result = response.json()
    assert inline_jobs[-1] == (routes._evaluate, request)
    assert result["bank_id"] == request["bank_id"]
    assert result["contest_research_id"] == request["contest_research_id"]
    assert result["input_snapshot_id"] == request["input_snapshot_id"]
    assert result["own_entry_count"] + result["opponent_entry_count"] == 101
    assert result["own_entry_count"] == 2
    assert result["draw_count"] == 32
    values = result["assumptions"][0]
    assert money(values["fees_cents"]) == 100
    assert money(values["gross"]["mean_cents"]) - money(values["net"]["mean_cents"]) == 100
    repeated = client.post(PREFIX + "/evaluate", json=request)
    assert repeated.status_code == 200
    assert repeated.json()["assumptions"] == result["assumptions"]
    assert repeated.json()["stream_manifest"] == result["stream_manifest"]


@pytest.mark.parametrize("raw", [b'{"contest_field":{},"contest_field":{}}',
    b'{"contest_field":{"score":1,"score":2}}', b'{"payout_contract":{"value":NaN}}',
    b'{"payout_contract":{"value":Infinity}}', b'{"payout_contract":{"value":-Infinity}}',
    b'{"payout_contract":{"value":1e999}}', b'\xff', b'{"payout_contract":', b'[]',
    b'{"contest_field":' + b'[' * 26 + b'0' + b']' * 26 + b'}',
    b'{"contest_field":[' + b'0,' * 250001 + b'0]}'],
    ids=["duplicate-root", "duplicate-nested", "nan", "infinity", "negative-infinity", "exponent",
         "utf8", "truncated", "root-list", "nesting-bomb", "value-bomb"])
def test_strict_json_rejects_malformed_duplicates_nonfinite_or_bombs_without_echo(client, monkeypatch, raw):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Malformed envelopes must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    response = client.post(PREFIX + "/preview", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid research package or controls. Review exact identities, salaries, bounds and JSON structure."}


@pytest.mark.parametrize("mutation", ["missing-payout", "null-payout", "missing-field", "null-field", "extra-write", "null-bank"])
def test_missing_capability_inputs_are_rejected_before_offload(client, payload, monkeypatch, mutation):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Incomplete envelopes must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    if mutation == "missing-payout": del payload["payout_contract"]
    elif mutation == "null-payout": payload["payout_contract"] = None
    elif mutation == "missing-field": del payload["contest_field"]
    elif mutation == "null-field": payload["contest_field"] = None
    elif mutation == "extra-write": payload["submit_entries"] = True
    elif mutation == "null-bank": payload["bank"] = None
    assert client.post(PREFIX + "/preview", json=payload).status_code == 422


@pytest.mark.parametrize("mutation", ["research-short", "research-upper", "research-padding", "top-zero", "top-bool", "top-string", "top-high",
    "draw-bool", "draw-string", "draw-low", "draw-high", "seed-bool", "seed-negative", "snapshot-padding", "extra-objective"])
def test_evaluate_controls_are_strict_and_bounded_before_cpu(client, payload, inline_jobs, monkeypatch, mutation):
    request = evaluation_payload(client, payload)
    async def unexpected(*args, **kwargs):
        raise AssertionError("Invalid controls must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    if mutation == "research-short": request["contest_research_id"] = "bad"
    elif mutation == "research-upper": request["contest_research_id"] = "A" * 64
    elif mutation == "research-padding": request["contest_research_id"] = " " + "a" * 63
    elif mutation == "top-zero": request["top_k"] = 0
    elif mutation == "top-bool": request["top_k"] = True
    elif mutation == "top-string": request["top_k"] = "3"
    elif mutation == "top-high": request["top_k"] = 100001
    elif mutation == "draw-bool": request["draw_count"] = True
    elif mutation == "draw-string": request["draw_count"] = "32"
    elif mutation == "draw-low": request["draw_count"] = 31
    elif mutation == "draw-high": request["draw_count"] = 257
    elif mutation == "seed-bool": request["seed"] = True
    elif mutation == "seed-negative": request["seed"] = -1
    elif mutation == "snapshot-padding": request["input_snapshot_id"] = " padded "
    elif mutation == "extra-objective": request["optimize_ev"] = True
    assert client.post(PREFIX + "/evaluate", json=request).status_code == 422


@pytest.mark.parametrize("mutation", ["research-id", "bank-id", "changed-payout", "changed-field", "changed-event", "wrong-slate",
    "wrong-contest", "wrong-entrants", "unadmitted-hash", "unadmitted-uri", "future-payout", "rights", "missing-fee", "noncash", "top-over-field"])
def test_actual_engine_rejects_changed_context_versions_and_missing_financial_support(client, payload, inline_jobs, mutation):
    request = evaluation_payload(client, payload)
    if mutation == "research-id": request["contest_research_id"] = "a" * 64
    elif mutation == "bank-id": request["bank_id"] = "a" * 64
    elif mutation == "changed-payout": request["payout_contract"]["entry_fee_cents"] = 25
    elif mutation == "changed-field": request["contest_field"]["scenarios"][0]["templates"][0]["weight"] = 20
    elif mutation == "changed-event": request["bank"]["games"][0]["profiles"][0]["events"][0]["yards"] = 40
    elif mutation == "wrong-slate": request["contest_field"]["context"]["slate_id"] = "other-slate"
    elif mutation == "wrong-contest": request["payout_contract"]["contest_id"] = "other-contest"
    elif mutation == "wrong-entrants": request["payout_contract"]["entrant_count"] = 100
    elif mutation == "unadmitted-hash": request["payout_contract"]["tie_policy"]["source"]["content_sha256"] = "b" * 64
    elif mutation == "unadmitted-uri": request["payout_contract"]["tie_policy"]["source"]["source_uri"] = "fixture:unadmitted"
    elif mutation == "future-payout": request["payout_contract"]["tie_policy"]["source"]["as_of"] = "2026-10-13T12:00:00Z"
    elif mutation == "rights": request["contest_field"]["sources"][0]["rights"]["hosted_ingestion"] = False
    elif mutation == "missing-fee": request["payout_contract"]["entry_fee_cents"] = None
    elif mutation == "noncash": request["payout_contract"]["noncash_prizes"] = [{"award": "ticket"}]
    elif mutation == "top-over-field": request["top_k"] = 102
    response = client.post(PREFIX + "/evaluate", json=request)
    assert response.status_code == 400, response.text
    assert "detail" in response.json()
