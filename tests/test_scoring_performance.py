"""Representative native league reads, using isolated public stats and league state."""
import cProfile
import io
import json
import pstats
import time
from datetime import datetime, timezone

from src.draft_hub import hub_scoring, native_stats, storage
from src.draft_hub.presets import load_preset


def test_native_league_read_profile(hub_db, tmp_path, monkeypatch):
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path / "native")
    native_stats.NATIVE_STATS_DIR.mkdir()
    native_stats.clear_native_stats_cache()
    clock = datetime(2026, 10, 8, tzinfo=timezone.utc)
    monkeypatch.setattr(hub_scoring, "_utcnow", lambda: clock)
    monkeypatch.setattr("src.draft_hub.league_live_scoring.resolve_current_week",
                        lambda **kw: (5, {"season": "2026", "week": 5, "season_type": "regular"}))
    monkeypatch.setattr("src.draft_hub.weekly_command_center._load_projection_index", lambda *a, **kw: ({}, {}))
    monkeypatch.setattr("src.draft_hub.native_score_refresh.request_refresh", lambda *a, **kw: None)
    rows = {str(n): {"name": f"Player {n}", "team": "KC", "position": "WR", "sleeper_player_id": str(n)}
            for n in range(1000, 2000)}
    snapshot = {"season": 2026, "week": 5, "identities": rows, "records": list(rows.values()),
                "stats": {pid: {key: 0 for key in range(20)} for pid in rows},
                "schedule_coverage_version": native_stats.SCHEDULE_COVERAGE_VERSION,
                "complete": False, "schedule_complete": True,
                "game_states": {"KC": {"game_state": "pregame", "kickoff_at": "2026-10-11T17:00:00Z"}}}
    native_stats._path(2026, 5).write_text(json.dumps(snapshot), encoding="utf-8")
    league = storage.create_league("profile-owner", "Profile", 2026, load_preset("salary_cap_auction_v1"), team_count=12)
    teams = [storage.get_team_by_user(league["id"], "profile-owner")]
    teams += [storage.join_league(f"profile-{n}", league["room_code"], f"Team {n}") for n in range(11)]
    for n, team in enumerate(teams):
        lineup = []
        for i in range(16):
            pid = str(1000 + n * 16 + i)
            storage.add_roster_slot(league["workspace_id"], {"player_id": pid, "player_name": rows[pid]["name"],
                "team": "KC", "position": "WR", "salary": 1, "contract_years": 1}, team_id=team["id"])
            lineup.append({"player_id": pid, "player_name": rows[pid]["name"], "nfl_team": "KC",
                           "position": "WR", "slot": f"WR{i+1}" if i < 2 else "BN",
                           "lineup_role": "starter" if i < 2 else "bench", "locked": False})
        storage.replace_team_lineup(league["id"], team["id"], 2026, 5, lineup)
    profile = cProfile.Profile()
    elapsed = []
    for _ in range(3):
        started = time.perf_counter()
        payload = profile.runcall(hub_scoring.build_hub_live_week, league["id"], week=5, viewer_team_id=teams[0]["id"])
        elapsed.append(round((time.perf_counter() - started) * 1000, 1))
        assert len(payload["matchups"]) == 6
    output = io.StringIO()
    pstats.Stats(profile, stream=output).sort_stats("cumulative").print_stats(12)
    print(f"\nNative 12-team / 192-player reads, profile enabled (ms): {elapsed}\n{output.getvalue()}")
