from concurrent.futures import ThreadPoolExecutor
import json
from threading import Event

import pytest

from src.draft_hub import prepared_week_context as pc
from src.draft_hub import weekly_command_center as wc


@pytest.fixture
def sources(monkeypatch):
    revision = ["source-1"]
    calls = []
    def build(*args, **kwargs):
        calls.append(1)
        player = {"player_id": "sleeper-1", "player_name": "Player", "position": "QB", "p50": 18.0}
        return {"sleeper-1": player, "1": player}, {
            "available": True, "available_positions": ["qb"], "missing_positions": ["rb", "wr"],
            "projections_built_at": "2026-09-30T00:00:00+00:00", "_by_name_team": {"player|KC": player},
            "_by_name": {"player": [player]}, "_by_roster_name": {"player": [player]}}
    monkeypatch.setattr(pc, "source_revision", lambda *_: revision[0])
    monkeypatch.setattr(wc, "_build_projection_index", build)
    monkeypatch.setattr(wc, "_load_prior_ppg_index", lambda *_: {"by_id": {"sleeper-1": 12.0}, "season": 2025})
    monkeypatch.setattr(wc, "_load_def_vs_pos", lambda *_: {("QB", "LV"): {"rank": 5, "ppg": 18.2}})
    monkeypatch.setattr(wc, "_load_vegas_teams", lambda *_: {"KC": {"total_line": 40.0}})
    return revision, calls, build


def test_readers_never_prepare_sources_and_keep_aliases_isolated(sources, monkeypatch):
    revision, calls, _ = sources
    pc.prepare_week_context(2026, 4)
    wc.invalidate_weekly_context_cache()  # a fresh API process has no private warmup
    def forbidden(*a, **kw):
        raise AssertionError("source preparation on a read")
    for name in ("_build_projection_index", "_load_prior_ppg_index", "_load_def_vs_pos", "_load_vegas_teams", "load_weekly_prediction"):
        monkeypatch.setattr(wc, name, forbidden)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: pc.load_week_context(2026, 4), range(8)))
    index, meta, facts = results[0]
    assert index["1"] is index["sleeper-1"] is meta["_by_name"]["player"][0]
    index["1"]["p50"] = 99
    facts["prior_ppg"]["by_id"]["sleeper-1"] = 99
    assert results[1][0]["1"]["p50"] == 18
    assert pc.load_week_context(2026, 4)[2]["prior_ppg"]["by_id"]["sleeper-1"] == 12
    cards = [{"player_id": "sleeper-1", "team": "KC", "position": "QB", "opponent": "LV"}]
    wc.attach_call_facts(cards, season=2026, week=4)
    assert cards[0]["vegas_total"] == 40
    assert len(calls) == 1


def test_missing_snapshot_coalesces_hints_without_building(sources):
    _, calls, _ = sources
    for _ in range(5):
        index, meta, facts = pc.load_week_context(2026, 4)
        assert index == {} and facts == {} and meta["context_status"] == "warming"
    assert calls == []
    assert len(list(pc.FANTASY_WEEK_CONTEXT_DIR.glob("*.request"))) == 1
    pc.prepare_week_context(2026, 4)
    assert not list(pc.FANTASY_WEEK_CONTEXT_DIR.glob("*.request"))
    assert pc.load_week_context(2026, 4)[1]["context_status"] == "ready"


def test_stale_reads_do_not_wait_for_worker_and_new_file_is_visible(sources, monkeypatch):
    revision, _, original = sources
    pc.prepare_week_context(2026, 4)
    revision[0] = "source-2"
    entered, finish = Event(), Event()
    def slow(*args, **kwargs):
        entered.set()
        assert finish.wait(5)
        index, meta = original(*args, **kwargs)
        index["1"]["p50"] = 21
        return index, meta
    monkeypatch.setattr(wc, "_build_projection_index", slow)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(pc.prepare_week_context, 2026, 4)
        assert entered.wait(5)
        try:
            index, meta, _ = pc.load_week_context(2026, 4)
            assert index["1"]["p50"] == 18 and meta["context_status"] == "refreshing"
            assert not future.done()
        finally:
            finish.set()
        assert future.result()["status"] == "prepared"
    assert pc.load_week_context(2026, 4)[0]["1"]["p50"] == 21


@pytest.mark.parametrize("failure", ["exception", "source_change", "missing_position", "publish_failure"])
def test_failed_or_partial_refresh_preserves_last_complete_snapshot(sources, monkeypatch, failure):
    revision, _, original = sources
    pc.prepare_week_context(2026, 4)
    before = pc.context_path(2026, 4, True).read_bytes()
    revision[0] = "source-2"
    def build(*args, **kwargs):
        if failure == "exception":
            raise RuntimeError("failed source read")
        index, meta = original(*args, **kwargs)
        if failure == "source_change":
            revision[0] = "source-3"
        if failure == "missing_position":
            meta["available_positions"] = []
        return index, meta
    monkeypatch.setattr(wc, "_build_projection_index", build)
    if failure == "publish_failure":
        monkeypatch.setattr(pc.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("disk unavailable")))
    if failure in ("exception", "publish_failure"):
        with pytest.raises((RuntimeError, OSError)):
            pc.prepare_week_context(2026, 4)
    else:
        assert pc.prepare_week_context(2026, 4)["status"] == "sources_changing"
    assert pc.context_path(2026, 4, True).read_bytes() == before
    assert pc.load_week_context(2026, 4)[0]["1"]["p50"] == 18
    assert not list(pc.FANTASY_WEEK_CONTEXT_DIR.glob("tmp*"))


def test_worker_lock_coalesces_concurrent_preparation(sources, monkeypatch):
    _, calls, original = sources
    entered, finish = Event(), Event()
    def slow(*args, **kwargs):
        entered.set()
        assert finish.wait(5)
        return original(*args, **kwargs)
    monkeypatch.setattr(wc, "_build_projection_index", slow)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(pc.prepare_week_context, 2026, 4)
        assert entered.wait(5)
        try:
            assert pc.prepare_week_context(2026, 4)["status"] == "busy"
        finally:
            finish.set()
        future.result()
    assert pc.prepare_week_context(2026, 4)["status"] == "current"
    assert len(calls) == 1


def test_context_cannot_leak_across_week_or_injury_variant(sources):
    pc.prepare_week_context(2026, 4)
    assert pc.load_week_context(2026, 5)[0] == {}
    assert pc.load_week_context(2026, 4, False)[0] == {}
    other = pc.context_path(2026, 5, True)
    other.write_bytes(pc.context_path(2026, 4, True).read_bytes())
    assert pc.load_week_context(2026, 5)[0] == {}


def test_discovery_includes_league_seasons_requests_and_artifact_variants(sources, hub_db, tmp_path, monkeypatch):
    from src.draft_hub import storage
    from src.draft_hub.presets import load_preset
    storage.create_league("owner", "League", 2025, load_preset("salary_cap_auction_v1"))
    monkeypatch.setattr(wc, "resolve_week_context", lambda *a, hub_season=None: (hub_season or 2026, 4))
    monkeypatch.setattr(pc, "WEEKLY_PREDICTIONS_DIR", tmp_path)
    (tmp_path / "2026_w3_qb.meta.json").write_text("{}")
    (tmp_path / "2026_w3_rb_no_inj.meta.json").write_text("{}")
    (tmp_path / "2026_w0_qb.meta.json").write_text("{}")
    pc.request_context(2026, 7, True)
    current = pc.discover_contexts(current_only=True)
    assert (2025, 4, True) in current and (2026, 4, False) in current
    all_contexts = pc.discover_contexts()
    assert (2026, 3, True) in all_contexts and (2026, 3, False) in all_contexts
    assert (2026, 7, True) in all_contexts
    assert not any(week == 0 for _, week, _ in all_contexts)


def test_worker_yields_after_small_batch(sources, monkeypatch):
    monkeypatch.setattr(pc, "discover_contexts", lambda **_: [(2026, 1, True), (2026, 2, True), (2026, 3, True)])
    results = pc.refresh_week_contexts()
    assert len(results) == 2
    # Current snapshots do not consume the preparation budget, so the next
    # pass reaches unfinished history instead of rebuilding the first batch.
    results = pc.refresh_week_contexts()
    assert len(results) == 3 and results["2026:w3:inj1"]["status"] == "prepared"


@pytest.mark.parametrize("record", ["{broken", "{}", '{"schema":"fantasy-week-context-v1"}'])
def test_corrupt_snapshot_queues_recovery_without_preparing_on_read(sources, record):
    _, calls, _ = sources
    path = pc.context_path(2026, 4, True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(record)
    assert pc.load_week_context(2026, 4)[1]["context_status"] == "warming"
    assert calls == []


@pytest.mark.parametrize("field", ["player", "prior_ppg", "vegas", "def_vs_pos"])
def test_semantically_invalid_snapshot_is_unavailable(sources, field):
    pc.prepare_week_context(2026, 4)
    path = pc.context_path(2026, 4, True)
    saved = json.loads(path.read_text())
    if field == "player":
        saved["payload"]["players"][0]["p50"] = [18]
    elif field == "def_vs_pos":
        saved["payload"]["facts"][field][0][2] = None
    else:
        saved["payload"]["facts"][field] = None
    path.write_text(json.dumps(saved))
    assert pc.load_week_context(2026, 4)[1]["context_status"] == "warming"


def test_explicit_projection_rebuild_prepares_variants_before_return(monkeypatch):
    from src.projections import weekly_cache
    order = []
    monkeypatch.setattr(weekly_cache, "invalidate_weekly_cache", lambda: order.append("invalidate"))
    monkeypatch.setattr(weekly_cache, "prewarm_weekly_predictions", lambda *a, **kw: order.append("weekly") or {"qb:inj1": 100})
    monkeypatch.setattr(pc, "prepare_week_context", lambda season, week, injury: order.append(injury) or {"status": "prepared"})
    assert weekly_cache.rebuild_weekly_predictions(2026, 4) == {"qb:inj1": 100}
    assert order == ["invalidate", "weekly", True, False]


def test_explicit_projection_rebuild_does_not_report_success_before_context_is_ready(monkeypatch):
    from src.projections import weekly_cache
    monkeypatch.setattr(weekly_cache, "prewarm_weekly_predictions", lambda *a, **kw: {})
    monkeypatch.setattr(pc, "prepare_week_context", lambda *a: {"status": "sources_changing"})
    with pytest.raises(RuntimeError, match="not ready"):
        weekly_cache.rebuild_weekly_predictions(2026, 4)


def test_ticker_uses_shared_worker_and_propagates_shutdown(monkeypatch):
    import asyncio
    from app import fantasy_context_ticker as ticker
    calls = []
    async def submit(fn):
        calls.append(fn)
        raise asyncio.CancelledError
    monkeypatch.setattr(ticker, "submit_cpu_job", submit)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ticker.fantasy_context_ticker_loop())
    assert calls == [pc.refresh_week_contexts]
