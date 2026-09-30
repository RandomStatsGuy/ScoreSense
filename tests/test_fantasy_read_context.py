from concurrent.futures import ThreadPoolExecutor
import json
import time

import pandas as pd


def test_projection_context_single_builder_and_isolated_callers(monkeypatch):
    from src.draft_hub import weekly_command_center as wc
    revision = [1]
    calls = []
    monkeypatch.setattr(wc, "_weekly_context_revision", lambda *args: tuple(revision))
    def build(*args, **kwargs):
        calls.append(1)
        time.sleep(.02)
        return {"p": {"p50": 18}}, {"_by_name": {"name": [{"p50": 18}]}}
    monkeypatch.setattr(wc, "_build_projection_index", build)
    def read():
        return wc._load_projection_index(2026, 4, apply_injury_adjustments=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: read(), range(6)))
    assert len(calls) == 1
    results[0][0]["p"]["p50"] = 99
    assert read()[0]["p"]["p50"] == 18
    revision[0] += 1
    read()
    assert len(calls) == 2


def test_projection_revision_tracks_artifacts_identity_and_schedule(monkeypatch, tmp_path):
    from src.draft_hub import weekly_command_center as wc
    from src.projections import weekly_cache
    from src.integrations import roster_identity
    from src.core import schedule_utils
    monkeypatch.setattr(weekly_cache, "WEEKLY_PREDICTIONS_DIR", tmp_path)
    monkeypatch.setattr(weekly_cache, "weekly_fingerprint", lambda: "models")
    stamp = ["identity-1"]
    monkeypatch.setattr(roster_identity, "identity_stamp", lambda _: stamp[0])
    schedule = tmp_path / "schedule"
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", schedule)
    def revision():
        return wc._weekly_context_revision(2026, 4, True)
    before = revision()
    (tmp_path / "2026_w4_qb.meta.json").write_text("new artifact")
    after = revision()
    assert before != after
    stamp[0] = "identity-2"
    assert after != revision()
    after = revision()
    schedule.write_text("rescheduled game")
    assert after != revision()


def test_read_only_identity_uses_old_snapshots_without_network(monkeypatch, tmp_path):
    from src.integrations import nflverse_roster, sleeper
    from src.integrations.roster_identity import apply_roster_identity_overlay
    monkeypatch.setattr(nflverse_roster, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", tmp_path / "players.json")
    monkeypatch.setattr(sleeper, "_PLAYERS_RAW_CACHE", None)
    monkeypatch.setattr(sleeper, "_PLAYERS_DF_CACHE", None)
    monkeypatch.setattr(sleeper, "_fetch_json", lambda *_: (_ for _ in ()).throw(AssertionError("network on read")))
    nflverse_roster.roster_cache_path(2026).write_bytes(b"")
    roster = pd.DataFrame([{"player_id": "00-0000001", "player_name": "Player", "team": "SEA", "position": "WR"}])
    monkeypatch.setattr(nflverse_roster.pd, "read_parquet", lambda _: roster)
    sleeper.PLAYERS_CACHE.write_text(json.dumps({"1": {"full_name": "Player", "position": "WR", "team": "SEA"}}))
    frame = pd.DataFrame([{"player_id": "00-0000001", "Player": "Player", "Team": "PHI", "Position": "WR"}])
    out, _ = apply_roster_identity_overlay(frame, "wr", season=2026, allow_refresh=False)
    assert out.iloc[0]["Team"] == "SEA"
    assert sleeper.load_sleeper_players(allow_refresh=False)["1"]["team"] == "SEA"
    sleeper.PLAYERS_CACHE.unlink()
    assert sleeper.load_sleeper_players(allow_refresh=False) == {}


def test_schedule_snapshot_reuses_source_and_detects_replacement(monkeypatch, tmp_path):
    from src.core import schedule_utils as su
    path = tmp_path / "schedules.parquet"
    monkeypatch.setattr(su, "SCHEDULE_CACHE", path)
    su._schedule_snapshot.cache_clear()
    pd.DataFrame({"season": [2026], "week": [4]}).to_parquet(path)
    original = pd.read_parquet
    calls = []
    def read(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)
    monkeypatch.setattr(su.pd, "read_parquet", read)
    first = su._load_schedules([2026])
    first.loc[0, "week"] = 99
    assert su._load_schedules([2026]).iloc[0]["week"] == 4
    assert len(calls) == 1
    pd.DataFrame({"season": [2026, 2026], "week": [4, 5]}).to_parquet(path)
    assert len(su._load_schedules([2026])) == 2
    assert len(calls) == 2
