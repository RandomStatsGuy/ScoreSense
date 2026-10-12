"""Synthetic arithmetic/diagnostic fixtures; no original 20-lineup audit."""
from copy import deepcopy
import json
import pytest

from src.products.dfs_showdown_integrity import (
    audit_showdown_lineup, normalize_injury_status, player_provenance,
    score_lineup, showdown_portfolio_review,
)


def row(pid, *, team="BUF", position="WR", slot="FLEX", proj=10., ceiling=20., salary=5000, **extra):
    return {"player_id": pid, "team": team, "position": position, "slot": slot,
            "proj": proj, "ceiling": ceiling, "floor": 3., "salary": salary,
            "diagnostics": {"projection_statistic": "median", "availability_conditioning": "conditional_active",
                            "score_system_id": "scoresense_ppr", "build_injury_status": "Active"}, **extra}


def test_ceiling_scoring_uses_already_weighted_captain_once_and_separates_projection():
    rows = [row("c", slot="CPT", proj=15, ceiling=30, salary=7500, multiplier=1.5), row("f")]
    score = score_lineup(rows, "ceiling")
    assert score["objective_score"] == 50
    assert score["projection_sum"] == 25
    assert score["objective_label"] == "P90-input score"
    assert score["captain_multiplier_applied"] is True
    assert "Not a predicted lineup percentile" in score["objective_semantics"]
    assert [r["salary"] for r in rows] == [7500, 5000]


def test_exact_coefficients_avoid_display_rounding_drift():
    rows = [row(str(i), proj=1.11, objective_coefficient=2.225, projection_coefficient=1.114) for i in range(6)]
    score = score_lineup(rows, "ceiling")
    assert score["objective_score"] == pytest.approx(13.35)
    assert score["projection_sum"] == pytest.approx(6.684)
    assert score["display_precision"] == 2
    assert score["numeric_tolerance"] == 1e-8


def test_median_is_sum_of_player_medians_and_value_has_distinct_units():
    rows = [row("c", slot="CPT", proj=15, salary=7500), row("f")]
    median, value = score_lineup(rows, "median"), score_lineup(rows, "value")
    assert median["objective_label"] == "Sum of player medians"
    assert median["objective_score"] == 25
    assert "not a lineup median" in median["objective_semantics"]
    assert value["objective_score"] == 4
    assert value["objective_units"] == "points_per_1000_salary_sum"
    assert value["objective_label"] == "Value-input score"


def test_unknown_and_mixed_projection_semantics_are_not_filled_or_called_means():
    rows = [row("a"), row("b", diagnostics={})]
    assert score_lineup(rows, "median")["projection_statistic"] == "unknown"
    assert score_lineup(rows, "median")["score_system_id"] == "unknown"
    rows[1]["diagnostics"]["projection_statistic"] = "mean"
    assert score_lineup(rows, "median")["projection_statistic"] == "mixed"
    assert score_lineup(rows, "median")["objective_label"] == "Mixed projection sum"
    rows[0]["proj"] = None
    assert score_lineup(rows, "median")["projection_sum"] is None


@pytest.mark.parametrize(("raw", "expected"), [("Q", "Questionable"), ("D", "Doubtful"), ("O", "Out"),
    ("injured reserve", "IR"), ("Reserve/PUP", "PUP"), ("Questionable - ankle", "Questionable"),
    ("limited practice", "Limited"), ("Active", "Active"), (None, "Unknown"), ("", "Unknown"), ("mystery", "Unknown")])
def test_status_variants_keep_unknown_distinct(raw, expected):
    assert normalize_injury_status(raw) == expected


def test_provenance_preserves_frozen_build_status_without_invented_role_components():
    original = {"player_id": "p", "Injury Status": "Q", "Projected Points": 10., "Low (P10)": 0., "High (P90)": 18.}
    frozen = player_provenance(original, pool_metadata={"built_at": "2026-10-12T12:00:00Z", "season": 2026, "week": 5})
    original["Injury Status"] = "Active"
    assert frozen["build_injury_status"] == "Questionable"
    assert frozen["injury_status_at"] is None  # forecast creation is not a status timestamp
    assert frozen["forecast_at"] == "2026-10-12T12:00:00Z"
    for key in ("role_evidence", "current_role_estimate", "predicted_zero_probability", "own_status_adjustment", "teammate_opportunity_adjustment"):
        assert frozen[key] is None
    assert frozen["availability_conditioning"] == "unknown"
    assert frozen["raw_inputs"]["basis"] == "FLEX"
    json.dumps(frozen, allow_nan=False)


def test_imported_override_does_not_inherit_replaced_model_semantics():
    frozen = player_provenance({"projection_source": "Imported", "projection_statistic": "median",
        "availability_conditioning": "conditional_active", "projection_model": "some-model",
        "Opportunity Adjustment": .2, "availability_adjustment": 0., "driver_player_ids": ["old-driver"],
        "Projected Points": 4., "Low (P10)": 1., "High (P90)": 10.})
    assert frozen["projection_statistic"] == "unknown"
    assert frozen["availability_conditioning"] == "unknown"
    assert frozen["model"] is None
    assert frozen["teammate_opportunity_fraction"] is None
    assert frozen["driver_player_ids"] == []
    assert frozen["imported_override"] is True


def test_strategy_pairing_requires_verified_mapping_and_does_not_accept_backup():
    rows = [row("receiver", slot="CPT"), row("backup", position="QB")]
    required = {"receiver_captain_qb": "require", "qb_by_team": {"BUF": ["starter"]}}
    findings = audit_showdown_lineup(rows, showdown_rules=required)
    finding = next(f for f in findings if f["code"] == "receiver_captain_without_qb")
    assert finding["severity"] == "error"
    assert finding["evidence_basis"]["kind"] == "strategy_policy"
    assert "receiver_captain_qb_unknown" in {f["code"] for f in audit_showdown_lineup(rows)}
    rows.append(row("starter", position="QB"))
    assert "receiver_captain_without_qb" not in {f["code"] for f in audit_showdown_lineup(rows, showdown_rules=required)}


@pytest.mark.parametrize("policy", ["warn", "off"])
def test_strategy_exception_remains_warning_and_records_off(policy):
    findings = audit_showdown_lineup([row("r", slot="CPT")], showdown_rules={"receiver_captain_qb": policy, "qb_by_team": {"BUF": ["q"]}})
    finding = next(f for f in findings if f["code"] == "receiver_captain_without_qb")
    assert finding["severity"] == "warning"
    assert finding["policy_overridden"] is (policy == "off")


@pytest.mark.parametrize("captain_position", ["QB", "DST", "RB"])
def test_opposing_dst_and_shared_backfield_are_nonblocking(captain_position):
    qb = row("q", position="QB", slot="CPT" if captain_position == "QB" else "FLEX")
    dst = row("d", team="LA", position="DST", slot="CPT" if captain_position == "DST" else "FLEX")
    rb = row("r", position="RB", slot="CPT" if captain_position == "RB" else "FLEX")
    rows = [qb, dst, rb, row("r2", position="RB"), row("w")]
    findings = audit_showdown_lineup(rows)
    assert "qb_opposing_dst" in {f["code"] for f in findings}
    assert "shared_backfield" in {f["code"] for f in findings}
    assert all(f["severity"] != "error" for f in findings)
    # No blanket offense-against-DST prohibition or coefficient mutation.
    assert not any(f["code"] == "offense_opposing_dst" for f in findings)
    assert rows[4]["proj"] == 10


def test_declared_unresolved_dependencies_and_selected_injury_have_evidence():
    diag = {"build_injury_status": "Q", "injury_status_at": "2026-10-12T12:00:00Z", "unresolved_personnel_ids": ["driver"], "availability_conditioning": "conditional_active"}
    rows = [row("a", diagnostics=diag), row("b", diagnostics=deepcopy(diag))]
    findings = audit_showdown_lineup(rows)
    shared = next(f for f in findings if f["code"] == "shared_personnel_assumption")
    assert shared["player_ids"] == ["a", "b"]
    assert shared["evidence_basis"]["driver_player_id"] == "driver"
    assert sum(f["code"] == "selected_availability" for f in findings) == 2


def test_exposure_decomposition_uses_actual_generated_denominator_and_never_deduplicates_entries():
    lineups = []
    for i in range(20):
        slot = "CPT" if i < 8 else "FLEX"
        rows = [row("p", slot=slot)] if i < 12 else [row("other", slot="CPT")]
        lineups.append({"lineup": rows})
    report = showdown_portfolio_review(lineups)
    player = next(item for item in report["exposures"] if item["player_id"] == "p")
    assert player == {"player_id": "p", "total_count": 12, "captain_count": 8, "flex_count": 4,
                      "total_share": .6, "captain_share": .4, "flex_share": .2, "denominator": 20}
    assert len(report["lineups"]) == 20
    assert report["policy"]["receiver_captain_qb"] == "legacy"


def test_role_unavailable_is_information_not_an_automatic_review_warning():
    report = showdown_portfolio_review([{"lineup": [row("qb", position="QB", slot="CPT")]}])
    assert report["needs_review_count"] == 0
    assert report["lineups"][0]["findings"][0]["code"] == "role_unavailable"


def test_pair_counts_and_review_group_counts_are_actual_and_stable():
    rows = [row("a", position="RB", slot="CPT"), row("b", position="RB")]
    report = showdown_portfolio_review([{"lineup": rows}, {"lineup": rows}])
    assert report["needs_review_count"] == 2
    assert report["pair_counts"] == [{"player_ids": ["a", "b"], "count": 2, "share": 1.}]
    assert next(f for f in report["finding_groups"] if f["code"] == "shared_backfield")["lineup_count"] == 2
    assert report == showdown_portfolio_review([{"lineup": rows}, {"lineup": rows}])


def test_artifact_provenance_survives_concat_without_guessing_model_or_component_points():
    import pandas as pd
    from src.projections.dfs_pool import with_forecast_provenance
    frame = pd.DataFrame([{"player_id": "p", "Player": "Synthetic", "Team": "BUF", "Position": "WR",
        "projection_source": "ScoreSense", "Projected Points": 10., "Low (P10)": 2., "High (P90)": 20.,
        "Opportunity Adjustment": .2}])
    frame.attrs["built_at"] = "2026-10-12T12:00:00Z"
    annotated = with_forecast_provenance(frame, season=2026, week=5, injury_adjusted=True)
    merged = pd.concat([annotated, pd.DataFrame([{"player_id": "unavailable"}])], ignore_index=True)
    provenance = player_provenance(merged.iloc[0].to_dict())
    assert provenance["forecast_at"] == frame.attrs["built_at"]
    assert provenance["projection_statistic"] == "median"
    assert provenance["availability_conditioning"] == "conditional_active"
    assert provenance["own_status_adjustment"] == 0
    assert provenance["teammate_opportunity_fraction"] == .2
    assert provenance["teammate_opportunity_adjustment"] is None
    assert provenance["model"] is None
    assert provenance["adjustments_embedded"] is True
    assert len(provenance["forecast_snapshot_id"]) == 64
    assert "projection_statistic" not in frame


def test_artifact_read_stamps_new_timestamp_and_staleness_without_rewriting_frozen_rows():
    import pandas as pd
    from src.projections.dfs_pool import with_forecast_provenance
    frame = pd.DataFrame([{"player_id": "p", "Position": "WR", "projection_source": "ScoreSense", "Projected Points": 10.,
                           "projection_built_at": None, "projection_stale": False}])
    frame.attrs.update(built_at="2026-10-12T12:00:00Z", projection_stale=True)
    annotated = with_forecast_provenance(frame, season=2026, week=5, injury_adjusted=True)
    assert annotated.iloc[0].projection_built_at == frame.attrs["built_at"]
    assert bool(annotated.iloc[0].projection_stale) is True
    assert frame.iloc[0].projection_built_at is None
    assert bool(frame.iloc[0].projection_stale) is False


def test_forecast_trace_reports_other_week_and_missing_requested_context(tmp_path):
    import pandas as pd
    from scripts.dev.trace_showdown_forecasts import trace_forecast_archives
    directory = tmp_path / "artifacts" / "weekly_predictions"
    directory.mkdir(parents=True)
    metadata = {"season": 2026, "week": 1, "position": "wr", "apply_injury_adjustments": True,
                "built_at": "2026-06-25T00:00:00Z", "rows": 1}
    (directory / "2026_w1_wr.meta.json").write_text(json.dumps(metadata))
    pd.DataFrame([{"Player": "Synthetic Player", "player_id": "p", "Projected Points": 1., "Low (P10)": 0., "High (P90)": 3.}]).to_parquet(directory / "2026_w1_wr.parquet")
    report = trace_forecast_archives(tmp_path, season=2026, week=5, player_names=["Synthetic Player", "Missing"])
    assert report["requested_weekly_archives_present"] == 0
    assert report["requested_deep_dfs_pool_present"] is False
    assert report["original_twenty_lineup_audit_reproduced"] is False
    assert report["player_traces"][0]["archive_rows"][0]["requested_context"] is False
    assert report["player_traces"][1]["archive_rows"] == []
    assert report["read_failures"] == []
