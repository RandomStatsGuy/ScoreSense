"""Anonymous projection reads are public; products and mutations remain gated.

Every data service is a fixture. No real artifacts, accounts, provider requests,
email, league state or model inference are used by these boundary checks.
"""

from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import api


@pytest.fixture
def protected_client(monkeypatch, hub_db, auth_db):
    monkeypatch.setattr("src.config.AUTH_REQUIRED", True)
    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", True)
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@fixture.test"}))
    monkeypatch.setattr(api, "_resolve_fantasy_narrative_context", lambda season, week: (season or 2026, week or 6))
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    return TestClient(api.app)


@pytest.mark.parametrize(("path", "target", "wrapped"), [
    ("/api/meta/projections/wr", "app.api.get_projection_meta", False),
    ("/api/meta/draft/wr", "app.api.get_draft_meta", False),
    ("/api/predict/wr?season=2026&week=6", "app.api._predict_response", False),
    ("/api/predict/wr/changes?season=2026&week=6", "src.projections.projection_movement.build_projection_movement_payload", False),
    ("/api/predict/compare?ids=fixture-a,fixture-b&season=2026&week=6", "app.api.build_player_compare", False),
    ("/api/draft/wr?season=2026", "app.api._draft_response", False),
    ("/api/ros/wr?season=2026&week=6", "app.api._ros_response", False),
    ("/api/players/media?ids=fixture-a", "src.draft_hub.draft_enrichment.build_player_media_batch", "media"),
    ("/api/player/fixture-a/card?season=2026&week=6", "src.projections.player_card.build_player_card", False),
    ("/api/player/fixture-a/explanation?season=2026&week=6", "app.api.build_projection_explanation", False),
    ("/api/player/fixture-a/context?season=2026&week=6", "app.api.get_player_context", False),
    ("/api/player/fixture-a/latest?season=2026&week=6", "src.draft_hub.player_latest.build_player_latest", False),
    ("/api/players/context?season=2026&week=6", "app.api.list_player_context", False),
    ("/api/fantasy-narrative/wr/weekly?season=2026&week=6", "app.api.build_fantasy_weekly_response", False),
    ("/api/fantasy-narrative/wr/season?season=2026&week=6", "app.api.build_fantasy_season_response", False),
    ("/api/accuracy?position=wr", "app.api.load_accuracy_report", "position"),
    ("/api/accuracy/season-long?position=wr", "app.api.load_season_long_report", "position"),
    ("/api/upside?position=wr", "app.api.load_upside_report", "position"),
])
def test_anonymous_projection_reads_with_site_auth_on(protected_client, monkeypatch, path, target, wrapped):
    from src.core.projection_read_scope import anonymous_projection_read

    payload = {"fixture": path}
    def read(*args, **kwargs):
        assert anonymous_projection_read() is True
        return {"wr": payload} if wrapped == "position" else payload
    service = Mock(side_effect=read)
    monkeypatch.setattr(target, service)
    response = protected_client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()[wrapped] if wrapped == "media" else response.json()
    assert body["fixture"] == path
    service.assert_called_once()


def test_public_draft_receiver_response_keeps_tight_ends_without_inference(protected_client, monkeypatch):
    from src.core.projection_read_scope import anonymous_projection_read
    from src.draft_hub import draft_pool_cache

    pool = pd.DataFrame({
        "player_id": ["qb-fixture", "wr-fixture", "te-fixture"],
        "Player": ["Fixture QB", "Fixture WR", "Fixture TE"],
        "Position": ["QB", "WR", "TE"],
        "Team": ["KC", "BUF", "SF"],
        "Season": [2026, 2026, 2026],
        "Season Proj": [350.0, 250.0, 190.0],
    })
    meta = {"feature_season": 2025, "games_per_season": 17, "season_quantile_method": "mc_schedule_v1", "season_coverage_meta": {"n_sims": 1000}}
    def cached_pool(season, *, allow_compute, allow_stale):
        assert allow_compute is False
        assert allow_stale is True
        assert season == 2026
        assert anonymous_projection_read() is True
        return pool
    load_pool = Mock(side_effect=cached_pool)
    inference = Mock(side_effect=AssertionError("Cached public season reads must not run inference"))
    provider = Mock(side_effect=AssertionError("Cached public season reads must not load providers"))
    monkeypatch.setattr(draft_pool_cache, "load_draft_pool", load_pool)
    monkeypatch.setattr(draft_pool_cache, "load_pool_meta", lambda season: meta)
    monkeypatch.setattr(draft_pool_cache, "_compute_pool", inference)
    monkeypatch.setattr(api, "predict_draft_season", inference)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", provider)
    response = protected_client.get("/api/draft/wr?season=2026")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert [(row["player_id"], row["Position"]) for row in body["projections"]] == [("wr-fixture", "WR"), ("te-fixture", "TE")]
    assert body["meta"]["feature_season"] == 2025
    assert body["meta"]["season_quantile_method"] == "mc_schedule_v1"
    assert body["meta"]["season_coverage_meta"] == {"n_sims": 1000}
    load_pool.assert_called_once_with(2026, allow_compute=False, allow_stale=True)
    inference.assert_not_called()
    provider.assert_not_called()


def test_anonymous_projection_read_keeps_requested_context_and_response(protected_client, monkeypatch):
    payload = {"meta": {"season": 2025, "week": 9}, "projections": [{"player_id": "fixture-a", "Projected Points": 17.4}]}
    service = Mock(return_value=payload)
    monkeypatch.setattr(api, "_predict_response", service)
    response = protected_client.get("/api/predict/wr?season=2025&week=9&apply_injury_adjustments=false&ids=fixture-a")
    assert response.status_code == 200
    assert response.json() == payload
    assert service.call_count == 1
    assert service.call_args.args == ("wr", 2025, 9, False)
    assert service.call_args.kwargs["player_ids"] == ["fixture-a"]
    assert service.call_args.kwargs["background_tasks"] is not None


def test_anonymous_injuries_are_cached_without_provider_polling(protected_client, monkeypatch):
    monkeypatch.setattr(api, "injured_players_from_disk", lambda: pd.DataFrame([{"full_name": "Fixture WR", "team": "KC", "position": "WR", "injury_status": "Questionable"}]))
    monkeypatch.setattr("src.integrations.injury_timeline.attach_return_estimates", lambda rows: rows)
    for name in ("maybe_tick_injury_poll", "get_injury_poll_status", "run_injury_poll", "submit_cpu_job"):
        monkeypatch.setattr(api, name, Mock(side_effect=AssertionError("Anonymous reads must not start provider work")))
    response = protected_client.get("/api/injuries?team=KC&position=wr")
    assert response.status_code == 200
    assert response.json()["players"][0]["full_name"] == "Fixture WR"
    assert response.json()["meta"]["served_from_cache"] is True
    assert response.json()["meta"]["network_on_request"] is False
    assert response.json()["meta"]["poll"]["phase"] is None


def test_authenticated_injury_read_retains_existing_poll_behavior(protected_client, monkeypatch):
    monkeypatch.setattr(api, "injured_players_from_disk", lambda: pd.DataFrame())
    monkeypatch.setattr("src.integrations.injury_timeline.attach_return_estimates", lambda rows: rows)
    monkeypatch.setattr("app.auth.decode_access_token", lambda token: {"sub": "fixture-account", "auth_type": "patreon"})
    tick = Mock(return_value={"tick": "due", "should_enqueue": True})
    poll = Mock(return_value={"status": "fixture refreshed"})
    monkeypatch.setattr(api, "maybe_tick_injury_poll", tick)
    monkeypatch.setattr(api, "queue_injury_refresh", poll)
    monkeypatch.setattr(api, "get_injury_poll_status", lambda: {"phase": "inseason"})
    response = protected_client.get("/api/injuries", headers={"Authorization": "Bearer fixture-token"})
    assert response.status_code == 200
    tick.assert_called_once_with(enqueue=True)
    assert poll.call_count == 1
    assert poll.call_args.kwargs == {"trigger": "stale_while_revalidate"}


def test_invalid_session_cannot_trigger_injury_polling(protected_client, monkeypatch):
    monkeypatch.setattr(api, "injured_players_from_disk", lambda: pd.DataFrame())
    monkeypatch.setattr("src.integrations.injury_timeline.attach_return_estimates", lambda rows: rows)
    monkeypatch.setattr("app.auth.decode_access_token", Mock(side_effect=HTTPException(status_code=401, detail="Invalid session")))
    tick = Mock(side_effect=AssertionError("Invalid sessions must not start provider work"))
    monkeypatch.setattr(api, "maybe_tick_injury_poll", tick)
    response = protected_client.get("/api/injuries", headers={"Authorization": "Bearer fixture-invalid"})
    assert response.status_code == 200
    tick.assert_not_called()


@pytest.mark.parametrize(("method", "path", "body"), [
    ("GET", "/api/hub/context", None),
    ("GET", "/api/lineup/formats", None),
    ("GET", "/api/lineup/pool", None),
    ("GET", "/api/lineup/vegas?season=2026&week=6", None),
    ("GET", "/api/lineup/slates?season=2026&week=6", None),
    ("POST", "/api/lineup/optimize", {}),
    ("POST", "/api/predict", {"position": "wr"}),
    ("POST", "/api/players/context/refresh?season=2026&week=6", None),
    ("POST", "/api/injuries/refresh", None),
    ("GET", "/api/injuries/poll", None),
    ("POST", "/api/injury-overlays/recompute?season=2026&week=6", None),
    ("POST", "/api/refresh?retrain=false", None),
    ("POST", "/api/accuracy/rebuild", None),
    ("POST", "/api/upside/rebuild", None),
    ("POST", "/api/accuracy/rebuild/ack", None),
    ("PATCH", "/api/auth/profile", {"display_name": "Fixture"}),
    ("GET", "/api/admin/overview", None),
    ("POST", "/api/hub/league/fixture/contract-history/reconcile-sleeper", None),
])
def test_products_provider_actions_and_writes_still_require_auth(protected_client, monkeypatch, method, path, body):
    for name in ("build_lineup_pool", "list_site_configs", "build_vegas_board", "_predict_response", "enqueue_manual_injury_refresh", "recompute_injury_overlays", "start_full_accuracy_rebuild", "acknowledge_accuracy_rebuild", "submit_cpu_job"):
        monkeypatch.setattr(api, name, Mock(side_effect=AssertionError("Protected service must not run anonymously")))
    monkeypatch.setattr("app.player_context_refresh.start_context_refresh", Mock(side_effect=AssertionError("No anonymous refresh")))
    response = protected_client.request(method, path, json=body)
    assert response.status_code == 401, (path, response.text)


def test_public_projection_validation_is_retained(protected_client):
    response = protected_client.get("/api/meta/projections/not-a-position")
    assert response.status_code == 400
    assert response.json()["detail"] == "position must be qb, rb, or wr"


def test_public_read_scope_is_request_local_and_preserves_authenticated_reads(protected_client, monkeypatch):
    from src.core.projection_read_scope import anonymous_projection_read

    monkeypatch.setattr(api, "get_projection_meta", lambda pos: {"anonymous": anonymous_projection_read()})
    assert protected_client.get("/api/meta/projections/wr").json() == {"anonymous": True}
    monkeypatch.setattr("app.auth.decode_access_token", lambda token: {"sub": "fixture-account", "auth_type": "patreon"})
    assert protected_client.get("/api/meta/projections/wr", headers={"Authorization": "Bearer fixture-token"}).json() == {"anonymous": False}
    assert protected_client.get("/api/meta/projections/wr").json() == {"anonymous": True}
    assert anonymous_projection_read() is False


def test_revoked_native_session_cannot_enable_provider_work(protected_client, monkeypatch):
    from src.core.projection_read_scope import anonymous_projection_read

    monkeypatch.setattr("app.auth.decode_access_token", lambda token: {"sub": "ss:fixture", "auth_type": "native"})
    monkeypatch.setattr(api, "native_session_current", lambda user: False)
    monkeypatch.setattr(api, "get_projection_meta", lambda pos: {"anonymous": anonymous_projection_read()})
    assert protected_client.get("/api/meta/projections/wr", headers={"Authorization": "Bearer fixture-revoked"}).json() == {"anonymous": True}


def test_legacy_guest_projection_reads_cannot_enable_provider_work(protected_client, monkeypatch):
    from src.core.projection_read_scope import anonymous_projection_read

    monkeypatch.setattr("app.auth.decode_access_token", lambda token: {"sub": "guest:fixture", "auth_type": "guest"})
    monkeypatch.setattr(api, "get_projection_meta", lambda pos: {"anonymous": anonymous_projection_read()})
    assert protected_client.get("/api/meta/projections/wr", headers={"Authorization": "Bearer fixture-guest"}).json() == {"anonymous": True}


@pytest.mark.parametrize("auth_required", [True, False])
@pytest.mark.parametrize("credential", ["bearer", "cookie"])
def test_legacy_guest_is_not_a_tools_account(protected_client, monkeypatch, auth_required, credential):
    from app.auth import create_guest_access_token

    monkeypatch.setattr("src.config.AUTH_REQUIRED", auth_required)
    token, _ = create_guest_access_token(league_id="fixture-room", team_id="fixture-team", name="Legacy visitor", guest_id="tools-boundary")
    headers = {"Authorization": f"Bearer {token}"} if credential == "bearer" else {}
    if credential == "cookie":
        protected_client.cookies.set("scoresense_token", token)
    service = Mock(side_effect=AssertionError("Legacy guest credentials must not enter Tools"))
    monkeypatch.setattr(api, "list_site_configs", service)
    denied = protected_client.get("/api/lineup/formats", headers=headers)
    assert denied.status_code == 401
    assert "Sign in or create an account" in denied.json()["detail"]
    me = protected_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["authenticated"] is False
    assert me.json().get("user") is None
    service.assert_not_called()


def test_process_pool_initializer_clears_inherited_request_scope(monkeypatch):
    from app import process_pool
    from src.core.projection_read_scope import anonymous_projection_read, initialize_projection_worker, projection_read_scope, run_anonymous_projection_work

    factory = Mock()
    monkeypatch.setattr(process_pool, "ProcessPoolExecutor", factory)
    monkeypatch.setattr(process_pool, "_executor", None)
    with projection_read_scope(anonymous=True):
        process_pool.init_process_executor(max_workers=2)
        factory.assert_called_once_with(max_workers=2, mp_context=process_pool._WORKER_CONTEXT, initializer=initialize_projection_worker)
        # Simulate a Unix fork inheriting the first public request's context.
        factory.call_args.kwargs["initializer"]()
        assert anonymous_projection_read() is False
        assert run_anonymous_projection_work(anonymous_projection_read) is True
        # Regular authenticated/background jobs in that same worker stay clean.
        assert anonymous_projection_read() is False
    assert anonymous_projection_read() is False


def test_anonymous_refresh_status_contains_only_projection_ui_fields(protected_client, monkeypatch):
    status = {"status": "error", "completed_at": "2026-10-20T12:00:00Z", "last_completed_at": "2026-10-19T12:00:00Z", "error": "private provider details", "stage": "private pipeline stage", "traceback": "private path"}
    monkeypatch.setattr(api, "public_refresh_status", lambda: status)
    automatic = Mock(return_value={"fixture": "automatic status"})
    monkeypatch.setattr("src.projections.automatic_status.automatic_refresh_status", automatic)
    assert protected_client.get("/api/refresh/status").json() == {key: status[key] for key in ("status", "completed_at", "last_completed_at")}
    automatic.assert_not_called()
    monkeypatch.setattr("app.auth.decode_access_token", lambda token: {"sub": "fixture-account", "auth_type": "patreon"})
    assert protected_client.get("/api/refresh/status", headers={"Authorization": "Bearer fixture-token"}).json() == {**status, "automatic": {"fixture": "automatic status"}}


def test_public_media_uses_cold_or_stale_cache_without_sleeper_refresh(protected_client, monkeypatch, tmp_path):
    import json
    from src.draft_hub import draft_enrichment
    from src.integrations import sleeper

    cache = tmp_path / "sleeper_players.json"
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", cache)
    monkeypatch.setattr(sleeper, "_PLAYERS_DF_CACHE", None)
    monkeypatch.setattr(draft_enrichment, "_SLEEPER_LOOKUP", None)
    fetch = Mock(side_effect=AssertionError("Public media must not refresh provider data"))
    monkeypatch.setattr(sleeper, "_fetch_json", fetch)
    response = protected_client.get("/api/players/media?ids=sleeper-1")
    assert response.status_code == 200
    assert response.json()["media"]["sleeper-1"]["headshot_url"] is None
    cache.write_text(json.dumps({"1": {"full_name": "Fixture Player", "team": "KC", "position": "WR"}}), encoding="utf-8")
    monkeypatch.setattr(draft_enrichment, "_SLEEPER_LOOKUP", None)
    response = protected_client.get("/api/players/media?ids=sleeper-1")
    assert response.status_code == 200
    assert response.json()["media"]["sleeper-1"]["headshot_url"].endswith("/1.jpg")
    fetch.assert_not_called()


def test_public_meta_uses_cached_calendar_without_background_provider_work(protected_client, monkeypatch, tmp_path):
    import json
    from src.integrations import sleeper

    path = tmp_path / "calendar.json"
    monkeypatch.setattr(sleeper, "STATE_CACHE", path)
    refresh = Mock(side_effect=AssertionError("Public metadata must not start a provider refresh"))
    monkeypatch.setattr(sleeper, "_kick_nfl_state_refresh", refresh)
    monkeypatch.setattr(sleeper, "_fetch_json", refresh)
    monkeypatch.setattr(api, "get_projection_meta", lambda pos: {"calendar": sleeper.get_nfl_state()})
    assert protected_client.get("/api/meta/projections/wr").json() == {"calendar": {}}
    path.write_text(json.dumps({"season": 2026, "week": 6}), encoding="utf-8")
    assert protected_client.get("/api/meta/projections/wr").json() == {"calendar": {"season": 2026, "week": 6}}
    refresh.assert_not_called()


def test_public_sleeper_player_reads_reuse_mtime_cache_without_fetch(monkeypatch, tmp_path):
    import json
    import os
    from pathlib import Path
    from src.core.projection_read_scope import projection_read_scope
    from src.integrations import sleeper

    cache = tmp_path / "players.json"
    cache.write_text(json.dumps({"1": {"full_name": "Fixture One"}}), encoding="utf-8")
    os.utime(cache, (1_000_000, 1_000_000))
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", cache)
    monkeypatch.setattr(sleeper, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(sleeper, "_PLAYERS_RAW_CACHE", None)
    monkeypatch.setattr(sleeper, "_PLAYERS_RAW_MTIME", -1.0)
    reads = []
    original = Path.read_text
    def read_text(path, *args, **kwargs):
        if path == cache:
            reads.append(path)
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", read_text)
    fetch = Mock(return_value={"3": {"full_name": "Authenticated refresh"}})
    monkeypatch.setattr(sleeper, "_fetch_json", fetch)
    with projection_read_scope(anonymous=True):
        first = sleeper.load_sleeper_players()
        assert sleeper.load_sleeper_players(force_refresh=True) is first
        assert len(reads) == 1
        cache.write_text(json.dumps({"2": {"full_name": "Fixture Two"}}), encoding="utf-8")
        os.utime(cache, (1_000_001, 1_000_001))
        assert "2" in sleeper.load_sleeper_players()
        assert len(reads) == 2
    fetch.assert_not_called()
    assert "3" in sleeper.load_sleeper_players(force_refresh=True)
    fetch.assert_called_once_with(sleeper.SLEEPER_PLAYERS_URL)


@pytest.mark.parametrize("kind", ["fantasy", "beat"])
def test_anonymous_notes_use_extractive_fallback_without_paid_generation(monkeypatch, kind):
    from src.core.projection_read_scope import projection_read_scope
    from src.sentiment import beat_digest, fantasy_digest

    module = fantasy_digest if kind == "fantasy" else beat_digest
    monkeypatch.setattr(module, "BEAT_DIGEST_LLM_ENABLED", True)
    monkeypatch.setattr(module, "OPENAI_API_KEY", "fixture-only-key")
    monkeypatch.setattr(module, "_cache_get", lambda *a, **k: None)
    cached = Mock()
    monkeypatch.setattr(module, "_cache_set", cached)
    reply = Mock()
    reply.json.return_value = {"choices": [{"message": {"content": "Fixture generated note."}}]}
    post = Mock(return_value=reply)
    monkeypatch.setattr(module.requests, "post", post)
    build = module.fantasy_digest_for_player if kind == "fantasy" else module.beat_digest_for_player
    sentiment = {"top_sentence": "Player had a strong week with increased target share.", "sentiment_label": "hype", "role_hype_flag": 1}
    with projection_read_scope(anonymous=True):
        result = build("Fixture Player", sentiment, prefer_llm=True, return_meta=True)
    assert result[f"{'fantasy_media' if kind == 'fantasy' else 'beat'}_digest_source"] == "extractive"
    post.assert_not_called()
    cached.assert_not_called()
    with projection_read_scope(anonymous=False):
        result = build("Fixture Player", sentiment, prefer_llm=True, return_meta=True)
    assert result[f"{'fantasy_media' if kind == 'fantasy' else 'beat'}_digest_source"] == "llm"
    post.assert_called_once()


def test_anonymous_cold_weekly_read_queues_safe_recovery_without_waiting(protected_client, monkeypatch):
    from app import projection_recovery as recovery
    monkeypatch.setattr(api, "load_weekly_prediction", Mock(return_value=pd.DataFrame()))
    monkeypatch.setattr(api, "get_process_executor", Mock(side_effect=AssertionError("HTTP must not wait for inference")))
    submitted = []
    async def submit(worker, *args):
        submitted.append((worker, args))
        return {"status": "ok", "failed": []}
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    response = protected_client.get("/api/predict/wr?season=2026&week=6")
    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert response.json()["projection_recovery"]["status"] == "queued"
    assert submitted == [(recovery._rebuild_public_projection_context, (2026, 6, ("weekly",)))]


def test_public_inference_worker_carries_scope_without_disabling_computation(monkeypatch):
    import pickle
    from app import projection_recovery as recovery
    from src.core.projection_read_scope import anonymous_projection_read
    callback = recovery._rebuild_public_projection_context
    assert pickle.loads(pickle.dumps(callback)) is callback
    calls = []
    def load(position, season, week, **kwargs):
        assert anonymous_projection_read() is True
        assert kwargs == {"apply_injury_adjustments": kwargs["apply_injury_adjustments"], "allow_compute": True, "allow_stale": False}
        calls.append((position, season, week, kwargs["apply_injury_adjustments"]))
        return pd.DataFrame([{"Projected Points": 17.4}])
    monkeypatch.setattr("src.projections.weekly_cache.load_weekly_prediction", load)
    private = Mock(side_effect=AssertionError("Public recovery must not refresh providers/DFS/Fantasy"))
    monkeypatch.setattr(recovery, "rebuild_projection_context", private)
    monkeypatch.setattr("src.jobs.dfs_inputs.prepare_sources", private)
    monkeypatch.setattr("src.jobs.dfs_refresh._warm_supporting_data", private)
    monkeypatch.setattr("src.draft_hub.value_snapshot_warmup.warm_fantasy_value_snapshots", private)
    assert callback(2026, 6, ("weekly",)) == {"status": "ok", "failed": []}
    assert calls == [(pos, 2026, 6, injury) for pos in ("qb", "rb", "wr") for injury in (True, False)]
    private.assert_not_called()
    assert anonymous_projection_read() is False


def test_public_roster_identity_uses_stale_or_missing_cache_without_provider(monkeypatch, tmp_path):
    from src.core.projection_read_scope import projection_read_scope
    from src.integrations import nflverse_roster

    monkeypatch.setattr(nflverse_roster, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(nflverse_roster, "_ROSTER_CACHE", {})
    provider = Mock(side_effect=AssertionError("Public roster identity must not fetch nflverse"))
    monkeypatch.setattr("src.etl.nflverse_etl._import_nfl_data_py", provider)
    with projection_read_scope(anonymous=True):
        assert nflverse_roster.load_seasonal_roster(2026).empty
        frame = pd.DataFrame([{"player_id": "fixture-a", "player_name": "Fixture Player", "team": "KC", "position": "WR"}])
        frame.to_parquet(tmp_path / "nflverse_roster_2026.parquet")
        assert nflverse_roster.load_seasonal_roster(2026, force_refresh=True).iloc[0]["team"] == "KC"
    assert nflverse_roster._ROSTER_CACHE == {}
    provider.assert_not_called()


def test_public_missing_schedule_does_not_poison_authenticated_schedule_cache(monkeypatch, tmp_path):
    from src.core import schedule_utils
    from src.core.projection_read_scope import projection_read_scope

    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", tmp_path / "schedule.parquet")
    schedule_utils.teams_playing_week.cache_clear()
    schedule_utils.team_bye_weeks.cache_clear()
    schedule_utils._league_week_windows.cache_clear()
    frame = pd.DataFrame([{"season": 2026, "week": 6, "home_team": "KC", "away_team": "BUF", "gameday": "2026-10-18", "gametime": "13:00"}])
    provider = Mock(return_value=frame)
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", provider)
    try:
        with projection_read_scope(anonymous=True):
            assert schedule_utils.teams_playing_week(2026, 6) == frozenset()
            assert schedule_utils.week_matchups(2026, 6) == {}
            assert schedule_utils.team_bye_weeks(2026) == {}
            assert schedule_utils._league_week_windows(2026) == tuple()
        provider.assert_not_called()
        assert schedule_utils.teams_playing_week.cache_info().currsize == 0
        assert schedule_utils.team_bye_weeks.cache_info().currsize == 0
        assert schedule_utils._league_week_windows.cache_info().currsize == 0
        assert schedule_utils.teams_playing_week(2026, 6) == frozenset({"KC", "BUF"})
        provider.assert_called_once_with([2026])
    finally:
        schedule_utils.teams_playing_week.cache_clear()
        schedule_utils.team_bye_weeks.cache_clear()
        schedule_utils._league_week_windows.cache_clear()


@pytest.mark.parametrize("kind", ["ros", "draft"])
def test_public_recovery_keeps_season_inference_and_no_context_leak(monkeypatch, kind):
    from app import projection_recovery as recovery
    from src.core.projection_read_scope import anonymous_projection_read
    calls = []
    def load(*args, **kwargs):
        assert anonymous_projection_read() is True
        assert kwargs["allow_compute"] is True
        assert kwargs["allow_stale"] is False
        calls.append((args, kwargs))
        return pd.DataFrame([{"forecast": 12}])
    monkeypatch.setattr("src.projections.ros_cache.load_ros_prediction", load)
    monkeypatch.setattr("src.draft_hub.draft_pool_cache.load_draft_pool", load)
    assert recovery._rebuild_public_projection_context(2026, 7, (kind,)) == {"status": "ok", "failed": []}
    assert len(calls) == (1 if kind == "draft" else 6)
    if kind == "draft":
        assert calls[0] == ((2026,), {"allow_compute": True, "apply_identity": False, "allow_stale": False})
    assert anonymous_projection_read() is False


@pytest.mark.parametrize("failure", ["empty", "stale", "exception"])
def test_public_recovery_failure_is_bounded_and_scope_is_reset(monkeypatch, failure):
    from app import projection_recovery as recovery
    from src.core.projection_read_scope import anonymous_projection_read
    def load(*args, **kwargs):
        assert anonymous_projection_read() is True
        if failure == "exception":
            raise RuntimeError("private provider path and details")
        frame = pd.DataFrame() if failure == "empty" else pd.DataFrame([{"forecast": 1}])
        frame.attrs["projection_stale"] = failure == "stale"
        return frame
    monkeypatch.setattr("src.projections.weekly_cache.load_weekly_prediction", load)
    result = recovery._rebuild_public_projection_context(2026, 7, ("weekly",))
    assert result == {"status": "error", "failed": ["weekly:qb", "weekly:rb", "weekly:wr"]}
    assert "private" not in str(result)
    assert anonymous_projection_read() is False


def test_public_and_account_recovery_have_separate_tasks_cooldowns_and_status(monkeypatch):
    import asyncio
    from fastapi import BackgroundTasks
    from app import projection_recovery as recovery
    from src.core.projection_read_scope import projection_read_scope
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    submitted = []
    async def submit(worker, *args):
        submitted.append(worker)
        return {"status": "error", "failed": ["weekly"]} if worker is recovery._rebuild_public_projection_context else {"status": "ok", "failed": []}
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    public_tasks, account_tasks = BackgroundTasks(), BackgroundTasks()
    with projection_read_scope(anonymous=True):
        assert recovery.queue_projection_recovery(public_tasks, 2026, 7, ["weekly", "dfs", "specialists"]) == {"status": "queued"}
        assert recovery.queue_projection_recovery(BackgroundTasks(), 2026, 7, ["weekly"]) == {"status": "running"}
        assert recovery.queue_projection_recovery(BackgroundTasks(), 2026, 7, ["dfs", "unknown"]) == {"status": "idle"}
    assert recovery.queue_projection_recovery(account_tasks, 2026, 7, ["weekly"]) == {"status": "queued"}
    asyncio.run(public_tasks())
    assert recovery.projection_recovery_status(2026, 7, ["weekly"]) == {"status": "running"}
    with projection_read_scope(anonymous=True):
        assert recovery.projection_recovery_status(2026, 7, ["weekly"])["status"] == "error"
    asyncio.run(account_tasks())
    assert submitted == [recovery._rebuild_public_projection_context, recovery.rebuild_projection_context]
    assert recovery.projection_recovery_status(2026, 7, ["weekly"])["status"] == "ok"
    with projection_read_scope(anonymous=True):
        assert recovery.projection_recovery_status(2026, 7, ["weekly"])["status"] == "error"
        assert recovery.queue_projection_recovery(BackgroundTasks(), 2026, 7, ["weekly"])["status"] == "error"


@pytest.mark.parametrize("kind", ["weekly", "draft"])
def test_public_recovery_exception_handler_retains_anonymous_mode(protected_client, monkeypatch, kind):
    from app import projection_recovery as recovery
    submitted = []
    monkeypatch.setattr("src.jobs.season_refresh.target_due", lambda *args: True)
    def missing(*args, **kwargs):
        if kind == "draft":
            raise api.PoolSnapshotUnavailable("Forecast is preparing", season=2026)
        raise api._ForecastPreparing("weekly", 2026, 7)
    async def submit(worker, *args):
        submitted.append(worker)
        return {"status": "ok", "failed": []}
    monkeypatch.setattr(api, "_predict_response", missing)
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    response = protected_client.get("/api/predict/qb?season=2026&week=7")
    assert response.status_code == 503
    assert submitted == [recovery._rebuild_public_projection_context]
