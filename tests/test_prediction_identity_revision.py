"""Published forecasts follow semantic identity, not provider poll timestamps."""
import json
import os

import pandas as pd
import pytest

from src.projections import artifact_store


@pytest.fixture
def saved_identity(tmp_path, monkeypatch):
    from src import config
    from src.integrations import sleeper
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    cache = tmp_path / "sleeper_players.json"
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", cache)
    players = {"1": {"full_name": "Known Player", "position": "QB", "fantasy_positions": ["QB"],
                     "team": "KC", "gsis_id": "00-0000001", "status": "Active",
                     "injury_status": None, "depth_chart_order": 1}}
    cache.write_text(json.dumps(players))
    frame = pd.DataFrame({"player_id": ["00-0000001"], "Projected Points": [18.0],
                          "Season": [2026], "Week": [7]})
    parquet, meta = tmp_path / "weekly.parquet", tmp_path / "weekly.meta.json"
    artifact_store.publish_prediction_artifact(parquet, meta, frame,
        {"artifact_kind": "weekly", "position": "qb", "season": 2026, "week": 7,
         "apply_injury_adjustments": True, "fingerprint": "fixed", "rows": 1,
         "built_at": "2026-10-22T00:00:00Z"})
    def status():
        return artifact_store.read_prediction_artifact(parquet, meta, position="qb",
            season=2026, week=7, apply_injury_adjustments=True, fingerprint="fixed")[2]
    return cache, players, status


def test_identical_poll_rewrite_keeps_published_forecast_ready(saved_identity):
    cache, players, status = saved_identity
    before = status()["identity_revision"]
    stamp = cache.stat().st_mtime_ns
    cache.write_bytes(cache.read_bytes())
    os.utime(cache, ns=(stamp + 1000000, stamp + 1000000))
    assert status()["status"] == "ready"
    assert status()["current_identity_revision"] == before


def test_availability_only_poll_keeps_published_forecast_ready(saved_identity):
    cache, players, status = saved_identity
    before = status()["identity_revision"]
    players["1"].update(status="Inactive", injury_status="Out", depth_chart_order=2)
    cache.write_text(json.dumps(players))
    assert status()["status"] == "ready"
    assert status()["current_identity_revision"] == before


@pytest.mark.parametrize("field,value", [("gsis_id", "00-0000002"), ("team", "BUF")])
def test_canonical_mapping_or_team_change_invalidates_publication(saved_identity, field, value):
    cache, players, status = saved_identity
    players["1"][field] = value
    cache.write_text(json.dumps(players))
    assert status()["status"] == "stale"
    assert status()["reason"] == "identity_source_changed"


def test_identical_nfl_roster_rewrite_keeps_identity_revision(tmp_path, monkeypatch):
    from src import config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    path = tmp_path / "nflverse_roster_2026.parquet"
    pd.DataFrame({"player_id": ["00-0000001"], "position": ["QB"], "team": ["KC"]}).to_parquet(path)
    before = artifact_store.prediction_identity_revision(2026)
    path.write_bytes(path.read_bytes())
    assert artifact_store.prediction_identity_revision(2026) == before
