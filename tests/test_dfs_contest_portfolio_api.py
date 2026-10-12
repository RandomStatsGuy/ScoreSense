"""Independent route checks for bounded, read-only portfolio research."""
from copy import deepcopy

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.auth import require_patron
from app import dfs_contest_research_routes as routes
from app.dfs_shared_outcomes_routes import MAX_BODY_BYTES
from test_dfs_shared_outcomes_api import asgi_post
from test_dfs_contest_research import fixture

PATH = "/api/lineup/contest-research/select"


@pytest.fixture
def research_app():
    value = FastAPI()
    value.include_router(routes.router)
    value.dependency_overrides[require_patron] = lambda: {"sub": "isolated-portfolio-research"}
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


@pytest.fixture
def payload(client, inline_jobs):
    bank, pool, lineups, field, payout = fixture()
    values = {"context": deepcopy(bank["context"]), "pool": pool, "bank": bank,
              "contest_field": field, "payout_contract": payout}
    preview = client.post("/api/lineup/contest-research/preview", json=values)
    assert preview.status_code == 200, preview.text
    return {**values, "lineups": lineups, "input_snapshot_id": "synthetic-portfolio-inputs",
        "selection_request_id": "synthetic-portfolio-request", "bank_id": preview.json()["bank_id"],
        "contest_research_id": preview.json()["content_id"], "seed": 17,
        "draw_count": 32, "top_k": 3, "count": 1,
        "projection_scores": {"first": "110.5", "alternative": "109.5"},
        "objective": "conditional_mean_net", "scenario_id": "baseline",
        "risk_alpha": "0.9", "risk_weight": "0"}


@pytest.mark.parametrize("denial", [401, 403])
def test_auth_rejects_before_consuming_source_or_scheduling_cpu(research_app, monkeypatch, denial):
    def deny():
        raise HTTPException(denial, "Synthetic account check denied")
    research_app.dependency_overrides[require_patron] = deny
    async def forbid(*args, **kwargs):
        pytest.fail("Denied accounts must not schedule research jobs")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    status, _, consumed = asgi_post(research_app, PATH, [b"x" * (MAX_BODY_BYTES + 1)],
                                   content_length=MAX_BODY_BYTES + 1)
    assert status == denial
    assert consumed == []


@pytest.mark.parametrize("content_length", [None, 1, MAX_BODY_BYTES + 100])
def test_actual_stream_limit_is_enforced_even_with_false_length(research_app, monkeypatch, content_length):
    async def forbid(*args, **kwargs):
        pytest.fail("Oversize research must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    quarter = MAX_BODY_BYTES // 4
    status, body, consumed = asgi_post(research_app, PATH,
        [b" " * quarter] * 4 + [b"x", b"unused"], content_length=content_length)
    assert status == 413
    assert consumed == [quarter] * 4 + [1]
    assert "8 MiB" in body["detail"]


@pytest.mark.parametrize("raw", [b'{"count":1,"count":2}', b'{"projection_scores":{"a":1,"a":2}}',
    b'{"risk_weight":NaN}', b'{"risk_weight":Infinity}', b'{"count":1e999}', b'[]', b'\xff',
    b'{"bank":' + b'[' * 26 + b'0' + b']' * 26 + b'}'],
    ids=["duplicate-root", "duplicate-projection", "nan", "infinity", "overflow", "list", "utf8", "depth"])
def test_malformed_envelope_is_rejected_without_cpu_or_payload_echo(client, monkeypatch, raw):
    async def forbid(*args, **kwargs):
        pytest.fail("Malformed JSON must not schedule work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    response = client.post(PATH, content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid research package or controls. Review exact identities, salaries, bounds and JSON structure."}


@pytest.mark.parametrize("mutation", ["count-bool", "count-string", "count-zero", "count-high", "request-padding",
    "request-long", "seed-bool", "draw-low", "draw-high", "missing-projections", "unknown-mode", "extra-write",
    "missing-field", "null-payout", "overlap-bool", "overlap-high", "risk-number", "scenario-padding",
    "missing-score", "extra-score"])
def test_strict_controls_reject_before_cpu(client, payload, monkeypatch, mutation):
    request = deepcopy(payload)
    if mutation == "count-bool": request["count"] = True
    elif mutation == "count-string": request["count"] = "1"
    elif mutation == "count-zero": request["count"] = 0
    elif mutation == "count-high": request["count"] = 151
    elif mutation == "request-padding": request["selection_request_id"] = " padding"
    elif mutation == "request-long": request["selection_request_id"] = "x" * 101
    elif mutation == "seed-bool": request["seed"] = True
    elif mutation == "draw-low": request["draw_count"] = 31
    elif mutation == "draw-high": request["draw_count"] = 257
    elif mutation == "missing-projections": del request["projection_scores"]
    elif mutation == "unknown-mode": request["objective"] = "forecast_expected_value"
    elif mutation == "extra-write": request["submit_entries"] = True
    elif mutation == "missing-field": del request["contest_field"]
    elif mutation == "null-payout": request["payout_contract"] = None
    elif mutation == "overlap-bool": request["max_overlap"] = True
    elif mutation == "overlap-high": request["max_overlap"] = 10
    elif mutation == "risk-number": request["risk_alpha"] = .9
    elif mutation == "scenario-padding": request["scenario_id"] = " baseline"
    elif mutation == "missing-score": del request["projection_scores"]["first"]
    elif mutation == "extra-score": request["projection_scores"]["outside"] = "10"
    async def forbid(*args, **kwargs):
        pytest.fail("Invalid controls must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", forbid)
    response = client.post(PATH, json=request)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("mutation", ["bank-hash", "research-hash", "field-weights", "payout-fee"])
def test_stale_selected_package_cannot_be_used_for_selection(client, payload, inline_jobs, mutation):
    if mutation == "bank-hash": payload["bank_id"] = "a" * 64
    elif mutation == "research-hash": payload["contest_research_id"] = "a" * 64
    elif mutation == "field-weights": payload["contest_field"]["scenarios"][0]["templates"][0]["weight"] += 1
    elif mutation == "payout-fee": payload["payout_contract"]["entry_fee_cents"] += 1
    response = client.post(PATH, json=payload)
    assert response.status_code == 400, response.text
    assert "changed" in response.json()["detail"].lower()
    assert inline_jobs[-1][0] is routes._select


@pytest.mark.parametrize("mutation", ["unknown-player", "unavailable-assumption",
    "missing-lock", "excluded-member", "duplicate-roster"])
def test_invalid_candidate_or_constraint_does_not_silently_change_request(client, payload, inline_jobs, mutation):
    if mutation == "unknown-player": payload["player_exposure_limits"] = {"outside": {"min": "1"}}
    elif mutation == "unavailable-assumption": payload["scenario_id"] = "missing-assumption"
    elif mutation == "missing-lock": payload["locked_player_ids"] = ["mia-wr2"]
    elif mutation == "excluded-member": payload["excluded_player_ids"] = ["buf-qb"]
    elif mutation == "duplicate-roster": payload["lineups"][1]["player_ids"] = list(reversed(payload["lineups"][0]["player_ids"]))
    response = client.post(PATH, json=payload)
    assert response.status_code == 400, response.text
    assert response.json()["detail"]


def test_real_selection_echoes_identity_and_never_writes_account_lineups(client, payload, inline_jobs, monkeypatch):
    from src.products import dfs_results
    def forbid(*args, **kwargs):
        pytest.fail("Read-only portfolio research must not write builds, contests or entries")
    for name in ("save_build", "save_contest", "import_entries"):
        monkeypatch.setattr(dfs_results, name, forbid)
    original = deepcopy(payload)
    response = client.post(PATH, json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["selection_request_id"] == payload["selection_request_id"]
    assert result["input_snapshot_id"] == payload["input_snapshot_id"]
    assert result["bank_id"] == payload["bank_id"]
    assert result["contest_research_id"] == payload["contest_research_id"]
    assert result["capabilities"]["expected_payout"] is False
    assert result["capabilities"]["forward_forecast"] is False
    assert result["capabilities"]["untouched_evaluation_verified"] is False
    assert inline_jobs[-1] == (routes._select, routes.SelectContest.model_validate(payload).model_dump())
    assert payload == original
    repeat = client.post(PATH, json=payload)
    assert repeat.status_code == 200
    assert repeat.json()["selection_request_id"] == result["selection_request_id"]


@pytest.mark.parametrize("control", ["player-min", "group-max", "global-max", "soft-count"])
def test_unsupported_decimal_precision_cannot_silently_relax_a_hard_bound(client, payload, control):
    if control == "player-min":
        payload["player_exposure_limits"] = {"buf-wr1": {"min": "1e-10000000"}}
    elif control == "group-max":
        payload["group_exposure_limits"] = [{"id": "synthetic-pair", "player_ids": ["buf-rb", "mia-rb"],
                                             "max": "0." + "9" * 100}]
    elif control == "global-max":
        payload["max_exposure"] = "1e-10000000"
    else:
        payload["player_exposure_limits"] = {"buf-wr1": {"target": {"count": "1e-10000000"}}}
    response = client.post(PATH, json=payload)
    assert response.status_code == 400, response.text
    assert "decimal" in response.json()["detail"].lower()


def test_supported_24_decimal_fraction_keeps_exact_ceil_minimum(client, payload):
    payload["player_exposure_limits"] = {"buf-wr1": {"min": "0.333333333333333333333333"}}
    response = client.post(PATH, json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["complete"] and result["selected_count"] == 1
    assert "buf-wr1" in result["selected_lineups"][0]["player_ids"]
    rule = next(row for row in result["constraints"] if row["scope"] == "player" and row["id"] == "buf-wr1")
    assert rule["minimum_count"] == 1
