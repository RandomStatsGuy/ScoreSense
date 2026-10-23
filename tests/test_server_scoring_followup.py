"""Native read batching and conservative weekly-repair reuse regressions."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from unittest.mock import Mock, call

import pandas as pd
import pytest


@pytest.fixture
def identity_catalog(tmp_path, monkeypatch):
    from src.draft_hub import player_identity as identity
    from src.integrations import sleeper
    path = tmp_path / "players.json"
    path.write_text(json.dumps({"4046": {"full_name": "Patrick Mahomes", "position": "QB", "team": "KC", "gsis_id": "00-0033873"}}))
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", path)
    monkeypatch.setattr(identity, "DRAFT_POOL_DIR", tmp_path / "pools")
    monkeypatch.setattr(identity, "CACHE_DIR", tmp_path / "official_rosters")
    identity.clear_player_identity_cache()
    yield path
    identity.clear_player_identity_cache()


def test_identity_read_scope_checks_sources_once_and_reloads_next_request(identity_catalog, monkeypatch):
    from src.draft_hub import player_identity as identity
    stamp = Mock(wraps=identity._stamp)
    monkeypatch.setattr(identity, "_stamp", stamp)
    with identity.identity_read_scope(2026):
        for _ in range(100):
            assert identity.cached_player_identity("4046", season=2026)["team"] == "KC"
        from src.integrations.sleeper import PLAYERS_CACHE
        sources = [call(PLAYERS_CACHE), call(identity.DRAFT_POOL_DIR / "pool_2026.parquet"),
                   call(identity.CACHE_DIR / "nflverse_roster_2026.parquet")]
        assert stamp.call_args_list == sources  # Each source once, even after 100 reads.
        raw = json.loads(identity_catalog.read_text())
        raw["4046"]["team"] = "BUF"
        identity_catalog.write_text(json.dumps(raw))
        assert identity.cached_player_identity("4046", season=2026)["team"] == "KC"
        with pytest.raises(identity.PlayerIdentityError):
            identity.cached_player_identity("4046", season=2026, sleeper_player_id="unrelated")
    assert identity.cached_player_identity("4046", season=2026)["team"] == "BUF"
    assert stamp.call_args_list == sources * 2  # Next request checks all three revisions once.


def test_identity_scope_resets_after_exception_and_does_not_leak_to_other_threads(identity_catalog):
    from src.draft_hub import player_identity as identity
    with pytest.raises(RuntimeError):
        with identity.identity_read_scope(2026):
            raise RuntimeError("aborted read")
    assert identity._READ_INDEX.get() is None
    with identity.identity_read_scope(2026):
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(lambda: identity._READ_INDEX.get()).result() is None
        with identity.identity_read_scope(2027):
            assert identity.cached_player_identity("4046", season=2027)["position"] == "QB"
        assert identity._READ_INDEX.get()[0] == 2026
    assert identity._READ_INDEX.get() is None


def test_bulk_rosters_do_not_enrich_owner_names_and_stay_in_their_league(hub_db, monkeypatch):
    from src.draft_hub import storage
    from src.draft_hub.schemas import LeagueRules
    first = storage.create_league("owner", "First", 2026, LeagueRules())
    second = storage.create_league("owner", "Second", 2026, LeagueRules())
    teams = [storage.get_team_by_user(league["id"], "owner") for league in (first, second)]
    for league, team, pid in zip((first, second), teams, ("p1", "p2")):
        storage.add_roster_slot(league["workspace_id"], {"player_id": pid, "player_name": pid, "position": "QB", "team": "KC", "salary": 1}, team_id=team["id"])
    monkeypatch.setattr(storage, "list_league_teams", lambda *args: pytest.fail("bulk roster read rebuilt owner maps"))
    result = storage.list_league_rosters_by_team(first["id"])
    assert set(result) == {teams[0]["id"]}
    assert [row["player_id"] for row in result[teams[0]["id"]]] == ["p1"]


@pytest.mark.parametrize("damage", [None, "old_frame", "missing_time", "stale_frame", "changed_inputs", "changed_availability", "missing_outputs", "failed_position", "support_changed_outputs"])
def test_weekly_repair_publishes_reuse_proof_only_for_new_complete_stable_frames(tmp_path, monkeypatch, damage):
    from src.jobs import projection_recovery as repair, season_refresh, dfs_inputs, dfs_refresh
    from src.projections import weekly_cache
    from src.integrations import sleeper
    epoch = 1791920000.0
    monkeypatch.setattr(repair, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(season_refresh, "STATUS_PATH", tmp_path / "season.json")
    monkeypatch.setattr(repair.time, "time", lambda: epoch)
    monkeypatch.setattr(dfs_inputs, "prepare_sources", lambda *args: None)
    support = Mock()
    monkeypatch.setattr(dfs_refresh, "_warm_supporting_data", support)
    revision = Mock(side_effect=["inputs", "different" if damage == "changed_inputs" else "inputs", "inputs"])
    monkeypatch.setattr(dfs_inputs, "input_revision", revision)
    monkeypatch.setattr(sleeper, "forecast_player_revisions", Mock(side_effect=[("roster", "availability"), ("roster", "changed" if damage == "changed_availability" else "availability"), ("roster", "availability")]))
    outputs = {"saved": "digest"}
    output_reads = [outputs, {"saved": "changed"} if damage == "support_changed_outputs" else outputs, outputs]
    monkeypatch.setattr(dfs_inputs, "output_revisions", Mock(side_effect=output_reads) if damage != "missing_outputs" else lambda *args: None)
    def load(position, season, week, **kwargs):
        if damage == "failed_position" and position == "rb":
            raise RuntimeError("failed forecast")
        frame = pd.DataFrame([{"player_id": position, "Projected Points": 12}])
        frame.attrs["built_at"] = datetime.fromtimestamp(epoch + 1, timezone.utc).isoformat()
        if position == "qb":
            if damage == "old_frame":
                frame.attrs["built_at"] = datetime.fromtimestamp(epoch - 100, timezone.utc).isoformat()
            if damage == "missing_time":
                frame.attrs.pop("built_at")
            if damage == "stale_frame":
                frame.attrs["projection_stale"] = True
        return frame
    monkeypatch.setattr(weekly_cache, "load_weekly_prediction", load)
    previous_success = "2026-10-12T12:00:00Z"
    season_refresh._save({"weekly:2026:5": {"status": "ok", "last_success_at": previous_success, "forecast_reuse": {"old": True}}})
    result = repair.rebuild_projection_context(2026, 5, ("weekly",))
    publication = season_refresh.read_status()["weekly:2026:5"]
    if damage is None:
        assert result["status"] == "ok"
        support.assert_called_once_with(2026, 5)
        assert publication["forecast_reuse"] == {"version": dfs_inputs.VERSION, "revision": "inputs", "outputs": outputs, "computed_epoch": epoch}
        assert publication["player_availability"] == "availability"
        assert dfs_inputs.can_reuse(publication, "inputs", 2026, 5, now=epoch + 300, max_age=3600)
    else:
        assert "forecast_reuse" not in publication
        if damage in {"failed_position", "stale_frame", "changed_inputs", "changed_availability", "support_changed_outputs"}:
            assert result["status"] == "error"
            assert publication["last_success_at"] == previous_success


def test_catalog_atomic_replacement_with_preserved_mtime_is_visible_next_read(identity_catalog):
    import os
    from src.draft_hub import player_identity as identity
    assert identity.cached_player_identity("4046", season=2026)["team"] == "KC"
    old = identity_catalog.stat()
    replacement = identity_catalog.with_name("replacement.json")
    replacement.write_text(identity_catalog.read_text().replace('"KC"', '"GB"'))
    os.utime(replacement, ns=(old.st_atime_ns, old.st_mtime_ns))
    replacement.replace(identity_catalog)
    assert identity_catalog.stat().st_size == old.st_size
    assert identity_catalog.stat().st_mtime_ns == old.st_mtime_ns
    assert identity.cached_player_identity("4046", season=2026)["team"] == "GB"


def test_batched_lineup_read_rechecks_closure_before_persisting(hub_db, monkeypatch):
    from src.draft_hub import hub_scoring as scoring, storage
    from src.draft_hub.schemas import LeagueRules
    league = storage.create_league("owner", "Closing", 2026, LeagueRules())
    team = storage.get_team_by_user(league["id"], "owner")
    roster = [{"player_id": "p1", "player_name": "Saved Player", "position": "QB", "team": "KC", "salary": 1}]
    monkeypatch.setattr(scoring, "_week_lineups_closed", lambda *args, **kwargs: True)
    monkeypatch.setattr(storage, "replace_team_lineup", lambda *args, **kwargs: pytest.fail("read changed a newly finalized week"))
    result = scoring.ensure_team_lineup(league["id"], team["id"], 2026, 5, league=league,
        roster=roster, game_started=lambda team: False, lineups_closed=False)
    assert result == []
    assert not storage.has_team_lineup_snapshot(league["id"], team["id"], 2026, 5)


def test_batched_lineup_context_rejects_another_league(hub_db):
    from src.draft_hub import hub_scoring as scoring, storage
    from src.draft_hub.schemas import LeagueRules
    first = storage.create_league("owner", "First", 2026, LeagueRules())
    second = storage.create_league("owner", "Second", 2026, LeagueRules())
    team = storage.get_team_by_user(first["id"], "owner")
    with pytest.raises(scoring.LineupError):
        scoring.ensure_team_lineup(first["id"], team["id"], 2026, 5, league=second)
