import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkLateSwapAdmission, readLateSwapFile, lateSwapPreviewRequest, validateLateSwapPreview, validateLateSwapPlan, portableLateSwapPlan, runLateSwapTask, LATE_SWAP_SLOTS } from "./dfsLateSwap.js";
import { DFS_LATE_SWAP_COPY as C } from "./dfsToolPresentation.js";

const fixture = JSON.parse(await readFile(new URL("../test-fixtures/dfs-late-swap-data.json", import.meta.url), "utf8"));
const copy = value => structuredClone(value), data = fixture.package;
const request = { ...lateSwapPreviewRequest(data, data.context), package_id: fixture.preview.content_id };

test("actual-engine snapshot and exact-slot proposal validate without granting platform capability", () => {
  assert.equal(validateLateSwapPreview(fixture.preview, request), fixture.preview);
  assert.equal(validateLateSwapPlan(fixture.report, request, fixture.preview), fixture.report);
  assert.equal(fixture.report.capabilities.platform_export_ready, false);
  assert.equal(fixture.report.capabilities.current_lock_verified, false);
  assert.equal(fixture.report.capabilities.accepted_readback_authenticated, false);
});
test("actual normalized engine output preserves alias teams, uppercase receipts and decimal precision", () => {
  const value = fixture.normalized, request = { ...lateSwapPreviewRequest(value.package, value.package.context), package_id: value.preview.content_id };
  assert.equal(validateLateSwapPreview(value.preview, request), value.preview);
  assert.equal(validateLateSwapPlan(value.report, request, value.preview), value.report);
});
test("source declarations require every permission before any API upload", () => {
  for (const permission of ["personal_analysis", "hosted_ingestion", "display"]) {
    const value = copy(data); value.sources[0].rights[permission] = false;
    assert.throws(() => checkLateSwapAdmission(value, value.context), { message: C.rightsError });
    delete value.sources[0].rights[permission];
    assert.throws(() => checkLateSwapAdmission(value, value.context), { message: C.rightsError });
  }
});
test("unknown kickoff and lock states block the supplied snapshot locally", () => {
  for (const [field, invalid] of [["lock_state", "unknown"], ["kickoff_at", null], ["kickoff_at", "1:00 PM ET"]]) {
    const value = copy(data); value.catalog[0][field] = invalid;
    assert.throws(() => checkLateSwapAdmission(value, value.context), { message: C.lockError });
  }
});
test("private entry identities stay exact strings and imports are bounded", () => {
  const value = copy(data); value.accepted_state.entries[0].entry_id = 123;
  assert.throws(() => checkLateSwapAdmission(value, value.context));
  const excess = copy(data); excess.candidates = Array.from({ length: 601 }, (_, i) => ({ ...copy(data.candidates[0]), candidate_id: `alternative-${i}` }));
  assert.throws(() => checkLateSwapAdmission(excess, excess.context));
  assert.throws(() => readLateSwapFile('a'.repeat(8 * 1024 * 1024 + 1), data.context), { message: C.sizeError });
});
test("unsafe, duplicate and nonfinite JSON cannot reach the preview request", () => {
  for (const value of ['{"schema_version":"a","schema_version":"b"}', '{"__proto__":{}}', '{"value":1e9999}']) assert.throws(() => readLateSwapFile(value, data.context));
});
test("a different exact slate is not admitted", () => {
  assert.throws(() => checkLateSwapAdmission(data, { ...data.context, slate_id: "another-slate" }), { message: C.contextError });
});
test("preview normalization accepts equivalent timestamp offsets and source order", () => {
  const value = copy(data); value.sources.reverse();
  for (const row of value.sources) row.as_of = new Date(row.as_of).toISOString();
  value.contest.as_of = new Date(value.contest.as_of).toISOString();
  assert.equal(validateLateSwapPreview(fixture.preview, { context: value.context, package: value }), fixture.preview);
});
test("forged preview capabilities, counts and private source receipts are rejected", () => {
  for (const mutate of [v => v.capabilities.platform_export_ready = true, v => v.capabilities.accepted_readback_authenticated = true,
    v => v.locked_slot_count++, v => v.sources[0].content_sha256 = "f".repeat(64), v => v.context.slate_id = "wrong"]) {
    const value = copy(fixture.preview); mutate(value);
    assert.throws(() => validateLateSwapPreview(value, request), { message: C.responseError });
  }
});
test("started player identity stays in its exact WR slot rather than moving to FLEX", () => {
  const value = copy(fixture.report), entry = value.entries.find(row => Object.keys(row.locked_slots).some(slot => slot.startsWith("WR")));
  assert.ok(entry, "synthetic engine fixture contains a started WR");
  const slot = Object.keys(entry.locked_slots).find(slot => slot.startsWith("WR"));
  [entry.after_slots[slot], entry.after_slots.FLEX] = [entry.after_slots.FLEX, entry.after_slots[slot]];
  assert.throws(() => validateLateSwapPlan(value, request, fixture.preview), { message: C.responseError });
});
test("response cannot omit or duplicate an accepted entry", () => {
  for (const mutate of [v => v.entries.pop(), v => v.entries[1] = copy(v.entries[0])]) {
    const value = copy(fixture.report); mutate(value);
    assert.throws(() => validateLateSwapPlan(value, request, fixture.preview), { message: C.responseError });
  }
});
test("changed candidate membership, exact IDs, salary and input sums are independently rechecked", () => {
  for (const mutate of [v => v.entries[0].salary_after++, v => v.entries[0].projection_after = "999999",
    v => v.proposed.projection_sum = "999999", v => v.entries[0].lineup[0].dfs_id = "999999",
    v => v.entries[0].after_slots.QB = "unknown-athlete", v => v.changes.push({ entry_id: "other-entry" })]) {
    const value = copy(fixture.report); mutate(value);
    assert.throws(() => validateLateSwapPlan(value, request, fixture.preview));
  }
});
test("hard collection exposure remains binding on all accepted appearances", () => {
  const value = copy(data), pid = fixture.report.entries[0].after_slots.WR1;
  value.controls.player_exposure_limits = { [pid]: { max: { count: 0 } } };
  assert.throws(() => validateLateSwapPlan(fixture.report, { ...request, package: value }, fixture.preview), { message: C.responseError });
});
test("global fractional caps round down exactly at a whole-count boundary", () => {
  const value = copy(data); value.controls.max_exposure = "0.999999999999999999999999";
  assert.throws(() => validateLateSwapPlan(fixture.report, { ...request, package: value }, fixture.preview), { message: C.responseError });
});
test("a selected candidate ID must belong to the same accepted entry and exact slots", () => {
  const value = copy(fixture.report); value.entries[0].candidate_id = "unrelated-candidate";
  assert.throws(() => validateLateSwapPlan(value, request, fixture.preview), { message: C.responseError });
});
test("a response cannot claim current locks, forecast returns or a different package", () => {
  for (const mutate of [v => v.package_id = "f".repeat(64), v => v.capabilities.expected_payout = true,
    v => v.capabilities.current_lock_verified = true, v => v.audit.locked_slots_preserved = false,
    v => delete v.audit, v => v.audit = null, v => v.audit.issues = null,
    v => { v.solver.proven_optimal = true; v.solver.status = "feasible_time_limit"; }]) {
    const value = copy(fixture.report); mutate(value);
    assert.throws(() => validateLateSwapPlan(value, request, fixture.preview), { message: C.responseError });
  }
});
test("personal plan retains complete frozen package without creating a platform file", () => {
  const review = { package: data, summary: fixture.preview, report: fixture.report }, value = portableLateSwapPlan(review);
  assert.deepEqual(value.package, data); assert.deepEqual(value.report, fixture.report);
  assert.equal(value.schema_version, "scoresense_late_swap_plan_review_v1");
  assert.equal(Object.hasOwn(value, "csv"), false); assert.match(value.archive_scope, /no platform acceptance or submission/i);
  assert.equal(LATE_SWAP_SLOTS.length, 9);
});
test("background parsing aborts before construction when already cancelled", async () => {
  const previous = globalThis.Worker; let constructed = false;
  globalThis.Worker = class { constructor() { constructed = true; } };
  try { const controller = new AbortController(); controller.abort(); await assert.rejects(runLateSwapTask("read", {}, controller.signal), { name: "AbortError" }); assert.equal(constructed, false); }
  finally { globalThis.Worker = previous; }
});
test("plain labels identify a personal snapshot plan and do not imply submission", () => {
  assert.equal(C.title, "Plan late swaps"); assert.match(C.scope, /snapshot comparison/i);
  assert.match(C.exportGate, /unavailable/i); assert.doesNotMatch(C.download, /submit|upload|entry-update/i);
});
