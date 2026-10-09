"""A missing raw record scores zero only with exact completed-game DNP proof."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import native_participation as participation, native_stats, storage, hub_scoring
from src.draft_hub import native_score_refresh as refresh, week_corrections as corrections
from src.draft_hub.schemas import LeagueRules

SEASON, WEEK = 2026, 4
GAME, TEAM, ATHLETE = "401872970", "21", "4241478"
GSIS = "00-0099999"  # Explicit synthetic crosswalk; never inferred from a name.
BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
NOW = datetime(2026, 10, 6, tzinfo=timezone.utc)


def ref(path):
    return {"$ref": BASE + path + "?lang=en&region=us"}


def raw_snapshot():
    return {"season": SEASON, "week": WEEK, "stats": {}, "identities": {}, "records": [],
            "complete": True, "schedule_complete": True, "fingerprint": "verified-raw-week4",
            "fetched_at": NOW.isoformat(), "all_final_since": (NOW - timedelta(minutes=10)).isoformat(),
            "game_states": {"PHI": {"game_state": "final", "completed": True,
                "game_id": GAME, "competition_id": GAME, "competitor_id": TEAM,
                "kickoff_at": "2026-10-04T17:00Z"}}}


def player(pid="7525", *, role="starter"):
    return {"player_id": pid, "player_name": "DeVonta Smith", "position": "WR", "nfl_team": "PHI",
            "slot": "WR1" if role == "starter" else "BN", "lineup_role": role}


def provider_payloads(aid=ATHLETE):
    path = f"/events/{GAME}/competitions/{GAME}/competitors/{TEAM}/roster"
    entry = {"playerId": int(aid), "period": 0, "active": False, "starter": False,
             "valid": False, "didNotPlay": True, "displayName": "D. Smith",
             "athlete": ref(f"/seasons/{SEASON}/athletes/{aid}"), "position": ref("/positions/1")}
    roster = {**ref(path), "competition": ref(f"/events/{GAME}/competitions/{GAME}"),
              "team": ref(f"/seasons/{SEASON}/teams/{TEAM}"), "entries": [entry]}
    profile = {**ref(f"/seasons/{SEASON}/athletes/{aid}"), "id": aid,
               "fullName": "DeVonta Smith", "position": {**ref("/positions/1"), "id": "1", "abbreviation": "WR"},
               "team": ref(f"/seasons/{SEASON}/teams/20")}  # Today's team is deliberately different.
    return roster, profile


@pytest.fixture
def proof_provider(monkeypatch, trusted_native_catalog):
    trusted_native_catalog("7525", name="DeVonta Smith", position="WR", team="PHI", gsis_id=GSIS)
    roster, profile = provider_payloads()
    calls = []
    def fetch(url):
        calls.append(url)
        return copy.deepcopy(roster if url.endswith("/roster") else profile)
    monkeypatch.setattr(participation, "_fetch_json", fetch)
    return roster, profile, calls


@pytest.mark.parametrize("pid", ["7525", "sleeper-7525", GSIS])
def test_exact_final_inactive_proof_scores_zero_under_all_trusted_aliases(proof_provider, pid):
    raw = raw_snapshot()
    enriched = participation.enrich_inactive_players(raw, [player(pid)], SEASON, WEEK)
    stats = native_stats.resolve_lineup_stats(player(pid), enriched)
    assert stats["_native_no_game"] == stats["_native_inactive"] == 1
    assert stats["_native_inactive_proof"]["espn_player_id"] == ATHLETE
    assert stats["_native_inactive_proof"]["team"] == "PHI"
    assert hub_scoring.fantasy_points_from_stats(stats) == 0
    assert enriched["identities"][pid]["played"] is False
    assert enriched["fingerprint"] != raw["fingerprint"]
    assert raw["stats"] == {} and raw["fingerprint"] == "verified-raw-week4"


@pytest.mark.parametrize("current_team", ["NYJ", "FA"])
def test_historical_roster_team_wins_over_current_catalog_and_profile_team(proof_provider, monkeypatch, current_team):
    from src.draft_hub import player_identity
    known = player_identity.cached_player_identity("7525", season=SEASON)
    monkeypatch.setattr(player_identity, "cached_player_identity", lambda *_a, **_k: {**known, "team": current_team})
    enriched = participation.enrich_inactive_players(raw_snapshot(), [player()], SEASON, WEEK)
    assert hub_scoring.trusted_lineup_row(player(), SEASON, WEEK, snapshot=enriched)["nfl_team"] == "PHI"
    assert native_stats.resolve_lineup_stats(player(), enriched)["_native_no_game"] == 1


@pytest.mark.parametrize("bad", ["live", "not-completed", "absent", "string-true", "wrong-name", "wrong-position",
    "wrong-event", "wrong-team", "wrong-host", "wrong-season-ref", "duplicate", "historical-team-mismatch", "conflicting-sid"])
def test_missing_or_untrustworthy_proof_never_becomes_zero(proof_provider, bad):
    roster, profile, calls = proof_provider
    snapshot, row = raw_snapshot(), player()
    if bad == "live": snapshot["game_states"]["PHI"].update(game_state="live", completed=False)
    elif bad == "not-completed": snapshot["game_states"]["PHI"]["completed"] = False
    elif bad == "absent": roster["entries"] = []
    elif bad == "string-true": roster["entries"][0]["didNotPlay"] = "true"
    elif bad == "wrong-name": profile["fullName"] = "Another Smith"
    elif bad == "wrong-position": profile["position"]["abbreviation"] = "CB"
    elif bad == "wrong-event": roster["competition"] = ref("/events/999/competitions/999")
    elif bad == "wrong-team": roster["team"] = ref(f"/seasons/{SEASON}/teams/20")
    elif bad == "wrong-host": roster["entries"][0]["athlete"]["$ref"] = "https://example.com/athlete"
    elif bad == "wrong-season-ref": roster["entries"][0]["athlete"] = ref(f"/seasons/2025/athletes/{ATHLETE}")
    elif bad == "duplicate": roster["entries"].append(copy.deepcopy(roster["entries"][0]))
    elif bad == "historical-team-mismatch":
        row["nfl_team"] = "NYJ"
        snapshot["game_states"]["NYJ"] = {**snapshot["game_states"]["PHI"], "competitor_id": "20", "game_id": "999", "competition_id": "999"}
    elif bad == "conflicting-sid": row["sleeper_player_id"] = "13977"
    enriched = participation.enrich_inactive_players(snapshot, [row], SEASON, WEEK)
    assert "inactive_proofs" not in enriched
    with pytest.raises(native_stats.NativeStatsUnavailable):
        native_stats.resolve_lineup_stats(row, enriched)
    if bad in {"live", "not-completed", "conflicting-sid"}: assert calls == []


def test_ambiguous_cached_full_name_refuses_dnp_mapping(proof_provider, trusted_native_catalog):
    trusted_native_catalog("other", name="DeVonta Smith", position="WR", team="NYJ")
    enriched = participation.enrich_inactive_players(raw_snapshot(), [player()], SEASON, WEEK)
    assert "inactive_proofs" not in enriched
    assert proof_provider[2] == []


def test_real_played_zero_always_wins_without_participation_fetch(proof_provider):
    snapshot = raw_snapshot()
    stats = native_stats.normalize_sleeper_stats({"gp": 1, "gms_active": 1}, "WR")
    snapshot["stats"]["7525"] = stats
    snapshot["identities"]["7525"] = {"name": "DeVonta Smith", "position": "WR", "team": "PHI", "played": True}
    enriched = participation.enrich_inactive_players(snapshot, [player()], SEASON, WEEK)
    assert native_stats.resolve_lineup_stats(player(), enriched) == stats
    assert "_native_no_game" not in stats and proof_provider[2] == []


def test_requests_are_shared_across_leagues_and_persisted_cache_restart(proof_provider):
    first = participation.enrich_inactive_players(raw_snapshot(), [player()], SEASON, WEEK)
    second = participation.enrich_inactive_players(raw_snapshot(), [player(GSIS)], SEASON, WEEK)
    assert first["fingerprint"] == second["fingerprint"]
    assert len(proof_provider[2]) == 2
    participation.clear_participation_cache()
    third = participation.enrich_inactive_players(raw_snapshot(), [player()], SEASON, WEEK)
    assert third["fingerprint"] == first["fingerprint"] and len(proof_provider[2]) == 2


def test_pure_resolver_and_cached_snapshot_read_never_fetch_inactive_proof(proof_provider):
    with pytest.raises(native_stats.NativeStatsUnavailable):
        native_stats.resolve_lineup_stats(player(), raw_snapshot())
    native_stats.cached_week_snapshot(SEASON, WEEK)
    assert proof_provider[2] == []


@pytest.mark.parametrize("state", [None, {"game_state": "pregame", "completed": False},
    {"game_state": "live", "completed": False}, {"game_state": "final", "completed": False}])
def test_without_completed_final_event_enrichment_never_probes_resolver_or_provider(proof_provider, monkeypatch, state):
    snapshot = raw_snapshot()
    snapshot["game_states"] = {} if state is None else {"PHI": state}
    monkeypatch.setattr(native_stats, "resolve_lineup_stats", lambda *_: pytest.fail("No final event permits a proof probe"))
    assert participation.enrich_inactive_players(snapshot, [player()], SEASON, WEEK) is snapshot
    assert proof_provider[2] == []


def test_provider_failure_remains_unknown_and_is_coalesced(proof_provider, monkeypatch):
    calls = []
    def unavailable(url):
        calls.append(url)
        raise OSError("Provider unavailable")
    monkeypatch.setattr(participation, "_fetch_json", unavailable)
    for _ in range(2):
        result = participation.enrich_inactive_players(raw_snapshot(), [player()], SEASON, WEEK)
        assert "inactive_proofs" not in result and result["participation_warnings"]
    assert len(calls) == 1


def test_bounded_request_budget_prioritizes_starters_over_optional_bench(proof_provider, monkeypatch, trusted_native_catalog):
    trusted_native_catalog("backup", name="Missing Backup", team="DAL", position="QB")
    monkeypatch.setattr(participation, "_REQUEST_LIMIT", 2)
    raw = raw_snapshot()
    raw["game_states"]["DAL"] = {**raw["game_states"]["PHI"], "competitor_id": "6", "game_id": "999", "competition_id": "999"}
    result = participation.enrich_inactive_players(raw, [
        {"player_id": "backup", "player_name": "Missing Backup", "position": "QB", "nfl_team": "DAL", "lineup_role": "bench"},
        player()], SEASON, WEEK)
    assert native_stats.resolve_lineup_stats(player(), result)["_native_no_game"] == 1
    assert len(proof_provider[2]) == 2
    assert "request limit" in result["participation_warnings"][0]


def seed(hub_db, monkeypatch, proof_provider):
    rules = LeagueRules(draft_type="snake", roster={"wr": {"starter": 1, "max": 3}}, roster_size_max=3)
    league = storage.create_league("comm", "Inactive proof", SEASON, rules, team_count=2)
    home = storage.get_team_by_user(league["id"], "comm")
    away = storage.join_league("other", league["room_code"], "Other")
    with storage.get_conn() as conn: conn.execute("UPDATE league SET draft_completed=1 WHERE id=?", (league["id"],))
    league = storage.get_league(league["id"])
    storage.add_roster_slot(storage.roster_workspace_for_league(league), {**player(), "team": "PHI", "salary": 0, "contract_years": 1}, team_id=home["id"])
    storage.replace_team_lineup(league["id"], home["id"], SEASON, WEEK, [player()])
    storage.replace_team_lineup(league["id"], away["id"], SEASON, WEEK, [])
    hub_scoring.ensure_season_schedule(league["id"], season=SEASON)
    monkeypatch.setattr(native_stats, "cached_week_snapshot", lambda *_: raw_snapshot())
    monkeypatch.setattr(native_stats, "get_week_snapshot", lambda *_a, **_k: raw_snapshot())
    return league, home, away


def test_worker_settles_and_persists_dnp_proof_without_inventing_season_game(hub_db, monkeypatch, proof_provider):
    league, home, _ = seed(hub_db, monkeypatch, proof_provider)
    first = refresh.refresh_league_week(league, SEASON, WEEK, raw_snapshot(), now=NOW)
    assert first["status"] == "pending" and storage.get_week_scoring_run(league["id"], SEASON, WEEK) is None
    final = refresh.refresh_league_week(league, SEASON, WEEK, raw_snapshot(), now=NOW + timedelta(minutes=3))
    assert final["status"] == "final"
    saved = storage.list_player_week_scores(league["id"], SEASON, WEEK)[0]
    assert saved["player_id"] == "7525" and saved["team_id"] == home["id"] and saved["points"] == 0
    assert saved["stats"]["_native_inactive_proof"]["game_id"] == GAME
    assert final["players"][0]["stats"]["_native_inactive_proof"]["espn_player_id"] == ATHLETE
    with storage.get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM player_season_week WHERE source=?", (league["id"],)).fetchone()[0] == 0
    assert len(proof_provider[2]) == 2


def test_manual_actual_calculation_uses_proof_and_existing_final_worker_never_reloads(hub_db, monkeypatch, proof_provider):
    league, _, _ = seed(hub_db, monkeypatch, proof_provider)
    result = hub_scoring.apply_week_scores(league["id"], SEASON, WEEK)
    assert result["scored"] and not result["live"]
    before = storage.list_team_week_scores(league["id"], SEASON, WEEK)
    monkeypatch.setattr(participation, "_fetch_json", lambda *_: pytest.fail("Already-final results must not reload proof"))
    refresh.refresh_league_week(league, SEASON, WEEK, raw_snapshot(), now=NOW)
    assert storage.list_team_week_scores(league["id"], SEASON, WEEK) == before


def test_correction_detects_changed_dnp_provenance_before_publication(hub_db, monkeypatch, proof_provider):
    league, home, away = seed(hub_db, monkeypatch, proof_provider)
    context = corrections.correction_context(league["id"], SEASON, WEEK, "comm")
    changes = [{"team_id": home["id"], "players": [player()]}]
    preview = corrections.preview_correction(league["id"], SEASON, WEEK, "comm", changes,
        "Verify recorded inactive starter", context["revision"], acknowledge_empty=True)
    assert preview["can_publish"]
    assert preview["player_scores"][0]["stats"]["_native_inactive_proof"]["espn_player_id"] == ATHLETE
    roster, profile = provider_payloads("4241479")
    monkeypatch.setattr(participation, "_fetch_json", lambda url: copy.deepcopy(roster if url.endswith("/roster") else profile))
    stamp = participation.time.time()
    monkeypatch.setattr(participation.time, "time", lambda: stamp + 4000)
    with pytest.raises(corrections.CorrectionError, match="statistics changed"):
        corrections.publish_correction(league["id"], SEASON, WEEK, "comm", preview["id"],
            preview["revision"], preview["reason"], "verified-proof")
    assert storage.get_week_scoring_run(league["id"], SEASON, WEEK) is None
    assert storage.list_player_week_scores(league["id"], SEASON, WEEK) == []
