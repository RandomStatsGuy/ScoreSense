"""Regressions for the minute-long reads observed in the October server report."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import BackgroundTasks, Response


@pytest.mark.parametrize("state", ["missing", "stale", "current", "absent_player"])
def test_player_card_never_infers_and_keeps_saved_values(monkeypatch, state):
    from src.projections import player_card as pc
    monkeypatch.setattr(pc, "_resolve_context", lambda *args: (2026, 5))
    def media(rows, **kwargs):
        assert kwargs == {"allow_refresh": False}
        return {"p1": {"name": "Saved Player"}}
    monkeypatch.setattr(pc, "build_player_media_batch", media)
    monkeypatch.setattr(pc, "_narrative_for_player", lambda *args, **kwargs: (None, {}))
    monkeypatch.setattr(pc, "_injury_for_player", lambda *args: None)
    def load(position, **kwargs):
        assert kwargs == {"season": 2026, "week": 5, "apply_injury_adjustments": False,
                          "allow_compute": False, "allow_stale": True}
        frame = pd.DataFrame() if state == "missing" else pd.DataFrame([
            {"player_id": "other" if state == "absent_player" else "p1", "Player": "Saved Player", "Projected Points": 12.5}])
        frame.attrs.update(built_at="2026-10-13T12:00:00Z", projection_stale=state == "stale")
        return frame
    monkeypatch.setattr(pc, "load_weekly_prediction", load)
    monkeypatch.setattr(pc, "load_ros_prediction", load)
    card = pc.build_player_card("p1", position="qb", apply_injury_adjustments=False)
    if state in {"missing", "absent_player"}:
        assert card["weekly_projection"] is None and card["season_projection"] is None
    else:
        assert card["weekly_projection"]["Projected Points"] == 12.5
    assert card["meta"]["rebuild_kinds"] == (["weekly", "ros"] if state in {"missing", "stale"} else [])
    assert card["meta"]["projection_stale"]["weekly"] is (state == "stale")


def test_player_card_metadata_uses_cached_context(monkeypatch):
    from src.projections import player_card as pc
    context = Mock(return_value=(2026, 5))
    monkeypatch.setattr(pc, "resolve_cached_context", context)
    assert pc._resolve_context(None, None) == (2026, 5)
    context.assert_called_once_with("qb", None, None)


def test_player_identity_media_and_injuries_are_read_only(tmp_path, monkeypatch):
    from src.integrations import sleeper
    from src.draft_hub import draft_enrichment as media
    from src.projections import player_card as pc
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", tmp_path / "missing.json")
    monkeypatch.setattr(sleeper, "_PLAYERS_DF_CACHE", None)
    monkeypatch.setattr(media, "_SLEEPER_LOOKUP", None)
    monkeypatch.setattr(media, "_gsis_identity_map", lambda: {})
    monkeypatch.setattr(sleeper, "_fetch_json", lambda *args, **kwargs: pytest.fail("provider I/O on card read"))
    assert pc._guess_position("4046") is None
    assert pc._injury_for_player("4046") is None
    result = media.build_player_media_batch([{"player_id": "4046"}], allow_refresh=False)
    assert result["4046"]["headshot_url"] is None


@pytest.mark.parametrize("scope", ["weekly", "season"])
def test_card_narrative_fallback_never_calls_llm(monkeypatch, scope):
    from src.sentiment import fantasy_readout as mod
    from test_fantasy_readout import _sample_features
    monkeypatch.setattr(mod, "_FANTASY_RESPONSE_CACHE", {})
    monkeypatch.setattr(mod, "load_sentiment_features", lambda path: _sample_features())
    monkeypatch.setattr(mod, "_player_names", lambda *args: {"p1": "Saved Player"})
    generation_flags = []
    def digest(name, payload, **kwargs):
        generation_flags.append(kwargs["prefer_llm"])
        return {"fantasy_media_digest": "Saved note", "fantasy_media_digest_source": "cache"}
    monkeypatch.setattr(mod, "fantasy_digest_for_player", digest)
    builder = mod.build_fantasy_weekly_response if scope == "weekly" else mod.build_fantasy_season_response
    assert builder("qb", 2026, 1, allow_generate=False)["players"]
    assert generation_flags and not any(generation_flags)
    generation_flags.clear()
    builder("qb", 2026, 1, allow_generate=True)
    assert generation_flags and any(generation_flags)  # Read fallback does not poison warmup cache.


def test_rosters_skip_live_repairs_and_inline_values_and_reload_worker_results(hub_db, monkeypatch):
    from app import hub_routes as routes, fair_value_recovery as recovery
    from src.draft_hub import storage, insights_cache as estimates
    from src.draft_hub.schemas import LeagueRules
    league = storage.create_league("reader", "Read path", 2026, LeagueRules())
    lid = league["id"]
    team = storage.get_team_by_user(lid, "reader")
    storage.add_roster_slot(league["workspace_id"], {"player_id": "p1", "player_name": "Saved Player",
        "team": "KC", "position": "QB", "salary": 10, "contract_years": 2}, team_id=team["id"])
    monkeypatch.setattr(routes, "_LEAGUE_ROSTERS_CACHE", {})
    monkeypatch.setattr(estimates, "build_and_store_fair_values", lambda *args: pytest.fail("inline valuation"))
    monkeypatch.setattr("src.draft_hub.league_sleeper_sync.reattach_league_roster_slots", lambda *args: pytest.fail("live repair"))
    queue = Mock(return_value={"status": "queued"})
    monkeypatch.setattr(recovery, "queue_fair_value_recovery", queue)
    def read(user):
        return routes.hub_league_rosters(Response(), lid, background_tasks=BackgroundTasks(),
                                        refresh=False, trade_view=False, _user={"sub": user})
    first = read("reader")
    assert first["teams"][0]["roster"][0]["fair_value"] is None
    assert first["estimate_recovery"]["status"] == "queued"
    assert first["teams"][0]["stats"]["fair_value_total"] is None
    storage.upsert_insights_fair_values(lid, 2026, {"p1": 22}, pool_fingerprint=estimates._fair_fingerprint())
    second = read("reader")
    assert second["teams"][0]["roster"][0]["fair_value"] == 22
    assert second["estimate_context"]["built_at"]
    storage.join_league("member", league["room_code"], "Member")
    third = read("member")
    assert third["hub_context"]["team_id"] != second["hub_context"]["team_id"]
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        read("outsider")
    assert exc.value.status_code == 403


def test_concurrent_valuation_recovery_is_coalesced_and_failure_releases_ownership(monkeypatch):
    from app import fair_value_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    tasks = BackgroundTasks()
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda _: recovery.queue_fair_value_recovery(tasks, "league", 2026, "rev"), range(20)))
    assert sum(item["status"] == "queued" for item in statuses) == 1
    assert len(tasks.tasks) == 1
    def failure(*args):
        raise RuntimeError("worker unavailable")
    monkeypatch.setattr(recovery, "submit_cpu_job", failure)
    async def run():
        with pytest.raises(RuntimeError):
            await tasks()
        await asyncio.sleep(0)
    asyncio.run(run())
    assert not recovery._ACTIVE
    assert recovery.queue_fair_value_recovery(BackgroundTasks(), "league", 2026, "rev")["status"] == "error"
    assert recovery.queue_fair_value_recovery(BackgroundTasks(), "league", 2026, "new-rev")["status"] == "queued"


def test_lineup_snapshot_omits_stats_and_isolates_identity_mutations(tmp_path, monkeypatch):
    from src.draft_hub import native_stats as stats
    monkeypatch.setattr(stats, "NATIVE_STATS_DIR", tmp_path)
    stats.clear_native_stats_cache()
    path = stats._path(2026, 5)
    snapshot = {"season": 2026, "week": 5, "schedule_coverage_version": stats.SCHEDULE_COVERAGE_VERSION,
                "identities": {"p1": {"name": "Saved Player", "position": "QB", "team": "KC"}},
                "records": [{"name": "Saved Player", "position": "QB", "team": "KC", "stats": {"passing_yards": 300}}],
                "stats": {"p1": {"passing_yards": 300}}}
    path.write_text(json.dumps(snapshot), encoding="utf-8")
    result = stats.cached_week_snapshot(2026, 5, stats.LINEUP_IDENTITY_FIELDS)
    assert "stats" not in result and "stats" not in result["records"][0]
    result["identities"]["p1"]["team"] = "DET"
    result["records"][0]["team"] = "DET"
    full = stats.cached_week_snapshot(2026, 5)
    assert full["identities"]["p1"]["team"] == "KC"
    assert full["records"][0]["team"] == "KC"
    assert full["stats"]["p1"]["passing_yards"] == 300
    snapshot["identities"]["p1"]["team"] = "BUF"
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps(snapshot), encoding="utf-8")
    replacement.replace(path)
    assert stats.cached_week_snapshot(2026, 5, stats.LINEUP_IDENTITY_FIELDS)["identities"]["p1"]["team"] == "BUF"


def test_read_only_digest_does_not_prevent_later_worker_generation(tmp_path, monkeypatch):
    from src.sentiment import fantasy_digest as digest
    monkeypatch.setattr(digest, "_WEEKLY_CACHE_DIR", tmp_path)
    llm = Mock(return_value="Generated note")
    monkeypatch.setattr(digest, "_llm_fantasy_digest", llm)
    kwargs = {"player_id": "p1", "season": 2026, "week": 5, "return_meta": True}
    payload = {"top_sentence": "Player has a larger role this week.", "sentiment_label": "hype"}
    first = digest.fantasy_digest_for_player("Saved Player", payload, prefer_llm=False, cache_fallback=False, **kwargs)
    assert first["fantasy_media_digest_source"] == "extractive"
    llm.assert_not_called()
    second = digest.fantasy_digest_for_player("Saved Player", payload, **kwargs)
    assert second["fantasy_media_digest"] == "Generated note"
    llm.assert_called_once()


def test_insights_with_missing_values_does_not_recalculate_them(hub_db, monkeypatch):
    from app import hub_routes as routes, fair_value_recovery as recovery
    from src.draft_hub import storage, draft_pool_cache, trade_insights
    from src.draft_hub.schemas import LeagueRules
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user
    league = storage.create_league("reader", "Insights", 2026, LeagueRules())
    team = storage.get_team_by_user(league["id"], "reader")
    storage.add_roster_slot(league["workspace_id"], {"player_id": "p1", "player_name": "Saved Player",
        "team": "KC", "position": "QB", "salary": 10, "contract_years": 2}, team_id=team["id"])
    monkeypatch.setattr(routes, "_INSIGHTS_RESPONSE_CACHE", {})
    monkeypatch.setattr(draft_pool_cache, "load_draft_pool", lambda *args, **kwargs: pytest.fail("pool read on Insights valuation miss"))
    monkeypatch.setattr(trade_insights, "_player_fair_values", lambda *args: pytest.fail("inline Insights valuation"))
    queue = Mock(return_value={"status": "queued"})
    monkeypatch.setattr(recovery, "queue_fair_value_recovery", queue)
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "reader"}
    try:
        response = TestClient(app).get(f"/api/hub/league/{league['id']}/insights/trades")
        assert response.status_code == 200, response.text
        assert response.json()["trade"]["suggestions"] == []
        assert response.json()["trade"]["recovery"]["status"] == "queued"
        queue.assert_called_once()
        queue.return_value = {"status": "error"}
        again = TestClient(app).get(f"/api/hub/league/{league['id']}/insights/trades")
        assert again.status_code == 200
        assert again.json()["trade"]["recovery"]["status"] == "error"
        assert queue.call_count == 2
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


@pytest.mark.parametrize("paused", [False, True])
def test_sleeper_sync_returns_roster_result_before_history_warmup(monkeypatch, paused):
    from app import hub_routes as routes, scoring_cache_refresh as refresh
    from src.draft_hub.sleeper_sync_mode import SleeperSyncPaused
    def sync(*args):
        if paused:
            raise SleeperSyncPaused("paused")
        return {"teams_synced": 2}
    monkeypatch.setattr(routes, "sync_league_sleeper", sync)
    monkeypatch.setattr(routes, "_ctx", lambda sub: {"sub": sub})
    monkeypatch.setattr(routes, "_refresh_scoring_cache_for_league", lambda *args: pytest.fail("inline scoring history refresh"))
    monkeypatch.setattr(routes, "_clear_league_rosters_cache", lambda *args: None)
    monkeypatch.setattr(refresh, "_PENDING", set())
    tasks = BackgroundTasks()
    result = routes.hub_league_sleeper_sync("league", tasks, _user={"sub": "reader"})
    assert result["scoring_refresh"]["status"] == "queued"
    assert result["teams_synced"] == (0 if paused else 2)
    assert len(tasks.tasks) == 1
    assert refresh.queue_scoring_cache_refresh(BackgroundTasks(), "league")["status"] == "running"
    calls = []
    async def submit(func, *args):
        calls.append((func, args))
    monkeypatch.setattr(refresh, "submit_cpu_job", submit)
    asyncio.run(tasks())
    assert calls == [(refresh.refresh_scoring_cache, ("league",))]
    assert not refresh._PENDING


def test_native_identity_snapshot_read_profile(tmp_path, monkeypatch):
    from statistics import median
    from time import perf_counter
    from src.draft_hub import native_stats as stats
    monkeypatch.setattr(stats, "NATIVE_STATS_DIR", tmp_path)
    stats.clear_native_stats_cache()
    identities = {str(n): {"name": f"Player {n}", "team": "KC", "position": "WR", "sleeper_player_id": str(n)} for n in range(1000)}
    counters = {str(n): {f"stat_{k}": k for k in range(40)} for n in range(1000)}
    snapshot = {"season": 2026, "week": 5, "schedule_coverage_version": stats.SCHEDULE_COVERAGE_VERSION,
                "stats": counters, "identities": identities,
                "records": [{**row, "stats": counters[pid]} for pid, row in identities.items()]}
    stats._path(2026, 5).write_text(json.dumps(snapshot), encoding="utf-8")
    stats.cached_week_snapshot(2026, 5)
    readings = {}
    for label, fields in (("full", None), ("lineup_identity", stats.LINEUP_IDENTITY_FIELDS)):
        elapsed = []
        for _ in range(10):
            start = perf_counter()
            data = stats.cached_week_snapshot(2026, 5, fields)
            elapsed.append((perf_counter() - start) * 1000)
            assert len(data["identities"]) == 1000
        readings[label] = round(median(elapsed), 2)
    print(f"\nWarm snapshot read median, 1,000 players / 40 stats (ms): {readings}")


def test_empty_league_roster_read_does_not_start_a_worker(hub_db, monkeypatch):
    from app import hub_routes as routes, fair_value_recovery as recovery
    from src.draft_hub import storage
    from src.draft_hub.schemas import LeagueRules
    league = storage.create_league("reader", "Empty", 2026, LeagueRules())
    monkeypatch.setattr(routes, "_LEAGUE_ROSTERS_CACHE", {})
    monkeypatch.setattr(recovery, "queue_fair_value_recovery", lambda *args: pytest.fail("empty league queued inference"))
    tasks = BackgroundTasks()
    for _ in range(2):
        result = routes.hub_league_rosters(Response(), league["id"], tasks, refresh=False, trade_view=False, _user={"sub": "reader"})
        assert result["estimate_recovery"]["status"] == "idle"
    assert not tasks.tasks


def test_historical_insights_lookup_cost_depends_on_owners_and_seasons_not_players(monkeypatch):
    from src.draft_hub import historic_insights as history, storage
    rows = [{"player_name": name, "owner_label": owner, "season_year": year,
             "position": "QB", "cap_hit": amount, "roster_status": "active"}
            for year in (2025, 2026) for owner in ("Alpha", "Beta")
            for name, amount in [("Patrick Mahomes", 40), ("Josh Allen", 30), ("Lamar Jackson", 20)] * 20]
    monkeypatch.setattr(history, "list_history_seasons", lambda lid: [2025, 2026])
    monkeypatch.setattr(history, "_active_contract_rows", lambda lid, year, **kw: [r for r in rows if r["season_year"] == year])
    monkeypatch.setattr(history, "_cut_rows", lambda *args: [])
    monkeypatch.setattr("src.draft_hub.owner_display.team_owner_map_for_league", lambda *args, **kw: {})
    name_lookup = Mock(side_effect=lambda lid, year, owner: f"{owner}-{year}")
    cap_lookup = Mock(side_effect=lambda lid, year, default: 150 if year == 2025 else 200)
    monkeypatch.setattr(storage, "resolve_hub_team_name", name_lookup)
    monkeypatch.setattr(storage, "resolve_salary_cap_for_season", cap_lookup)
    awards = history.build_contract_awards("league")
    assert next(a for a in awards if a["id"] == "cap_hog")["headline"] == "26.7% of that season's cap"
    assert cap_lookup.call_count == 2  # 240 player rows, only two salary-cap reads.
    assert name_lookup.call_count <= 4  # At most one lookup per owner/year.
    name_lookup.reset_mock()
    snapshot = history._analytics_snapshot([r for r in rows if r["season_year"] == 2026],
                                          salary_cap=200, label="2026", league_id="league")
    assert {team["team_name"] for team in snapshot["teams"]} == {"Alpha-2026", "Beta-2026"}
    assert name_lookup.call_count == 2
    # A later request must observe commissioner edits rather than a global memoized result.
    name_lookup.side_effect = lambda lid, year, owner: f"New {owner}"
    snapshot = history._analytics_snapshot([r for r in rows if r["season_year"] == 2026],
                                          salary_cap=200, label="2026", league_id="league")
    assert {team["team_name"] for team in snapshot["teams"]} == {"New Alpha", "New Beta"}
    assert name_lookup.call_count == 4
    cap_lookup.reset_mock()
    assert history.build_contract_analytics("league")["identity"] == "owner"
    assert cap_lookup.call_count == 2
