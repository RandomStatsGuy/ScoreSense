from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
from threading import Event

import pandas as pd
import pytest

from src.draft_hub import k_def_pool_cache as kdef
from src.draft_hub import prepared_k_def_context as pc
from src.integrations import sleeper


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    source = tmp_path / "players.json"
    source.write_text("saved catalog")
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", source)
    frame = pd.DataFrame([
        {"sleeper_id": "k1", "full_name": "Kicker", "team": "KC", "position": "K", "search_rank": 100},
        {"sleeper_id": "k2", "full_name": "Other kicker", "team": "LV", "position": "K", "search_rank": 200},
        {"sleeper_id": "KC", "full_name": "", "team": "KC", "position": "DEF", "search_rank": 150},
    ])
    calls = []
    def load(*, allow_refresh):
        assert allow_refresh is False
        calls.append(1)
        return frame
    monkeypatch.setattr(sleeper, "players_dataframe", load)
    return source, frame, calls


def test_durable_readers_never_prepare_and_caller_copies_are_isolated(catalog, monkeypatch):
    _, _, calls = catalog
    assert pc.prepare_k_def_context()["status"] == "prepared"
    # Empty process-local caches cannot change the public lookup.
    pc._read_snapshot.cache_clear()
    kdef.invalidate_k_def_cache()
    def forbidden(*a, **kw):
        raise AssertionError("source preparation on a read")
    monkeypatch.setattr(sleeper, "players_dataframe", forbidden)
    monkeypatch.setattr(kdef, "build_k_def_projection_index", forbidden)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: kdef.k_def_projection_index(), range(8)))
    assert set(results[0]) == {"k1", "k2", "KC"}
    results[0]["k1"]["p50"] = 0
    assert results[1]["k1"]["p50"] == 164
    cards = [{"player_id": "k1", "position": "K", "p50": None},
             {"player_id": "KC", "position": "DEF", "p50": None}]
    kdef.overlay_k_def_week_projections(cards)
    assert [row["p50"] for row in cards] == [9.6, 9.2]
    assert all(row["has_projection"] for row in cards)
    assert calls == [1]


def test_new_api_process_uses_published_file_without_source_loading(catalog):
    pc.prepare_k_def_context()
    script = """
import socket
from pathlib import Path
from src.draft_hub import prepared_k_def_context as pc, k_def_pool_cache as kd
from src.integrations import sleeper
def forbidden(*a, **kw): raise AssertionError('read crossed preparation boundary')
socket.socket.connect = forbidden
sleeper.players_dataframe = forbidden
kd.build_k_def_projection_index = forbidden
pc.FANTASY_K_DEF_CONTEXT_PATH = Path(__import__('sys').argv[1])
cards = [{'player_id':'k1','position':'K','p50':None}]
kd.overlay_k_def_week_projections(cards)
assert cards[0]['p50'] == 9.6
"""
    subprocess.run([sys.executable, "-c", script, str(pc.FANTASY_K_DEF_CONTEXT_PATH)],
                   cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True, text=True, timeout=30)


def test_league_specific_auction_cache_cannot_truncate_public_lookup(catalog):
    pc.prepare_k_def_context()
    kdef._CACHE["kicker-only-league"] = (0, [{"player_id": "k1", "season_p50": 1}])
    try:
        index = kdef.k_def_projection_index()
        assert set(index) == {"k1", "k2", "KC"} and index["k1"]["p50"] == 164
    finally:
        kdef.invalidate_k_def_cache()


def test_source_and_algorithm_revisions_invalidate_preparation(catalog, monkeypatch):
    source, frame, calls = catalog
    pc.prepare_k_def_context()
    assert pc.prepare_k_def_context()["status"] == "current"
    frame.loc[frame.sleeper_id == "k1", "search_rank"] = 300
    source.write_text("new saved catalog revision")
    assert kdef.k_def_projection_index()["k1"]["p50"] == 164  # last complete
    assert pc.prepare_k_def_context()["status"] == "prepared"
    assert kdef.k_def_projection_index()["k2"]["p50"] == 164
    old_revision = pc.source_revision()
    monkeypatch.setattr(kdef, "K_DEF_QUANTILE_METHOD", "future-curve")
    assert pc.source_revision() != old_revision
    assert calls == [1, 1]


def test_reads_do_not_wait_for_refresh_and_lock_coalesces(catalog, monkeypatch):
    source, _, calls = catalog
    pc.prepare_k_def_context()
    source.write_text("next catalog revision")
    entered, finish = Event(), Event()
    original = sleeper.players_dataframe
    def slow(**kwargs):
        entered.set()
        assert finish.wait(5)
        return original(**kwargs)
    monkeypatch.setattr(sleeper, "players_dataframe", slow)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(pc.prepare_k_def_context)
        assert entered.wait(5)
        try:
            assert kdef.k_def_projection_index()["k1"]["p50"] == 164
            assert not future.done()
            assert pc.prepare_k_def_context()["status"] == "busy"
        finally:
            finish.set()
        assert future.result()["status"] == "prepared"
    assert calls == [1, 1]


@pytest.mark.parametrize("failure", ["exception", "source_change", "missing_position", "publish_failure", "missing_source"])
def test_failed_refresh_keeps_previous_complete_lookup(catalog, monkeypatch, failure):
    source, frame, _ = catalog
    pc.prepare_k_def_context()
    before = pc.FANTASY_K_DEF_CONTEXT_PATH.read_bytes()
    source.write_text("changed saved source revision")
    if failure == "missing_source":
        source.unlink()
    elif failure == "missing_position":
        frame.drop(frame[frame.position == "DEF"].index, inplace=True)
    elif failure == "source_change":
        original = sleeper.players_dataframe
        def changing(**kwargs):
            source.write_text("changed again during preparation")
            return original(**kwargs)
        monkeypatch.setattr(sleeper, "players_dataframe", changing)
    elif failure == "exception":
        def broken(**kwargs): raise RuntimeError("catalog read failed")
        monkeypatch.setattr(sleeper, "players_dataframe", broken)
    else:
        def broken(*args): raise OSError("disk unavailable")
        monkeypatch.setattr(pc.os, "replace", broken)
    if failure in ("exception", "publish_failure"):
        with pytest.raises((RuntimeError, OSError)):
            pc.prepare_k_def_context()
    else:
        assert pc.prepare_k_def_context()["status"] in ("sources_changing", "missing_source")
    assert pc.FANTASY_K_DEF_CONTEXT_PATH.read_bytes() == before
    assert set(kdef.k_def_projection_index()) == {"k1", "k2", "KC"}
    assert not list(pc.FANTASY_K_DEF_CONTEXT_PATH.parent.glob("tmp*"))


@pytest.mark.parametrize("corruption", ["json", "schema", "number", "row", "empty"])
def test_missing_or_corrupt_snapshot_stays_unavailable_without_building(catalog, corruption, monkeypatch):
    assert kdef.k_def_projection_index() == {}
    pc.prepare_k_def_context()
    saved = json.loads(pc.FANTASY_K_DEF_CONTEXT_PATH.read_text())
    if corruption == "schema": saved["schema"] = "unsupported"
    if corruption == "number": saved["index"]["k1"]["p50"] = "164"
    if corruption == "row": saved["index"]["k1"] = None
    if corruption == "empty": saved["index"] = {}
    pc.FANTASY_K_DEF_CONTEXT_PATH.write_text("{broken" if corruption == "json" else json.dumps(saved))
    def forbidden(*a, **kw): raise AssertionError("source build in corrupt read")
    monkeypatch.setattr(sleeper, "players_dataframe", forbidden)
    assert kdef.k_def_projection_index() == {}


def test_week_worker_prepares_specialists_even_when_week_is_current(monkeypatch):
    from src.draft_hub import prepared_week_context as weekly
    order = []
    monkeypatch.setattr(pc, "prepare_k_def_context", lambda: order.append("specialists") or {"status": "current"})
    monkeypatch.setattr(weekly, "source_revision", lambda *a: "current")
    monkeypatch.setattr(weekly, "_snapshot", lambda *a: {"revision": "current"})
    assert weekly.prepare_week_context(2026, 4)["status"] == "current"
    assert order == ["specialists"]
