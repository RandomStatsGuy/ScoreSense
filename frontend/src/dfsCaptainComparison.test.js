import test from "node:test";
import assert from "node:assert/strict";
import { captainComparisonRequest } from "./dfsCaptainComparisonRequest.js";
import { captainComparisonSummary } from "./dfsToolPresentation.js";

test("comparison preserves lineup constraints without mutating portfolio settings", () => {
  const original = { lineup_count: 20, max_exposure: .5, randomness: .25, captain_exposure_limits: { p1: .2 },
    salary_cap: 49000, min_salary: 48000, max_per_team: 4, locked_player_ids: ["p1"], excluded_player_ids: ["p2"],
    locked_captain_id: "p1", objective: "ceiling", projection_overrides: { p1: { proj: 20 } } };
  const copy = structuredClone(original);
  const request = captainComparisonRequest(original);
  assert.deepEqual(original, copy);
  assert.equal(request.include_captain_comparison, true);
  assert.equal(request.lineup_count, 1);
  assert.equal(request.max_exposure, null);
  assert.equal(request.randomness, 0);
  assert.deepEqual(request.captain_exposure_limits, {});
  for (const key of ["salary_cap", "min_salary", "max_per_team", "locked_player_ids", "excluded_player_ids", "locked_captain_id", "objective", "projection_overrides"])
    assert.deepEqual(request[key], original[key]);
});

const solved = { status: "optimal", objective_score: 12, result: { validation: { ok: true }, lineup: Array(6).fill({}) } };
test("only validated full candidates count as solved", () => {
  const report = { complete: true, eligible_captains: 2, evaluated_captains: 2, objective: "median", candidates: [solved, { status: "infeasible" }] };
  assert.equal(captainComparisonSummary(report).complete, true);
  assert.equal(captainComparisonSummary(report).solved.length, 1);
  assert.equal(captainComparisonSummary(report).objective, "Sum of player P50s");
  for (const broken of [{ ...solved, objective_score: NaN }, { ...solved, result: {} }, { status: "unresolved" }, { status: "not_evaluated" }]) {
    const summary = captainComparisonSummary({ ...report, candidates: [solved, broken] });
    assert.equal(summary.complete, false);
    assert.equal(summary.solved.length, 1);
  }
  assert.equal(captainComparisonSummary({ ...report, candidates: [solved] }).complete, false);
  assert.equal(captainComparisonSummary(null).complete, false);
});
