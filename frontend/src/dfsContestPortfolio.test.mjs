import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { frozenProjectionScores, frozenPortfolioConstraints, contestPortfolioRequest, validateContestPortfolio,
  portableContestPortfolio, runContestPortfolioTask } from "./dfsContestPortfolio.js";

const fixture = JSON.parse(await readFile(new URL("../test-fixtures/dfs-contest-portfolio-data.json", import.meta.url), "utf8"));
const shared = JSON.parse(await readFile(new URL("../test-fixtures/dfs-shared-data.json", import.meta.url), "utf8"));
const contest = JSON.parse(await readFile(new URL("../test-fixtures/dfs-contest-data.json", import.meta.url), "utf8"));
const copy = value => structuredClone(value);
const snapshot = { ...fixture.engine_inputs, bank: undefined, bank_id: shared.summary.content_id, input_snapshot_id: "scenario:synthetic",
  scope: "build", labels: ["Lineup 1", "Lineup 2"], player_labels: Object.fromEntries(shared.ui_pool.map(row => [row.player_id, row.Player])),
  controls: { settings: { objective: "median", differences: 2, exposure: 1, maxSalary: 50000 },
    playerInputs: shared.ui_pool.map(row => [row.player_id, row["Projected Points"], row["Low (P10)"], row["High (P90)"]]) } };
const selected = { summary: shared.summary, bank: fixture.engine_inputs.bank, snapshot };
const chosen = { file: { value: fixture.contest_file }, summary: contest.summary };
const settings = { count: 1, scenarioId: fixture.settings.scenario_id, objective: "conditional_mean_net", seed: 0, draws: 128, topK: 10, riskAlpha: "0.9", riskWeight: "1" };
const request = async overrides => contestPortfolioRequest(selected, chosen, { ...settings, ...overrides });
const response = (request, mode = request.objective) => ({ ...copy(fixture.evaluations[mode]), input_snapshot_id: request.input_snapshot_id, selection_request_id: request.selection_request_id });

test("all three actual-engine proposal objectives validate against exact frozen inputs", async () => {
  for (const objective of Object.keys(fixture.evaluations)) {
    const input = await request({ objective }), value = response(input);
    assert.equal(validateContestPortfolio(value, input), value);
    assert.equal(value.capabilities.expected_payout, false);
    assert.equal(value.selected_count, 1); assert.equal(value.selected.evaluation.opponent_entry_count, 100);
  }
});
test("projection baseline scores come from the frozen player goal, never mutable lineup totals", () => {
  assert.deepEqual(frozenProjectionScores(snapshot), { "current:0": "93.6", "current:1": "94.2" });
  const lower = copy(snapshot); lower.controls.settings.objective = "floor";
  const result = frozenProjectionScores(lower);
  assert.equal(Number(result["current:0"]), lower.lineups[0].player_ids.reduce((sum, id) => sum + lower.controls.playerInputs.find(row => row[0] === id)[2], 0));
  const missing = copy(snapshot); missing.controls.playerInputs[0][1] = null;
  assert.throws(() => frozenProjectionScores(missing), /finite/);
});
test("request versions change with goal, count, risk and native hard constraints", async () => {
  const first = await request(), again = await request(), risk = await request({ objective: "conditional_risk_adjusted_net", riskWeight: "2" });
  assert.equal(first.selection_request_id, again.selection_request_id); assert.notEqual(first.selection_request_id, risk.selection_request_id);
  assert.match(first.selection_request_id, /^selection:[a-f0-9]{64}$/);
  for (const overrides of [{ count: 0 }, { count: 3 }, { scenarioId: "absent" }, { riskWeight: "101" }, { riskWeight: "NaN" }, { objective: "forecast_ev" }])
    await assert.rejects(request(overrides));
});
test("native player and core bounds round for the requested set and preserve locks", () => {
  const value = copy(snapshot); value.controls.settings.portfolioMode = "global"; value.controls.locked = ["buf-qb"];
  value.controls.globalExposure = { "mia-wr2": { unit: "percent", min: "50", max: "100" } };
  value.controls.globalGroups = [{ id: "pair", player_ids: ["buf-qb", "buf-wr2"], unit: "count", min: "1" }];
  const result = frozenPortfolioConstraints(value, 1);
  assert.deepEqual(result.locked_player_ids, ["buf-qb"]); assert.equal(result.player_exposure_limits["mia-wr2"].min, "0.5");
  assert.deepEqual(result.group_exposure_limits[0].min, { count: 1 });
  value.controls.globalExposure["buf-qb"] = { unit: "count", max: "0" };
  assert.throws(() => frozenPortfolioConstraints(value, 1), /locked/);
});
test("collection count limits merge conservatively and conflicting preferences fail visibly", () => {
  const value = copy(snapshot); value.scope = "collection"; value.controls.settings.portfolioMode = "global";
  value.controls.globalExposure = { "mia-wr2": { unit: "count", max: "1", target: "1" } };
  value.controls.portfolioRules = { version: 1, players: { "mia-wr2": { min: "1", target: "1" } }, groups: [] };
  value.controls.portfolioLimits = { "buf-qb": "1" };
  assert.deepEqual(frozenPortfolioConstraints(value, 1).player_exposure_limits["mia-wr2"], { min: { count: 1 }, target: { count: 1 }, max: { count: 1 } });
  value.controls.portfolioRules.players["mia-wr2"].target = "0";
  assert.throws(() => frozenPortfolioConstraints(value, 1), /conflict/);
  value.controls.portfolioRules.players["mia-wr2"].target = "1"; value.controls.portfolioRules.players["mia-wr2"].min = "2";
  assert.throws(() => frozenPortfolioConstraints(value, 1));
});
test("legacy stack allocations are not silently removed from a proposal", () => {
  for (const edit of [v => v.controls.settings.qbStack = 2, v => v.controls.stackWeights = { example: 0.5 }, v => v.controls.stackScope = { teams: ["BUF"] }]) {
    const value = copy(snapshot); edit(value); assert.throws(() => frozenPortfolioConstraints(value, 1), /legacy stack/);
  }
});
test("proposal responses reject changed inputs, promoted forecasts and wrong counts", async () => {
  const input = await request();
  const edits = [v => v.selection_request_id = "selection:stale", v => v.input_snapshot_id = "old", v => v.capabilities.expected_payout = true,
    v => v.capabilities.untouched_evaluation_verified = true, v => v.requested_count++, v => v.selected_count = 0,
    v => v.input_manifest.max_overlap = 9, v => v.input_manifest.candidates[0].projection_score = "999", v => v.objective.mode = "forecast_ev",
    v => v.stream_manifest.evaluation_seed = v.stream_manifest.selection_seed, v => v.solver.proven_optimal = false,
    v => v.solver.baseline_proven_exact = true, v => v.solver.target_optimum_proven_exact = true,
    v => v.solver.target_stage_status = "optimal", v => v.solver.bound_scope = "global expected return", v => v.solver.stop_reason = "time_limit"];
  for (const edit of edits) { const value = response(input); edit(value); assert.throws(() => validateContestPortfolio(value, input)); }
});
test("selected roster membership and original hard controls are independently recounted", async () => {
  const input = await request();
  const edits = [v => v.selected_lineups[0].player_ids[0] = "other", v => v.selected.lineup_ids[0] = "absent",
    v => v.selected.evaluation.own_entry_count++, v => v.selected.evaluation.opponent_entry_count--,
    v => v.selected.evaluation.assumptions[0].lineups[0].lineup_id = "other", v => v.exposure_violations.push({ actual_count: 2 })];
  for (const edit of edits) { const value = response(input); edit(value); assert.throws(() => validateContestPortfolio(value, input)); }
  const locked = { ...input, excluded_player_ids: ["buf-qb"] }, value = response(input);
  value.input_manifest.excluded_player_ids = ["buf-qb"];
  assert.throws(() => validateContestPortfolio(value, locked));
});
test("actual infeasible search yields no partial set or invented fallback", async () => {
  const input = await request({ count: 2 }), value = { ...copy(fixture.failures.count2), input_snapshot_id: input.input_snapshot_id, selection_request_id: input.selection_request_id };
  assert.equal(validateContestPortfolio(value, input), value); assert.equal(value.complete, false);
  assert.deepEqual(value.selected_lineups, []); assert.equal(value.selected, null); assert.equal(value.baseline, null);
});
test("exact objective arithmetic and common review draws reject corrupted metrics", async () => {
  const input = await request();
  const edits = [v => v.selected.evaluation_metrics.risk_adjusted_net_cents.numerator = "9",
    v => v.selected.selection_metrics.top_finish_fraction.numerator = "9999",
    v => v.selected.evaluation_metrics.net_distribution.p10_cents.numerator = "99999999999999",
    v => v.selected.evaluation_metrics.mean_net_cents.denominator = "0",
    v => v.baseline.evaluation.stream_manifest.game_draw_content_id = "f".repeat(64),
    v => v.stream_manifest.evaluation.field_draw_content_id = "f".repeat(64),
    v => v.comparison.evaluation_mean_net_difference_cents.numerator = "3"];
  for (const edit of edits) { const value = response(input); edit(value); assert.throws(() => validateContestPortfolio(value, input)); }
});
test("personal computed proposal keeps rosters while omitting raw third-party inputs", async () => {
  const input = await request(), value = portableContestPortfolio({ snapshot, preview: contest.summary, report: response(input) });
  assert.equal(value.report.selected_lineups.length, 1); const json = JSON.stringify(value);
  for (const key of ["templates", "ownership", "events", "bank"]) assert.equal(json.includes(`"${key}":`), false);
  assert.equal(value.report.capabilities.expected_payout, false);
});
test("cancellation terminates the proposal worker and ignores late replies", async () => {
  const original = globalThis.Worker; let worker;
  globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  try {
    const controller = new AbortController(), pending = runContestPortfolioTask("request", {}, controller.signal);
    controller.abort(); await assert.rejects(pending, { name: "AbortError" }); assert.equal(worker.terminated, true);
    worker.onmessage({ data: { ok: true, value: "late" } });
  } finally { globalThis.Worker = original; }
});
