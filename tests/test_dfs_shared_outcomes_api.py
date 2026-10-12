"""Isolated read-only research HTTP contracts, including streamed-body gates."""
import asyncio
from copy import deepcopy
import json

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.auth import require_patron
from app import dfs_shared_outcomes_routes as routes
from test_dfs_shared_outcomes import fixture as scenario_fixture


PREFIX = "/api/lineup/shared-outcomes"


@pytest.fixture
def research_app():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_patron] = lambda: {"sub": "isolated-research"}
    return app


@pytest.fixture
def client(research_app):
    with TestClient(research_app) as result:
        yield result


@pytest.fixture
def payload():
    bank, pool, _ = scenario_fixture()
    return {"context": deepcopy(bank["context"]), "pool": pool, "bank": bank}


@pytest.fixture
def inline_jobs(monkeypatch):
    """Capture the CPU boundary while executing the actual pure engine locally."""
    calls = []
    async def submit(func, values):
        calls.append((func, deepcopy(values)))
        return func(values)
    monkeypatch.setattr(routes, "submit_cpu_job", submit)
    return calls


def evaluation_payload(client, payload):
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 200, response.text
    _, _, lineups = scenario_fixture()
    return {**payload, "lineups": lineups, "input_snapshot_id": "decision:synthetic-exact",
            "bank_id": response.json()["content_id"], "seed": 19, "draw_count": 256}


def asgi_post(app, path, chunks, *, content_length=None):
    """Use real ASGI request chunks without buffering them in an HTTP client."""
    consumed, messages = [], []
    iterator = iter(chunks)
    async def receive():
        try:
            body = next(iterator)
        except StopIteration:
            return {"type": "http.request", "body": b"", "more_body": False}
        consumed.append(len(body))
        return {"type": "http.request", "body": body, "more_body": True}
    async def send(message):
        messages.append(message)
    headers = [(b"content-type", b"application/json")]
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "headers": headers, "client": ("test", 1),
             "server": ("test", 80), "root_path": ""}
    asyncio.run(app(scope, receive, send))
    status = next(item["status"] for item in messages if item["type"] == "http.response.start")
    body = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
    return status, json.loads(body), consumed


@pytest.mark.parametrize("endpoint", ["preview", "evaluate"])
@pytest.mark.parametrize("denial", [401, 403])
def test_auth_denial_precedes_any_body_read_even_when_oversize(research_app, monkeypatch, endpoint, denial):
    def deny():
        raise HTTPException(denial, "Synthetic account check denied")
    research_app.dependency_overrides[require_patron] = deny
    async def unexpected(*args, **kwargs):
        raise AssertionError("Denied requests must never schedule research jobs")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    status, _, consumed = asgi_post(research_app, PREFIX + "/" + endpoint,
                                   [b"x" * (routes.MAX_BODY_BYTES + 1)],
                                   content_length=routes.MAX_BODY_BYTES + 1)
    assert status == denial
    assert consumed == [], "Authentication must run before streaming or parsing user-held source bytes"


@pytest.mark.parametrize("declared_length", [None, 1, routes.MAX_BODY_BYTES + 100])
@pytest.mark.parametrize("endpoint", ["preview", "evaluate"])
def test_actual_stream_enforces_8_mib_independent_of_content_length(research_app, monkeypatch, endpoint, declared_length):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Oversize bodies must not reach the process pool")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    quarter = routes.MAX_BODY_BYTES // 4
    chunks = [b" " * quarter] * 4 + [b"x", b"unused-after-rejection"]
    status, body, consumed = asgi_post(research_app, PREFIX + "/" + endpoint, chunks,
                                     content_length=declared_length)
    assert status == 413
    assert consumed == [quarter] * 4 + [1]
    assert "8 MiB" in body["detail"]


def test_preview_offloads_actual_validation_and_returns_receipts_without_raw_outcomes(client, payload, inline_jobs):
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert inline_jobs[0] == (routes._preview, payload)
    assert body["counts"] == {"games": 2, "profiles": 4, "events": 8,
                               "pool_players": 10, "unique_actors": 15}
    assert body["evidence_scope"] == "synthetic"
    assert body["sources"][0]["source_id"] == "synthetic-events"
    assert body["capabilities"]["coherent_event_scoring"] is True
    assert not body["capabilities"]["calibrated_joint_tail"]
    assert not body["capabilities"]["expected_payout"]
    assert all(key not in body for key in ("games", "events", "player_scores", "pool", "players", "lineups"))


def test_actual_evaluation_uses_one_selected_bank_common_independent_draws_and_echoes_inputs(client, payload, inline_jobs):
    request = evaluation_payload(client, payload)
    response = client.post(PREFIX + "/evaluate", json=request)
    assert response.status_code == 200, response.text
    body = response.json()
    assert inline_jobs[-1] == (routes._evaluate, request)
    assert body["input_snapshot_id"] == request["input_snapshot_id"]
    assert body["bank_id"] == request["bank_id"]
    assert body["draw_count"] == 256
    assert body["audit"]["lineups_evaluated"] == 2
    assert body["audit"]["pool_players_covered"] == 10
    assert body["audit"]["conservation_passed"] is True
    assert body["stream_manifest"]["selected_purpose"] == "evaluation"
    assert body["stream_manifest"]["common_draws_across_lineups"] is True
    assert len(set(body["stream_manifest"]["streams"].values())) == 3
    assert not body["capabilities"]["forward_forecast"]
    assert all(row["salary"] == 45000 for row in body["lineups"])
    assert next(row for row in body["players"] if row["player_id"] == "buf-qb")["negative_fraction"] > 0
    repeated = client.post(PREFIX + "/evaluate", json=request).json()
    assert repeated["stream_manifest"] == body["stream_manifest"]
    assert repeated["lineups"] == body["lineups"]


@pytest.mark.parametrize("mutation", ["padded-player", "controlled-player", "padded-game", "controlled-game", "duplicate-player",
    "fractional-salary", "boolean-salary", "string-salary", "zero-salary", "high-salary", "extra-player", "bad-position",
    "lower-team", "padded-slate", "controlled-slate", "bool-season", "extra-context", "wrong-site", "wrong-format", "extra-envelope",
    "short-pool", "oversize-pool", "null-bank"])
def test_preview_rejects_invalid_envelope_before_cpu_work(client, payload, monkeypatch, mutation):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Invalid envelopes must be rejected before offload")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    row = payload["pool"][0]
    if mutation == "padded-player": row["player_id"] = " padded "
    elif mutation == "controlled-player": row["player_id"] = "buf\nqb"
    elif mutation == "padded-game": row["game_id"] = " buf-mia"
    elif mutation == "controlled-game": row["game_id"] = "buf\x00mia"
    elif mutation == "duplicate-player": payload["pool"][1]["player_id"] = row["player_id"]
    elif mutation == "fractional-salary": row["salary"] = 5000.5
    elif mutation == "boolean-salary": row["salary"] = True
    elif mutation == "string-salary": row["salary"] = "5000"
    elif mutation == "zero-salary": row["salary"] = 0
    elif mutation == "high-salary": row["salary"] = 50001
    elif mutation == "extra-player": row["guess_roles"] = True
    elif mutation == "bad-position": row["position"] = "K"
    elif mutation == "lower-team": row["team"] = "buf"
    elif mutation == "padded-slate": payload["context"]["slate_id"] = " padded "
    elif mutation == "controlled-slate": payload["context"]["slate_id"] = "bad\x00slate"
    elif mutation == "bool-season": payload["context"]["season"] = True
    elif mutation == "extra-context": payload["context"]["guessed_week"] = True
    elif mutation == "wrong-site": payload["context"]["site"] = "fanduel"
    elif mutation == "wrong-format": payload["context"]["format"] = "showdown"
    elif mutation == "extra-envelope": payload["submit_entries"] = True
    elif mutation == "short-pool": payload["pool"] = payload["pool"][:8]
    elif mutation == "oversize-pool": payload["pool"] = payload["pool"] * 76
    elif mutation == "null-bank": payload["bank"] = None
    assert client.post(PREFIX + "/preview", json=payload).status_code == 422


@pytest.mark.parametrize("raw", [b'{"bank":{},"bank":{}}', b'{"bank":{"same":1,"same":2}}',
    b'{"bank":{"value":NaN}}', b'{"bank":{"value":Infinity}}', b'{"bank":{"value":-Infinity}}',
    b'{"bank":{"value":1e999}}', b'\xff', b'{"bank":', b'[]', b'{"bank":' + b'[' * 26 + b'0' + b']' * 26 + b'}',
    b'{"bank":[' + b'0,' * 250001 + b'0]}'],
    ids=["duplicate-envelope", "duplicate-nested", "nan", "positive-infinity", "negative-infinity", "exponent-overflow",
         "invalid-utf8", "truncated-json", "wrong-root", "too-deep", "too-many-values"])
def test_malformed_duplicate_deep_nonfinite_or_value_bomb_json_is_rejected_without_echo(client, monkeypatch, raw):
    async def unexpected(*args, **kwargs):
        raise AssertionError("Malformed source packages must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    response = client.post(PREFIX + "/preview", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid research package or controls. Review exact identities, salaries, bounds and JSON structure."}


@pytest.mark.parametrize("mutation", ["snapshot-padding", "snapshot-control", "bank-padding", "bank-control", "seed-bool", "seed-string",
    "seed-negative", "seed-too-high", "draw-bool", "draw-string", "draw-small", "draw-large", "empty-lineups", "too-many-lineups",
    "duplicate-lineup-id", "lineup-id-control", "lineup-player-control", "duplicate-player", "extra-lineup", "extra-purpose"])
def test_evaluation_controls_and_ids_are_strict_before_offload(client, payload, inline_jobs, monkeypatch, mutation):
    request = evaluation_payload(client, payload)
    async def unexpected(*args, **kwargs):
        raise AssertionError("Invalid evaluation controls must not reach CPU work")
    monkeypatch.setattr(routes, "submit_cpu_job", unexpected)
    if mutation == "snapshot-padding": request["input_snapshot_id"] = " padded "
    elif mutation == "snapshot-control": request["input_snapshot_id"] = "decision\nwrong"
    elif mutation == "bank-padding": request["bank_id"] = " padded "
    elif mutation == "bank-control": request["bank_id"] = "bank\x00wrong"
    elif mutation == "seed-bool": request["seed"] = True
    elif mutation == "seed-string": request["seed"] = "1"
    elif mutation == "seed-negative": request["seed"] = -1
    elif mutation == "seed-too-high": request["seed"] = 2**31
    elif mutation == "draw-bool": request["draw_count"] = True
    elif mutation == "draw-string": request["draw_count"] = "256"
    elif mutation == "draw-small": request["draw_count"] = 31
    elif mutation == "draw-large": request["draw_count"] = 1025
    elif mutation == "empty-lineups": request["lineups"] = []
    elif mutation == "too-many-lineups": request["lineups"] *= 76
    elif mutation == "duplicate-lineup-id": request["lineups"][1]["lineup_id"] = request["lineups"][0]["lineup_id"]
    elif mutation == "lineup-id-control": request["lineups"][0]["lineup_id"] = "lineup\x00wrong"
    elif mutation == "lineup-player-control": request["lineups"][0]["player_ids"][0] = "buf\nqb"
    elif mutation == "duplicate-player": request["lineups"][0]["player_ids"][0] = request["lineups"][0]["player_ids"][1]
    elif mutation == "extra-lineup": request["lineups"][0]["auto_replace"] = True
    elif mutation == "extra-purpose": request["purpose"] = "generation"
    assert client.post(PREFIX + "/evaluate", json=request).status_code == 422


@pytest.mark.parametrize("mutation", ["bank-id", "changed-events", "changed-pool", "unknown-player", "bad-flex", "one-game", "over-cap", "scoring-duplicate", "rights", "scoring-version", "cross-slate"])
def test_actual_engine_rejects_stale_versions_invalid_rosters_or_unsupported_sources(client, payload, inline_jobs, mutation):
    request = evaluation_payload(client, payload)
    if mutation == "bank-id": request["bank_id"] = "unselected-bank"
    elif mutation == "changed-events": request["bank"]["games"][0]["profiles"][0]["events"][0]["yards"] = 40
    elif mutation == "changed-pool": request["pool"][0]["salary"] = 4000
    elif mutation == "unknown-player": request["lineups"][0]["player_ids"][0] = "missing-player"
    elif mutation == "bad-flex": request["lineups"][0]["player_ids"][0] = "mia-wr2"
    elif mutation == "one-game": request["lineups"][0]["player_ids"] = ["mia-wr2" if pid == "kc-te" else pid for pid in request["lineups"][0]["player_ids"]]
    elif mutation == "over-cap":
        request["pool"][0]["salary"] = 15000
        request["bank_id"] = client.post(PREFIX + "/preview", json={key: request[key] for key in ("context", "pool", "bank")}).json()["content_id"]
    elif mutation == "scoring-duplicate": request["lineups"][1]["player_ids"] = list(reversed(request["lineups"][0]["player_ids"]))
    elif mutation == "rights": request["bank"]["sources"][0]["rights"]["display"] = None
    elif mutation == "scoring-version": request["bank"]["scoring_version"] = "guessed-scoring"
    elif mutation == "cross-slate": request["bank"]["context"]["slate_id"] = "other-slate"
    response = client.post(PREFIX + "/evaluate", json=request)
    assert response.status_code == 400, response.text
    assert "lineups" not in response.json()


@pytest.mark.parametrize("mutation", ["scope-list", "scope-object", "position-list", "position-object", "status-list",
    "status-object", "availability-list", "availability-object", "source-scope-list", "source-rights-string",
    "bank-extra-control", "game-extra-control", "profile-extra-control", "actor-extra-control", "event-extra-control"])
def test_malformed_nested_bank_controls_return_actionable_rejection_not_server_error(client, payload, inline_jobs, mutation):
    profile = payload["bank"]["games"][0]["profiles"][0]
    if mutation == "scope-list": payload["bank"]["evidence_scope"] = []
    elif mutation == "scope-object": payload["bank"]["evidence_scope"] = {}
    elif mutation == "position-list": profile["players"][0]["position"] = []
    elif mutation == "position-object": profile["players"][0]["position"] = {}
    elif mutation == "status-list": profile["players"][0]["status"] = []
    elif mutation == "status-object": profile["players"][0]["status"] = {}
    elif mutation == "availability-list": profile["players"][0]["availability_scenario"] = []
    elif mutation == "availability-object": profile["players"][0]["availability_scenario"] = {}
    elif mutation == "source-scope-list": payload["bank"]["sources"][0]["evidence_scope"] = []
    elif mutation == "source-rights-string": payload["bank"]["sources"][0]["rights"]["display"] = "yes"
    elif mutation == "bank-extra-control": payload["bank"]["assume_normal_tails"] = True
    elif mutation == "game-extra-control": payload["bank"]["games"][0]["force_passing_tds"] = 8
    elif mutation == "profile-extra-control": profile["repair_negative_scores"] = True
    elif mutation == "actor-extra-control": profile["players"][0]["fill_missing_role"] = True
    elif mutation == "event-extra-control": profile["events"][0]["lateral_yards"] = 7
    response = client.post(PREFIX + "/preview", json=payload)
    assert response.status_code == 400, response.text
    assert "content_id" not in response.json()


def test_preview_chunked_at_exact_limit_reaches_validation_instead_of_false_oversize(research_app, payload, inline_jobs):
    raw = json.dumps(payload).encode()
    raw += b" " * (routes.MAX_BODY_BYTES - len(raw))
    status, body, consumed = asgi_post(research_app, PREFIX + "/preview", [raw[:4000], raw[4000:]])
    assert status == 200
    assert sum(consumed) == routes.MAX_BODY_BYTES
    assert body["counts"]["pool_players"] == 10


def test_routes_are_registered_on_main_api_without_starting_servers():
    from app.api import app
    paths = set(app.openapi()["paths"])
    assert {PREFIX + "/preview", PREFIX + "/evaluate"} <= paths
