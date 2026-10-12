"""Synthetic evidence: no paid observations, live feeds, or model fitting."""
from copy import deepcopy
import hashlib
import json

import pytest

from src.products.dfs_opportunity import (
    PLAY_DEFINITION, build_opportunity_evidence, normalize_team_games,
    parse_receiving_observations, prepare_opportunity_artifact, read_opportunity_artifact,
)


CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic", "slate_id": "synthetic-1", "season": 2026, "week": 3}
DECISION = "2026-09-20T16:00:00Z"


def source(**changes):
    return {"source_id": "public-fixture", "provider": "synthetic", "uri": "fixture.csv",
            "content_sha256": "a" * 64, "period": {"season": 2026, "start_week": 1, "end_week": 2},
            "published_at": "2026-09-15T00:00:00Z", "retrieved_at": "2026-09-15T01:00:00Z",
            "known_at": "2026-09-15T00:00:00Z", "definition": PLAY_DEFINITION["id"],
            "rights": {"personal_analysis": True, "hosted_ingestion": True, "display": True,
                       "redistribution": False, "training": False, "external_model": False},
            "evidence_scope": "synthetic", **changes}


def csv_source(text):
    return source(content_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest())


def team_game(team="AAA", opponent="BBB", week=1, is_home=True, plays=60, dropbacks=40, **changes):
    return {"game_id": f"history-{week}", "season": 2026, "week": week, "team": team,
            "opponent": opponent, "is_home": is_home, "kickoff_at": f"2026-09-{week * 7:02d}T17:00:00Z",
            "ended_at": f"2026-09-{week * 7:02d}T21:00:00Z", "source_id": "public-fixture",
            "plays": plays, "designed_runs": plays-dropbacks, "dropbacks": dropbacks,
            "sacks": 3, "scrambles": 2, "throws": dropbacks-5,
            "targeted": dropbacks-7, "untargeted": 2, "completions": 20, **changes}


def payload():
    return {"context": deepcopy(CONTEXT), "decision_at": DECISION,
            "games": [{"game_id": "next", "home": "AAA", "away": "BBB", "kickoff_at": "2026-09-20T17:00:00Z"}],
            "players": [{"canonical_id": "p1", "team": "AAA", "position": "WR"}],
            "team_games": [team_game(), team_game("BBB", "AAA", is_home=False, plays=70, dropbacks=35),
                           team_game(week=2, is_home=False, plays=80, dropbacks=50),
                           team_game("BBB", "AAA", week=2, is_home=True, plays=60, dropbacks=30)],
            "player_games": [{"game_id": "history-1", "canonical_id": "p1", "team": "AAA", "position": "WR",
                              "targets": 8, "carries": 0, "source_id": "public-fixture"}],
            "sources": [source()], "evidence_scope": "synthetic"}


def test_t17_exact_inherited_formula_and_distinct_team_dropbacks():
    evidence = build_opportunity_evidence(**payload())
    game = evidence["games"][0]
    # AAA's own and opposing defense terms both equal 67.5; BBB's equal 66.25.
    assert game["team_screens"]["AAA"]["plays_screen"] == 67.5
    assert game["team_screens"]["BBB"]["plays_screen"] == 66.25
    assert game["combined_play_screen"] == 133.75
    assert game["team_screens"]["AAA"]["dropbacks_screen"] != game["team_screens"]["BBB"]["dropbacks_screen"]
    assert game["team_screens"]["AAA"]["alternatives"]["season_only"] == 70
    assert evidence["players"][0]["target_share"] == 8 / 33
    assert evidence["players"][0]["routes"] is None


def test_t17_absent_venue_declares_season_fallback_and_missing_is_not_zero():
    request = payload()
    request["team_games"] = request["team_games"][:2]
    request["team_games"][0]["is_home"] = False
    request["team_games"][1]["is_home"] = True
    result = build_opportunity_evidence(**request)
    assert result["games"][0]["team_screens"]["AAA"]["venue_fallback"]
    assert result["games"][0]["team_screens"]["AAA"]["alternatives"]["venue_only"] is None
    empty = build_opportunity_evidence(**{**request, "team_games": [], "player_games": []})
    assert empty["games"][0]["combined_play_screen"] is None
    assert empty["players"][0]["target_share"] is None
    assert not empty["capabilities"]["team_volume_evidence"]


@pytest.mark.parametrize("field,value", [("plays", 61), ("dropbacks", 41), ("throws", 36), ("targets", -1)])
def test_t18_count_identities_and_nonnegative_counts(field, value):
    row = team_game()
    row[field] = value
    with pytest.raises(ValueError):
        normalize_team_games([row])


def test_t05_future_source_and_target_game_never_enter_screen():
    request = payload()
    request["team_games"].append(team_game(week=3, plays=100, ended_at="2026-09-22T00:00:00Z"))
    result = build_opportunity_evidence(**request)
    assert result["games"][0]["team_screens"]["AAA"]["season_games"] == 2
    request["sources"][0]["known_at"] = "2026-09-21T00:00:00Z"
    request["sources"][0]["retrieved_at"] = "2026-09-21T01:00:00Z"
    result = build_opportunity_evidence(**request)
    assert result["games"][0]["combined_play_screen"] is None
    assert any("after" in warning for warning in result["warnings"])


def test_t05_retrospective_unknown_publication_is_disclosed_not_live_verified():
    request = payload()
    request["sources"][0].update(published_at=None, known_at=None, evidence_scope="retrospective")
    request["evidence_scope"] = "retrospective"
    result = build_opportunity_evidence(**request)
    assert not result["capabilities"]["prelock_source_verified"]
    assert "retrospective" in " ".join(result["warnings"]).lower()
    with pytest.raises(ValueError, match="publication"):
        build_opportunity_evidence(**{**request, "evidence_scope": "live"})


def test_t03_duplicate_recv_header_requires_explicit_routes_and_grade_indices():
    csv = "ID,TEAM,POS,G,RECV,RECV,TGT,PASS SNAPS,TEAM DB\np1,AAA,WR,5,88.2,100,24,125,150\n"
    mapping = {"canonical_id": 0, "team": 1, "position": 2, "games": 3,
               "receiving_grade": 4, "routes": 5, "targets": 6,
               "player_pass_snaps": 7, "team_dropbacks": 8}
    parsed = parse_receiving_observations(csv, source=csv_source(csv), column_map=mapping)
    row = parsed["rows"][0]
    assert row["receiving_grade"] == 88.2
    assert row["routes"] == 100
    assert row["targets_per_route"] == .24
    assert row["player_pass_snap_route_rate"] == .8
    assert row["team_dropback_route_participation"] == 2 / 3
    assert row["raw"] == ["p1", "AAA", "WR", "5", "88.2", "100", "24", "125", "150"]
    assert "period" in " ".join(parsed["warnings"]).lower()
    with pytest.raises(ValueError, match="indices"):
        parse_receiving_observations(csv, source=csv_source(csv), column_map={**mapping, "routes": 4})


def test_t03_no_route_division_by_zero_or_invented_denominator():
    csv = "ID,TGT,ROUTES\np1,0,0\n"
    parsed = parse_receiving_observations(csv, source=csv_source(csv),
                                         column_map={"canonical_id": 0, "targets": 1, "routes": 2})
    assert parsed["rows"][0]["targets_per_route"] is None
    assert parsed["rows"][0]["team_dropback_route_participation"] is None


def test_t05_mixed_definition_and_incomplete_full_offense_do_not_create_share():
    request = payload()
    request["sources"].append(source(source_id="other", definition="official_carries_with_kneels"))
    request["player_games"][0]["source_id"] = "other"
    result = build_opportunity_evidence(**request)
    assert result["players"][0]["target_share"] is None
    assert "denominator" in result["players"][0]["reason"].lower()


def test_artifact_roundtrip_hash_and_exact_context(tmp_path):
    evidence = prepare_opportunity_artifact(payload(), directory=tmp_path)
    assert read_opportunity_artifact(CONTEXT, directory=tmp_path) == evidence
    missing = read_opportunity_artifact({**CONTEXT, "slate_id": "other"}, directory=tmp_path)
    assert missing["status"] == "unavailable"
    assert missing["games"] == [] and not missing["capabilities"]["team_volume_evidence"]
    artifact = next(tmp_path.glob("*.json"))
    corrupted = json.loads(artifact.read_text())
    corrupted["games"][0]["combined_play_screen"] = 0
    artifact.write_text(json.dumps(corrupted))
    with pytest.raises(ValueError, match="integrity"):
        read_opportunity_artifact(CONTEXT, directory=tmp_path)


def test_atomic_preparation_failure_retains_prior_artifact(tmp_path):
    original = prepare_opportunity_artifact(payload(), directory=tmp_path)
    invalid = payload()
    invalid["team_games"][0]["plays"] = 1
    with pytest.raises(ValueError):
        prepare_opportunity_artifact(invalid, directory=tmp_path)
    assert read_opportunity_artifact(CONTEXT, directory=tmp_path) == original


def test_t06_ids_are_strings_duplicates_and_unknown_sources_rejected():
    request = payload()
    request["players"][0]["canonical_id"] = 123
    with pytest.raises(ValueError, match="string"):
        build_opportunity_evidence(**request)
    request = payload()
    request["team_games"].append(deepcopy(request["team_games"][0]))
    with pytest.raises(ValueError, match="Duplicate"):
        build_opportunity_evidence(**request)
    request = payload()
    request["player_games"][0]["source_id"] = "unknown"
    with pytest.raises(ValueError, match="source"):
        build_opportunity_evidence(**request)


def test_t04_source_rights_and_time_contradictions_block_hosted_use():
    request = payload()
    request["sources"][0]["rights"]["hosted_ingestion"] = False
    result = build_opportunity_evidence(**request)
    assert not result["capabilities"]["hosted_display_allowed"]
    request["sources"][0]["known_at"] = "2026-09-14T00:00:00Z"
    with pytest.raises(ValueError, match="publication"):
        build_opportunity_evidence(**request)


def test_source_bytes_and_contradictory_route_denominators_are_not_certified():
    csv = "ID,TGT,ROUTES,SNAPS\np1,10,5,4\n"
    mapping = {"canonical_id": 0, "targets": 1, "routes": 2, "player_pass_snaps": 3}
    with pytest.raises(ValueError, match="hash"):
        parse_receiving_observations(csv, source=source(), column_map=mapping)
    parsed = parse_receiving_observations(csv, source=csv_source(csv), column_map=mapping)
    assert parsed["rows"][0]["targets_per_route"] is None
    assert parsed["rows"][0]["player_pass_snap_route_rate"] is None
    assert len(parsed["warnings"]) == 2


def test_live_declared_times_are_checked_without_claiming_source_authenticity():
    request = payload()
    request["sources"][0]["evidence_scope"] = "live"
    request["evidence_scope"] = "live"
    result = build_opportunity_evidence(**request)
    assert result["capabilities"]["asof_source_times_checked"]
    assert not result["capabilities"]["prelock_source_verified"]
    assert result["observation_ledger"]["team_games"] == normalize_team_games(request["team_games"])


def test_period_contradiction_and_missing_offense_denom_remain_explicit():
    request = payload()
    request["sources"][0]["period"]["end_week"] = 1
    result = build_opportunity_evidence(**request)
    assert result["games"][0]["team_screens"]["AAA"]["season_games"] == 1
    assert "period" in " ".join(result["warnings"])
    request["player_games"][0]["game_id"] = "missing-team-game"
    result = build_opportunity_evidence(**request)
    assert result["players"][0]["target_share"] is None
    assert "denominator" in " ".join(result["warnings"])


def test_residual_counts_cannot_become_negative():
    request = payload()
    request["player_games"] += [{**request["player_games"][0], "canonical_id": "p2", "targets": 30}]
    with pytest.raises(ValueError, match="residual"):
        build_opportunity_evidence(**request)


def test_receiving_report_routes_retain_their_own_window_and_denominator():
    request = payload()
    csv = "ID,TEAM,POS,G,TGT,ROUTES,PLAYER PASS SNAPS\np1,AAA,WR,2,15,50,60\n"
    receipt = csv_source(csv)
    receipt["source_id"] = "routes-file"
    request["sources"].append(receipt)
    request["receiving_reports"] = [{"source_id": "routes-file", "csv_text": csv,
                                     "column_map": {"canonical_id": 0, "team": 1, "position": 2, "games": 3,
                                                    "targets": 4, "routes": 5, "player_pass_snaps": 6}}]
    result = build_opportunity_evidence(**request)
    player = result["players"][0]
    assert player["targets"] == 8  # the weekly ledger wasn't overwritten with the report's 15
    assert player["routes"] == 50
    assert player["route_participation"] is None  # own pass snaps are not team dropbacks
    assert player["route_observations"][0]["player_pass_snap_route_rate"] == 50 / 60
    assert player["route_observations"][0]["period"] == receipt["period"]
    assert result["capabilities"]["route_evidence"]
    request["sources"].append({**receipt, "source_id": "second-window", "period": {"season": 2026, "start_week": 1, "end_week": 1}})
    request["receiving_reports"].append({**request["receiving_reports"][0], "source_id": "second-window"})
    # That report's observed G=2 contradicts its declared one-week period and cannot certify routes.
    result = build_opportunity_evidence(**request)
    assert result["players"][0]["routes"] == 50
    assert result["players"][0]["route_observations"][1]["period_needs_review"]
    request["sources"][-1]["period"]["end_week"] = 2
    result = build_opportunity_evidence(**request)
    assert result["players"][0]["routes"] is None
    assert "without averaging" in " ".join(result["warnings"])


def test_source_receiving_report_future_window_is_not_used():
    request = payload()
    csv = "ID,TGT,ROUTES\np1,15,50\n"
    receipt = csv_source(csv)
    receipt["source_id"] = "future-report"
    receipt["period"]["end_week"] = 3
    request["sources"].append(receipt)
    request["receiving_reports"] = [{"source_id": receipt["source_id"], "csv_text": csv,
                                     "column_map": {"canonical_id": 0, "targets": 1, "routes": 2}}]
    result = build_opportunity_evidence(**request)
    assert result["players"][0]["routes"] is None
    assert result["observation_ledger"]["receiving_reports"] == []


def test_observed_final_counts_cannot_be_known_before_the_game_finished():
    request = payload()
    request["team_games"][0]["known_at"] = "2026-09-07T18:00:00Z"
    with pytest.raises(ValueError, match="game end"):
        build_opportunity_evidence(**request)


def test_missing_role_counts_do_not_claim_role_evidence():
    request = payload()
    request["player_games"][0].update(targets=None, carries=None)
    result = build_opportunity_evidence(**request)
    assert not result["capabilities"]["historical_role_evidence"]
    assert result["players"][0]["observed_games"] == 0


def test_exact_immutable_ids_are_not_trimmed_or_float_converted():
    request = payload()
    request["players"][0]["canonical_id"] = " p1 "
    with pytest.raises(ValueError, match="padding"):
        build_opportunity_evidence(**request)
    request = payload()
    large_id = "9007199254740993123456789"
    request["players"][0]["canonical_id"] = large_id
    request["player_games"][0]["canonical_id"] = large_id
    assert build_opportunity_evidence(**request)["players"][0]["canonical_id"] == large_id


def test_reader_rejects_future_decision_cutoff_at_actual_read_time(tmp_path):
    request = payload()
    request["decision_at"] = "2027-01-01T00:00:00Z"
    result = prepare_opportunity_artifact(request, directory=tmp_path)
    with pytest.raises(ValueError, match="future"):
        read_opportunity_artifact(CONTEXT, directory=tmp_path, now="2026-10-12T00:00:00Z")
    assert read_opportunity_artifact(CONTEXT, directory=tmp_path, now="2027-01-02T00:00:00Z") == result


@pytest.mark.parametrize("cutoff", ["2026-09-20T17:00:00Z", "2026-09-20T17:00:01Z"])
def test_live_evidence_cutoff_must_precede_every_target_kickoff(cutoff):
    request = payload()
    request["evidence_scope"] = "live"
    request["sources"][0]["evidence_scope"] = "live"
    request["decision_at"] = cutoff
    with pytest.raises(ValueError, match="pre-lock"):
        build_opportunity_evidence(**request)
