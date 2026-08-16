"""SCORE-33 — adaptive injury polling + stale inclusion safeguard."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from src.integrations.injury_poll import (
    INJURY_STALE_SAFEGUARD_MESSAGE,
    PHASE_INSEASON,
    PHASE_OFFSEASON,
    PHASE_REPORTING,
    cadence_seconds_for_phase,
    compute_inclusion_trust,
    enqueue_manual_injury_refresh,
    get_injury_poll_status,
    maybe_tick_injury_poll,
    resolve_injury_poll_phase,
    run_injury_poll,
)
from src.integrations.injury_snapshot import injured_players_from_disk
from src.projections.player_context import attach_inclusion_trust


@pytest.fixture()
def poll_tmpdir(tmp_path, monkeypatch):
    status_path = tmp_path / "injury_poll_status.json"
    players_cache = tmp_path / "sleeper_players.json"
    monkeypatch.setattr("src.integrations.injury_poll.INJURY_POLL_STATUS_PATH", status_path)
    monkeypatch.setattr("src.integrations.injury_poll.CACHE_DIR", tmp_path)
    monkeypatch.setattr("src.integrations.injury_poll.PLAYERS_CACHE", players_cache)
    monkeypatch.setattr("src.integrations.injury_snapshot.PLAYERS_CACHE", players_cache)
    monkeypatch.setattr(
        "src.integrations.injury_poll.INJURY_POLL_MANUAL_COOLDOWN_SECONDS",
        120,
    )
    return tmp_path, status_path, players_cache


def test_resolve_phase_offseason_and_reporting():
    assert resolve_injury_poll_phase({"season_type": "off"}) == PHASE_OFFSEASON
    assert resolve_injury_poll_phase({"season_type": "pre"}) == PHASE_OFFSEASON

    # Wednesday Eastern during regular season → reporting window
    wed = datetime(2026, 9, 16, 18, 0, tzinfo=timezone.utc)  # Wed afternoon ET
    assert (
        resolve_injury_poll_phase({"season_type": "regular"}, now=wed) == PHASE_REPORTING
    )

    # Tuesday Eastern → normal in-season
    tue = datetime(2026, 9, 15, 18, 0, tzinfo=timezone.utc)
    assert resolve_injury_poll_phase({"season_type": "regular"}, now=tue) == PHASE_INSEASON


def test_cadence_bounds():
    assert 5 * 60 <= cadence_seconds_for_phase(PHASE_REPORTING) <= 10 * 60
    assert 30 * 60 <= cadence_seconds_for_phase(PHASE_INSEASON) <= 60 * 60
    assert cadence_seconds_for_phase(PHASE_OFFSEASON) >= 2 * 3600


def test_inclusion_trust_suppresses_when_injury_newer():
    trust = compute_inclusion_trust(
        opportunity_included=True,
        artifact_stale=False,
        projection_freshness_at="2026-08-14T12:00:00+00:00",
        injury_status_freshness_at="2026-08-14T18:00:00+00:00",
    )
    assert trust["stale_vs_projection"] is True
    assert trust["can_label_included"] is False
    assert trust["message"] == INJURY_STALE_SAFEGUARD_MESSAGE

    fresh = compute_inclusion_trust(
        opportunity_included=True,
        artifact_stale=False,
        projection_freshness_at="2026-08-14T18:00:00+00:00",
        injury_status_freshness_at="2026-08-14T12:00:00+00:00",
    )
    assert fresh["stale_vs_projection"] is False
    assert fresh["can_label_included"] is True
    assert fresh["message"] is None


def test_inclusion_trust_respects_artifact_stale_flag():
    trust = compute_inclusion_trust(
        opportunity_included=True,
        artifact_stale=True,
        projection_freshness_at="2026-08-14T18:00:00+00:00",
        injury_status_freshness_at="2026-08-14T12:00:00+00:00",
    )
    assert trust["can_label_included"] is False


def test_attach_inclusion_trust_on_payload():
    payload = {
        "availability": {"updated_at": "2026-08-14T18:00:00+00:00"},
        "opportunity_adjustment": {"included": True, "points": 1.5},
        "meta": {
            "artifact_built_at": "2026-08-14T12:00:00+00:00",
            "stale": False,
        },
    }
    out = attach_inclusion_trust(payload)
    assert out["inclusion_trust"]["stale_vs_projection"] is True
    assert out["opportunity_adjustment"]["can_label_included"] is False
    assert (
        out["opportunity_adjustment"]["safeguard_message"]
        == INJURY_STALE_SAFEGUARD_MESSAGE
    )


def test_manual_refresh_rate_limited(poll_tmpdir):
    _tmp, _status, _players = poll_tmpdir
    first = enqueue_manual_injury_refresh(
        now=datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
    )
    assert first["allowed"] is True
    assert first["should_enqueue"] is True

    second = enqueue_manual_injury_refresh(
        now=datetime(2026, 8, 14, 12, 1, tzinfo=timezone.utc)
    )
    assert second["allowed"] is False
    assert second["status"] == "rate_limited"
    assert second["retry_after_seconds"] >= 1


def test_maybe_tick_due_when_never_polled(poll_tmpdir):
    with patch(
        "src.integrations.injury_poll.get_nfl_state",
        return_value={"season_type": "off"},
    ):
        tick = maybe_tick_injury_poll()
    assert tick["tick"] == "due"
    assert tick["should_enqueue"] is True
    assert tick["phase"] == PHASE_OFFSEASON


def test_run_injury_poll_writes_cache(poll_tmpdir):
    _tmp, status_path, players_cache = poll_tmpdir
    fake_players = {
        "1": {
            "full_name": "Test Player",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "injury_body_part": "Ankle",
            "injury_notes": "limited",
            "news_updated": 1_724_000_000_000,
            "gsis_id": "00-TEST",
        }
    }

    with (
        patch(
            "src.integrations.injury_poll.load_sleeper_players",
            side_effect=lambda force_refresh=False: (
                players_cache.write_text(json.dumps(fake_players), encoding="utf-8")
                or fake_players
            ),
        ),
        patch(
            "src.integrations.injury_poll.get_nfl_state",
            return_value={"season_type": "regular", "season": 2026, "week": 1},
        ),
        patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ),
        patch(
            "src.projections.injury_overlay.recompute_injury_overlays",
            return_value={
                "status": "ok",
                "injury_snapshot_id": "inj_test",
                "material_change": False,
                "recomputed_teams": [],
            },
        ),
    ):
        result = run_injury_poll(force=True, recompute_overlays=True, trigger="test")

    assert result["status"] == "ok"
    assert players_cache.exists()
    assert status_path.exists()
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["is_refreshing"] is False
    assert status["last_success_at"]


def test_injured_players_from_disk_no_network(poll_tmpdir):
    _tmp, _status, players_cache = poll_tmpdir
    players_cache.write_text(
        json.dumps(
            {
                "99": {
                    "full_name": "Ja'Marr Chase",
                    "team": "CIN",
                    "position": "WR",
                    "injury_status": "Out",
                    "injury_body_part": "Hip",
                    "injury_notes": "",
                    "gsis_id": "00-0036900",
                },
                "100": {
                    "full_name": "Healthy Guy",
                    "team": "CIN",
                    "position": "RB",
                    "injury_status": "",
                },
            }
        ),
        encoding="utf-8",
    )
    with patch(
        "src.integrations.sleeper.load_sleeper_players",
        side_effect=AssertionError("network must not be called"),
    ):
        df = injured_players_from_disk()
    assert len(df) == 1
    assert df.iloc[0]["full_name"] == "Ja'Marr Chase"
    assert df.iloc[0]["injury_status"] == "Out"


def test_injuries_api_serves_cache_meta(poll_tmpdir, monkeypatch):
    _tmp, _status, players_cache = poll_tmpdir
    players_cache.write_text(
        json.dumps(
            {
                "1": {
                    "full_name": "Tee Higgins",
                    "team": "CIN",
                    "position": "WR",
                    "injury_status": "Questionable",
                    "injury_body_part": "Hamstring",
                    "injury_notes": "limited",
                    "gsis_id": "00-0036322",
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "app.api.injured_players_from_disk",
        injured_players_from_disk,
    )
    with (
        patch(
            "src.integrations.injury_poll.get_nfl_state",
            return_value={"season_type": "off"},
        ),
        patch("app.api.maybe_tick_injury_poll", return_value={"tick": "not_due"}),
        patch(
            "src.integrations.injury_timeline.attach_return_estimates",
            side_effect=lambda rows: rows,
        ),
    ):
        from app.api import injuries

        payload = injuries()
    assert payload["count"] == 1
    assert payload["meta"]["network_on_request"] is False
    assert payload["meta"]["served_from_cache"] is True
    assert "poll" in payload["meta"]
    assert payload["players"][0]["full_name"] == "Tee Higgins"


def test_injuries_refresh_endpoint_rate_limit(poll_tmpdir, monkeypatch):
    _tmp, _status, players_cache = poll_tmpdir
    players_cache.write_text("{}", encoding="utf-8")
    monkeypatch.setattr("app.api.injured_players_from_disk", injured_players_from_disk)

    with (
        patch(
            "src.integrations.injury_timeline.attach_return_estimates",
            side_effect=lambda rows: rows,
        ),
        patch("app.api.is_admin_user", return_value=False),
    ):
        from app.api import injuries_refresh

        first = injuries_refresh(force=False, user={"email": "fan@example.com"})
        assert first["allowed"] is True
        assert first["status"] == "queued"
        assert "injuries" in first

        second = injuries_refresh(force=False, user={"email": "fan@example.com"})
        assert second["allowed"] is False
        assert second["status"] == "rate_limited"


def test_injuries_poll_status_endpoint(poll_tmpdir):
    with patch(
        "src.integrations.injury_poll.get_nfl_state",
        return_value={"season_type": "pre"},
    ):
        from app.api import injuries_poll_status

        status = injuries_poll_status()
    assert status["phase"] == PHASE_OFFSEASON
    assert "cadence_seconds" in status
    assert "poll_due" in status


def test_get_poll_status_schema(poll_tmpdir):
    with patch(
        "src.integrations.injury_poll.get_nfl_state",
        return_value={"season_type": "regular"},
    ):
        status = get_injury_poll_status(
            now=datetime(2026, 9, 15, 18, 0, tzinfo=timezone.utc)
        )
    assert status["schema_version"] == "injury_poll_v1"
    assert status["phase"] == PHASE_INSEASON
    assert status["cadence_seconds"] == cadence_seconds_for_phase(PHASE_INSEASON)
