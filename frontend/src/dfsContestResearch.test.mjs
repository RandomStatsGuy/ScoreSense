import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkContestAdmission, readContestFile, contestPreviewRequest, validateContestPreview, contestEvaluationRequest,
  validateContestReport, moneyFraction, portableContestReview, runContestTask } from "./dfsContestResearch.js";

const fixture = JSON.parse(await readFile(new URL("../test-fixtures/dfs-contest-data.json", import.meta.url), "utf8"));
const shared = JSON.parse(await readFile(new URL("../test-fixtures/dfs-shared-data.json", import.meta.url), "utf8"));
const selected = { summary: shared.summary, bank: shared.engine_inputs.bank,
  snapshot: { ...shared.engine_inputs, bank_id: shared.summary.content_id, input_snapshot_id: "scenario:synthetic" } };
const copy = v => structuredClone(v);
const request = () => contestEvaluationRequest(selected, fixture.file, fixture.summary, 0, 128, 10);
const report = () => ({ ...copy(fixture.evaluation), input_snapshot_id: selected.snapshot.input_snapshot_id });

test("actual-engine unsorted assumption file previews by identity and round-trips exact results", () => {
  assert.equal(readContestFile(JSON.stringify(fixture.file), selected).contest_field.scenarios.length, 2);
  assert.equal(validateContestPreview(fixture.summary, selected, fixture.file), fixture.summary);
  assert.deepEqual(contestPreviewRequest(selected, fixture.file).pool, selected.snapshot.pool);
  const response = validateContestReport(report(), request());
  assert.equal(response.opponent_entry_count, 99);
  assert.equal(response.capabilities.expected_payout, false);
});

test("server normalization of a valid uppercase payout digest and zoned time preserves preview", () => {
  const file = copy(fixture.file); file.payout_contract.tie_policy.source.content_sha256 = file.payout_contract.tie_policy.source.content_sha256.toUpperCase();
  file.payout_contract.tie_policy.source.as_of = new Date(file.payout_contract.tie_policy.source.as_of).toISOString();
  assert.equal(validateContestPreview(fixture.summary, selected, file), fixture.summary);
});

test("rights admission runs before hosted upload, with unknown permissions rejected", () => {
  for (const key of ["personal_analysis", "hosted_ingestion", "display"]) for (const value of [false, null, undefined]) {
    const file = copy(fixture.file); file.contest_field.sources[0].rights[key] = value;
    assert.throws(() => checkContestAdmission(file, selected), /permission/);
  }
});

test("unknown redistribution remains denied without blocking allowed personal analysis", () => {
  const file = copy(fixture.file); file.contest_field.sources[0].rights.redistribution = false;
  assert.equal(checkContestAdmission(file, selected), file);
});

test("file admission requires exact contest count, slate and decision snapshot", () => {
  const edits = [v => v.contest_field.context.slate_id = "wrong", v => v.contest_field.decision_at = "2026-10-13T00:00:00Z",
    v => v.payout_contract.contest_id = "other", v => v.payout_contract.entrant_count = 2,
    v => v.contest_field.contest.entrant_count = 102, v => v.extra = "unsupported",
    v => v.contest_field.mode = "calibrated_forecast", v => v.contest_field.scenarios = []];
  for (const edit of edits) { const file = copy(fixture.file); edit(file); assert.throws(() => checkContestAdmission(file, selected)); }
});

test("bounded parser rejects duplicate rights, nonfinite values and nesting", () => {
  assert.throws(() => readContestFile('{"contest_field":{},"contest_field":{}}', selected));
  assert.throws(() => readContestFile('{"x":1e999}', selected));
  assert.throws(() => readContestFile('{"a":'.repeat(26) + "0" + "}".repeat(26), selected));
  assert.throws(() => readContestFile(" ".repeat(8 * 1024 * 1024 + 1), selected));
});

test("preview rejects promoted capabilities, changed contract and duplicate assumption identities", () => {
  const edits = [v => v.capabilities.expected_payout = true, v => v.capabilities.ownership_calibrated = true,
    v => v.bank_id = "f".repeat(64), v => v.field.contest.entrant_count++, v => v.payout_contract.entry_fee_cents++,
    v => v.field.scenarios[1].scenario_id = v.field.scenarios[0].scenario_id,
    v => v.field.scenarios[0].provider = "different", v => v.content_id = "bad"];
  for (const edit of edits) { const value = copy(fixture.summary); edit(value); assert.throws(() => validateContestPreview(value, selected, fixture.file)); }
});

test("review settings and actual lineup identities cannot silently change", () => {
  for (const args of [[-1, 128, 10], [0, 1024, 10], [0, 128, 102], [0, 128, NaN], [0, 128, 1.5]])
    assert.throws(() => contestEvaluationRequest(selected, fixture.file, fixture.summary, ...args));
  const value = request(); assert.deepEqual(value.lineups, selected.snapshot.lineups);
  assert.equal(value.contest_research_id, fixture.summary.content_id);
});

test("responses require frozen IDs, full actual field and common game draws", () => {
  const edits = [v => v.input_snapshot_id = "old", v => v.bank_id = "f".repeat(64), v => v.contest_research_id = "a".repeat(64),
    v => v.opponent_entry_count--, v => v.own_entry_count++, v => v.top_k++, v => v.stream_manifest.seed++,
    v => v.stream_manifest.common_game_draws_across_assumptions = false, v => v.capabilities.forward_forecast = true,
    v => v.assumptions[1].scenario_id = v.assumptions[0].scenario_id, v => v.assumptions[0].lineups[0].lineup_id = "wrong"];
  for (const edit of edits) { const value = report(); edit(value); assert.throws(() => validateContestReport(value, request())); }
});

test("financial summaries reject missing metrics, nonfinite errors and corrupted rational values", () => {
  const edits = [v => delete v.assumptions[0].sampled_finish_fractions.top_k,
    v => v.assumptions[0].sampled_finish_fractions.cash = 1.01, v => v.assumptions[0].net.replay_standard_error_cents = Infinity,
    v => v.assumptions[0].fees_cents.numerator = "101", v => v.assumptions[0].net.mean_cents.denominator = "0",
    v => v.assumptions[0].net.p90_cents.numerator = "-99999999999"];
  for (const edit of edits) { const value = report(); edit(value); assert.throws(() => validateContestReport(value, request())); }
});

test("long exact draw-average fractions convert for display without integer loss or Infinity", () => {
  const unit = "USD_cents", numerator = "12345" + "0".repeat(3000), denominator = "1" + "0".repeat(3000);
  assert.equal(moneyFraction({ unit, numerator, denominator }), 12345);
  assert.equal(moneyFraction({ unit, numerator: "-17000", denominator: "3" }), -5666.666666);
  assert.throws(() => moneyFraction({ unit, numerator: "1", denominator: "0" }));
});

test("portable personal review omits raw bank, opponent constructions and ownership observations", () => {
  const review = { snapshot: selected.snapshot, preview: fixture.summary, report: report() };
  // The actual UI snapshot has user inputs only, rather than this test envelope's bank.
  delete review.snapshot.bank;
  const result = portableContestReview(review), json = JSON.stringify(result);
  assert.equal(result.assumptions.field.sources[0].rights.redistribution, false);
  assert.equal(json.includes('"templates"'), false); assert.equal(json.includes('"ownership"'), false);
  assert.equal(json.includes('"events"'), false);
  assert.equal(result.report.capabilities.expected_payout, false);
});

test("cancelling background processing terminates the worker and ignores late replies", async () => {
  const original = globalThis.Worker; let worker;
  globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  try {
    const controller = new AbortController(), operation = runContestTask("read", {}, controller.signal);
    controller.abort(); await assert.rejects(operation, { name: "AbortError" });
    assert.equal(worker.terminated, true); worker.onmessage({ data: { ok: true, value: "late" } });
  } finally { globalThis.Worker = original; }
});
